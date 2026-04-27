// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "fhevm/lib/TFHE.sol";
import "fhevm/gateway/GatewayCaller.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ── Custom Errors ────────────────────────────────────────────────────────────
error NoxGate__Unauthorised(address caller);
error NoxGate__NoScoreToken();
error NoxGate__InvalidThreshold(uint64 threshold);
error NoxGate__RequestPending(address user, address lender);
error NoxGate__NoPendingRequest(uint256 requestId);
error NoxGate__LenderNotRegistered(address lender);

interface INoxScoreToken {
    function getEncryptedScore(address user) external view returns (euint64);
    function hasScore(address user) external view returns (bool);
}

/**
 * @title  NoxCreditGate
 * @notice TFHE threshold gate. Users prove score >= lender's threshold
 *         without revealing the score. Two-step async pattern using fhevm Gateway.
 * @dev    Step 1: requestCreditCheck() → TFHE.gte() + Gateway decryption request
 *         Step 2: callbackCreditCheck() → Gateway returns bool → emit event
 */
contract NoxCreditGate is ERC20, Ownable, ReentrancyGuard, GatewayCaller {
    struct LenderConfig {
        uint64  minScore;
        string  name;
        string  metadataURI;
        bool    active;
        uint256 registeredAt;
    }

    struct CreditCheckRequest {
        address user;
        address lender;
        uint256 requestedAt;
    }

    INoxScoreToken public scoreToken;
    mapping(address => LenderConfig) public lenders;
    address[] private _lenderList;
    mapping(uint256 => CreditCheckRequest) private _pendingChecks;
    mapping(bytes32 => uint256) private _activePairRequest;

    event LenderRegistered(address indexed lender, uint64 minScore, string name);
    event CreditCheckRequested(address indexed user, address indexed lender, uint256 indexed requestId);
    event CreditApproved(address indexed user, address indexed lender, uint256 indexed requestId, euint64 encryptedTier);
    event CreditDenied(address indexed user, address indexed lender, uint256 indexed requestId);
    event LenderDeactivated(address indexed lender);

    constructor(address _scoreToken) ERC20("Nox USD", "NOXUSD") Ownable(msg.sender) {
        if (_scoreToken == address(0)) revert NoxGate__NoScoreToken();
        scoreToken = INoxScoreToken(_scoreToken);
    }

    function registerLender(
        uint64 minScore,
        string calldata name,
        string calldata metadataURI
    ) external {
        if (minScore == 0 || minScore > 1000) revert NoxGate__InvalidThreshold(minScore);
        bool isNew = !lenders[msg.sender].active;
        lenders[msg.sender] = LenderConfig({
            minScore:     minScore,
            name:         name,
            metadataURI:  metadataURI,
            active:       true,
            registeredAt: block.timestamp
        });
        if (isNew) _lenderList.push(msg.sender);
        emit LenderRegistered(msg.sender, minScore, name);
    }

    function deactivateLender(address lender) external onlyOwner {
        lenders[lender].active = false;
        emit LenderDeactivated(lender);
    }

    /**
     * @notice Step 1: Request credit check. Performs TFHE.gte(userScore, threshold)
     *         and sends ebool to Gateway for async decryption.
     */
    function requestCreditCheck(address lender) external nonReentrant {
        if (!lenders[lender].active) revert NoxGate__LenderNotRegistered(lender);
        if (!scoreToken.hasScore(msg.sender)) revert NoxGate__Unauthorised(msg.sender);

        bytes32 pairKey = keccak256(abi.encodePacked(msg.sender, lender));
        if (_activePairRequest[pairKey] != 0) revert NoxGate__RequestPending(msg.sender, lender);

        euint64 encScore     = scoreToken.getEncryptedScore(msg.sender);
        euint64 encThreshold = TFHE.asEuint64(lenders[lender].minScore);
        ebool   encResult    = TFHE.ge(encScore, encThreshold);
        TFHE.allowThis(encResult);

        uint256[] memory cts = new uint256[](1);
        cts[0] = Gateway.toUint256(encResult);

        uint256 requestId = Gateway.requestDecryption(
            cts,
            this.callbackCreditCheck.selector,
            0,
            block.timestamp + 3600,
            false
        );

        _pendingChecks[requestId] = CreditCheckRequest({
            user:        msg.sender,
            lender:      lender,
            requestedAt: block.timestamp
        });
        _activePairRequest[pairKey] = requestId;

        emit CreditCheckRequested(msg.sender, lender, requestId);
    }

    /**
     * @notice Step 2: Gateway callback with decrypted boolean result.
     */
    function callbackCreditCheck(
        uint256 requestId,
        bool approved
    ) external onlyGateway nonReentrant {
        CreditCheckRequest storage req = _pendingChecks[requestId];
        if (req.user == address(0)) revert NoxGate__NoPendingRequest(requestId);

        address user   = req.user;
        address lender = req.lender;
        bytes32 pairKey = keccak256(abi.encodePacked(user, lender));

        delete _activePairRequest[pairKey];
        delete _pendingChecks[requestId];

        if (approved) {
            euint64 encTier = TFHE.asEuint64(1);
            TFHE.allow(encTier, user);
            TFHE.allow(encTier, lender);

            // Mock zero-collateral loan disbursement
            _mint(user, 10000 * 10 ** decimals());

            emit CreditApproved(user, lender, requestId, encTier);
        } else {
            emit CreditDenied(user, lender, requestId);
        }
    }

    function getLenders(uint256 offset, uint256 limit) external view returns (address[] memory) {
        uint256 total = _lenderList.length;
        if (offset >= total) return new address[](0);
        uint256 end = offset + limit;
        if (end > total) end = total;
        address[] memory result = new address[](end - offset);
        for (uint256 i = offset; i < end; ) {
            result[i - offset] = _lenderList[i];
            unchecked { ++i; }
        }
        return result;
    }

    function lenderCount() external view returns (uint256) {
        return _lenderList.length;
    }
}
