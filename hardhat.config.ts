import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import "hardhat-gas-reporter";
import "solidity-coverage";
import * as dotenv from "dotenv";

dotenv.config();

// ── Validate critical env vars at startup ───────────────────────────────────
const PRIVATE_KEY: string = process.env.PRIVATE_KEY ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // Hardhat default key for local testing
const ARBITRUM_SEPOLIA_RPC_URL: string = process.env.ARBITRUM_SEPOLIA_RPC_URL ?? "https://sepolia-rollup.arbitrum.io/rpc";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200, // Optimised for deployment (cold path), not repeated calls
      },
      viaIR: true, // Enable IR-based code generation for complex fhevm types
      evmVersion: "cancun", // Required for transient storage opcodes
    },
  },

  networks: {
    // ── Local development ────────────────────────────────────────────────────
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },

    // ── Arbitrum Sepolia testnet ─────────────────────────────────────────────
    arbitrumSepolia: {
      url: ARBITRUM_SEPOLIA_RPC_URL,
      accounts: [PRIVATE_KEY],
      chainId: 421614,
      gasPrice: "auto",
    },

    // ── Arbitrum mainnet (production) ────────────────────────────────────────
    arbitrum: {
      url: process.env.ARBITRUM_RPC_URL ?? "https://arb1.arbitrum.io/rpc",
      accounts: [PRIVATE_KEY],
      chainId: 42161,
      gasPrice: "auto",
    },
  },

  // ── Contract verification ────────────────────────────────────────────────
  etherscan: {
    apiKey: {
      arbitrumSepolia: process.env.ARBISCAN_API_KEY ?? "",
      arbitrumOne: process.env.ARBISCAN_API_KEY ?? "",
    },
    customChains: [
      {
        network: "arbitrumSepolia",
        chainId: 421614,
        urls: {
          apiURL: "https://api-sepolia.arbiscan.io/api",
          browserURL: "https://sepolia.arbiscan.io",
        },
      },
    ],
  },

  // ── Gas reporting ────────────────────────────────────────────────────────
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    outputFile: "gas-report.txt",
    noColors: true,
  },

  // ── TypeChain ────────────────────────────────────────────────────────────
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },

  // ── Paths ────────────────────────────────────────────────────────────────
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
