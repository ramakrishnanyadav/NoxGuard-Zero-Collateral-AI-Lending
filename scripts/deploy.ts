import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import * as fs from "fs";

dotenv.config();

/**
 * NoxGuard Deployment Script
 * Deploys all contracts to Arbitrum Sepolia and writes addresses to .env
 */
async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();

  console.log("═══════════════════════════════════════════════");
  console.log("  NoxGuard Deployment");
  console.log("═══════════════════════════════════════════════");
  console.log(`  Deployer:  ${deployer.address}`);
  console.log(`  Network:   ${(await ethers.provider.getNetwork()).name}`);
  console.log(`  Chain ID:  ${(await ethers.provider.getNetwork()).chainId}`);
  console.log(`  Balance:   ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);
  console.log("═══════════════════════════════════════════════\n");

  // ── 1. Deploy NoxScoreToken ────────────────────────────────────────────────
  console.log("Deploying NoxScoreToken...");
  const NoxScoreToken = await ethers.getContractFactory("NoxScoreToken");
  const noxScoreToken = await NoxScoreToken.deploy();
  await noxScoreToken.waitForDeployment();
  const scoreTokenAddress = await noxScoreToken.getAddress();
  console.log(`✓ NoxScoreToken deployed: ${scoreTokenAddress}\n`);

  // ── 2. Deploy NoxOracle ────────────────────────────────────────────────────
  const trustedMrenclave = process.env.TRUSTED_MRENCLAVE ?? ethers.keccak256(
    ethers.toUtf8Bytes("noxguard-iapp-v1.0.0-placeholder")
  );
  const teeSignerAddress = deployer.address; // Use deployer as placeholder for TEE signer

  console.log("Deploying NoxOracle...");
  const NoxOracle = await ethers.getContractFactory("NoxOracle");
  const noxOracle = await NoxOracle.deploy(trustedMrenclave, teeSignerAddress);
  await noxOracle.waitForDeployment();
  const oracleAddress = await noxOracle.getAddress();
  console.log(`✓ NoxOracle deployed: ${oracleAddress}\n`);

  // ── 3. Deploy NoxCreditGate ────────────────────────────────────────────────
  console.log("Deploying NoxCreditGate...");
  const NoxCreditGate = await ethers.getContractFactory("NoxCreditGate");
  const noxCreditGate = await NoxCreditGate.deploy(scoreTokenAddress, teeSignerAddress);
  await noxCreditGate.waitForDeployment();
  const creditGateAddress = await noxCreditGate.getAddress();
  console.log(`✓ NoxCreditGate deployed: ${creditGateAddress}\n`);

  // ── 4. Wire contracts ──────────────────────────────────────────────────────
  console.log("Wiring contracts...");

  const tx1 = await noxScoreToken.setOracle(oracleAddress);
  await tx1.wait(2);
  console.log(`✓ NoxScoreToken.setOracle(${oracleAddress})`);

  const tx3 = await noxOracle.setScoreToken(scoreTokenAddress);
  await tx3.wait(2);
  console.log(`✓ NoxOracle.setScoreToken(${scoreTokenAddress})\n`);

  // ── 5. Write deployment addresses ─────────────────────────────────────────
  const deploymentInfo = {
    network:        (await ethers.provider.getNetwork()).name,
    chainId:        (await ethers.provider.getNetwork()).chainId.toString(),
    deployedAt:     new Date().toISOString(),
    deployer:       deployer.address,
    contracts: {
      NoxScoreToken:  scoreTokenAddress,
      NoxOracle:      oracleAddress,
      NoxCreditGate:  creditGateAddress,
    },
    config: {
      trustedMrenclave,
      teeSignerAddress,
    },
  };

  fs.writeFileSync(
    "deployment.json",
    JSON.stringify(deploymentInfo, null, 2),
    "utf-8"
  );
  console.log("✓ Deployment info written to deployment.json");

  // ── 6. Print .env snippet ──────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════");
  console.log("  Add these to your .env file:");
  console.log("═══════════════════════════════════════════════");
  console.log(`NEXT_PUBLIC_NOX_SCORE_TOKEN_ADDRESS=${scoreTokenAddress}`);
  console.log(`NEXT_PUBLIC_NOX_CREDIT_GATE_ADDRESS=${creditGateAddress}`);
  console.log(`NEXT_PUBLIC_NOX_ORACLE_ADDRESS=${oracleAddress}`);
  console.log("═══════════════════════════════════════════════\n");

  console.log("\n✅ NoxGuard deployment complete!");
}

main().catch((err) => {
  console.error("Deployment failed:", err);
  process.exit(1);
});
