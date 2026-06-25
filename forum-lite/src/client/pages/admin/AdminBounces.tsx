import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { relativeTime } from "../../lib/utils";

export default function AdminBounces() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-email-suppressions", page],
    queryFn: () => api.adminEmailSuppressions(page),
  });

  const totalPages = data ? Math.ceil(data.total / data.perPage) : 1;
  const rows = data?.suppressions ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {data && (
        <div style={{ fontSize: 11, color: "var(--gb-gray)", letterSpacing: ".06em" }}>
          " {data.total} suppressed emails
        </div>
      )}

      <table className="gb-table">
        <thead>
          <tr>
            <th scope="col" style={{ textAlign: "right", paddingRight: 16 }}>#</th>
            <th scope="col">EMAIL</th>
            <th scope="col">REASON</th>
            <th scope="col">SOURCE</th>
            <th scope="col">UPDATED</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16 }}>~</td>
              <td colSpan={4} style={{ color: "var(--gb-gray)" }}>$ loading...</td>
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
              <td style={{ color: "var(--gb-gray)", fontSize: 12 }}>{relativeTime(row.updatedAt)}</td>
            </tr>
          )) : (
            <tr>
              <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16 }}>~</td>
              <td colSpan={4} style={{ color: "var(--gb-gray)" }}>no bounces yet</td>
            </tr>
          )}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid var(--gb-bg2)" }}>
          <button className="gb-btn" style={{ padding: "2px 10px" }} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>prev</button>
          <span style={{ color: "var(--gb-gray)", fontSize: 12 }}>{page} / {totalPages}</span>
          <button className="gb-btn" style={{ padding: "2px 10px" }} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>next</button>
        </div>
      )}
    </div>
  );
}
