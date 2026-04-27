// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Only imported for the `euint64` / `einput` type definitions — NO TFHE function calls.
import "fhevm/lib/TFHE.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title  MockNoxScoreToken
 * @notice TFHE-free test double for NoxScoreToken.
 *
 *         In fhevm v0.6 the TFHE precompile contracts are not deployed in the
 *         default Hardhat network, so even `TFHE.asEuint64(uint64)` reverts.
 *         This mock satisfies the INoxScoreTokenWriter + INoxScoreToken
 *         interfaces while making ZERO calls to any TFHE function.
 *
 *         `euint64.wrap(bytes32(0))` is a pure type conversion — no precompile
 *         call, no network interaction. It satisfies the ABI without touching
 *         the fhevm execution environment.
 *
 *         Used by:
 *           - NoxOracle unit tests   (tests attestation verification logic)
 *           - fullFlow integration   (tests wiring + state transitions)
 */
contract MockNoxScoreToken is Ownable {
    mapping(address => bool)    private _hasScore;
    mapping(address => uint256) public  scoreVersion;

    address public oracle;
    address public creditGate;

    event ScoreIssued(address indexed user, uint256 version, uint256 timestamp);

    constructor() Ownable(msg.sender) {}

    function setOracle(address _oracle)   external onlyOwner { oracle     = _oracle; }
    function setCreditGate(address _gate) external onlyOwner { creditGate = _gate;   }

    /**
     * @notice writeScore — ignores proof params, just flips hasScore.
     *         Signature matches INoxScoreTokenWriter so NoxOracle can call it.
     */
    function writeScore(
        address        user,
        einput         /* encryptedScore — ignored */,
        bytes calldata /* inputProof     — ignored */
    ) external {
        require(msg.sender == oracle, "MockScoreToken: not oracle");
        _hasScore[user] = true;
        scoreVersion[user]++;
        emit ScoreIssued(user, scoreVersion[user], block.timestamp);
    }

    /**
     * @notice Returns a zero-handle euint64.
     *         `euint64.wrap(bytes32(0))` is a type cast — no TFHE call.
     *         Sufficient for tests that check state transitions; not usable
     *         for real TFHE comparisons (which are not tested here).
     */
    function getEncryptedScore(address user) external view returns (euint64) {
        require(_hasScore[user], "MockScoreToken: no score");
        return euint64.wrap(0);   // ← zero-valued handle, pure type cast, no precompile
    }

    function hasScore(address user) external view returns (bool) {
        return _hasScore[user];
    }
}
