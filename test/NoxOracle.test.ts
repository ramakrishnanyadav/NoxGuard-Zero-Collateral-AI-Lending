import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * NoxOracle Unit Tests — uses MockNoxScoreToken (TFHE-free) so every test
 * exercises NoxOracle's OWN logic: MRENCLAVE verification, ECDSA attestation,
 * replay protection, range check, and liveness staleness tracking.
 *
 * Tests 1–4 that require a successful submitScore call now work because
 * MockNoxScoreToken.writeScore() makes zero TFHE precompile calls.
 */

describe("NoxOracle", function () {
  let oracle: any;
  let mockScoreToken: any;
  let owner: HardhatEthersSigner;
  let teeSignerWallet: any;
  let user: HardhatEthersSigner;
  let attacker: HardhatEthersSigner;

  const MOCK_MRENCLAVE = ethers.keccak256(ethers.toUtf8Bytes("noxguard-iapp-v1.0.0"));
  const MOCK_TASK_ID   = ethers.keccak256(ethers.toUtf8Bytes("task-001"));
  const MOCK_ENC_SCORE = ethers.keccak256(ethers.toUtf8Bytes("encrypted_score")) as `0x${string}`;
  const MOCK_PROOF     = ethers.keccak256(ethers.toUtf8Bytes("proof"));
  const SCORE_RANGE: [bigint, bigint] = [670n, 770n];

  async function buildAttestation(
    userAddr: string, taskId: string, mrenclave: string,
    range: [bigint, bigint], signer: any
  ): Promise<string> {
    const payload = ethers.solidityPackedKeccak256(
      ["address", "bytes32", "bytes32", "uint64", "uint64"],
      [userAddr, taskId, mrenclave, range[0], range[1]]
    );
    return signer.signMessage(ethers.getBytes(payload));
  }

  beforeEach(async function () {
    [owner, user, attacker] = await ethers.getSigners();
    teeSignerWallet = ethers.Wallet.createRandom().connect(ethers.provider);
    await owner.sendTransaction({ to: teeSignerWallet.address, value: ethers.parseEther("0.1") });

    const NoxOracle         = await ethers.getContractFactory("NoxOracle");
    const MockNoxScoreToken = await ethers.getContractFactory("MockNoxScoreToken");

    oracle         = await NoxOracle.deploy(MOCK_MRENCLAVE, teeSignerWallet.address);
    mockScoreToken = await MockNoxScoreToken.deploy();

    await oracle.waitForDeployment();
    await mockScoreToken.waitForDeployment();

    await oracle.connect(owner).setScoreToken(await mockScoreToken.getAddress());
    await mockScoreToken.connect(owner).setOracle(await oracle.getAddress());
  });

  // ── Test 1: Valid attestation succeeds ───────────────────────────────────
  it("Should accept valid attestation and emit ScoreSubmitted", async function () {
    const sig = await buildAttestation(user.address, MOCK_TASK_ID, MOCK_MRENCLAVE, SCORE_RANGE, teeSignerWallet);
    await expect(
      oracle.submitScore(user.address, MOCK_TASK_ID, MOCK_MRENCLAVE, MOCK_ENC_SCORE, MOCK_PROOF, SCORE_RANGE, sig)
    ).to.emit(oracle, "ScoreSubmitted");
    // Score written to mock token
    expect(await mockScoreToken.hasScore(user.address)).to.equal(true);
  });

  // ── Test 2: Wrong MRENCLAVE rejected ─────────────────────────────────────
  it("Should revert with InvalidMrenclave for wrong enclave hash", async function () {
    const fakeMr = ethers.keccak256(ethers.toUtf8Bytes("fake-iapp"));
    const sig    = await buildAttestation(user.address, MOCK_TASK_ID, fakeMr, SCORE_RANGE, teeSignerWallet);
    await expect(
      oracle.submitScore(user.address, MOCK_TASK_ID, fakeMr, MOCK_ENC_SCORE, MOCK_PROOF, SCORE_RANGE, sig)
    ).to.be.revertedWithCustomError(oracle, "NoxOracle__InvalidMrenclave");
  });

  // ── Test 3: Replay attack rejected ───────────────────────────────────────
  it("Should revert on duplicate task ID (replay protection)", async function () {
    const sig = await buildAttestation(user.address, MOCK_TASK_ID, MOCK_MRENCLAVE, SCORE_RANGE, teeSignerWallet);
    await oracle.submitScore(user.address, MOCK_TASK_ID, MOCK_MRENCLAVE, MOCK_ENC_SCORE, MOCK_PROOF, SCORE_RANGE, sig);
    await expect(
      oracle.submitScore(user.address, MOCK_TASK_ID, MOCK_MRENCLAVE, MOCK_ENC_SCORE, MOCK_PROOF, SCORE_RANGE, sig)
    ).to.be.revertedWithCustomError(oracle, "NoxOracle__ReplayDetected");
  });

  // ── Test 4: Wrong signer rejected ────────────────────────────────────────
  it("Should revert with InvalidSignature for wrong signer", async function () {
    const fakeSig = await buildAttestation(user.address, MOCK_TASK_ID, MOCK_MRENCLAVE, SCORE_RANGE, attacker);
    await expect(
      oracle.submitScore(user.address, MOCK_TASK_ID, MOCK_MRENCLAVE, MOCK_ENC_SCORE, MOCK_PROOF, SCORE_RANGE, fakeSig)
    ).to.be.revertedWithCustomError(oracle, "NoxOracle__InvalidSignature");
  });

  // ── Test 5: Score out of range rejected ──────────────────────────────────
  it("Should revert with ScoreOutOfRange when range[1] > 1000", async function () {
    const badRange: [bigint, bigint] = [0n, 1100n];
    const sig = await buildAttestation(user.address, MOCK_TASK_ID, MOCK_MRENCLAVE, badRange, teeSignerWallet);
    await expect(
      oracle.submitScore(user.address, MOCK_TASK_ID, MOCK_MRENCLAVE, MOCK_ENC_SCORE, MOCK_PROOF, badRange, sig)
    ).to.be.revertedWithCustomError(oracle, "NoxOracle__ScoreOutOfRange");
  });

  // ── Test 6: Fresh score not stale ────────────────────────────────────────
  it("Should report fresh score as not stale immediately after issuance", async function () {
    const sig = await buildAttestation(user.address, MOCK_TASK_ID, MOCK_MRENCLAVE, SCORE_RANGE, teeSignerWallet);
    await oracle.submitScore(user.address, MOCK_TASK_ID, MOCK_MRENCLAVE, MOCK_ENC_SCORE, MOCK_PROOF, SCORE_RANGE, sig);
    const [stale] = await oracle.isScoreStale(user.address);
    expect(stale).to.equal(false);
  });

  // ── Test 7: Address with no score is stale ───────────────────────────────
  it("Should report max staleness for address with no score", async function () {
    const [stale, issuedAt, age] = await oracle.isScoreStale(attacker.address);
    expect(stale).to.equal(true);
    expect(issuedAt).to.equal(0n);
    expect(age).to.equal(ethers.MaxUint256);
  });

  // ── Test 8: Admin can update MRENCLAVE ───────────────────────────────────
  it("Should allow owner to update trusted MRENCLAVE", async function () {
    const newMr = ethers.keccak256(ethers.toUtf8Bytes("noxguard-iapp-v2.0.0"));
    await expect(oracle.connect(owner).updateMrenclave(newMr))
      .to.emit(oracle, "MrenclaveUpdated")
      .withArgs(MOCK_MRENCLAVE, newMr);
    expect(await oracle.trustedMrenclave()).to.equal(newMr);
  });

  // ── Test 9: Non-owner cannot update MRENCLAVE ────────────────────────────
  it("Should revert updateMrenclave from non-owner", async function () {
    await expect(
      oracle.connect(attacker).updateMrenclave(ethers.ZeroHash)
    ).to.be.revertedWithCustomError(oracle, "OwnableUnauthorizedAccount");
  });

  // ── Test 10: Processed tasks tracked ─────────────────────────────────────
  it("Should mark taskId as processed after successful submission", async function () {
    const sig = await buildAttestation(user.address, MOCK_TASK_ID, MOCK_MRENCLAVE, SCORE_RANGE, teeSignerWallet);
    await oracle.submitScore(user.address, MOCK_TASK_ID, MOCK_MRENCLAVE, MOCK_ENC_SCORE, MOCK_PROOF, SCORE_RANGE, sig);
    expect(await oracle.processedTasks(MOCK_TASK_ID)).to.equal(true);
  });
});
