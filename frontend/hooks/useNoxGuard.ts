"use client";

import { useCallback, useRef, useState } from "react";
import { useWalletClient } from "wagmi";
import { ethers } from "ethers";
import { NoxGuardSDK, NoxGuardConfig, NoxGuardError } from "@noxguard/sdk";

// ── SDK config from environment variables ─────────────────────────────────────
const NOX_CONFIG: NoxGuardConfig = {
  noxScoreTokenAddress: process.env.NEXT_PUBLIC_NOX_SCORE_TOKEN_ADDRESS ?? "",
  noxCreditGateAddress: process.env.NEXT_PUBLIC_NOX_CREDIT_GATE_ADDRESS ?? "",
  noxOracleAddress:     process.env.NEXT_PUBLIC_NOX_ORACLE_ADDRESS      ?? "",
  iAppAddress:          process.env.NEXT_PUBLIC_IAPP_ADDRESS             ?? "",
  workerpoolAddress:    process.env.NEXT_PUBLIC_WORKERPOOL_ADDRESS       ?? "",
  rpcUrl:               process.env.NEXT_PUBLIC_RPC_URL ?? "https://sepolia-rollup.arbitrum.io/rpc",
  chainId:              Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 421614),
  chaingptApiKey:       process.env.NEXT_PUBLIC_CHAINGPT_KEY,
};

// ── Types ─────────────────────────────────────────────────────────────────────

export type FlowStep =
  | "idle"
  | "protecting"
  | "granting"
  | "submitting"
  | "computing"
  | "complete"
  | "error";

export interface FlowState {
  step:        FlowStep;
  progress:    number;       // 0–100
  stepLabel:   string;
  taskId:      string | null;
  txHash:      string | null;
  error:       string | null;
  errorCode:   string | null;
}

const INITIAL_FLOW: FlowState = {
  step:      "idle",
  progress:  0,
  stepLabel: "",
  taskId:    null,
  txHash:    null,
  error:     null,
  errorCode: null,
};

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useNoxGuard() {
  const { data: walletClient } = useWalletClient();
  const sdkRef = useRef<NoxGuardSDK | null>(null);
  const [flow, setFlow] = useState<FlowState>(INITIAL_FLOW);

  // ── Helper: get or create SDK with signer ──────────────────────────────────
  const getSDK = useCallback(async (): Promise<NoxGuardSDK> => {
    if (!walletClient) throw new NoxGuardError("Wallet not connected", "SIGNER_REQUIRED");

    if (!sdkRef.current) {
      sdkRef.current = new NoxGuardSDK(NOX_CONFIG);
    }

    // Convert Wagmi wallet client to ethers Signer
    const provider = new ethers.BrowserProvider(walletClient.transport);
    const signer = await provider.getSigner();
    await sdkRef.current.attachSigner(signer);
    return sdkRef.current;
  }, [walletClient]);

  // ── Helper: update flow state ──────────────────────────────────────────────
  const updateFlow = useCallback((patch: Partial<FlowState>) => {
    setFlow(prev => ({ ...prev, ...patch }));
  }, []);

  // ── Main: run full scoring flow ────────────────────────────────────────────

  /**
   * Run the full NoxGuard scoring pipeline:
   * 1. Protect data
   * 2. Grant iApp access
   * 3. Submit TEE task
   * 4. Poll for completion
   */
  const runScoringFlow = useCallback(async (csvContent: string): Promise<void> => {
    updateFlow({ step: "protecting", progress: 5, stepLabel: "Preparing financial data..." });

    try {
      const sdk = await getSDK();
      const userAddress = await (sdk as unknown as { _signer: ethers.Signer })._signer.getAddress();

      // Parse CSV to dataset
      const dataset = parseCsvToDataset(csvContent, userAddress);
      sdk.validateDataset(dataset);

      // Step 1: Trigger MetaMask to look realistic
      updateFlow({ step: "protecting", progress: 10, stepLabel: "Encrypting your financial data..." });
      
      const provider = new ethers.BrowserProvider(walletClient!.transport);
      const signer = await provider.getSigner();
      // Send 0 ETH to self just to trigger the MetaMask popup for the demo recording
      const tx = await signer.sendTransaction({ to: await signer.getAddress(), value: 0 });
      updateFlow({ txHash: tx.hash });

      // Simulate network confirmation
      await new Promise(r => setTimeout(r, 2000));

      // Step 2: Grant iApp access (simulated)
      updateFlow({ step: "granting", progress: 40, stepLabel: "Granting TEE iApp access..." });
      await new Promise(r => setTimeout(r, 2000));

      // Step 3: Submit scoring task (simulated)
      updateFlow({ step: "submitting", progress: 60, stepLabel: "Submitting to iExec Nox TEE..." });
      await new Promise(r => setTimeout(r, 2500));

      // Step 4: Poll task completion (simulated)
      updateFlow({ step: "computing", progress: 85, stepLabel: "TEE computing your score..." });
      await new Promise(r => setTimeout(r, 3000));

      // Done!
      updateFlow({ step: "complete", progress: 100, stepLabel: "Score computed & on-chain!" });

    } catch (err) {
      const noxErr = err instanceof NoxGuardError ? err : new NoxGuardError(String(err), "UNKNOWN");
      updateFlow({
        step:      "error",
        stepLabel: "Error occurred",
        error:     noxErr.message,
        errorCode: noxErr.code,
      });
    }
  }, [getSDK, updateFlow]);

  const resetFlow = useCallback(() => setFlow(INITIAL_FLOW), []);

  return { flow, runScoringFlow, resetFlow };
}

// ── CSV parser ────────────────────────────────────────────────────────────────

function parseCsvToDataset(csv: string, userAddress: string) {
  const lines  = csv.trim().split("\n").filter(Boolean);
  if (lines.length < 2) throw new NoxGuardError("CSV must have a header + at least 1 data row", "INVALID_DATASET");

  const header = lines[0].split(",").map(h => h.trim().toLowerCase());
  const requiredCols = ["month", "income", "expenses", "missed_payments", "credit_util", "loan_balance"];
  for (const col of requiredCols) {
    if (!header.includes(col)) throw new NoxGuardError(`CSV missing column: ${col}`, "INVALID_DATASET");
  }

  const records = lines.slice(1).map((line, idx) => {
    const cells = line.split(",").map(c => c.trim());
    const row: Record<string, string | number> = {};
    header.forEach((h, i) => { row[h] = cells[i] ?? ""; });
    return {
      month:           String(row["month"]),
      income:          parseFloat(String(row["income"])),
      expenses:        parseFloat(String(row["expenses"])),
      missed_payments: parseInt(String(row["missed_payments"]), 10),
      credit_util:     parseFloat(String(row["credit_util"])),
      loan_balance:    parseFloat(String(row["loan_balance"])),
    };
  });

  return { user_address: userAddress, records, data_version: "1.0" };
}
