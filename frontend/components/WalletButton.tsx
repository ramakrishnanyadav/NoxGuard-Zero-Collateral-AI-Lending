"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";

export function WalletButton() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const ready = mounted;
        const connected = ready && account && chain;

        return (
          <div
            id="wallet-button"
            aria-hidden={!ready}
            style={{ opacity: ready ? 1 : 0, pointerEvents: ready ? "auto" : "none" }}
          >
            {!connected ? (
              <button
                id="connect-wallet-btn"
                className="btn btn--primary"
                onClick={openConnectModal}
              >
                Connect Wallet
              </button>
            ) : chain.unsupported ? (
              <button
                id="wrong-network-btn"
                className="btn btn--danger btn--sm"
                onClick={openChainModal}
              >
                ⚠ Wrong Network
              </button>
            ) : (
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <button
                  id="chain-switch-btn"
                  className="btn btn--secondary btn--sm"
                  onClick={openChainModal}
                  style={{ gap: "0.4rem" }}
                >
                  {chain.hasIcon && chain.iconUrl && (
                    <img
                      alt={chain.name ?? "Chain"}
                      src={chain.iconUrl}
                      style={{ width: 14, height: 14, borderRadius: "50%" }}
                    />
                  )}
                  {chain.name}
                </button>
                <button
                  id="account-modal-btn"
                  className="btn btn--secondary btn--sm"
                  onClick={openAccountModal}
                >
                  {account.displayName}
                </button>
              </div>
            )}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
