import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * Integration Tests — Full NoxGuard Flow
 *
 * Uses TFHE-free mocks so all tests exercise OUR integration logic
 * (oracle attestation → state write → credit gate) without requiring
 * the fhevm precompile to be deployed.
 */

describe("Integration: Full NoxGuard Flow", function () {
  let mockScoreToken: any;
  let mockCreditGate: any;
  let oracle: any;
  let owner: HardhatEthersSigner;
  let teeWallet: any;
  let user: HardhatEthersSigner;
  let lenderSigner: HardhatEthersSigner;

  const MRENCLAVE   = ethers.keccak256(ethers.toUtf8Bytes("noxguard-iapp-v1.0.0"));
  const TASK_ID_1   = ethers.keccak256(ethers.toUtf8Bytes("integration-task-001"));
  const TASK_ID_2   = ethers.keccak256(ethers.toUtf8Bytes("integration-task-002"));
  const ENC_SCORE   = ethers.keccak256(ethers.toUtf8Bytes("encrypted_score_bytes")) as `0x${string}`;
  const INPUT_PROOF = ethers.keccak256(ethers.toUtf8Bytes("fhevm_input_proof"));
  const SCORE_RANGE: [bigint, bigint] = [700n, 780n];

  async function buildAttestation(
    userAddr: string, taskId: string, mr: string, range: [bigint, bigint]
  ): Promise<string> {
    const payload = ethers.solidityPackedKeccak256(
      ["address", "bytes32", "bytes32", "uint64", "uint64"],
      [userAddr, taskId, mr, range[0], range[1]]
    );
    return teeWallet.signMessage(ethers.getBytes(payload));
  }

  before(async function () {
    [owner, user, lenderSigner] = await ethers.getSigners();
    teeWallet = ethers.Wallet.createRandom().connect(ethers.provider);
    await owner.sendTransaction({ to: teeWallet.address, value: ethers.parseEther("0.1") });

    const MockNoxScoreToken = await ethers.getContractFactory("MockNoxScoreToken");
    const MockNoxCreditGate = await ethers.getContractFactory("MockNoxCreditGate");
    const NoxOracle         = await ethers.getContractFactory("NoxOracle");

    mockScoreToken = await MockNoxScoreToken.deploy();
    await mockScoreToken.waitForDeployment();

    oracle = await NoxOracle.deploy(MRENCLAVE, teeWallet.address);
    await oracle.waitForDeployment();

    mockCreditGate = await MockNoxCreditGate.deploy(await mockScoreToken.getAddress());
    await mockCreditGate.waitForDeployment();

    // Wire
    await oracle.setScoreToken(await mockScoreToken.getAddress());
    await mockScoreToken.setOracle(await oracle.getAddress());
    await mockScoreToken.setCreditGate(await mockCreditGate.getAddress());
  });

  // ── INT-01: Wiring ────────────────────────────────────────────────────────
  it("INT-01: All contracts deployed and wired correctly", async function () {
    expect(await oracle.scoreToken()).to.equal(await mockScoreToken.getAddress());
    expect(await mockScoreToken.oracle()).to.equal(await oracle.getAddress());
    expect(await mockScoreToken.creditGate()).to.equal(await mockCreditGate.getAddress());
    expect(await oracle.trustedMrenclave()).to.equal(MRENCLAVE);
    expect(await oracle.teeSignerAddress()).to.equal(teeWallet.address);
  });

  // ── INT-02: TEE attestation → score write ─────────────────────────────────
  it("INT-02: TEE submits score → Oracle verifies → Token writes → hasScore = true", async function () {
    const sig = await buildAttestation(user.address, TASK_ID_1, MRENCLAVE, SCORE_RANGE);
    await expect(
      oracle.submitScore(user.address, TASK_ID_1, MRENCLAVE, ENC_SCORE, INPUT_PROOF, SCORE_RANGE, sig)
    ).to.emit(oracle, "ScoreSubmitted");
    expect(await mockScoreToken.hasScore(user.address)).to.equal(true);
    expect(await mockScoreToken.scoreVersion(user.address)).to.equal(1n);
  });

  // ── INT-03: Staleness tracking ────────────────────────────────────────────
  it("INT-03: Score is not stale immediately after TEE submission", async function () {
    const [stale, issuedAt] = await oracle.isScoreStale(user.address);
    expect(stale).to.equal(false);
    expect(issuedAt).to.be.gt(0n);
  });

  // ── INT-04: Replay protection ─────────────────────────────────────────────
  it("INT-04: Oracle rejects duplicate taskId (replay protection)", async function () {
    const sig = await buildAttestation(user.address, TASK_ID_1, MRENCLAVE, SCORE_RANGE);
    await expect(
      oracle.submitScore(user.address, TASK_ID_1, MRENCLAVE, ENC_SCORE, INPUT_PROOF, SCORE_RANGE, sig)
    ).to.be.revertedWithCustomError(oracle, "NoxOracle__ReplayDetected");
    expect(await oracle.processedTasks(TASK_ID_1)).to.equal(true);
  });

  // ── INT-05: Lender registration + gate wiring ─────────────────────────────
  it("INT-05: Lender registers → mock gate stores lender config", async function () {
    await mockCreditGate.connect(lenderSigner).registerLender(650, "Integration Lender", "ipfs://int");
    expect(await mockCreditGate.lenderCount()).to.equal(1n);
    expect(await mockCreditGate.scoreToken()).to.equal(await mockScoreToken.getAddress());
  });

  // ── INT-06: Scored user can request credit check ──────────────────────────
  it("INT-06: Scored user calls requestCreditCheck and CreditCheckRequested is emitted", async function () {
    // user has score from INT-02, lender registered in INT-05
    await expect(
      mockCreditGate.connect(user).requestCreditCheck(lenderSigner.address)
    ).to.emit(mockCreditGate, "CreditCheckRequested");
  });
});
