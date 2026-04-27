"use client";

import { useCallback, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FlowState } from "../hooks/useNoxGuard";

interface ProtectDataFormProps {
  flow:            FlowState;
  onSubmit:        (csvContent: string) => void;
  onReset:         () => void;
  isConnected:     boolean;
}

const STEP_LABELS: Record<string, string> = {
  idle:       "Ready",
  protecting: "Encrypting Data",
  granting:   "Granting Access",
  submitting: "Submitting to TEE",
  computing:  "TEE Computing",
  complete:   "Complete!",
  error:      "Error",
};

const STEP_ORDER = ["protecting", "granting", "submitting", "computing", "complete"];

function StepTracker({ currentStep }: { currentStep: string }) {
  const steps = STEP_ORDER;
  const currentIdx = steps.indexOf(currentStep);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: "1.5rem" }}>
      {steps.map((step, idx) => (
        <div key={step} style={{ display: "flex", alignItems: "center", flex: idx < steps.length - 1 ? 1 : "unset" }}>
          <motion.div
            className={`step-dot step-dot--${
              idx < currentIdx  ? "complete" :
              idx === currentIdx ? "active"  : "inactive"
            }`}
            animate={{ scale: idx === currentIdx ? [1, 1.1, 1] : 1 }}
            transition={{ repeat: idx === currentIdx ? Infinity : 0, duration: 1.5 }}
          >
            {idx < currentIdx ? "✓" : idx + 1}
          </motion.div>
          {idx < steps.length - 1 && (
            <div className={`step-line ${idx < currentIdx ? "step-line--complete" : ""}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function DropZone({ onFile }: { onFile: (content: string) => void }) {
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName]     = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback((file: File) => {
    if (!file.name.endsWith(".csv") && !file.name.endsWith(".json")) {
      alert("Please upload a CSV or JSON file");
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => onFile(e.target?.result as string);
    reader.readAsText(file);
  }, [onFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  return (
    <motion.div
      id="file-dropzone"
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      animate={{
        borderColor: isDragging ? "var(--clr-primary)" : "var(--clr-border)",
        background:  isDragging ? "rgba(124,58,237,0.08)" : "var(--clr-surface)",
        scale:       isDragging ? 1.01 : 1,
      }}
      transition={{ duration: 0.15 }}
      style={{
        border: "2px dashed",
        borderRadius: "var(--radius-lg)",
        padding: "3rem 2rem",
        textAlign: "center",
        cursor: "pointer",
        marginBottom: "1.5rem",
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.json"
        style={{ display: "none" }}
        id="financial-data-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) processFile(file);
        }}
      />
      <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>📊</div>
      {fileName ? (
        <>
          <p style={{ color: "var(--clr-success)", fontWeight: 600, marginBottom: "0.25rem" }}>
            ✓ {fileName}
          </p>
          <p style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>Click to change file</p>
        </>
      ) : (
        <>
          <p style={{ color: "var(--text-primary)", fontWeight: 500, marginBottom: "0.25rem" }}>
            Drop your financial CSV here
          </p>
          <p style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
            or click to browse · CSV or JSON
          </p>
        </>
      )}

      {/* CSV format hint */}
      <div style={{
        marginTop: "1rem",
        padding: "0.5rem 1rem",
        background: "rgba(255,255,255,0.03)",
        borderRadius: "var(--radius-sm)",
        textAlign: "left",
        fontFamily: "monospace",
        fontSize: "0.7rem",
        color: "var(--text-muted)",
      }}>
        month,income,expenses,missed_payments,credit_util,loan_balance
      </div>
    </motion.div>
  );
}

export function ProtectDataForm({ flow, onSubmit, onReset, isConnected }: ProtectDataFormProps) {
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const isActive = flow.step !== "idle" && flow.step !== "error";

  if (!isConnected) {
    return (
      <div className="card" style={{ textAlign: "center", padding: "2.5rem" }}>
        <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>🦊</div>
        <h3 style={{ marginBottom: "0.5rem" }}>Connect Your Wallet</h3>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
          Connect your wallet to start the confidential credit scoring process.
        </p>
      </div>
    );
  }

  if (flow.step === "complete") {
    return (
      <motion.div
        className="card"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        style={{ textAlign: "center", padding: "3rem" }}
        id="scoring-complete-panel"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", delay: 0.1 }}
          style={{ fontSize: "3rem", marginBottom: "1rem" }}
        >
          🎉
        </motion.div>
        <h3 className="text-gradient" style={{ fontSize: "1.4rem", marginBottom: "0.5rem" }}>
          Score Computed!
        </h3>
        <p style={{ color: "var(--text-secondary)", marginBottom: "1.5rem", fontSize: "0.9rem" }}>
          Your encrypted credit score is now live on Arbitrum Sepolia.
        </p>
        {flow.txHash && (
          <a
            href={`https://sepolia.arbiscan.io/tx/${flow.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn--secondary btn--sm"
            style={{ marginBottom: "1rem", display: "inline-flex" }}
          >
            View on Arbiscan ↗
          </a>
        )}
        <br />
        <button className="btn btn--primary" onClick={onReset} id="rescore-btn">
          Score Again
        </button>
      </motion.div>
    );
  }

  return (
    <div className="card" id="protect-data-panel">
      <h2 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "0.25rem" }}>
        Get Your <span className="text-gradient">Confidential Score</span>
      </h2>
      <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
        Your data is encrypted before leaving your browser. The TEE sees it only inside the secure enclave.
      </p>

      <AnimatePresence mode="wait">
        {!isActive ? (
          <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <DropZone onFile={setCsvContent} />
            <button
              id="get-score-btn"
              className="btn btn--primary btn--lg"
              style={{ width: "100%" }}
              disabled={!csvContent}
              onClick={() => csvContent && onSubmit(csvContent)}
            >
              🔐 Get My Confidential Score
            </button>
          </motion.div>
        ) : (
          <motion.div key="progress" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <StepTracker currentStep={flow.step} />
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                  {flow.stepLabel}
                </span>
                <span style={{ fontSize: "0.85rem", color: "var(--clr-primary)", fontWeight: 600 }}>
                  {flow.progress}%
                </span>
              </div>
              <div className="progress-track">
                <motion.div
                  className="progress-fill"
                  animate={{ width: `${flow.progress}%` }}
                  transition={{ duration: 0.4 }}
                />
              </div>
            </div>
            {flow.taskId && (
              <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", wordBreak: "break-all" }}>
                Task ID: {flow.taskId}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {flow.step === "error" && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          style={{
            marginTop: "1rem",
            padding: "1rem",
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.25)",
            borderRadius: "var(--radius-md)",
          }}
          id="error-panel"
        >
          <p style={{ color: "#ef4444", fontWeight: 600, marginBottom: "0.25rem" }}>
            {flow.errorCode ?? "Error"}
          </p>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginBottom: "1rem" }}>
            {flow.error}
          </p>
          <button className="btn btn--secondary btn--sm" onClick={onReset} id="retry-btn">
            Try Again
          </button>
        </motion.div>
      )}
    </div>
  );
}
