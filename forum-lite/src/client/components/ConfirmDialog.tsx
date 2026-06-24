import { useState, useEffect } from "react";

interface Props {
  message: string;
  detail?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ message, detail, confirmLabel = "ok", danger = false, onConfirm, onCancel }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onConfirm, onCancel]);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(40,40,40,0.82)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: "var(--gb-bg1)",
          border: "1px solid var(--gb-bg3)",
          minWidth: 320, maxWidth: 480,
          fontFamily: "JetBrains Mono, monospace",
          padding: 0,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* titlebar */}
        <div style={{
          background: "var(--gb-bg2)",
          borderBottom: "1px solid var(--gb-bg3)",
          padding: "4px 12px",
          fontSize: 11,
          color: "var(--gb-yellow)",
          letterSpacing: "0.05em",
        }}>
          CONFIRM
        </div>

        {/* body */}
        <div style={{ padding: "18px 20px 14px" }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--gb-fg)", lineHeight: 1.5 }}>
            {message}
          </p>
          {detail && (
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--gb-gray)" }}>
              {detail}
            </p>
          )}
        </div>

        {/* statusbar-style footer */}
        <div style={{
          borderTop: "1px solid var(--gb-bg3)",
          padding: "8px 12px",
          display: "flex", gap: 8, justifyContent: "flex-end",
          background: "var(--gb-bg)",
        }}>
          <button
            className="gb-btn"
            style={{ fontSize: 12, padding: "3px 14px" }}
            onClick={onCancel}
            autoFocus
          >
            cancel
          </button>
          <button
            className={`gb-btn ${danger ? "gb-btn-danger" : "gb-btn-primary"}`}
            style={{ fontSize: 12, padding: "3px 14px" }}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ConfirmState {
  message: string;
  detail?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}

export function useConfirm() {
  const [state, setState] = useState<ConfirmState | null>(null);

  const ask = (message: string, onConfirm: () => void, opts?: { detail?: string; confirmLabel?: string; danger?: boolean }) => {
    setState({ message, onConfirm, ...opts });
  };

  const dialog = state ? (
    <ConfirmDialog
      message={state.message}
      detail={state.detail}
      confirmLabel={state.confirmLabel}
      danger={state.danger}
      onConfirm={() => { state.onConfirm(); setState(null); }}
      onCancel={() => setState(null)}
    />
  ) : null;

  return { ask, dialog };
}
