/**
 * NoxGuard SDK — Type Definitions
 * All interfaces are defined here before any implementation.
 */

// ── Financial Data Types ──────────────────────────────────────────────────────

export interface FinancialRecord {
  month:           string;   // YYYY-MM format
  income:          number;   // Monthly income USD
  expenses:        number;   // Monthly expenses USD
  missed_payments: number;   // Payment failures that month
  credit_util:     number;   // Credit utilisation 0.0–1.0
  loan_balance:    number;   // Outstanding loan balance USD
}

export interface FinancialDataset {
  user_address: string;
  records:      FinancialRecord[];
  data_version: string;
}

// ── DataProtector Types ───────────────────────────────────────────────────────

export interface ProtectDataResult {
  protectedDataAddress: string;  // On-chain NFT address for the protected dataset
  txHash:               string;  // Transaction hash of protection
  ipfsCid:              string;  // IPFS CID of the encrypted data
}

export interface GrantAccessResult {
  orderhash: string;             // iExec dataset order hash
  txHash:    string;
}

// ── Task Types ────────────────────────────────────────────────────────────────

export interface TaskConfig {
  protectedDataAddress: string;  // Address of the protected dataset
  iAppAddress:          string;  // Deployed iApp contract address
  workerpoolAddress:    string;  // Target workerpool (not open market — RULE 4)
  chaingptApiKey:       string;  // Injected as requester secret
  fhevmPublicKey:       string;  // Injected as requester secret
  oracleAddress:        string;  // NoxOracle contract address
  rpcUrl:               string;  // Arbitrum Sepolia RPC URL
}

export interface TaskSubmitResult {
  taskId:   string;
  dealId:   string;
  txHash:   string;
}

export interface TaskStatusResult {
  taskId:   string;
  status:   "UNSET" | "ACTIVE" | "REVEALING" | "COMPLETED" | "FAILED" | "TIMEOUT";
  resultCid?: string;
  errorMessage?: string;
}

// ── Score Types ───────────────────────────────────────────────────────────────

export interface ScoreResult {
  hasScore:     boolean;
  isStale:      boolean;
  age:          bigint;          // Age in seconds
  issuedAt:     bigint;          // Unix timestamp
  scoreVersion: bigint;          // Monotonic version counter
}

// ── Credit Gate Types ─────────────────────────────────────────────────────────

export interface LenderInfo {
  address:      string;
  name:         string;
  minScore:     bigint;
  metadataURI:  string;
  registeredAt: bigint;
  active:       boolean;
}

export interface CreditCheckResult {
  requestId:   bigint;
  status:      "PENDING" | "APPROVED" | "DENIED";
  txHash:      string;
}

// ── SDK Configuration ─────────────────────────────────────────────────────────

export interface NoxGuardConfig {
  // Contract addresses on Arbitrum Sepolia
  noxScoreTokenAddress: string;
  noxCreditGateAddress: string;
  noxOracleAddress:     string;

  // iExec app + workerpool
  iAppAddress:          string;
  workerpoolAddress:    string;

  // Network
  rpcUrl:               string;
  chainId:              number;

  // Optional: ChainGPT
  chaingptApiKey?:      string;
}

// ── Error Types ───────────────────────────────────────────────────────────────

export class NoxGuardError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "NoxGuardError";
  }
}

export const ERROR_CODES = {
  PROTECT_DATA_FAILED:    "PROTECT_DATA_FAILED",
  GRANT_ACCESS_FAILED:    "GRANT_ACCESS_FAILED",
  TASK_SUBMIT_FAILED:     "TASK_SUBMIT_FAILED",
  TASK_POLLING_FAILED:    "TASK_POLLING_FAILED",
  SCORE_READ_FAILED:      "SCORE_READ_FAILED",
  CREDIT_CHECK_FAILED:    "CREDIT_CHECK_FAILED",
  INVALID_DATASET:        "INVALID_DATASET",
  SIGNER_REQUIRED:        "SIGNER_REQUIRED",
  NETWORK_MISMATCH:       "NETWORK_MISMATCH",
} as const;

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];
