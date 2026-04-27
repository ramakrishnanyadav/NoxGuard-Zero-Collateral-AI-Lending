# iExec Nox Protocol — Developer Feedback

**Project:** NoxGuard — Zero-Collateral Lending via Private Credit Proof  
**Team:** Solo  
**Hackathon:** iExec Vibe Coding Challenge 2026

---

## Overall Experience

Building on the Nox protocol was genuinely exciting. The idea of combining on-chain FHE encrypted state with off-chain TEE computation is architecturally elegant, and the Confidential Token concept unlocks a class of DeFi applications that simply cannot be built on transparent blockchains.

---

## What Worked Well

### 1. fhevm v0.6 Smart Contract API
The `TFHE.sol` library is well-structured. The separation between `asEuint64(einput, proof)` (for TEE-generated ciphertext) and `TFHE.asEuint64(uint64)` (for plaintext promotion) makes the two trust models explicit. The `GatewayCaller` pattern for async decryption is clean and composable.

### 2. iExec DataProtector SDK
The `@iexec/dataprotector` v2 SDK's `.core` property for accessing protection methods was well-designed once discovered. The privacy guarantee of iExec's DataProtector is genuinely strong — the user's financial CSV never touches a public server.

### 3. Arbitrum Sepolia Integration
Deploying to Arbitrum Sepolia was seamless. Gas costs were minimal and the RPC endpoint (`https://sepolia-rollup.arbitrum.io/rpc`) was reliable throughout development.

---

## Pain Points & Improvement Suggestions

### 1. ⚠️ No Hardhat Mock for fhevm Precompiles
**Pain:** `TFHE.asEuint64(einput, proof)` — and even the plaintext variant `TFHE.asEuint64(uint64)` — revert without a reason string in the default Hardhat test environment. This is because the `TFHEExecutor` precompile is not deployed. This forced us to build TFHE-free mock contracts for all Hardhat tests, which is significant extra work and creates a two-tier test environment.

**Suggestion:** Ship a `fhevm-hardhat-plugin` (or update the existing one) that automatically deploys the mock `TFHEExecutor`, `ACL`, `KMSVerifier`, and `GatewayContract` to the Hardhat network. Ideally accessible via `import "fhevm/hardhat"` in `hardhat.config.ts`. This would allow `TFHE.asEuint64(uint64)` to work in tests without any setup overhead.

### 2. ⚠️ DataProtector v2 Breaking Change — `.core` Property
**Pain:** The `@iexec/dataprotector` v2 SDK silently moved all methods under a `.core` property (e.g., `dataProtector.core.protectData()`). The error message on the v1 call pattern is unhelpful. A builder coming from the docs or examples would be confused for hours.

**Suggestion:** Add a deprecation proxy that logs a helpful error: _"In v2, use `dataProtector.core.protectData()` instead of `dataProtector.protectData()`."_

### 3. ℹ️ iExec SDK + wagmi / ethers v6 Version Matrix
**Pain:** `iexec` SDK requires `ethers` v5 internally, while `wagmi` v2 / `rainbowkit` uses ethers v6. This creates a peer dependency conflict that produces 3-4 npm warnings and requires a wrapper shim to convert Wagmi wallet clients to ethers providers.

**Suggestion:** A compatibility guide in the docs for `wagmi v2 + iexec` integration would save builders significant time.

### 4. ℹ️ Gateway Callback Testing
**Pain:** There is no way to simulate a `GatewayContract` callback (for `callbackReceiveScore`) in the Hardhat test environment. Builders who want to test their Gateway callback logic must either deploy to testnet or mock the entire Gateway.

**Suggestion:** The Hardhat plugin (once built) should include a `simulateGatewayCallback(requestId, plaintextValue)` helper that triggers the callback in test mode.

---

## Summary Scores

| Area | Score (1–5) | Comment |
|---|---|---|
| Protocol concept | ⭐⭐⭐⭐⭐ | Genuinely novel and useful |
| fhevm Solidity API | ⭐⭐⭐⭐ | Clean, but testing needs precompile mocks |
| DataProtector SDK | ⭐⭐⭐⭐ | Powerful, docs need v2 migration guide |
| Workshop support | ⭐⭐⭐⭐⭐ | Office hours were extremely helpful |
| Arbitrum Sepolia infra | ⭐⭐⭐⭐⭐ | Rock-solid |
| Overall experience | ⭐⭐⭐⭐ | Would build on Nox again |

---

*Thank you to the iExec team for running this challenge. The Nox protocol is genuinely exciting technology and NoxGuard is a real DeFi primitive we intend to develop further.*
