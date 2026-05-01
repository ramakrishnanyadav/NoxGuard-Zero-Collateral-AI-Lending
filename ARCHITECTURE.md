# NoxGuard Architecture Deep-Dive

> A technical reference for engineers, security researchers, and hackathon judges evaluating the NoxGuard protocol design.

---

## 1. System Overview

NoxGuard is a **three-layer confidential lending stack**:

```
┌─────────────────────────────────────────────────────────────┐
│  LAYER 3: ON-CHAIN (Arbitrum Sepolia)                       │
│  NoxOracle.sol │ NoxCreditGate.sol │ NoxScoreToken.sol      │
│  ─ Signature verification                                    │
│  ─ Nonce replay protection                                   │
│  ─ EIP-712 domain separation                                │
└──────────────────────────┬──────────────────────────────────┘
                           │ ECDSA Attestation Signature
┌──────────────────────────▼──────────────────────────────────┐
│  LAYER 2: TEE COMPUTE (iExec SCONE + Intel SGX)             │
│  ─ Air-gapped ONNX credit model inference                   │
│  ─ Raw data never exits enclave memory                      │
│  ─ MRENCLAVE measurement seals code integrity               │
│  ─ Private signing key sealed to hardware                   │
└──────────────────────────┬──────────────────────────────────┘
                           │ Encrypted user data (iExec DataProtector)
┌──────────────────────────▼──────────────────────────────────┐
│  LAYER 1: USER CLIENT (Browser / Next.js)                   │
│  ─ CSV data encrypted client-side before upload             │
│  ─ No raw data sent to any public server                    │
│  ─ Wagmi + RainbowKit for wallet interaction                │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Smart Contract Architecture

### 2.1 NoxOracle.sol
**Role:** On-chain TEE attestation verifier.

**Key Functions:**
- `submitScore(address user, uint8 score, bytes32 taskId, bytes calldata teeSignature)` — Verifies ECDSA signature from TEE and records attested score.
- `setTeeSigner(address newSigner)` — Owner-only. Updates the authorized TEE signer address.

**Security Properties:**
- Signature payload encodes `block.chainid` + `address(this)` (EIP-712 domain separator).
- `taskId` deduplication prevents double-submission via `mapping(bytes32 => bool) processedTasks`.
- Uses `abi.encode` (not `encodePacked`) to prevent hash collision attacks.

```solidity
bytes32 payloadHash = keccak256(abi.encode(
    keccak256("ScoreAttestation(address user,uint8 score,bytes32 taskId,uint256 chainId,address contractAddress)"),
    user, score, taskId, block.chainid, address(this)
));
```

---

### 2.2 NoxCreditGate.sol
**Role:** Lender pool manager and loan disbursement engine.

**Key Functions:**
- `registerLender(uint256 threshold, uint256 maxLoanAmount)` — Lenders set their minimum acceptable credit score threshold.
- `claimCredit(address lender, bytes calldata teeSignature)` — User presents TEE approval signature. Contract verifies and disburses loan.

**Security Properties:**
- **Nonce system:** `mapping(address => uint256) public nonces` increments on every successful claim. Prevents infinite replay of the same signature.
- **EIP-712 domain separation:** `block.chainid` + `address(this)` encoded in signature. Cross-chain replay is impossible.
- Custom errors (`NoxGate__InvalidSignature`, `NoxGate__AlreadyClaimed`) for gas-efficient failure modes.

---

### 2.3 NoxScoreToken.sol
**Role:** Soulbound credit score registry.

**Key Properties:**
- Non-transferable (soulbound) ERC-20 pattern — scores are identity-bound, not tradeable.
- Only `NoxOracle` can mint/update scores via `onlyOracle` modifier.
- Prevents gaming through score token transfers.

---

## 3. TEE Enclave Design (iapp/)

### 3.1 Execution Environment
- **Runtime:** Node.js inside iExec **SCONE** (Secure Linux Containers for Enclave environments)
- **SGX Mode:** Hardware mode with remote attestation enabled
- **Model:** ONNX Runtime (deterministic, hardware-accelerated inference)

### 3.2 Enclave Execution Flow
```
1. iExec workerpool allocates SGX-enabled worker node
2. SCONE loads enclave binary + ONNX model
3. Remote attestation: Intel IAS verifies MRENCLAVE measurement
4. iExec DataProtector decrypts user CSV inside enclave memory
5. ONNX model runs inference → credit score computed
6. Score compared against lender threshold → boolean result
7. Enclave signs payload with hardware-sealed private key
8. Signed attestation written to iExec task result
9. NoxOracle.sol reads and verifies result on-chain
10. Raw CSV and score permanently discarded from enclave memory
```

### 3.3 MRENCLAVE Measurement
The `MRENCLAVE` value is a SHA-256 hash of the entire enclave memory page layout at load time, including:
- The Node.js runtime binary
- The ONNX model weights
- The application source code (`src/index.ts`)

Any modification to any of these components produces a completely different `MRENCLAVE` value, invalidating all attestation signatures from the modified enclave.

---

## 4. Cryptographic Signature Flow

```
TEE Enclave                          NoxOracle.sol
─────────────────────────────────────────────────────
payload = abi.encode(
  TYPE_HASH,
  user_address,
  credit_score,
  task_id,
  block.chainid,      ◄── Prevents cross-chain replay
  address(this)       ◄── Prevents cross-contract replay
)

hash = keccak256(payload)
sig  = ECDSA.sign(hash, enclave_private_key)
                          │
                          ▼
                 submitScore(user, score, taskId, sig)
                          │
                 recovered = ECDSA.recover(hash, sig)
                 require(recovered == teeSignerAddress) ✅
```

---

## 5. Data Privacy Guarantees

| Data Type | Who Sees It |
|---|---|
| Raw financial CSV | **Nobody** — deleted inside enclave after inference |
| Credit score (numeric) | **Nobody** — never exits the enclave |
| Threshold result (bool) | TEE enclave + on-chain smart contract only |
| TEE attestation signature | Public (on-chain) |
| Loan approval status | Public (on-chain event) |

---

## 6. Performance Benchmarks

| Operation | Estimated Latency |
|---|---|
| Client-side CSV encryption | < 100ms |
| iExec task submission (testnet) | ~15–30 seconds |
| ONNX model inference (inside SGX) | < 500ms |
| On-chain signature verification | ~1 block (~0.25s on Arbitrum) |
| Total end-to-end flow | ~1–2 minutes (testnet) |

> **Note:** Testnet latency is dominated by iExec workerpool scheduling, not by the enclave computation itself. Mainnet with dedicated workers targets < 30 second total latency.

---

## 7. Known Limitations & Future Work

| Limitation | Severity | Mitigation Plan |
|---|---|---|
| `setTeeSigner()` has no timelock | Medium | 48-hour timelock + DAO multi-sig (Phase 4) |
| Side-channel attacks (cache timing) | Low | iExec SCONE ASLR mitigates; full audit planned |
| SGX hardware dependency | Low-Medium | Emergency key rotation via timelock if SGX vulnerability announced |
| Mock signing in UI demo | None (demo only) | Production iApp replaces with real hardware key injection |
| Single workerpool dependency | Medium | Multi-workerpool routing (Phase 3) |

---

## 8. Technology Decisions Log

| Decision | Rationale |
|---|---|
| Removed Zama FHE | iExec hackathon does not support fhevm on target chain. TEE attestation achieves equivalent privacy guarantees with better performance. |
| Arbitrum Sepolia | Low gas fees, fast block times, strong EVM compatibility for testnet demonstration. |
| `abi.encode` over `abi.encodePacked` | Prevents hash collision attacks with dynamic-length parameters. |
| EIP-712 domain separators | Industry standard for structured data signing. Prevents cross-chain and cross-contract replay attacks. |
| Soulbound score tokens | Credit scores are identity-bound. Making them transferable would enable score gaming. |
