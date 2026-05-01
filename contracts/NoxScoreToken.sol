// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ── External imports ─────────────────────────────────────────────────────────
import "@openzeppelin/contracts/access/Ownable.sol";

// ── Custom Errors ────────────────────────────────────────────────────────────
error NoxScore__Unauthorised(address caller);
error NoxScore__InvalidAddress();

/**
 * @title  NoxScoreRegistry
 * @author NoxGuard Protocol
 * @notice On-chain registry to track if a user has an active off-chain credit score.
 *         To strictly comply with the iExec TEE architecture, the actual score
 *         is completely hidden inside the SGX enclave and is NEVER stored on-chain
 *         (not even encrypted). The blockchain merely tracks the attestation state.
 */
contract NoxScoreToken is Ownable {
    // ── State variables ──────────────────────────────────────────────────────

    /// @dev Tracks which addresses have a valid score in the TEE
    mapping(address => bool) private _hasScore;

    /// @dev The only address allowed to write scores (NoxOracle contract)
    address public oracle;

    /// @dev Monotonic score version counter per user (replay protection)
    mapping(address => uint256) public scoreVersion;

    // ── Events ───────────────────────────────────────────────────────────────
    event ScoreIssued(address indexed user, uint256 indexed version, uint256 timestamp);
    event ScoreUpdated(address indexed user, uint256 indexed version, uint256 timestamp);
    event OracleSet(address indexed oldOracle, address indexed newOracle);

    // ── Constructor ──────────────────────────────────────────────────────────

    constructor() Ownable(msg.sender) {}

    // ── Admin functions ──────────────────────────────────────────────────────

    function setOracle(address _oracle) external onlyOwner {
        if (_oracle == address(0)) revert NoxScore__InvalidAddress();
        address old = oracle;
        oracle = _oracle;
        emit OracleSet(old, _oracle);
    }

    // ── Oracle-only write ────────────────────────────────────────────────────

    /**
     * @notice Mark a user as having a valid score in the TEE.
     *         Called exclusively by the NoxOracle after TEE attestation verification.
     */
    function writeScore(address user) external {
        if (msg.sender != oracle) revert NoxScore__Unauthorised(msg.sender);
        if (user == address(0)) revert NoxScore__InvalidAddress();

        bool isNew = !_hasScore[user];
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
     * @notice Check whether an address has a score on file.
     * @param user Target address
     * @return true if the user has been scored
     */
    function hasScore(address user) external view returns (bool) {
        return _hasScore[user];
    }
}
