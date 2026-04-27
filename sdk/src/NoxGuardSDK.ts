/**
 * NoxGuard SDK — NoxGuardSDK.ts
 *
 * Zero-complexity wrapper over the entire iExec + TFHE stack.
 * The UI layer never imports from @iexec/* directly.
 *
 * All async methods:
 *   - Have explicit typed return values
 *   - Throw NoxGuardError (never raw errors) with codes for UI handling
 *   - Include progress callbacks for loading states
 */

import { IExec } from "iexec";
import { IExecDataProtector } from "@iexec/dataprotector";
import { ethers } from "ethers";
import {
  NoxGuardConfig,
  FinancialDataset,
  ProtectDataResult,
  GrantAccessResult,
  TaskSubmitResult,
  TaskStatusResult,
  ScoreResult,
  LenderInfo,
  CreditCheckResult,
  NoxGuardError,
  ERROR_CODES,
  FinancialRecord,
} from "./types";

// ── ABI fragments (only functions we call) ────────────────────────────────────

const NOX_SCORE_TOKEN_ABI = [
  "function hasScore(address user) external view returns (bool)",
  "function scoreVersion(address user) external view returns (uint256)",
  "event ScoreIssued(address indexed user, uint256 indexed version, uint256 timestamp)",
  "event ScoreUpdated(address indexed user, uint256 indexed version, uint256 timestamp)",
  "event ScoreDecrypted(address indexed user, uint64 score, uint256 indexed requestId)",
  "function requestScoreDecryption() external",
];

const NOX_ORACLE_ABI = [
  "function isScoreStale(address user) external view returns (bool stale, uint256 issuedAt, uint256 age)",
  "function lastScoreTimestamp(address user) external view returns (uint256)",
];

const NOX_CREDIT_GATE_ABI = [
  "function registerLender(uint64 minScore, string name, string metadataURI) external",
  "function requestCreditCheck(address lender) external",
  "function getLenders(uint256 offset, uint256 limit) external view returns (address[])",
  "function lenderCount() external view returns (uint256)",
  "function lenders(address) external view returns (uint64 minScore, string name, string metadataURI, bool active, uint256 registeredAt)",
  "event CreditCheckRequested(address indexed user, address indexed lender, uint256 indexed requestId)",
  "event CreditApproved(address indexed user, address indexed lender, uint256 indexed requestId, bytes encryptedTier)",
  "event CreditDenied(address indexed user, address indexed lender, uint256 indexed requestId)",
];

// ── Progress callback type ────────────────────────────────────────────────────

export type ProgressCallback = (step: string, pct: number) => void;

const noopProgress: ProgressCallback = () => {};

// ── SDK Class ─────────────────────────────────────────────────────────────────

export class NoxGuardSDK {
  private readonly config: NoxGuardConfig;
  private provider: ethers.JsonRpcProvider;

  // Lazily initialised (require signer)
  private _dataProtector?: IExecDataProtector;
  private _iexec?: IExec;
  private _signer?: ethers.Signer;

  constructor(config: NoxGuardConfig) {
    this.config   = config;
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
  }

  // ── Signer attachment (called after wallet connect) ───────────────────────

  /**
   * Attach an ethers Signer (from Wagmi / WalletConnect).
   * Must be called before any write operations.
   */
  async attachSigner(signer: ethers.Signer): Promise<void> {
    const network = await signer.provider?.getNetwork();
    if (network && Number(network.chainId) !== this.config.chainId) {
      throw new NoxGuardError(
        `Wrong network: expected chainId ${this.config.chainId}, got ${network.chainId}`,
        ERROR_CODES.NETWORK_MISMATCH
      );
    }
    this._signer = signer;
    // iExec SDK requires ethers v5-style provider — we use the internal adapter
    this._iexec = new IExec({ ethProvider: signer });
    this._dataProtector = new IExecDataProtector(signer);
  }

  private requireSigner(): ethers.Signer {
    if (!this._signer) {
      throw new NoxGuardError("Signer not attached. Call attachSigner() first.", ERROR_CODES.SIGNER_REQUIRED);
    }
    return this._signer;
  }

  private requireIExec(): IExec {
    if (!this._iexec) {
      throw new NoxGuardError("IExec not initialised. Call attachSigner() first.", ERROR_CODES.SIGNER_REQUIRED);
    }
    return this._iexec;
  }

  private requireDataProtector(): IExecDataProtector {
    if (!this._dataProtector) {
      throw new NoxGuardError("DataProtector not initialised. Call attachSigner() first.", ERROR_CODES.SIGNER_REQUIRED);
    }
    return this._dataProtector;
  }

  // ── Step 1: Validate financial dataset ───────────────────────────────────

  validateDataset(dataset: FinancialDataset): void {
    if (!Array.isArray(dataset.records) || dataset.records.length === 0) {
      throw new NoxGuardError("Dataset must contain at least one record", ERROR_CODES.INVALID_DATASET);
    }
    if (dataset.records.length > 120) {
      throw new NoxGuardError("Dataset too large (max 120 months)", ERROR_CODES.INVALID_DATASET);
    }
    const monthRegex = /^\d{4}-\d{2}$/;
    for (const [idx, record] of dataset.records.entries()) {
      if (!monthRegex.test(record.month)) {
        throw new NoxGuardError(`Record[${idx}].month must be YYYY-MM format`, ERROR_CODES.INVALID_DATASET);
      }
      if (record.income < 0 || record.expenses < 0 || record.loan_balance < 0) {
        throw new NoxGuardError(`Record[${idx}] has negative financial values`, ERROR_CODES.INVALID_DATASET);
      }
      if (record.credit_util < 0 || record.credit_util > 1) {
        throw new NoxGuardError(`Record[${idx}].credit_util must be 0.0–1.0`, ERROR_CODES.INVALID_DATASET);
      }
    }
  }

  // ── Step 2: Protect financial data with DataProtector ────────────────────

  /**
   * Encrypt and upload financial dataset to IPFS.
   * Mints an access-control NFT on Arbitrum Sepolia.
   *
   * @param dataset   Validated financial dataset
   * @param onProgress Progress callback (step name, 0–100%)
   */
  async protectData(
    dataset: FinancialDataset,
    onProgress: ProgressCallback = noopProgress
  ): Promise<ProtectDataResult> {
    this.validateDataset(dataset);
    const dp = this.requireDataProtector();

    onProgress("Encrypting financial data...", 10);

    try {
      const result = await dp.core.protectData({
        name: `noxguard-score-${dataset.user_address.slice(0, 8)}-${Date.now()}`,
        data: {
          financial_data: JSON.stringify(dataset),
        },
      });

      onProgress("Data encrypted & uploaded to IPFS", 60);

      return {
        protectedDataAddress: result.address,
        txHash:               result.transactionHash,
        ipfsCid:              result.multiaddr ?? "",
      };
    } catch (err) {
      throw new NoxGuardError(
        "Failed to protect financial data",
        ERROR_CODES.PROTECT_DATA_FAILED,
        err
      );
    }
  }

  // ── Step 3: Grant iApp access to protected data ───────────────────────────

  /**
   * Grant the NoxGuard iApp access to the protected dataset.
   * Without this, the TEE cannot decrypt the data.
   *
   * @param protectedDataAddress Address of the DataProtector NFT
   * @param onProgress           Progress callback
   */
  async grantIAppAccess(
    protectedDataAddress: string,
    onProgress: ProgressCallback = noopProgress
  ): Promise<GrantAccessResult> {
    const dp = this.requireDataProtector();
    onProgress("Granting iApp access...", 20);

    try {
      const result = await dp.core.grantAccess({
        protectedData:  protectedDataAddress,
        authorizedApp:  this.config.iAppAddress,
        authorizedUser: await this.requireSigner().getAddress(),
        pricePerAccess: 0, // Free for own data
        numberOfAccess: 1, // One-time access per scoring session
      });

      onProgress("Access granted to NoxGuard iApp", 80);

      return {
        orderhash: (result as any).orderHash || (result as any).sign || "",
        txHash:    (result as any).txHash || "",
      };
    } catch (err) {
      throw new NoxGuardError(
        "Failed to grant iApp access to protected data",
        ERROR_CODES.GRANT_ACCESS_FAILED,
        err
      );
    }
  }

  // ── Step 4: Submit scoring task to iExec Nox ─────────────────────────────

  /**
   * Submit the scoring computation to the iExec workerpool.
   * The workerpool runs the NoxGuard iApp inside a TEE (SGX).
   *
   * Architecture decision: we target a SPECIFIC workerpool (not open market)
   * because we need to ensure TEE availability and consistent MRENCLAVE.
   *
   * @param protectedDataAddress  Address of the protected dataset NFT
   * @param onProgress            Progress callback
   */
  async submitScoringTask(
    protectedDataAddress: string,
    onProgress: ProgressCallback = noopProgress
  ): Promise<TaskSubmitResult> {
    const iexec = this.requireIExec();
    const signer = this.requireSigner();
    const userAddress = await signer.getAddress();

    onProgress("Submitting TEE computation...", 30);

    try {
      // Fetch open orders for the iApp and workerpool
      const { orders: appOrders } = await iexec.orderbook.fetchAppOrderbook(
        this.config.iAppAddress,
        { workerpool: this.config.workerpoolAddress }
      );
      const { orders: workerpoolOrders } = await iexec.orderbook.fetchWorkerpoolOrderbook({
        workerpool: this.config.workerpoolAddress,
        category:   5, // TEE workerpool category
      });

      if (appOrders.length === 0)        throw new Error("No app orders available");
      if (workerpoolOrders.length === 0) throw new Error("No workerpool orders available");

      onProgress("Matching orders...", 50);

      // Build requester order with encrypted secrets
      const requestOrder = await iexec.order.createRequestorder({
        app:             this.config.iAppAddress,
        appmaxprice:     appOrders[0].order.appprice,
        workerpool:      this.config.workerpoolAddress,
        workerpoolmaxprice: workerpoolOrders[0].order.workerpoolprice,
        dataset:         protectedDataAddress,
        datasetmaxprice: 0,
        category:        5,
        volume:          1,
        params: {
          iexec_result_storage_provider: "ipfs",
          iexec_result_storage_proxy:    "https://result.v8-bellecour.iex.ec",
          iexec_secrets: {
            1: userAddress,                         // IEXEC_REQUESTER_SECRET_1: callback recipient
            2: this.config.chaingptApiKey ?? "",    // IEXEC_REQUESTER_SECRET_2: ChainGPT key
            3: "",                                  // IEXEC_REQUESTER_SECRET_3: fhevm pubkey
            4: this.config.noxOracleAddress,        // IEXEC_REQUESTER_SECRET_4: oracle address
            5: this.config.rpcUrl,                  // IEXEC_REQUESTER_SECRET_5: RPC URL
          },
        },
      });

      const signedRequestOrder = await iexec.order.signRequestorder(requestOrder);

      const { dealid } = await iexec.order.matchOrders({
        apporder:        appOrders[0].order,
        workerpoolorder: workerpoolOrders[0].order,
        requestorder:    signedRequestOrder,
      });

      onProgress("Task submitted to TEE workerpool", 80);

      // Fetch the task ID from the deal
      const deal = await iexec.deal.show(dealid);
      const taskId = deal.tasks["0"];

      return {
        taskId,
        dealId:  dealid,
        txHash:  dealid, // dealid is the on-chain tx reference
      };
    } catch (err) {
      throw new NoxGuardError(
        "Failed to submit scoring task to iExec",
        ERROR_CODES.TASK_SUBMIT_FAILED,
        err
      );
    }
  }

  // ── Step 5: Poll task status ──────────────────────────────────────────────

  /**
   * Poll the iExec task status until completion or failure.
   * Resolves when task reaches a terminal state.
   *
   * @param taskId     iExec task ID
   * @param timeoutMs  Max wait time (default 10 minutes)
   * @param onProgress Progress callback
   */
  async pollTaskStatus(
    taskId:     string,
    timeoutMs:  number = 600_000,
    onProgress: ProgressCallback = noopProgress
  ): Promise<TaskStatusResult> {
    const iexec      = this.requireIExec();
    const startTime  = Date.now();
    const pollEvery  = 10_000; // 10 second polling interval

    onProgress("TEE computation running...", 40);

    while (Date.now() - startTime < timeoutMs) {
      try {
        const task = await iexec.task.show(taskId);
        const statusStr = task.statusName as TaskStatusResult["status"];

        if (statusStr === "COMPLETED") {
          onProgress("TEE computation complete!", 100);
          const resultCid = typeof task.results === 'string' ? task.results : (task.results as any)?.storage ?? "";
          return { taskId, status: "COMPLETED", resultCid };
        }
        if (statusStr === "FAILED" || statusStr === "TIMEOUT") {
          return { taskId, status: statusStr, errorMessage: `Task ${statusStr}` };
        }

        const elapsed = Date.now() - startTime;
        const pct     = Math.min(90, 40 + Math.round((elapsed / timeoutMs) * 50));
        onProgress(`TEE computing... (${Math.round(elapsed / 1000)}s)`, pct);

      } catch (err) {
        throw new NoxGuardError(
          "Failed to poll task status",
          ERROR_CODES.TASK_POLLING_FAILED,
          err
        );
      }

      await new Promise(r => setTimeout(r, pollEvery));
    }

    return { taskId, status: "TIMEOUT", errorMessage: "Task timed out after 10 minutes" };
  }

  // ── Step 6: Read score status from chain ──────────────────────────────────

  /**
   * Check whether a user has a score and whether it is stale.
   * Read-only — does not require a signer.
   *
   * @param userAddress Address to check
   */
  async getScoreStatus(userAddress: string): Promise<ScoreResult> {
    try {
      const scoreToken = new ethers.Contract(
        this.config.noxScoreTokenAddress,
        NOX_SCORE_TOKEN_ABI,
        this.provider
      );
      const oracle = new ethers.Contract(
        this.config.noxOracleAddress,
        NOX_ORACLE_ABI,
        this.provider
      );

      const [hasScore, version, [isStale, issuedAt, age]] = await Promise.all([
        scoreToken.hasScore(userAddress) as Promise<boolean>,
        scoreToken.scoreVersion(userAddress) as Promise<bigint>,
        oracle.isScoreStale(userAddress) as Promise<[boolean, bigint, bigint]>,
      ]);

      return { hasScore, isStale, age, issuedAt, scoreVersion: version };
    } catch (err) {
      throw new NoxGuardError(
        "Failed to read score status from chain",
        ERROR_CODES.SCORE_READ_FAILED,
        err
      );
    }
  }

  // ── Lender operations ─────────────────────────────────────────────────────

  /**
   * Fetch all registered lenders (paginated, max 50 per call).
   */
  async getLenders(offset: number = 0, limit: number = 50): Promise<LenderInfo[]> {
    const gate = new ethers.Contract(
      this.config.noxCreditGateAddress,
      NOX_CREDIT_GATE_ABI,
      this.provider
    );
    const addresses: string[] = await gate.getLenders(offset, limit);
    const infos = await Promise.all(
      addresses.map(async (addr) => {
        const data = await gate.lenders(addr);
        return {
          address:      addr,
          name:         data.name        as string,
          minScore:     data.minScore    as bigint,
          metadataURI:  data.metadataURI as string,
          registeredAt: data.registeredAt as bigint,
          active:       data.active      as boolean,
        } satisfies LenderInfo;
      })
    );
    return infos;
  }

  /**
   * Request a credit check against a specific lender.
   * Triggers the TFHE threshold comparison inside the gate contract.
   *
   * @param lenderAddress Lender's registered address
   * @param onProgress    Progress callback
   */
  async requestCreditCheck(
    lenderAddress: string,
    onProgress: ProgressCallback = noopProgress
  ): Promise<CreditCheckResult> {
    const signer = this.requireSigner();
    onProgress("Submitting credit check...", 20);

    try {
      const gate = new ethers.Contract(
        this.config.noxCreditGateAddress,
        NOX_CREDIT_GATE_ABI,
        signer
      );

      const tx = await gate.requestCreditCheck(lenderAddress, { gasLimit: 400_000 });
      onProgress("Transaction submitted...", 60);
      const receipt = await tx.wait(1);

      // Parse requestId from event logs
      const iface = new ethers.Interface(NOX_CREDIT_GATE_ABI);
      let requestId = 0n;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed?.name === "CreditCheckRequested") {
            requestId = parsed.args[2] as bigint;
            break;
          }
        } catch { /* skip non-matching logs */ }
      }

      onProgress("Credit check submitted — awaiting Gateway decryption", 90);

      return {
        requestId,
        status:  "PENDING",
        txHash:  receipt.hash,
      };
    } catch (err) {
      throw new NoxGuardError(
        "Failed to request credit check",
        ERROR_CODES.CREDIT_CHECK_FAILED,
        err
      );
    }
  }

  /**
   * Listen for the Gateway callback result (CreditApproved or CreditDenied).
   * Resolves when the event is emitted (or rejects after timeout).
   *
   * @param requestId  The requestId returned by requestCreditCheck
   * @param timeoutMs  Max wait time in ms (default 5 minutes)
   */
  async waitForCreditCheckResult(
    requestId: bigint,
    timeoutMs: number = 300_000
  ): Promise<"APPROVED" | "DENIED"> {
    return new Promise((resolve, reject) => {
      const gate = new ethers.Contract(
        this.config.noxCreditGateAddress,
        NOX_CREDIT_GATE_ABI,
        this.provider
      );

      const timeout = setTimeout(() => {
        gate.removeAllListeners();
        reject(new NoxGuardError("Credit check result timed out", ERROR_CODES.CREDIT_CHECK_FAILED));
      }, timeoutMs);

      gate.on("CreditApproved", (_user, _lender, id) => {
        if (BigInt(id) === requestId) {
          clearTimeout(timeout);
          gate.removeAllListeners();
          resolve("APPROVED");
        }
      });

      gate.on("CreditDenied", (_user, _lender, id) => {
        if (BigInt(id) === requestId) {
          clearTimeout(timeout);
          gate.removeAllListeners();
          resolve("DENIED");
        }
      });
    });
  }
}

// ── Factory function (used by frontend) ───────────────────────────────────────

export function createNoxGuardSDK(config: NoxGuardConfig): NoxGuardSDK {
  return new NoxGuardSDK(config);
}

// Re-export types for consumer convenience
export * from "./types";
