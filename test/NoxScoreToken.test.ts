import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * NoxScoreToken Unit Tests
 *
 * fhevm's TFHE precompile is not available in the default Hardhat network,
 * so tests that call writeScore (which calls TFHE.asEuint64) are replaced
 * with equivalent tests against MockNoxScoreToken. Tests that exercise
 * ONLY admin/access-control logic on the real NoxScoreToken (setOracle,
 * setCreditGate, zero-address checks, Ownable) remain on the real contract.
 *
 * This is the standard pattern when testing fhevm contracts: test your
 * access-control and state logic with a mock, and validate TFHE operations
 * in a dedicated fhevm Hardhat plugin environment or against testnet.
 */

describe("NoxScoreToken — Admin & Access Control (real contract)", function () {
  let scoreToken: any;
  let owner: HardhatEthersSigner;
  let oracle: HardhatEthersSigner;
  let attacker: HardhatEthersSigner;
  let creditGate: HardhatEthersSigner;

  beforeEach(async function () {
    [owner, oracle, attacker, creditGate] = await ethers.getSigners();
    const NoxScoreToken = await ethers.getContractFactory("NoxScoreToken");
    scoreToken = await NoxScoreToken.deploy();
    await scoreToken.waitForDeployment();
  });

  it("Should start with zero oracle address", async function () {
    expect(await scoreToken.oracle()).to.equal(ethers.ZeroAddress);
  });

  it("Should allow owner to set oracle", async function () {
    await expect(scoreToken.connect(owner).setOracle(oracle.address))
      .to.emit(scoreToken, "OracleSet")
      .withArgs(ethers.ZeroAddress, oracle.address);
    expect(await scoreToken.oracle()).to.equal(oracle.address);
  });

  it("Should revert setOracle with zero address", async function () {
    await expect(
      scoreToken.connect(owner).setOracle(ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(scoreToken, "NoxScore__InvalidAddress");
  });

  it("Should revert setOracle from non-owner", async function () {
    await expect(
      scoreToken.connect(attacker).setOracle(oracle.address)
    ).to.be.revertedWithCustomError(scoreToken, "OwnableUnauthorizedAccount");
  });

  it("Should allow owner to set credit gate", async function () {
    await expect(scoreToken.connect(owner).setCreditGate(creditGate.address))
      .to.emit(scoreToken, "CreditGateSet")
      .withArgs(ethers.ZeroAddress, creditGate.address);
    expect(await scoreToken.creditGate()).to.equal(creditGate.address);
  });

  it("Should revert setCreditGate with zero address", async function () {
    await expect(
      scoreToken.connect(owner).setCreditGate(ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(scoreToken, "NoxScore__InvalidAddress");
  });

  it("Should return false for hasScore with no score written", async function () {
    expect(await scoreToken.hasScore(attacker.address)).to.equal(false);
  });

  it("Should revert non-oracle writeScore call with NoxScore__Unauthorised", async function () {
    await scoreToken.connect(owner).setOracle(oracle.address);
    const ENC = ethers.keccak256(ethers.toUtf8Bytes("enc")) as `0x${string}`;
    const PRF = ethers.keccak256(ethers.toUtf8Bytes("prf"));
    await expect(
      scoreToken.connect(attacker).writeScore(attacker.address, ENC, PRF)
    ).to.be.revertedWithCustomError(scoreToken, "NoxScore__Unauthorised")
      .withArgs(attacker.address);
  });
});

describe("NoxScoreToken — Score Write & State (MockNoxScoreToken)", function () {
  let mock: any;
  let owner: HardhatEthersSigner;
  let oracle: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let attacker: HardhatEthersSigner;

  const ENC = ethers.keccak256(ethers.toUtf8Bytes("enc")) as `0x${string}`;
  const PRF = ethers.keccak256(ethers.toUtf8Bytes("prf"));

  beforeEach(async function () {
    [owner, oracle, user, attacker] = await ethers.getSigners();
    const MockNoxScoreToken = await ethers.getContractFactory("MockNoxScoreToken");
    mock = await MockNoxScoreToken.deploy();
    await mock.waitForDeployment();
    await mock.connect(owner).setOracle(oracle.address);
  });

  it("Non-oracle writeScore is rejected", async function () {
    await expect(
      mock.connect(attacker).writeScore(user.address, ENC, PRF)
    ).to.be.reverted;
  });

  it("Oracle writeScore sets hasScore = true", async function () {
    await mock.connect(oracle).writeScore(user.address, ENC, PRF);
    expect(await mock.hasScore(user.address)).to.equal(true);
  });

  it("Oracle writeScore increments scoreVersion to 1", async function () {
    await mock.connect(oracle).writeScore(user.address, ENC, PRF);
    expect(await mock.scoreVersion(user.address)).to.equal(1n);
  });

  it("Second writeScore increments scoreVersion to 2", async function () {
    await mock.connect(oracle).writeScore(user.address, ENC, PRF);
    await mock.connect(oracle).writeScore(user.address, ENC, PRF);
    expect(await mock.scoreVersion(user.address)).to.equal(2n);
  });

  it("writeScore emits ScoreIssued", async function () {
    await expect(mock.connect(oracle).writeScore(user.address, ENC, PRF))
      .to.emit(mock, "ScoreIssued");
  });

  it("getEncryptedScore reverts for unscored address", async function () {
    await expect(mock.getEncryptedScore(attacker.address)).to.be.reverted;
  });

  it("getEncryptedScore returns a handle after writeScore", async function () {
    await mock.connect(oracle).writeScore(user.address, ENC, PRF);
    // Just checking the call doesn't revert — return type is euint64 (bytes32 handle)
    await mock.getEncryptedScore(user.address);
  });
});
