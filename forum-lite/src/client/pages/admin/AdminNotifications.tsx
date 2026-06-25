import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { relativeTime } from "../../lib/utils";

const STATUS_COLOR: Record<string, string> = {
  sent: "var(--gb-green)",
  skipped: "var(--gb-gray)",
  suppressed: "var(--gb-red)",
  error: "var(--gb-red)",
  pending: "var(--gb-yellow)",
  synced: "var(--gb-green)",
};

function StatLine({ label, rows }: { label: string; rows: any[] }) {
  return (
    <div style={{ border: "1px solid var(--gb-bg2)", padding: 10, minHeight: 74 }}>
      <div style={{ color: "var(--gb-gray)", fontSize: 10, letterSpacing: ".08em", marginBottom: 8 }}>{label}</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {rows.length ? rows.map((row) => {
          const key = row.status ?? row.kind;
          return (
            <span key={key} style={{ fontSize: 12, color: STATUS_COLOR[key] ?? "var(--gb-fg)" }}>
              {key}: <strong>{row.count}</strong>
            </span>
          );
        }) : <span style={{ color: "var(--gb-gray)", fontSize: 12 }}>empty</span>}
      </div>
    </div>
  );
}

export default function AdminNotifications() {
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState("");
  const overview = useQuery({ queryKey: ["admin-notifications"], queryFn: api.adminNotifications, refetchInterval: 15000 });
  const events = useQuery({
    queryKey: ["admin-email-events", page, kind],
    queryFn: () => api.adminEmailEvents(page, kind),
    refetchInterval: 15000,
  });

  const rows = events.data?.events ?? [];
  const totalPages = events.data ? Math.max(1, Math.ceil(events.data.total / events.data.perPage)) : 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {overview.data && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          <StatLine label={`${overview.data.eventCount} email events`} rows={overview.data.byStatus} />
          <StatLine label={`${overview.data.preferenceCount} preference records`} rows={overview.data.byKind} />
          <StatLine label={`${overview.data.suppressionCount} suppressed emails / CF sync`} rows={overview.data.cfSuppressionStatus} />
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: "var(--gb-gray)", fontSize: 11, letterSpacing: ".08em" }}>FILTER</span>
        <select className="gb-input" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }} style={{ width: 180 }}>
          <option value="">all</option>
          <option value="reply">reply</option>
          <option value="like">like</option>
          <option value="marketing">marketing</option>
          <option value="account">account</option>
        </select>
      </div>

      <table className="gb-table">
        <thead>
          <tr>
            <th style={{ textAlign: "right", paddingRight: 16 }}>#</th>
            <th>KIND</th>
            <th>RECIPIENT</th>
            <th>SUBJECT</th>
            <th>STATUS</th>
            <th className="gb-col-modified" style={{ textAlign: "right", paddingRight: 12 }}>WHEN</th>
          </tr>
        </thead>
        <tbody>
          {events.isLoading ? (
            <tr><td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16 }}>~</td><td colSpan={5} style={{ color: "var(--gb-gray)" }}>$ loading...</td></tr>
          ) : rows.length ? rows.map((row: any, i: number) => (
            <tr key={row.id}>
              <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>{i + 1 + (page - 1) * (events.data?.perPage ?? 40)}</td>
              <td style={{ color: "var(--gb-yellow)", fontSize: 12 }}>{row.kind}</td>
              <td>
                <div style={{ color: "var(--gb-fg)", fontSize: 12 }}>{row.email}</div>
                {row.campaignKey && <div style={{ color: "var(--gb-gray)", fontSize: 11 }}>{row.campaignKey}</div>}
              </td>
              <td style={{ maxWidth: 520 }}>
                <div style={{ color: "var(--gb-fg)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.subject}</div>
                {row.message && <div style={{ color: "var(--gb-gray)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.message}</div>}
              </td>
              <td style={{ color: STATUS_COLOR[row.status] ?? "var(--gb-fg)", fontSize: 12 }}>{row.status}{row.errorCode ? ` / ${row.errorCode}` : ""}</td>
              <td className="gb-col-modified" style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 12, fontSize: 11 }}>{relativeTime(row.createdAt)}</td>
            </tr>
          )) : (
            <tr><td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16 }}>~</td><td colSpan={5} style={{ color: "var(--gb-gray)" }}>no email events yet</td></tr>
          )}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 8, borderTop: "1px solid var(--gb-bg2)" }}>
          <button className="gb-btn" style={{ padding: "2px 10px" }} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>prev</button>
          <span style={{ color: "var(--gb-gray)", fontSize: 12 }}>{page} / {totalPages}</span>
          <button className="gb-btn" style={{ padding: "2px 10px" }} disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>next</button>
        </div>
      )}
    </div>
  );
}
