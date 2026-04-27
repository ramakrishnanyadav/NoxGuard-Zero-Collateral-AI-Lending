import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * NoxCreditGate Unit Tests — lender registration, gate logic, paginated queries
 */

describe("NoxCreditGate", function () {
  let gate: any;
  let scoreToken: any;
  let owner: HardhatEthersSigner;
  let lender: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let attacker: HardhatEthersSigner;

  beforeEach(async function () {
    [owner, lender, user, attacker] = await ethers.getSigners();

    const NoxScoreToken = await ethers.getContractFactory("NoxScoreToken");
    scoreToken = await NoxScoreToken.deploy();
    await scoreToken.waitForDeployment();

    const NoxCreditGate = await ethers.getContractFactory("NoxCreditGate");
    gate = await NoxCreditGate.deploy(await scoreToken.getAddress());
    await gate.waitForDeployment();
  });

  // ── Test 0: ERC20 Properties ─────────────────────────────────────────────
  it("Should expose ERC20 properties for NOXUSD", async function () {
    expect(await gate.name()).to.equal("Nox USD");
    expect(await gate.symbol()).to.equal("NOXUSD");
    expect(await gate.decimals()).to.equal(18n);
  });

  // ── Test 1: Lender registration ──────────────────────────────────────────
  it("Should allow any address to register as lender", async function () {
    await expect(
      gate.connect(lender).registerLender(700, "DeFi Bank", "ipfs://terms")
    ).to.emit(gate, "LenderRegistered")
      .withArgs(lender.address, 700n, "DeFi Bank");
  });

  // ── Test 2: Lender count increments ──────────────────────────────────────
  it("Should increment lenderCount after registration", async function () {
    await gate.connect(lender).registerLender(700, "DeFi Bank", "ipfs://terms");
    expect(await gate.lenderCount()).to.equal(1n);
  });

  // ── Test 3: Invalid threshold rejected ───────────────────────────────────
  it("Should revert registration with threshold = 0", async function () {
    await expect(
      gate.connect(lender).registerLender(0, "Bad Lender", "ipfs://bad")
    ).to.be.revertedWithCustomError(gate, "NoxGate__InvalidThreshold").withArgs(0n);
  });

  // ── Test 4: Threshold > 1000 rejected ────────────────────────────────────
  it("Should revert registration with threshold > 1000", async function () {
    await expect(
      gate.connect(lender).registerLender(1001, "Bad Lender", "ipfs://bad")
    ).to.be.revertedWithCustomError(gate, "NoxGate__InvalidThreshold").withArgs(1001n);
  });

  // ── Test 5: Lender data stored correctly ─────────────────────────────────
  it("Should store lender config correctly", async function () {
    await gate.connect(lender).registerLender(650, "Quick Loans", "ipfs://ql");
    const config = await gate.lenders(lender.address);
    expect(config.minScore).to.equal(650n);
    expect(config.name).to.equal("Quick Loans");
    expect(config.active).to.equal(true);
  });

  // ── Test 6: Admin can deactivate lender ──────────────────────────────────
  it("Should allow admin to deactivate a lender", async function () {
    await gate.connect(lender).registerLender(700, "DeFi Bank", "ipfs://terms");
    await expect(gate.connect(owner).deactivateLender(lender.address))
      .to.emit(gate, "LenderDeactivated")
      .withArgs(lender.address);
    const config = await gate.lenders(lender.address);
    expect(config.active).to.equal(false);
  });

  // ── Test 7: Non-owner cannot deactivate lender ───────────────────────────
  it("Should revert deactivateLender from non-owner", async function () {
    await gate.connect(lender).registerLender(700, "DeFi Bank", "ipfs://terms");
    await expect(
      gate.connect(attacker).deactivateLender(lender.address)
    ).to.be.revertedWithCustomError(gate, "OwnableUnauthorizedAccount");
  });

  // ── Test 8: requestCreditCheck fails for user without score ──────────────
  it("Should revert requestCreditCheck if user has no score", async function () {
    await gate.connect(lender).registerLender(700, "DeFi Bank", "ipfs://terms");
    await expect(
      gate.connect(user).requestCreditCheck(lender.address)
    ).to.be.revertedWithCustomError(gate, "NoxGate__Unauthorised");
  });

  // ── Test 9: requestCreditCheck fails for inactive lender ─────────────────
  it("Should revert requestCreditCheck for deactivated lender", async function () {
    await gate.connect(lender).registerLender(700, "DeFi Bank", "ipfs://terms");
    await gate.connect(owner).deactivateLender(lender.address);
    await expect(
      gate.connect(user).requestCreditCheck(lender.address)
    ).to.be.revertedWithCustomError(gate, "NoxGate__LenderNotRegistered");
  });

  // ── Test 10: Paginated getLenders returns correct slice ──────────────────
  it("Should return paginated lender list correctly", async function () {
    const signers = await ethers.getSigners();
    // Register 5 lenders
    for (let i = 0; i < 5; i++) {
      await gate.connect(signers[i + 4]).registerLender(600 + i * 10, `Lender ${i}`, "ipfs://meta");
    }
    const page1 = await gate.getLenders(0, 3);
    const page2 = await gate.getLenders(3, 3);
    expect(page1.length).to.equal(3);
    expect(page2.length).to.equal(2);
    // No overlap
    expect(page1).to.not.include(page2[0]);
  });
});
