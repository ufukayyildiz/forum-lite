import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type AdminEmailVerifyRow } from "../../lib/api";
import { relativeTime } from "../../lib/utils";

const MAX_SUPPRESS = 200;
const MAX_PREFLIGHT = 100;

type VerifyQueuedUser = Pick<AdminEmailVerifyRow, "email" | "username" | "displayName">;
type VerifyResult = {
  userId?: number;
  username?: string;
  email: string;
  status: string;
  preflight?: AdminEmailVerifyRow["preflight"];
};
type VerifyLogState = {
  open: boolean;
  phase: "checking" | "done" | "error";
  mode: "selected" | "batch";
  queued: VerifyQueuedUser[];
  results: VerifyResult[];
  message: string;
};

function riskColor(risk: string) {
  if (risk === "critical" || risk === "high") return "var(--gb-red)";
  if (risk === "medium" || risk === "system") return "var(--gb-yellow)";
  return "var(--gb-gray)";
}

function compact(value: string | null | undefined, fallback = "-") {
  return value && value.trim() ? value : fallback;
}

function preflightLabel(preflight: AdminEmailVerifyRow["preflight"] | undefined) {
  if (!preflight) return "preflight pending";
  if (!preflight.validSyntax) return "bad syntax";
  if (preflight.typoSuggestion) return `typo? use ${preflight.typoSuggestion}`;
  if (preflight.disposable) return "disposable";
  if (!preflight.domainExists) return "no DNS";
  if (!preflight.hasMx) return "no MX, A fallback";
  return "DNS/MX passed, mailbox unknown";
}

function statusLabel(status: string) {
  if (status === "preflight_ok") return "DNS/MX passed";
  if (status === "preflight_risky") return "risky";
  return status;
}

function passedStatus(status: string) {
  return status === "preflight_ok";
}

export default function AdminEmailVerify() {
  const [q, setQ] = useState("");
  const [risk, setRisk] = useState("all");
  const [action, setAction] = useState("all");
  const [hours, setHours] = useState(72);
  const [verifyLimit, setVerifyLimit] = useState(100);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [verifyLog, setVerifyLog] = useState<VerifyLogState | null>(null);
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["admin-email-verify", hours, q, risk, action, verifyLimit],
    queryFn: () => api.adminEmailVerify({ hours, q, risk, action, candidateLimit: verifyLimit }),
  });

  const rows = query.data?.rows ?? [];
  const candidateRows = useMemo(
    () => rows.filter((row) => row.rowType === "candidate" && !row.suppressed),
    [rows],
  );
  const riskRows = useMemo(
    () => rows.filter((row) => row.rowType !== "candidate"),
    [rows],
  );
  const suppressableRows = useMemo(
    () => riskRows.filter((row) => !row.suppressed && row.action === "suppress"),
    [riskRows],
  );
  const selectedCandidateRows = candidateRows.filter((row) => selected.has(row.email));
  const selectedSuppressRows = suppressableRows.filter((row) => selected.has(row.email));
  const queuedForNextBatch = candidateRows.slice(0, verifyLimit);

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["admin-email-verify"] });
    qc.invalidateQueries({ queryKey: ["admin-email-suppressions"] });
    qc.invalidateQueries({ queryKey: ["admin-marketing-users"] });
    qc.invalidateQueries({ queryKey: ["admin-marketing-sends"] });
  };

  const suppress = useMutation({
    mutationFn: (emails: string[]) => api.adminEmailVerifySuppress(emails),
    onSuccess: (result) => {
      setSelected(new Set());
      refreshAll();
      toast.success(`Suppressed ${result.suppressed}/${result.total} emails`);
      if (result.errors?.length) toast.warning(`${result.errors.length} suppression errors`);
    },
    onError: (error: any) => toast.error(error.message || "Suppression failed"),
  });

  const verify = useMutation({
    mutationFn: (emails?: string[]) => api.adminEmailVerifyRun(emails?.length ? { emails } : { limit: verifyLimit }),
    onSuccess: (result) => {
      setVerifyLog((current) => current ? {
        ...current,
        phase: "done",
        results: result.results ?? [],
        message: `Completed: ${result.okPreflight} DNS/MX passed, ${result.risky} risky, ${result.skipped} already checked/skipped, ${result.error} errors, ${result.remaining} remaining. 0 emails sent.`,
      } : current);
      setSelected(new Set());
      refreshAll();
      toast.success(`Verify batch: ${result.okPreflight} passed, ${result.risky} risky, ${result.error} errors, ${result.remaining} remaining, 0 emails sent`);
    },
    onError: (error: any) => {
      const message = error.message || "Verify failed";
      setVerifyLog((current) => current ? { ...current, phase: "error", message } : current);
      toast.error(message);
    },
  });

  const toggle = (row: AdminEmailVerifyRow) => {
    if (row.suppressed) return;
    if (row.rowType !== "candidate" && row.action !== "suppress") return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(row.email)) next.delete(row.email);
      else if (row.rowType === "candidate") {
        const selectedCandidateCount = candidateRows.filter((item) => next.has(item.email)).length;
        if (selectedCandidateCount < MAX_PREFLIGHT) next.add(row.email);
      } else {
        const selectedSuppressCount = suppressableRows.filter((item) => next.has(item.email)).length;
        if (selectedSuppressCount < MAX_SUPPRESS) next.add(row.email);
      }
      return next;
    });
  };

  const selectRisky = () => {
    setSelected(new Set(suppressableRows.slice(0, MAX_SUPPRESS).map((row) => row.email)));
  };

  const selectCandidates = () => {
    setSelected(new Set(candidateRows.slice(0, MAX_PREFLIGHT).map((row) => row.email)));
  };

  const summary = query.data?.summary;
  const runQueuedRows = selectedCandidateRows.length ? selectedCandidateRows : queuedForNextBatch;
  const runMode: VerifyLogState["mode"] = selectedCandidateRows.length ? "selected" : "batch";
  const runLabel = selectedCandidateRows.length ? `$ run preflight (${selectedCandidateRows.length})` : `$ run preflight next ${verifyLimit}`;

  const runPreflight = () => {
    if (verify.isPending || !runQueuedRows.length) return;
    const queued = runQueuedRows.map((row) => ({
      email: row.email,
      username: row.username,
      displayName: row.displayName,
    }));
    setVerifyLog({
      open: true,
      phase: "checking",
      mode: runMode,
      queued,
      results: [],
      message: `${queued.length} address${queued.length === 1 ? "" : "es"} queued for passive preflight. No email will be sent.`,
    });
    verify.mutate(selectedCandidateRows.length ? selectedCandidateRows.map((row) => row.email) : undefined);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section style={{ border: "1px solid var(--gb-bg2)", background: "var(--gb-bg0)", padding: 12 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: "0 0 6px", color: "var(--gb-yellow)", fontSize: 15 }}>$ email verify</h2>
            <p style={{ margin: 0, color: "var(--gb-gray)", maxWidth: 920 }}>
              Scans Cloudflare failed/rejected events, then checks never-emailed users with syntax, typo, disposable, MX and A/AAAA preflight.
            </p>
            <p style={{ margin: "6px 0 0", color: "var(--gb-yellow)", maxWidth: 920 }}>
              No email is sent from this screen. Mailbox existence and inbox quota are classified only after Cloudflare returns a failed/rejected delivery event.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button className="gb-btn" type="button" disabled={query.isFetching} onClick={() => query.refetch()}>
              $ scan cf
            </button>
            <button className="gb-btn" type="button" disabled={!candidateRows.length} onClick={selectCandidates}>
              $ select unverified ({Math.min(candidateRows.length, MAX_PREFLIGHT)})
            </button>
            <button className="gb-btn" type="button" disabled={!suppressableRows.length} onClick={selectRisky}>
              $ select risky ({Math.min(suppressableRows.length, MAX_SUPPRESS)})
            </button>
            <button className="gb-btn" type="button" disabled={!selected.size} onClick={() => setSelected(new Set())}>
              $ clear
            </button>
            <button
              className="gb-btn gb-btn-primary"
              type="button"
              disabled={!selectedSuppressRows.length || suppress.isPending}
              onClick={() => suppress.mutate(selectedSuppressRows.map((row) => row.email))}
            >
              {suppress.isPending ? "$ suppressing..." : `$ suppress checked (${selectedSuppressRows.length})`}
            </button>
          </div>
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1fr) 140px 140px 120px auto", gap: 8, alignItems: "end" }}>
        <label style={{ display: "grid", gap: 4, color: "var(--gb-gray)", fontSize: 11, letterSpacing: ".06em" }}>
          SEARCH
          <input className="gb-input" value={q} onChange={(event) => setQ(event.target.value)} placeholder="email, username, error..." />
        </label>
        <label style={{ display: "grid", gap: 4, color: "var(--gb-gray)", fontSize: 11, letterSpacing: ".06em" }}>
          RISK
          <select className="gb-input" value={risk} onChange={(event) => setRisk(event.target.value)}>
            <option value="all">all</option>
            <option value="critical">critical</option>
            <option value="high">high</option>
            <option value="medium">medium</option>
            <option value="system">system</option>
            <option value="low">low</option>
          </select>
        </label>
        <label style={{ display: "grid", gap: 4, color: "var(--gb-gray)", fontSize: 11, letterSpacing: ".06em" }}>
          ACTION
          <select className="gb-input" value={action} onChange={(event) => setAction(event.target.value)}>
            <option value="all">all</option>
            <option value="suppress">suppress</option>
            <option value="review">review</option>
            <option value="ignore">ignore</option>
          </select>
        </label>
        <label style={{ display: "grid", gap: 4, color: "var(--gb-gray)", fontSize: 11, letterSpacing: ".06em" }}>
          HOURS
          <input className="gb-input" type="number" min={1} max={720} value={hours} onChange={(event) => setHours(Number(event.target.value) || 72)} />
        </label>
        <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
          <label style={{ display: "grid", gap: 4, color: "var(--gb-gray)", fontSize: 11, letterSpacing: ".06em", width: 110 }}>
            PREFLIGHT BATCH
            <input className="gb-input" type="number" min={1} max={100} value={verifyLimit} onChange={(event) => setVerifyLimit(Math.max(1, Math.min(100, Number(event.target.value) || 100)))} />
          </label>
          <button className="gb-btn gb-btn-primary" type="button" disabled={verify.isPending || !runQueuedRows.length} onClick={runPreflight}>
            {verify.isPending ? "$ checking..." : runLabel}
          </button>
        </div>
      </section>

      {query.data && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", color: "var(--gb-gray)", fontSize: 12 }}>
          <span><strong style={{ color: "var(--gb-yellow)" }}>{query.data.total}</strong> visible rows</span>
          <span><strong style={{ color: "var(--gb-yellow)" }}>{query.data.candidateTotal}</strong> never emailed total</span>
          <span><strong style={{ color: "var(--gb-green)" }}>{candidateRows.length}</strong> selectable now</span>
          <span><strong style={{ color: "var(--gb-yellow)" }}>{selectedCandidateRows.length}/{MAX_PREFLIGHT}</strong> selected for preflight</span>
          <span><strong style={{ color: "var(--gb-red)" }}>{selectedSuppressRows.length}/{MAX_SUPPRESS}</strong> selected for suppression</span>
          <span><strong style={{ color: "var(--gb-red)" }}>{summary?.risk.critical ?? 0}</strong> critical</span>
          <span><strong style={{ color: "var(--gb-red)" }}>{summary?.risk.high ?? 0}</strong> high</span>
          <span><strong style={{ color: "var(--gb-yellow)" }}>{summary?.action.suppress ?? 0}</strong> suppress recommended</span>
          <span><strong style={{ color: "var(--gb-green)" }}>{summary?.suppressed ?? 0}</strong> already suppressed</span>
          {!query.data.configured && <span style={{ color: "var(--gb-red)" }}>CF API secrets missing</span>}
          {query.data.errors.map((error) => <span key={error} style={{ color: "var(--gb-red)" }}>{error}</span>)}
        </div>
      )}

      <div className="gb-email-verify-table-wrap">
      <table className="gb-table gb-email-verify-table">
        <thead>
          <tr>
            <th scope="col" style={{ width: 34 }}>
              <button className="gb-check-all" type="button" onClick={selected.size ? () => setSelected(new Set()) : selectCandidates}>
                {selected.size ? "–" : "✓"}
              </button>
            </th>
            <th scope="col">EMAIL</th>
            <th scope="col">RISK</th>
            <th scope="col">CLASS</th>
            <th scope="col">ATTEMPTS</th>
            <th scope="col">LAST</th>
          </tr>
        </thead>
        <tbody>
          {query.isLoading ? (
            <tr>
              <td style={{ color: "var(--gb-gray)" }}>~</td>
              <td colSpan={5} style={{ color: "var(--gb-gray)" }}>$ loading...</td>
            </tr>
          ) : rows.length ? rows.map((row) => (
            <tr key={row.email} style={{ opacity: row.suppressed ? .55 : 1 }}>
              <td>
                <label className={`gb-check${row.suppressed || (row.rowType !== "candidate" && row.action !== "suppress") ? " is-disabled" : ""}`}>
                  <input
                    type="checkbox"
                    disabled={row.suppressed || (row.rowType !== "candidate" && row.action !== "suppress")}
                    checked={selected.has(row.email)}
                    onChange={() => toggle(row)}
                  />
                  <span />
                </label>
              </td>
              <td>
                <div style={{ color: "var(--gb-fg)", fontSize: 13 }}>
                  {row.email}
                  {row.rowType === "candidate" && <span style={{ color: "var(--gb-yellow)", marginLeft: 8 }}>never emailed</span>}
                  {row.suppressed && <span style={{ color: "var(--gb-green)", marginLeft: 8 }}>suppressed</span>}
                </div>
                <div style={{ color: "var(--gb-gray)", fontSize: 11 }}>
                  {compact(row.displayName)} {row.username ? `/ @${row.username}` : ""}
                </div>
                <div title={row.details} style={{ color: "var(--gb-gray)", fontSize: 11, maxWidth: 760, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {row.details || row.reason}
                </div>
                {row.preflight && (
                  <div style={{ color: row.preflight.canSend ? "var(--gb-green)" : "var(--gb-yellow)", fontSize: 10, marginTop: 3 }}>
                    preflight: {preflightLabel(row.preflight)} | domain {row.preflight.domain || "-"} | mx {row.preflight.hasMx ? "yes" : "no"} | a {row.preflight.hasA ? "yes" : "no"} | aaaa {row.preflight.hasAaaa ? "yes" : "no"}
                  </div>
                )}
              </td>
              <td style={{ color: riskColor(row.risk), fontSize: 12 }}>
                {row.rowType === "candidate" ? "unchecked" : row.risk}
                <div style={{ color: "var(--gb-gray)", fontSize: 10 }}>{row.score}/100</div>
              </td>
              <td style={{ fontSize: 12 }}>
                <div style={{ color: row.action === "suppress" ? "var(--gb-red)" : "var(--gb-yellow)" }}>{row.label}</div>
                <div style={{ color: "var(--gb-gray)", maxWidth: 420 }}>{row.reason}</div>
                {row.evidence.length > 0 && (
                  <div style={{ color: "var(--gb-green)", fontSize: 10 }}>{row.evidence.join(", ")}</div>
                )}
              </td>
              <td style={{ color: "var(--gb-fg)", fontSize: 12 }}>
                {row.attempts}
                {row.temporary && <div style={{ color: "var(--gb-yellow)", fontSize: 10 }}>temporary</div>}
              </td>
              <td style={{ color: "var(--gb-gray)", fontSize: 12 }}>
                {row.lastSeenAt ? relativeTime(row.lastSeenAt) : "-"}
                {row.suppressionUpdatedAt && <div style={{ color: "var(--gb-green)", fontSize: 10 }}>suppressed {relativeTime(row.suppressionUpdatedAt)}</div>}
              </td>
            </tr>
          )) : (
            <tr>
              <td style={{ color: "var(--gb-gray)" }}>~</td>
              <td colSpan={5} style={{ color: "var(--gb-gray)" }}>no delivery risks found</td>
            </tr>
          )}
        </tbody>
      </table>
      </div>

      {verifyLog?.open && (
        <div className="gb-preview-overlay" role="presentation" onClick={(event) => {
          if (event.target === event.currentTarget && verifyLog.phase !== "checking") setVerifyLog(null);
        }}>
          <section className="gb-preview-dialog gb-send-dialog" role="dialog" aria-modal="true" aria-labelledby="email-verify-run-title">
            <div className="gb-preview-titlebar">
              <div id="email-verify-run-title" className="gb-preview-title">
                {verifyLog.phase === "checking" ? "$ email preflight running" : "$ email preflight log"}
              </div>
              <button
                className="gb-btn"
                type="button"
                disabled={verifyLog.phase === "checking"}
                onClick={() => setVerifyLog(null)}
              >
                $ close
              </button>
            </div>
            <div className="gb-preview-subject">
              {verifyLog.message}
            </div>
            <div className="gb-send-log">
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", padding: "10px 0", color: "var(--gb-gray)", fontSize: 12 }}>
                <span><strong style={{ color: "var(--gb-yellow)" }}>{verifyLog.queued.length}</strong> queued</span>
                <span><strong style={{ color: "var(--gb-green)" }}>{verifyLog.results.filter((row) => passedStatus(row.status)).length}</strong> passed</span>
                <span><strong style={{ color: "var(--gb-red)" }}>{verifyLog.results.filter((row) => row.status === "preflight_risky").length}</strong> risky</span>
                <span><strong style={{ color: "var(--gb-yellow)" }}>0</strong> emails sent</span>
                <span>{verifyLog.mode === "selected" ? "selected run" : "next batch"}</span>
              </div>
              <table className="gb-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: "right", paddingRight: 16 }}>#</th>
                    <th>EMAIL</th>
                    <th>USER</th>
                    <th>STATUS</th>
                    <th>CHECKS</th>
                  </tr>
                </thead>
                <tbody>
                  {(verifyLog.results.length ? verifyLog.results : verifyLog.queued.map((row) => ({
                    email: row.email,
                    username: row.username ?? undefined,
                    status: verifyLog.phase === "checking" ? "checking" : "queued",
                    preflight: null,
                  }))).map((row, index) => (
                    <tr key={`${row.email}-${index}`}>
                      <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>{index + 1}</td>
                      <td style={{ color: "var(--gb-fg)", fontSize: 12 }}>{row.email}</td>
                      <td style={{ color: "var(--gb-gray)", fontSize: 11 }}>@{row.username ?? "unknown"}</td>
                      <td style={{
                        color: passedStatus(row.status) ? "var(--gb-green)" : row.status === "checking" ? "var(--gb-yellow)" : "var(--gb-red)",
                        fontSize: 12,
                      }}>
                        {statusLabel(row.status)}
                      </td>
                      <td style={{ color: "var(--gb-gray)", fontSize: 11 }}>
                        {row.preflight
                          ? `${preflightLabel(row.preflight)} / mx ${row.preflight.hasMx ? "yes" : "no"} / a ${row.preflight.hasA ? "yes" : "no"} / aaaa ${row.preflight.hasAaaa ? "yes" : "no"}`
                          : verifyLog.phase === "checking" ? "syntax, typo, disposable, MX, A/AAAA..." : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
