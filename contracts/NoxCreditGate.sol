// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

// ── Custom Errors ────────────────────────────────────────────────────────────
error NoxGate__Unauthorised(address caller);
error NoxGate__NoScoreToken();
error NoxGate__InvalidThreshold(uint64 threshold);
error NoxGate__LenderNotRegistered(address lender);
error NoxGate__InvalidSignature();

interface INoxScoreToken {
    function hasScore(address user) external view returns (bool);
}

/**
 * @title  NoxCreditGate
 * @notice TEE threshold gate. Users prove score >= lender's threshold
 *         by providing a cryptographic signature generated entirely within
 *         the air-gapped SGX Enclave. No encrypted data is stored on-chain.
 */
contract NoxCreditGate is ERC20, Ownable, ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    struct LenderConfig {
        uint64  minScore;
        string  name;
        string  metadataURI;
        bool    active;
        uint256 registeredAt;
    }

    INoxScoreToken public scoreToken;
    address public teeSignerAddress;
    mapping(address => LenderConfig) public lenders;
    mapping(address => uint256) public nonces;
    address[] private _lenderList;

    event LenderRegistered(address indexed lender, uint64 minScore, string name);
    event CreditApproved(address indexed user, address indexed lender);
    event LenderDeactivated(address indexed lender);

    constructor(address _scoreToken, address _teeSigner) ERC20("Nox USD", "NOXUSD") Ownable(msg.sender) {
        if (_scoreToken == address(0) || _teeSigner == address(0)) revert NoxGate__NoScoreToken();
        scoreToken = INoxScoreToken(_scoreToken);
        teeSignerAddress = _teeSigner;
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
     * @notice Claim a zero-collateral loan by submitting a TEE signature proving approval.
     */
    function claimCredit(address lender, bytes calldata teeSignature) external nonReentrant {
        if (!lenders[lender].active) revert NoxGate__LenderNotRegistered(lender);
        if (!scoreToken.hasScore(msg.sender)) revert NoxGate__Unauthorised(msg.sender);

        uint256 currentNonce = nonces[msg.sender];
        bytes32 payload = keccak256(abi.encode(
            block.chainid,
            address(this),
            msg.sender,
            lender,
            "APPROVED",
            currentNonce
        ));
        bytes32 ethHash = payload.toEthSignedMessageHash();
        address recovered = ethHash.recover(teeSignature);

        if (recovered != teeSignerAddress) revert NoxGate__InvalidSignature();

        nonces[msg.sender]++;

        // Mock zero-collateral loan disbursement
        _mint(msg.sender, 10000 * 10 ** decimals());

        emit CreditApproved(msg.sender, lender);
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
