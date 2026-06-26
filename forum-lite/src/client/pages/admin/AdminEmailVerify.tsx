import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type AdminEmailVerifyRow } from "../../lib/api";
import { relativeTime } from "../../lib/utils";

const MAX_SUPPRESS = 200;

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
  return "MX ok";
}

export default function AdminEmailVerify() {
  const [q, setQ] = useState("");
  const [risk, setRisk] = useState("all");
  const [action, setAction] = useState("all");
  const [hours, setHours] = useState(72);
  const [verifyLimit, setVerifyLimit] = useState(25);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["admin-email-verify", hours, q, risk, action],
    queryFn: () => api.adminEmailVerify({ hours, q, risk, action }),
  });

  const rows = query.data?.rows ?? [];
  const selectable = useMemo(
    () => rows.filter((row) => !row.suppressed && row.action === "suppress"),
    [rows],
  );
  const selectedRows = rows.filter((row) => selected.has(row.email) && !row.suppressed);

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
    mutationFn: () => api.adminEmailVerifyRun(verifyLimit),
    onSuccess: (result) => {
      refreshAll();
      toast.success(`Preflight batch: ${result.okPreflight} ok, ${result.risky} risky, ${result.error} errors, ${result.remaining} remaining, 0 emails sent`);
    },
    onError: (error: any) => toast.error(error.message || "Verify failed"),
  });

  const toggle = (row: AdminEmailVerifyRow) => {
    if (row.suppressed) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(row.email)) next.delete(row.email);
      else if (next.size < MAX_SUPPRESS) next.add(row.email);
      return next;
    });
  };

  const selectRisky = () => {
    setSelected(new Set(selectable.slice(0, MAX_SUPPRESS).map((row) => row.email)));
  };

  const summary = query.data?.summary;
  const candidatePreview = query.data?.candidatePreview ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section style={{ border: "1px solid var(--gb-bg2)", background: "var(--gb-bg0)", padding: 12 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: "0 0 6px", color: "var(--gb-yellow)", fontSize: 15 }}>$ email verify</h2>
            <p style={{ margin: 0, color: "var(--gb-gray)", maxWidth: 920 }}>
              Scans Cloudflare failed/rejected events and checks never-emailed users with syntax, typo, disposable, MX and A/AAAA preflight. Mailbox/full-inbox status is classified only after Cloudflare returns a delivery failure.
            </p>
            <p style={{ margin: "6px 0 0", color: "var(--gb-yellow)", maxWidth: 920 }}>
              No email is sent from this screen. Use Marketing or Notify for actual sending.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button className="gb-btn" type="button" disabled={query.isFetching} onClick={() => query.refetch()}>
              $ scan cf
            </button>
            <button className="gb-btn" type="button" disabled={!selectable.length} onClick={selectRisky}>
              $ select risky ({Math.min(selectable.length, MAX_SUPPRESS)})
            </button>
            <button className="gb-btn" type="button" disabled={!selected.size} onClick={() => setSelected(new Set())}>
              $ clear
            </button>
            <button
              className="gb-btn gb-btn-primary"
              type="button"
              disabled={!selectedRows.length || suppress.isPending}
              onClick={() => suppress.mutate(selectedRows.map((row) => row.email))}
            >
              {suppress.isPending ? "$ suppressing..." : `$ suppress checked (${selectedRows.length})`}
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
            <input className="gb-input" type="number" min={1} max={100} value={verifyLimit} onChange={(event) => setVerifyLimit(Math.max(1, Math.min(100, Number(event.target.value) || 25)))} />
          </label>
          <button className="gb-btn" type="button" disabled={verify.isPending || !query.data?.candidateTotal} onClick={() => verify.mutate()}>
            {verify.isPending ? "$ checking..." : `$ preflight (${verifyLimit})`}
          </button>
        </div>
      </section>

      {query.data && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", color: "var(--gb-gray)", fontSize: 12 }}>
          <span><strong style={{ color: "var(--gb-yellow)" }}>{query.data.total}</strong> risk rows</span>
          <span><strong style={{ color: "var(--gb-yellow)" }}>{query.data.candidateTotal}</strong> never emailed</span>
          <span><strong style={{ color: "var(--gb-red)" }}>{summary?.risk.critical ?? 0}</strong> critical</span>
          <span><strong style={{ color: "var(--gb-red)" }}>{summary?.risk.high ?? 0}</strong> high</span>
          <span><strong style={{ color: "var(--gb-yellow)" }}>{summary?.action.suppress ?? 0}</strong> suppress recommended</span>
          <span><strong style={{ color: "var(--gb-green)" }}>{summary?.suppressed ?? 0}</strong> already suppressed</span>
          {!query.data.configured && <span style={{ color: "var(--gb-red)" }}>CF API secrets missing</span>}
          {query.data.errors.map((error) => <span key={error} style={{ color: "var(--gb-red)" }}>{error}</span>)}
        </div>
      )}

      {candidatePreview.length > 0 && (
        <div style={{ border: "1px solid var(--gb-bg2)", padding: "8px 10px", color: "var(--gb-gray)", fontSize: 12 }}>
          <span style={{ color: "var(--gb-yellow)" }}>next preflight:</span>{" "}
          {candidatePreview.slice(0, 8).map((user) => `${user.username} <${user.email}> [${preflightLabel(user.preflight)}]`).join(", ")}
          {candidatePreview.length > 8 ? " ..." : ""}
        </div>
      )}

      <table className="gb-table">
        <thead>
          <tr>
            <th scope="col" style={{ width: 34 }}>
              <button className="gb-check-all" type="button" onClick={selected.size ? () => setSelected(new Set()) : selectRisky}>
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
                <label className={`gb-check${row.suppressed ? " is-disabled" : ""}`}>
                  <input
                    type="checkbox"
                    disabled={row.suppressed}
                    checked={selected.has(row.email)}
                    onChange={() => toggle(row)}
                  />
                  <span />
                </label>
              </td>
              <td>
                <div style={{ color: "var(--gb-fg)", fontSize: 13 }}>
                  {row.email}
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
                {row.risk}
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
  );
}
