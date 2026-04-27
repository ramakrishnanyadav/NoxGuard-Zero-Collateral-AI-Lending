// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "fhevm/lib/TFHE.sol";

// ── Custom Errors ────────────────────────────────────────────────────────────
error NoxOracle__InvalidMrenclave(bytes32 provided, bytes32 expected);
error NoxOracle__InvalidSignature();
error NoxOracle__ScoreOutOfRange(uint64 score);
error NoxOracle__ReplayDetected(bytes32 taskId);
error NoxOracle__StaleScore(address user, uint256 issuedAt, uint256 stalenessWindow);
error NoxOracle__Unauthorised(address caller);
error NoxOracle__InvalidAddress();
error NoxOracle__ScoreTokenNotSet();

interface INoxScoreTokenWriter {
    function writeScore(
        address user,
        einput encryptedScore,
        bytes calldata inputProof
    ) external;
}

/**
 * @title  NoxOracle
 * @notice TEE callback receiver with MRENCLAVE attestation verification.
 *         Receives score submissions from the iExec Nox iApp running in SGX,
 *         verifies the SGX attestation signature, checks the MRENCLAVE hash,
 *         and writes the encrypted score to NoxScoreToken.
 *
 * @dev    MRENCLAVE = measurement of the SGX enclave code (like a code hash).
 *         If the iApp binary is tampered, MRENCLAVE changes → callback rejected.
 *
 *         Liveness fallback (RULE 4): if the TEE goes offline for >72h,
 *         any existing score is flagged as stale via `isScoreStale()`.
 *         Lenders MUST check staleness before approving credit.
 *
 *         Replay protection: each iExec task produces a unique taskId.
 *         We track processed taskIds to prevent double-submission.
 */
contract NoxOracle is Ownable, ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ── Constants ────────────────────────────────────────────────────────────

    /// @dev Maximum credit score value
    uint64 public constant MAX_SCORE = 1000;

    /// @dev Staleness window: 72 hours in seconds
    uint256 public constant STALENESS_WINDOW = 72 hours;

    // ── State ────────────────────────────────────────────────────────────────

    /// @dev The expected MRENCLAVE hash of the NoxGuard iApp Docker image
    bytes32 public trustedMrenclave;

    /// @dev The TEE attestation signing key address (recovered from SGX report)
    address public teeSignerAddress;

    /// @dev Reference to the score token contract
    INoxScoreTokenWriter public scoreToken;

    /// @dev Processed iExec task IDs (replay protection)
    mapping(bytes32 => bool) public processedTasks;

    /// @dev Last score issuance timestamp per user (for staleness check)
    mapping(address => uint256) public lastScoreTimestamp;

    // ── Events ───────────────────────────────────────────────────────────────

    event ScoreSubmitted(
        address indexed user,
        bytes32 indexed taskId,
        uint256 timestamp
    );

    event MrenclaveUpdated(bytes32 indexed oldHash, bytes32 indexed newHash);
    event TeeSignerUpdated(address indexed oldSigner, address indexed newSigner);
    event ScoreTokenSet(address indexed token);

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor(
        bytes32 _trustedMrenclave,
        address _teeSignerAddress
    ) Ownable(msg.sender) {
        if (_teeSignerAddress == address(0)) revert NoxOracle__InvalidAddress();
        trustedMrenclave  = _trustedMrenclave;
        teeSignerAddress  = _teeSignerAddress;
    }

    // ── Admin functions ──────────────────────────────────────────────────────

    function setScoreToken(address _scoreToken) external onlyOwner {
        if (_scoreToken == address(0)) revert NoxOracle__InvalidAddress();
        scoreToken = INoxScoreTokenWriter(_scoreToken);
        emit ScoreTokenSet(_scoreToken);
    }

    function updateMrenclave(bytes32 _newMrenclave) external onlyOwner {
        emit MrenclaveUpdated(trustedMrenclave, _newMrenclave);
        trustedMrenclave = _newMrenclave;
    }

    function updateTeeSigner(address _newSigner) external onlyOwner {
        if (_newSigner == address(0)) revert NoxOracle__InvalidAddress();
        emit TeeSignerUpdated(teeSignerAddress, _newSigner);
        teeSignerAddress = _newSigner;
    }

    // ── Core: TEE callback ───────────────────────────────────────────────────

    /**
     * @notice Called by the iExec Nox iApp after computing the credit score
     *         inside the SGX enclave. Verifies attestation before writing score.
     *
     * @dev    Verification flow:
     *         1. Verify MRENCLAVE hash matches trusted iApp binary
     *         2. Verify ECDSA signature from TEE signing key
     *         3. Verify task ID has not been processed (replay protection)
     *         4. Validate score range (0–1000)
     *         5. Forward encrypted score to NoxScoreToken
     *
     * @param user           Scored user's address
     * @param taskId         iExec task ID (32 bytes, unique per computation)
     * @param mrenclave      MRENCLAVE hash from the SGX report
     * @param encryptedScore fhevm-encrypted score ciphertext bytes
     * @param inputProof     fhevm input proof for the encrypted score
     * @param scoreRange     Plaintext score range for sanity check [min, max]
     *                       The TEE reveals only the range, not the exact score
     * @param attestationSig ECDSA signature over (user, taskId, mrenclave, scoreRange)
     *                       signed by the TEE's signing key inside the enclave
     */
    function submitScore(
        address         user,
        bytes32         taskId,
        bytes32         mrenclave,
        einput          encryptedScore,
        bytes calldata  inputProof,
        uint64[2] calldata scoreRange,
        bytes calldata  attestationSig
    ) external nonReentrant {
        if (address(scoreToken) == address(0)) revert NoxOracle__ScoreTokenNotSet();

        // ── 1. MRENCLAVE verification ────────────────────────────────────────
        if (mrenclave != trustedMrenclave) {
            revert NoxOracle__InvalidMrenclave(mrenclave, trustedMrenclave);
        }

        // ── 2. Replay protection ─────────────────────────────────────────────
        if (processedTasks[taskId]) revert NoxOracle__ReplayDetected(taskId);

        // ── 3. Score range sanity check ──────────────────────────────────────
        if (scoreRange[1] > MAX_SCORE) revert NoxOracle__ScoreOutOfRange(scoreRange[1]);

        // ── 4. Attestation signature verification ────────────────────────────
        // The TEE signs the payload using its private key that is bound to
        // the enclave (MRSIGNER key). The signature covers all critical fields.
        bytes32 payload = keccak256(abi.encodePacked(
            user,
            taskId,
            mrenclave,
            scoreRange[0],
            scoreRange[1]
        ));
        bytes32 ethHash = payload.toEthSignedMessageHash();
        address recovered = ethHash.recover(attestationSig);

        if (recovered != teeSignerAddress) revert NoxOracle__InvalidSignature();

        // ── 5. Mark task as processed ────────────────────────────────────────
        processedTasks[taskId] = true;

        // ── 6. Update staleness tracker ──────────────────────────────────────
        lastScoreTimestamp[user] = block.timestamp;

        // ── 7. Write encrypted score to NoxScoreToken ───────────────────────
        scoreToken.writeScore(user, encryptedScore, inputProof);

        emit ScoreSubmitted(user, taskId, block.timestamp);
    }

    // ── Liveness fallback ────────────────────────────────────────────────────

    /**
     * @notice Check if a user's score is stale (TEE liveness fallback).
     *         Scores older than STALENESS_WINDOW (72h) are considered stale.
     *         Lenders MUST verify freshness before approving credit.
     *
     * @param user Target address
     * @return stale    True if score is older than 72 hours
     * @return issuedAt Block timestamp of last score issuance
     * @return age      Age of score in seconds
     */
    function isScoreStale(address user) external view returns (
        bool stale,
        uint256 issuedAt,
        uint256 age
    ) {
        issuedAt = lastScoreTimestamp[user];
        if (issuedAt == 0) return (true, 0, type(uint256).max);
        age   = block.timestamp - issuedAt;
        stale = age > STALENESS_WINDOW;
    }
}
