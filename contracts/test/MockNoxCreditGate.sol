// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

interface IMockScoreToken {
    function hasScore(address user) external view returns (bool);
}

/**
 * @title  MockNoxCreditGate
 * @notice TFHE-free test double for NoxCreditGate.
 *
 *         The real NoxCreditGate calls TFHE.ge() / TFHE.asEuint64() inside
 *         requestCreditCheck(). These precompile calls fail in the default
 *         Hardhat network. This mock tests the gating STATE MACHINE
 *         (access control, lender registration, event emission) without
 *         touching the fhevm execution layer.
 */
contract MockNoxCreditGate is Ownable {
    struct LenderConfig {
        uint64 minScore;
        string name;
        bool   active;
    }

    IMockScoreToken public scoreToken;
    mapping(address => LenderConfig) public lenders;
    address[] private _lenderList;

    event LenderRegistered(address indexed lender, uint64 minScore, string name);
    event CreditCheckRequested(address indexed user, address indexed lender, uint256 indexed requestId);
    event LenderDeactivated(address indexed lender);

    error MockGate__LenderNotRegistered(address lender);
    error MockGate__Unauthorised(address user);
    error MockGate__InvalidThreshold(uint64 threshold);

    constructor(address _scoreToken) Ownable(msg.sender) {
        scoreToken = IMockScoreToken(_scoreToken);
    }

    function registerLender(uint64 minScore, string calldata name, string calldata) external {
        if (minScore == 0 || minScore > 1000) revert MockGate__InvalidThreshold(minScore);
        bool isNew = !lenders[msg.sender].active;
        lenders[msg.sender] = LenderConfig({ minScore: minScore, name: name, active: true });
        if (isNew) _lenderList.push(msg.sender);
        emit LenderRegistered(msg.sender, minScore, name);
    }

    function deactivateLender(address lender) external onlyOwner {
        lenders[lender].active = false;
        emit LenderDeactivated(lender);
    }

    /**
     * @notice Simplified credit check — checks hasScore only (no TFHE comparison).
     *         Emits CreditCheckRequested so the integration test can verify the flow.
     */
    function requestCreditCheck(address lender) external {
        if (!lenders[lender].active) revert MockGate__LenderNotRegistered(lender);
        if (!scoreToken.hasScore(msg.sender)) revert MockGate__Unauthorised(msg.sender);
        // Skip TFHE.ge() comparison — emit the event directly for integration test coverage
        emit CreditCheckRequested(msg.sender, lender, block.number);
    }

    function lenderCount() external view returns (uint256) { return _lenderList.length; }
}
