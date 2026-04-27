import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "NoxGuard — Confidential AI Credit Scoring",
  description:
    "Prove your creditworthiness without revealing a single byte of your financial history. Powered by iExec Nox confidential computing and ChainGPT AI.",
  keywords: ["credit scoring", "iExec", "TEE", "confidential computing", "DeFi", "Web3"],
  openGraph: {
    title: "NoxGuard — Confidential AI Credit Scoring",
    description: "Zero-knowledge credit scoring on iExec Nox",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
