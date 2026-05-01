# NoxGuard Security Model & Threat Analysis

> This document outlines the trust model, threat surface, and mitigations implemented in the NoxGuard protocol. It is intended for security researchers, auditors, and hackathon evaluators.

---

## 1. Trust Model

NoxGuard operates on a **minimal-trust** principle. The only trusted party in the entire system is the **Intel SGX hardware** itself (verified via Remote Attestation). Every other component — including the TEE operator, the iExec workerpool node, the lender, and even the NoxGuard team — is considered **untrusted**.

```
[User] → encrypts CSV locally → [iExec SCONE SGX Enclave]
                                        │
                          (MRENCLAVE measurement verified)
                                        │
                                 [NoxOracle.sol]
                                 (ECDSA sig check)
                                        │
                               [NoxCreditGate.sol]
                               (nonce + EIP-712 check)
                                        │
                              [Loan Disbursement ✅]
```

No party in this chain — except the enclave — ever sees the raw financial data.

---

## 2. Threat Model (STRIDE)

### 2.1 Spoofing — Who can impersonate the TEE?
**Threat:** An attacker runs a fake TEE enclave and submits fraudulent credit approvals.

**Mitigation:**
- The `NoxOracle.sol` contract verifies the **ECDSA signature** of every attestation against a pre-registered `teeSignerAddress`.
- The `teeSignerAddress` corresponds to the enclave's `MRSIGNER` key, which is cryptographically bound to the Intel SGX hardware. Any code change inside the enclave produces a different `MRENCLAVE` measurement, invalidating all future signatures.
- Result: A spoofed enclave **cannot produce a valid signature** without access to the hardware-sealed private key.

---

### 2.2 Tampering — Can the AI model be modified?
**Threat:** An attacker modifies the ONNX model inside the enclave to approve all loan requests regardless of credit score.

**Mitigation:**
- The ONNX model binary is included at enclave build time. The **`MRENCLAVE`** measurement (a SHA-256 hash of the entire enclave memory layout, including the model) is registered on-chain in `NoxOracle.sol`.
- Any modification to the model produces a different `MRENCLAVE`, causing the remote attestation to fail. The oracle will reject signatures from this new measurement.
- Result: Model tampering is **cryptographically detectable** and immediately rejected on-chain.

---

### 2.3 Replay Attacks — Can an old signature be reused?
**Threat:** An attacker intercepts a valid TEE approval signature and replays it multiple times to drain the lending pool.

**Mitigation (Two-Layer Defense):**
1. **On-chain Nonces:** `NoxCreditGate.sol` maintains `mapping(address => uint256) public nonces`. Every approval signature encodes the user's current nonce. After a successful claim, the nonce is incremented, making the old signature mathematically invalid forever.
2. **EIP-712 Domain Separators:** Every signature encodes `block.chainid` and `address(this)`. A valid signature on Arbitrum Sepolia is completely invalid on any other chain or contract deployment.

```solidity
bytes32 payloadHash = keccak256(abi.encode(
    keccak256("CreditApproval(address user,address lender,uint256 nonce,uint256 chainId,address contractAddress)"),
    user, lender, nonces[user], block.chainid, address(this)
));
```

---

### 2.4 Information Disclosure — Can anyone read the credit score?
**Threat:** The raw credit score leaks to the blockchain, lender, or TEE operator.

**Mitigation:**
- The ONNX model computes the score **inside the enclave**. The raw score is **never written to any variable accessible outside the enclave memory**.
- The enclave only outputs a **boolean threshold result** (approved/rejected) and the signed attestation payload. The numeric score is discarded.
- The lender's smart contract receives only the TEE's boolean signature — never the score itself.
- Result: **Zero information disclosure** of the raw financial data or credit score.

---

### 2.5 Denial of Service — Can the system be griefed?
**Threat:** An attacker floods the oracle with invalid attestations to block legitimate users.

**Mitigation:**
- `NoxOracle.sol` uses a `taskId → bool` mapping to reject duplicate task submissions (`NoxOracle__TaskAlreadyProcessed`).
- Invalid signatures fail cheaply at the ECDSA recovery step before any state is written.
- The lender registration system requires explicit `registerLender()` calls, preventing unauthorized pool creation.

---

### 2.6 Elevation of Privilege — Can the owner abuse their admin role?
**Threat:** The contract owner calls `setTeeSigner()` to replace the TEE signer with their own key, enabling fraudulent approvals.

**Current Status (Hackathon):** The `setTeeSigner()` function is owner-gated with no timelock. This is a **known, accepted risk** for the testnet prototype.

**Planned Mitigation (Mainnet Roadmap):**
- Implement a **48-hour timelock** before any `setTeeSigner()` change takes effect.
- Migrate ownership to a **DAO multi-sig** (e.g., Gnosis Safe with 3-of-5 signers).
- Emit on-chain events for all signer updates to enable community monitoring.

---

## 3. SGX-Specific Attack Vectors

### 3.1 What if Intel SGX is compromised?
SGX has known vulnerabilities (e.g., Spectre, Foreshadow). Our mitigation strategy:
- **iExec SCONE** runs enclaves with patched microcode and OS-level mitigations against known side-channel attacks.
- In the event of a critical SGX vulnerability, the `setTeeSigner()` function allows emergency migration to a new enclave key within the timelock window.
- This is consistent with how all TEE-based systems (e.g., Chainlink, TLSNotary) handle hardware-layer risks.

### 3.2 Rollback Attacks
**Threat:** An attacker rolls back the enclave state to re-use an old nonce.

**Mitigation:** Nonces are stored **on-chain**, not inside the enclave. The enclave reads the current nonce from the blockchain at task submission time. Rolling back the enclave cannot roll back the on-chain nonce state.

### 3.3 Side-Channel Attacks (Timing, Cache)
- The ONNX inference model uses deterministic, constant-time operations where possible.
- iExec SCONE applies address-space layout randomization (ASLR) inside the enclave.
- Full constant-time guarantee is a **post-hackathon hardening target**.

---

## 4. Audit Status

| Component | Status |
|---|---|
| `NoxCreditGate.sol` | Internal audit complete. EIP-712 + nonces implemented. |
| `NoxOracle.sol` | Internal audit complete. Domain separator implemented. |
| `NoxScoreToken.sol` | Internal audit complete. Soulbound transfer lock implemented. |
| TEE Enclave (iapp/) | Functional review complete. Formal SGX audit post-hackathon. |
| Frontend | No sensitive key material in client-side code. |

---

*For responsible disclosure of security vulnerabilities, please open a GitHub Security Advisory.*
