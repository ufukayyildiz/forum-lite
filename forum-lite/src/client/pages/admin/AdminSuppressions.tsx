import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type AdminEmailSuppression } from "../../lib/api";
import { relativeTime } from "../../lib/utils";

function cfColor(status: string | null): string {
  if (status === "synced") return "var(--gb-green)";
  if (status === "error" || status === "auth_error") return "var(--gb-red)";
  if (status === "pending") return "var(--gb-yellow)";
  return "var(--gb-gray)";
}

function displayUser(row: AdminEmailSuppression): string {
  if (!row.username) return "-";
  return row.displayName && row.displayName !== row.username
    ? `${row.displayName} @${row.username}`
    : `@${row.username}`;
}

export default function AdminSuppressions() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const qc = useQueryClient();
  const perPage = 100;

  const { data, isLoading } = useQuery({
    queryKey: ["admin-email-suppressions", page, q, perPage],
    queryFn: () => api.adminEmailSuppressions({ page, q, perPage }),
  });

  const sync = useMutation({
    mutationFn: () => api.adminSyncEmailSuppressions(72),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["admin-email-suppressions"] });
      qc.invalidateQueries({ queryKey: ["admin-marketing-users"] });
      const message = `CF sync: ${result.localUpdates} local updates, ${result.deliveryFailures} failures`;
      if (!result.configured) toast.error("CF sync secrets are missing");
      else if (result.errors.length) toast.warning(`${message}; ${result.errors[0]}`);
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
      toast.success(`Suppressed ${result.email}`);
    },
    onError: (error: any) => toast.error(error.message || "Suppression failed"),
  });

  const remove = useMutation({
    mutationFn: (email: string) => api.adminRemoveEmailSuppression(email),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["admin-email-suppressions"] });
      qc.invalidateQueries({ queryKey: ["admin-marketing-users"] });
      toast.success(`Removed ${result.email}`);
    },
    onError: (error: any) => toast.error(error.message || "Remove failed"),
  });

  const rows = data?.suppressions ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.perPage)) : 1;
  const withUsers = useMemo(() => rows.filter((row) => row.username).length, [rows]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ border: "1px solid var(--gb-bg2)", background: "var(--gb-bg0)", padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, color: "var(--gb-yellow)", fontSize: 16 }}>$ suppression</h2>
          <span style={{ color: "var(--gb-gray)", fontSize: 12 }}>
            local list blocks all email types: marketing, notify, account, password reset
          </span>
          <div style={{ flex: 1 }} />
          <a className="gb-btn" href="/api/admin/email-suppressions/export" download>
            $ download csv
          </a>
          <button className="gb-btn" type="button" disabled={sync.isPending} onClick={() => sync.mutate()}>
            {sync.isPending ? "$ syncing..." : "$ sync cf"}
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) minmax(220px, 420px) auto", gap: 8, alignItems: "center" }}>
        <input
          value={q}
          onChange={(event) => {
            setQ(event.target.value);
            setPage(1);
          }}
          placeholder="search email, user, reason..."
          style={{ background: "var(--gb-bg1)", border: "1px solid var(--gb-bg3)", color: "var(--gb-fg)", font: "inherit", padding: "6px 8px" }}
        />
        <input
          value={manualEmail}
          onChange={(event) => setManualEmail(event.target.value)}
          placeholder="email@domain.com"
          style={{ background: "var(--gb-bg1)", border: "1px solid var(--gb-bg3)", color: "var(--gb-fg)", font: "inherit", padding: "6px 8px" }}
        />
        <button
          className="gb-btn gb-btn-primary"
          type="button"
          disabled={!manualEmail.trim() || manualSuppress.isPending}
          onClick={() => manualSuppress.mutate()}
        >
          $ suppress
        </button>
      </div>

      {data && (
        <div style={{ color: "var(--gb-gray)", fontSize: 12 }}>
          {data.total} total / {rows.length} showing / {withUsers} linked users
          {!data.syncConfigured && <span style={{ color: "var(--gb-yellow)", marginLeft: 10 }}>CF sync secrets missing</span>}
        </div>
      )}

      <table className="gb-table">
        <thead>
          <tr>
            <th scope="col" style={{ textAlign: "right", paddingRight: 16 }}>#</th>
            <th scope="col">EMAIL</th>
            <th scope="col">USER</th>
            <th scope="col">THREADS</th>
            <th scope="col">REPLIES</th>
            <th scope="col">REASON</th>
            <th scope="col">CF</th>
            <th scope="col">UPDATED</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16 }}>~</td>
              <td colSpan={8} style={{ color: "var(--gb-gray)" }}>$ loading...</td>
            </tr>
          ) : rows.length ? rows.map((row, i) => (
            <tr key={row.email}>
              <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>
                {i + 1 + (page - 1) * (data?.perPage ?? perPage)}
              </td>
              <td>
                <div style={{ color: "var(--gb-fg)", fontSize: 13 }}>{row.email}</div>
                <div style={{ color: "var(--gb-gray)", fontSize: 11 }}>{row.source}</div>
              </td>
              <td style={{ color: row.username ? "var(--gb-fg)" : "var(--gb-gray)", fontSize: 12 }}>{displayUser(row)}</td>
              <td style={{ color: "var(--gb-green)", fontSize: 12 }}>{row.threadCount}</td>
              <td style={{ color: "var(--gb-green)", fontSize: 12 }}>{row.postCount}</td>
              <td style={{ color: "var(--gb-red)", fontSize: 12 }}>{row.reason}</td>
              <td style={{ color: cfColor(row.cfSuppressionStatus), fontSize: 12 }}>{row.cfSuppressionStatus ?? "unknown"}</td>
              <td style={{ color: "var(--gb-gray)", fontSize: 12 }}>{relativeTime(row.updatedAt)}</td>
              <td style={{ textAlign: "right" }}>
                <button
                  className="gb-btn"
                  type="button"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (window.confirm(`Remove local suppression for ${row.email}?`)) remove.mutate(row.email);
                  }}
                >
                  $ remove
                </button>
              </td>
            </tr>
          )) : (
            <tr>
              <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16 }}>~</td>
              <td colSpan={8} style={{ color: "var(--gb-gray)" }}>no suppressions</td>
            </tr>
          )}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid var(--gb-bg2)" }}>
          <button className="gb-btn" style={{ padding: "2px 10px" }} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>prev</button>
          <span style={{ color: "var(--gb-gray)", fontSize: 12 }}>{page} / {totalPages}</span>
          <button className="gb-btn" style={{ padding: "2px 10px" }} disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>next</button>
        </div>
      )}
    </div>
  );
}
