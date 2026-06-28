import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../../lib/api";
import { relativeTime } from "../../lib/utils";
import { PaginationControls } from "../../components/PaginationControls";

function explainCfError(error: string): string {
  const normalized = error.toLowerCase();
  if (normalized.includes("authentication error") || normalized.includes("not authorized") || normalized.includes("permission")) {
    return "permission/auth error: token needs Email Sending write access for devfox.net";
  }
  if (normalized.includes("not found") || normalized.includes("unknown route")) {
    return "Cloudflare suppression write API is unavailable for this token";
  }
  return error;
}

export default function AdminBounces() {
  const [page, setPage] = useState(1);
  const [manualEmail, setManualEmail] = useState("");
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin-email-suppressions", page],
    queryFn: () => api.adminEmailSuppressions(page),
  });
  const sync = useMutation({
    mutationFn: () => api.adminSyncEmailSuppressions(72),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["admin-email-suppressions"] });
      qc.invalidateQueries({ queryKey: ["admin-marketing-users"] });
      qc.invalidateQueries({ queryKey: ["admin-marketing-sends"] });
      const message = `CF sync: ${result.localUpdates} local updates, ${result.deliveryFailures} failures, ${result.cfWriteSynced}/${result.cfWriteAttempts} CF writes`;
      if (!result.configured) toast.error("CF sync secrets are missing: CF_ACCOUNT_ID / CF_EMAIL_API_TOKEN");
      else if (result.errors.length) toast.warning(`${message}; ${result.errors[0]}`);
      else if (result.cfWriteErrors) toast.warning(`${message}; ${result.cfWriteErrors} CF write errors`);
      else toast.success(message);
    },
    onError: (error: any) => toast.error(error.message || "CF sync failed"),
  });
  const manualSuppress = useMutation({
    mutationFn: () => api.adminAddEmailSuppression(manualEmail),
    onSuccess: (result) => {
      setManualEmail("");
      qc.invalidateQueries({ queryKey: ["admin-email-suppressions"] });
      qc.invalidateQueries({ queryKey: ["admin-marketing-users"] });
      qc.invalidateQueries({ queryKey: ["admin-marketing-sends"] });
      toast.success(`Suppressed ${result.email}`);
    },
    onError: (error: any) => toast.error(error.message || "Suppression failed"),
  });

  const totalPages = data ? Math.ceil(data.total / data.perPage) : 1;
  const rows = data?.suppressions ?? [];
  const cfWriteBlockedCount = rows.filter((row: any) => row.cfSuppressionStatus === "error" || row.cfSuppressionStatus === "auth_error").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {data && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: 11, color: "var(--gb-gray)", letterSpacing: ".06em" }}>
            " {data.total} suppressed emails
          </div>
          <button
            className="gb-btn gb-btn-primary"
            type="button"
            disabled={sync.isPending}
            onClick={() => sync.mutate()}
          >
            {sync.isPending ? "$ syncing cf..." : "$ sync cf failures"}
          </button>
          <span style={{ color: "var(--gb-gray)", fontSize: 11 }}>
            imports Cloudflare suppression list + last 72h failed/rejected events; local suppression blocks future sends immediately
          </span>
          {!data.syncConfigured && (
            <span style={{ color: "var(--gb-red)", fontSize: 11 }}>
              CF sync disabled: set CF_ACCOUNT_ID and CF_EMAIL_API_TOKEN Worker secrets
            </span>
          )}
          {cfWriteBlockedCount > 0 && (
            <span style={{ color: "var(--gb-yellow)", fontSize: 11 }}>
              {cfWriteBlockedCount} local suppressions are blocked in FSTDESK; press sync to retry Cloudflare suppression write
            </span>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 420px) auto 1fr", gap: 8, alignItems: "center" }}>
        <input
          value={manualEmail}
          onChange={(event) => setManualEmail(event.target.value)}
          placeholder="email@domain.com"
          style={{ background: "var(--gb-bg1)", border: "1px solid var(--gb-bg3)", color: "var(--gb-fg)", font: "inherit", padding: "6px 8px" }}
        />
        <button
          className="gb-btn"
          type="button"
          disabled={!manualEmail.trim() || manualSuppress.isPending}
          onClick={() => manualSuppress.mutate()}
        >
          $ suppress
        </button>
        <span style={{ color: "var(--gb-gray)", fontSize: 11 }}>
          manual suppression also blocks future marketing sends
        </span>
      </div>

      <table className="gb-table">
        <thead>
          <tr>
            <th scope="col" style={{ textAlign: "right", paddingRight: 16 }}>#</th>
            <th scope="col">EMAIL</th>
            <th scope="col">REASON</th>
            <th scope="col">SOURCE</th>
            <th scope="col">CF</th>
            <th scope="col">UPDATED</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16 }}>~</td>
              <td colSpan={5} style={{ color: "var(--gb-gray)" }}>$ loading...</td>
            </tr>
          ) : rows.length ? rows.map((row: any, i: number) => (
            <tr key={row.email}>
              <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>
                {i + 1 + (page - 1) * (data?.perPage ?? 50)}
              </td>
              <td>
                <div style={{ color: "var(--gb-fg)", fontSize: 13 }}>{row.email}</div>
                {row.details && <div style={{ color: "var(--gb-gray)", fontSize: 11, maxWidth: 620, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.details}</div>}
              </td>
              <td style={{ color: "var(--gb-red)", fontSize: 12 }}>{row.reason}</td>
              <td style={{ color: "var(--gb-gray)", fontSize: 12 }}>{row.source}</td>
              <td style={{ color: row.cfSuppressionStatus === "synced" ? "var(--gb-green)" : row.cfSuppressionStatus === "error" ? "var(--gb-red)" : "var(--gb-yellow)", fontSize: 12 }}>
                {row.cfSuppressionStatus ?? "unknown"}
                {row.cfSuppressedAt && <div style={{ color: "var(--gb-gray)", fontSize: 10 }}>{relativeTime(row.cfSuppressedAt)}</div>}
                {row.cfSuppressionError && <div title={row.cfSuppressionError} style={{ color: "var(--gb-red)", fontSize: 10, maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{explainCfError(row.cfSuppressionError)}</div>}
              </td>
              <td style={{ color: "var(--gb-gray)", fontSize: 12 }}>{relativeTime(row.updatedAt)}</td>
            </tr>
          )) : (
            <tr>
              <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16 }}>~</td>
              <td colSpan={5} style={{ color: "var(--gb-gray)" }}>no bounces yet</td>
            </tr>
          )}
        </tbody>
      </table>

      <PaginationControls page={page} totalPages={totalPages} onPage={setPage} />
    </div>
  );
}
