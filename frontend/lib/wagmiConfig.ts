"use client";

import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { arbitrumSepolia } from "wagmi/chains";

// ── Wagmi v2 + RainbowKit configuration ──────────────────────────────────────
// Architecture decision: use RainbowKit for WalletConnect because it handles
// the UX complexity of wallet selection, connection state, and chain switching.

const WALLETCONNECT_PROJECT_ID: string =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "MISSING_PROJECT_ID";

export const wagmiConfig = getDefaultConfig({
  appName:     "NoxGuard — Confidential Credit Scoring",
  projectId:   WALLETCONNECT_PROJECT_ID,
  chains:      [arbitrumSepolia],
  ssr:         true,
});
