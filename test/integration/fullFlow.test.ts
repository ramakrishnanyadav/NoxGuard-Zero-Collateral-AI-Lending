import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("Integration: Full NoxGuard Flow (TEE Architecture)", function () {
  let scoreToken: any;
  let creditGate: any;
  let oracle: any;
  let owner: HardhatEthersSigner;
  let teeWallet: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let lenderSigner: HardhatEthersSigner;

  const MRENCLAVE = ethers.keccak256(ethers.toUtf8Bytes("noxguard-iapp-v1.0.0"));
  const TASK_ID_1 = ethers.keccak256(ethers.toUtf8Bytes("integration-task-001"));

  async function buildAttestation(
    userAddr: string, taskId: string, mr: string
  ): Promise<string> {
    const network = await ethers.provider.getNetwork();
    const oracleAddr = await oracle.getAddress();
    
    // abi.encode(block.chainid, address(this), user, taskId, mrenclave)
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address", "address", "bytes32", "bytes32"],
      [network.chainId, oracleAddr, userAddr, taskId, mr]
    );
    const payload = ethers.keccak256(encoded);
    return teeWallet.signMessage(ethers.getBytes(payload));
  }

  async function buildApprovalSignature(
    userAddr: string, lenderAddr: string, nonce: bigint
  ): Promise<string> {
    const network = await ethers.provider.getNetwork();
    const gateAddr = await creditGate.getAddress();

    // abi.encode(block.chainid, address(this), msg.sender, lender, "APPROVED", currentNonce)
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "address", "address", "address", "string", "uint256"],
      [network.chainId, gateAddr, userAddr, lenderAddr, "APPROVED", nonce]
    );
    const payload = ethers.keccak256(encoded);
    return teeWallet.signMessage(ethers.getBytes(payload));
  }

  before(async function () {
    [owner, user, lenderSigner] = await ethers.getSigners();
    
    // Create a random wallet for the TEE enclave
    teeWallet = ethers.Wallet.createRandom().connect(ethers.provider) as unknown as HardhatEthersSigner;
    await owner.sendTransaction({ to: teeWallet.address, value: ethers.parseEther("0.1") });

    const NoxScoreToken = await ethers.getContractFactory("NoxScoreToken");
    const NoxCreditGate = await ethers.getContractFactory("NoxCreditGate");
    const NoxOracle     = await ethers.getContractFactory("NoxOracle");

    scoreToken = await NoxScoreToken.deploy();
    await scoreToken.waitForDeployment();

    oracle = await NoxOracle.deploy(MRENCLAVE, teeWallet.address);
    await oracle.waitForDeployment();

    creditGate = await NoxCreditGate.deploy(await scoreToken.getAddress(), teeWallet.address);
    await creditGate.waitForDeployment();

    // Wire
    await oracle.setScoreToken(await scoreToken.getAddress());
    await scoreToken.setOracle(await oracle.getAddress());
  });

  it("INT-01: Contracts wired correctly", async function () {
    expect(await oracle.scoreToken()).to.equal(await scoreToken.getAddress());
    expect(await scoreToken.oracle()).to.equal(await oracle.getAddress());
    expect(await oracle.trustedMrenclave()).to.equal(MRENCLAVE);
  });

  it("INT-02: TEE submits score attestation → Oracle verifies → Token writes", async function () {
    const sig = await buildAttestation(user.address, TASK_ID_1, MRENCLAVE);
    await expect(
      oracle.submitScore(user.address, TASK_ID_1, MRENCLAVE, sig)
    ).to.emit(oracle, "ScoreSubmitted");
    expect(await scoreToken.hasScore(user.address)).to.equal(true);
  });

  it("INT-03: Oracle rejects duplicate taskId", async function () {
    const sig = await buildAttestation(user.address, TASK_ID_1, MRENCLAVE);
    await expect(
      oracle.submitScore(user.address, TASK_ID_1, MRENCLAVE, sig)
    ).to.be.revertedWithCustomError(oracle, "NoxOracle__ReplayDetected");
  });

  it("INT-04: Lender registers", async function () {
    await creditGate.connect(lenderSigner).registerLender(650, "Integration Lender", "ipfs://int");
    expect(await creditGate.lenderCount()).to.equal(1n);
  });

  it("INT-05: User claims credit with TEE signature", async function () {
    const nonce = await creditGate.nonces(user.address);
    const approvalSig = await buildApprovalSignature(user.address, lenderSigner.address, nonce);
    await expect(
      creditGate.connect(user).claimCredit(lenderSigner.address, approvalSig)
    ).to.emit(creditGate, "CreditApproved");
    
    // User gets 10000 NOXUSD tokens mock disbursement
    expect(await creditGate.balanceOf(user.address)).to.equal(ethers.parseUnits("10000", 18));
  });

  it("INT-06: Reject invalid TEE signature during claim", async function () {
    const nonce = await creditGate.nonces(user.address);
    const invalidSig = await buildApprovalSignature(user.address, user.address, nonce); // wrong lender
    await expect(
      creditGate.connect(user).claimCredit(lenderSigner.address, invalidSig)
    ).to.be.revertedWithCustomError(creditGate, "NoxGate__InvalidSignature");
  });
});
