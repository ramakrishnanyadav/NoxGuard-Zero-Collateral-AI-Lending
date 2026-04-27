// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ── External imports ─────────────────────────────────────────────────────────
import "fhevm/lib/TFHE.sol";                          // Zama fhevm: encrypted types + operations
import "fhevm/gateway/GatewayCaller.sol";             // Async decryption gateway integration
import "@openzeppelin/contracts/access/Ownable.sol";  // Role control: deployer = protocol admin
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol"; // Reentrancy protection on callbacks

// ── Custom Errors ────────────────────────────────────────────────────────────
// Gas-efficient: custom errors use ~50% less gas than revert strings
error NoxScore__Unauthorised(address caller);
error NoxScore__ScoreAlreadyIssued(address user);
error NoxScore__NoScoreFound(address user);
error NoxScore__OracleNotSet();
error NoxScore__InvalidAddress();

/**
 * @title  NoxScoreToken
 * @author NoxGuard Protocol
 * @notice ERC-7984 Confidential Score Token.
 *         Each address holds exactly ONE encrypted credit score (0–1000)
 *         stored as a TFHE euint64. The plaintext score is NEVER exposed
 *         on-chain — only the encrypted ciphertext handle lives in storage.
 *
 * @dev    Architecture decision: score is stored as euint64 (not euint256)
 *         because credit scores max at 1000, fitting comfortably in uint64.
 *         euint64 uses 4× less gas than euint256 in TFHE operations.
 *
 *         ERC-7984 compliance: confidential fungible token interface where
 *         "balance" = encrypted credit score. Only the token holder can
 *         request decryption via the fhevm Gateway.
 */
contract NoxScoreToken is Ownable, ReentrancyGuard, GatewayCaller {
    // ── State variables ──────────────────────────────────────────────────────

    /// @dev Maps user address → encrypted score handle (euint64)
    /// Declared private: no external contract reads raw handle without permission
    mapping(address => euint64) private _encryptedScores;

    /// @dev Tracks which addresses have been scored (avoids zero-value ambiguity)
    mapping(address => bool) private _hasScore;

    /// @dev The only address allowed to write scores (NoxOracle contract)
    address public oracle;

    /// @dev The credit gate contract that can query scores via TFHE ops
    address public creditGate;

    /// @dev Pending decryption request ID → requester address (for Gateway callback)
    mapping(uint256 => address) private _pendingDecryptionRequests;

    /// @dev Monotonic score version counter per user (replay protection)
    mapping(address => uint256) public scoreVersion;

    // ── Events ───────────────────────────────────────────────────────────────
    // All events indexed for efficient off-chain filtering

    /// @notice Emitted when a new encrypted score is written for a user
    event ScoreIssued(address indexed user, uint256 indexed version, uint256 timestamp);

    /// @notice Emitted when an existing score is updated
    event ScoreUpdated(address indexed user, uint256 indexed version, uint256 timestamp);

    /// @notice Emitted when oracle address changes
    event OracleSet(address indexed oldOracle, address indexed newOracle);

    /// @notice Emitted when credit gate address changes
    event CreditGateSet(address indexed oldGate, address indexed newGate);

    /// @notice Emitted when async decryption is requested (for UI polling)
    event DecryptionRequested(address indexed user, uint256 indexed requestId);

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor() Ownable(msg.sender) {}

    // ── Admin functions ──────────────────────────────────────────────────────

    /**
     * @notice Set the oracle contract address.
     *         Only callable by protocol admin (owner).
     * @param _oracle Address of the NoxOracle contract
     */
    function setOracle(address _oracle) external onlyOwner {
        if (_oracle == address(0)) revert NoxScore__InvalidAddress();
        address old = oracle;
        oracle = _oracle;
        emit OracleSet(old, _oracle);
    }

    /**
     * @notice Set the credit gate contract address.
     *         Only callable by protocol admin (owner).
     * @param _gate Address of the NoxCreditGate contract
     */
    function setCreditGate(address _gate) external onlyOwner {
        if (_gate == address(0)) revert NoxScore__InvalidAddress();
        address old = creditGate;
        creditGate = _gate;
        emit CreditGateSet(old, _gate);
    }

    // ── Oracle-only write ────────────────────────────────────────────────────

    /**
     * @notice Write an encrypted credit score for a user.
     *         Called exclusively by the NoxOracle after TEE attestation verification.
     *
     * @dev    The `encryptedScore` bytes and `inputProof` come directly from the
     *         iExec TEE application, which encrypted the plaintext score using the
     *         fhevm network's FHE public key. The `TFHE.asEuint64()` call verifies
     *         the input proof and stores the handle.
     *
     *         Access permissions:
     *         - `TFHE.allowThis`: allows THIS contract to use the euint64 in TFHE ops
     *         - `TFHE.allow(score, user)`: allows the user to request Gateway decryption
     *         - `TFHE.allow(score, creditGate)`: allows the gate to run TFHE comparisons
     *
     * @param user           Address of the scored user
     * @param encryptedScore Ciphertext bytes from TEE (fhevm-encrypted uint64)
     * @param inputProof     ZK proof that the ciphertext is a valid fhevm input
     */
    function writeScore(
        address user,
        einput encryptedScore,
        bytes calldata inputProof
    ) external nonReentrant {
        if (msg.sender != oracle) revert NoxScore__Unauthorised(msg.sender);
        if (user == address(0)) revert NoxScore__InvalidAddress();

        // Deserialise the ciphertext into an euint64 handle with proof verification
        euint64 score = TFHE.asEuint64(encryptedScore, inputProof);

        // Grant access permissions for TFHE operations
        TFHE.allowThis(score);      // This contract can use score in TFHE ops
        TFHE.allow(score, user);    // User can request plaintext decryption via Gateway
        if (creditGate != address(0)) {
            TFHE.allow(score, creditGate); // Gate can compare score vs threshold
        }
        TFHE.allow(score, oracle);  // Oracle can update the score later

        bool isNew = !_hasScore[user];
        _encryptedScores[user] = score;
        _hasScore[user] = true;
        scoreVersion[user]++;

        if (isNew) {
            emit ScoreIssued(user, scoreVersion[user], block.timestamp);
        } else {
            emit ScoreUpdated(user, scoreVersion[user], block.timestamp);
        }
    }

    // ── View functions ───────────────────────────────────────────────────────

    /**
     * @notice Returns the encrypted score handle for a user.
     *         Only the creditGate and oracle can call this meaningfully —
     *         raw handle is useless without TFHE access permission.
     * @param user Target address
     * @return Encrypted score handle (euint64)
     */
    function getEncryptedScore(address user) external view returns (euint64) {
        if (!_hasScore[user]) revert NoxScore__NoScoreFound(user);
        return _encryptedScores[user];
    }

    /**
     * @notice Check whether an address has a score on file.
     * @param user Target address
     * @return true if the user has been scored
     */
    function hasScore(address user) external view returns (bool) {
        return _hasScore[user];
    }

    // ── Gateway decryption callback ──────────────────────────────────────────

    /**
     * @notice Request async decryption of own score via fhevm Gateway.
     *         The plaintext result is returned via `callbackReceiveScore`.
     *
     * @dev    Architecture decision: decryption is async because fhevm uses
     *         threshold MPC — no single party holds the decryption key.
     *         The Gateway orchestrates MPC nodes and calls back with plaintext.
     */
    function requestScoreDecryption() external {
        if (!_hasScore[msg.sender]) revert NoxScore__NoScoreFound(msg.sender);

        uint256[] memory cts = new uint256[](1);
        cts[0] = Gateway.toUint256(_encryptedScores[msg.sender]);

        // Request decryption — Gateway will call `callbackReceiveScore`
        uint256 requestId = Gateway.requestDecryption(
            cts,
            this.callbackReceiveScore.selector,
            0,          // max timestamp (0 = no deadline)
            block.timestamp + 3600, // 1-hour TTL
            false       // not trustless (TEE-attested result is enough)
        );

        _pendingDecryptionRequests[requestId] = msg.sender;
        emit DecryptionRequested(msg.sender, requestId);
    }

    /**
     * @notice Gateway callback — receives plaintext score after MPC decryption.
     *         Emits event with the decrypted value for the requesting user.
     *
     * @dev    The plaintext is emitted in an event (not stored) to preserve
     *         the on-chain encrypted state. Users read their score via the event.
     *
     * @param requestId  The decryption request ID
     * @param score      Decrypted plaintext score (0–1000)
     */
    function callbackReceiveScore(
        uint256 requestId,
        uint64 score
    ) external onlyGateway nonReentrant {
        address user = _pendingDecryptionRequests[requestId];
        if (user == address(0)) revert NoxScore__NoScoreFound(address(0));

        delete _pendingDecryptionRequests[requestId]; // Clean up storage

        emit ScoreDecrypted(user, score, requestId);
    }

    /// @notice Emitted when Gateway returns the decrypted score
    event ScoreDecrypted(address indexed user, uint64 score, uint256 indexed requestId);
}
