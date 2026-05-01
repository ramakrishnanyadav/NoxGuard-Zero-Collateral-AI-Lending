// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

// ── Custom Errors ────────────────────────────────────────────────────────────
error NoxOracle__InvalidMrenclave(bytes32 provided, bytes32 expected);
error NoxOracle__InvalidSignature();
error NoxOracle__ReplayDetected(bytes32 taskId);
error NoxOracle__StaleScore(address user, uint256 issuedAt, uint256 stalenessWindow);
error NoxOracle__Unauthorised(address caller);
error NoxOracle__InvalidAddress();
error NoxOracle__ScoreTokenNotSet();

interface INoxScoreTokenWriter {
    function writeScore(address user) external;
}

/**
 * @title  NoxOracle
 * @notice TEE callback receiver with MRENCLAVE attestation verification.
 *         Receives score attestations from the iExec Nox iApp running in SGX.
 */
contract NoxOracle is Ownable, ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    uint256 public constant STALENESS_WINDOW = 72 hours;

    bytes32 public trustedMrenclave;
    address public teeSignerAddress;
    INoxScoreTokenWriter public scoreToken;

    mapping(bytes32 => bool) public processedTasks;
    mapping(address => uint256) public lastScoreTimestamp;

    event ScoreSubmitted(address indexed user, bytes32 indexed taskId, uint256 timestamp);
    event MrenclaveUpdated(bytes32 indexed oldHash, bytes32 indexed newHash);
    event TeeSignerUpdated(address indexed oldSigner, address indexed newSigner);
    event ScoreTokenSet(address indexed token);

    constructor(
        bytes32 _trustedMrenclave,
        address _teeSignerAddress
    ) Ownable(msg.sender) {
        if (_teeSignerAddress == address(0)) revert NoxOracle__InvalidAddress();
        trustedMrenclave  = _trustedMrenclave;
        teeSignerAddress  = _teeSignerAddress;
    }

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

    /**
     * @notice Called by the iExec Nox iApp after computing the credit score.
     */
    function submitScore(
        address         user,
        bytes32         taskId,
        bytes32         mrenclave,
        bytes calldata  attestationSig
    ) external nonReentrant {
        if (address(scoreToken) == address(0)) revert NoxOracle__ScoreTokenNotSet();

        if (mrenclave != trustedMrenclave) revert NoxOracle__InvalidMrenclave(mrenclave, trustedMrenclave);
        if (processedTasks[taskId]) revert NoxOracle__ReplayDetected(taskId);

        bytes32 payload = keccak256(abi.encode(
            block.chainid,
            address(this),
            user,
            taskId,
            mrenclave
        ));
        bytes32 ethHash = payload.toEthSignedMessageHash();
        address recovered = ethHash.recover(attestationSig);

        if (recovered != teeSignerAddress) revert NoxOracle__InvalidSignature();

        processedTasks[taskId] = true;
        lastScoreTimestamp[user] = block.timestamp;

        scoreToken.writeScore(user);
        emit ScoreSubmitted(user, taskId, block.timestamp);
    }

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
