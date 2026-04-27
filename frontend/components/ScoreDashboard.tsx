"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";

interface ScoreDashboardProps {
  score:        number;   // 0–1000
  isStale:      boolean;
  age:          bigint;
  hasScore:     boolean;
  isLoading:    boolean;
}

// ── Score tier helpers ─────────────────────────────────────────────────────────

function getTier(score: number): { label: string; colour: string; glow: string } {
  if (score >= 800) return { label: "Exceptional",  colour: "#10b981", glow: "rgba(16,185,129,0.5)" };
  if (score >= 700) return { label: "Very Good",    colour: "#06b6d4", glow: "rgba(6,182,212,0.5)"  };
  if (score >= 600) return { label: "Good",         colour: "#7c3aed", glow: "rgba(124,58,237,0.5)" };
  if (score >= 500) return { label: "Fair",         colour: "#f59e0b", glow: "rgba(245,158,11,0.5)" };
  return                    { label: "Poor",         colour: "#ef4444", glow: "rgba(239,68,68,0.5)"  };
}

function formatAge(age: bigint): string {
  const secs = Number(age);
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

// ── Animated score ring ────────────────────────────────────────────────────────

function ScoreRing({ score, colour, glow }: { score: number; colour: string; glow: string }) {
  const radius     = 80;
  const circumf    = 2 * Math.PI * radius;
  const pct        = score / 1000;
  const dashOffset = circumf * (1 - pct);

  return (
    <svg width="200" height="200" viewBox="0 0 200 200" style={{ filter: `drop-shadow(0 0 16px ${glow})` }}>
      {/* Background track */}
      <circle
        cx="100" cy="100" r={radius}
        fill="none"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth="12"
      />
      {/* Score arc */}
      <motion.circle
        cx="100" cy="100" r={radius}
        fill="none"
        stroke={colour}
        strokeWidth="12"
        strokeLinecap="round"
        strokeDasharray={circumf}
        initial={{ strokeDashoffset: circumf }}
        animate={{ strokeDashoffset: dashOffset }}
        transition={{ duration: 1.6, ease: [0.4, 0, 0.2, 1], delay: 0.2 }}
        style={{ transformOrigin: "100px 100px", transform: "rotate(-90deg)" }}
      />
      {/* Score number */}
      <motion.text
        x="100" y="95"
        textAnchor="middle"
        fill="white"
        fontSize="32"
        fontWeight="800"
        fontFamily="Inter, sans-serif"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
      >
        {score}
      </motion.text>
      <motion.text
        x="100" y="118"
        textAnchor="middle"
        fill="rgba(255,255,255,0.4)"
        fontSize="11"
        fontFamily="Inter, sans-serif"
      >
        out of 1000
      </motion.text>
    </svg>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function ScoreDashboard({ score, isStale, age, hasScore, isLoading }: ScoreDashboardProps) {
  const [displayed, setDisplayed] = useState(false);
  const tier = getTier(score);

  useEffect(() => {
    if (hasScore && !isLoading) {
      const t = setTimeout(() => setDisplayed(true), 100);
      return () => clearTimeout(t);
    }
  }, [hasScore, isLoading]);

  if (isLoading) {
    return (
      <div className="card" style={{ textAlign: "center", padding: "3rem" }}>
        <div className="spinner" style={{ margin: "0 auto 1rem" }} />
        <p style={{ color: "var(--text-secondary)" }}>Loading score from chain…</p>
      </div>
    );
  }

  if (!hasScore) {
    return (
      <div className="card" style={{ textAlign: "center", padding: "3rem" }}>
        <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🔒</div>
        <h3 style={{ marginBottom: "0.5rem", color: "var(--text-primary)" }}>No Score Yet</h3>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
          Upload your financial data to get your confidential credit score.
        </p>
      </div>
    );
  }

  return (
    <AnimatePresence>
      {displayed && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="card card--glow"
          style={{ textAlign: "center", position: "relative", overflow: "hidden" }}
          id="score-dashboard"
        >
          {/* Decorative glow background */}
          <div style={{
            position: "absolute",
            inset: 0,
            background: `radial-gradient(ellipse at 50% 0%, ${tier.glow} 0%, transparent 70%)`,
            pointerEvents: "none",
          }} />

          {/* Header */}
          <div style={{ marginBottom: "1.5rem", position: "relative" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                Confidential Credit Score
              </span>
              <span
                className={`badge ${isStale ? "badge--warning" : "badge--success"}`}
                id="score-freshness-badge"
              >
                {isStale ? "⚠ Stale" : "✓ Fresh"}
              </span>
            </div>
          </div>

          {/* Score ring */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "1.5rem" }}>
            <ScoreRing score={score} colour={tier.colour} glow={tier.glow} />
          </div>

          {/* Tier badge */}
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.8 }}
            style={{ marginBottom: "1rem" }}
          >
            <span
              className="badge"
              style={{
                background: `${tier.glow}`,
                color: tier.colour,
                border: `1px solid ${tier.colour}40`,
                fontSize: "0.85rem",
                padding: "4px 16px",
              }}
              id="score-tier-badge"
            >
              {tier.label}
            </span>
          </motion.div>

          {/* Age */}
          {age > 0n && (
            <p style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
              Last scored {formatAge(age)}
            </p>
          )}

          {/* Privacy note */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.2 }}
            style={{
              marginTop: "1.5rem",
              padding: "0.75rem",
              background: "rgba(124,58,237,0.08)",
              borderRadius: "var(--radius-md)",
              border: "1px solid rgba(124,58,237,0.15)",
            }}
          >
            <p style={{ color: "var(--text-secondary)", fontSize: "0.78rem" }}>
              🔐 This score is stored as an encrypted TFHE ciphertext on-chain.
              Nobody — including NoxGuard — can see your raw score without your permission.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
