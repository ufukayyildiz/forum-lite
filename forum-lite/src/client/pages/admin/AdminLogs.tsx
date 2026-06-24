import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const TYPE_COLOR: Record<string, string> = {
  register:   "var(--gb-green)",
  login:      "var(--gb-aqua)",
  thread:     "var(--gb-yellow)",
  post:       "var(--gb-blue)",
  like:       "var(--gb-purple)",
  ban:        "var(--gb-red)",
  role:       "var(--gb-orange)",
  settings:   "var(--gb-fg4)",
  error:      "var(--gb-red)",
};

export default function AdminLogs() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-logs", page],
    queryFn: () => api.adminLogs(page),
    refetchInterval: 15000,
  });

  const totalPages = data ? Math.ceil(data.total / data.perPage) : 1;
  const logs = data?.logs ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {data && (
        <div style={{ fontSize: 11, color: "var(--gb-gray)", letterSpacing: ".06em" }}>
          " {data.total} total log entries — auto-refresh 15s
        </div>
      )}

      <table className="gb-table">
        <thead>
          <tr>
            <th style={{ textAlign: "right", paddingRight: 16 }}>#</th>
            <th style={{ paddingRight: 12 }}>TYPE</th>
            <th>SUMMARY</th>
            <th className="gb-col-modified" style={{ textAlign: "right", paddingRight: 12 }}>WHEN</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16 }}>~</td>
              <td colSpan={3} style={{ color: "var(--gb-gray)" }}>$ loading...</td>
            </tr>
          ) : logs.length === 0 ? (
            <tr>
              <td style={{ color: "var(--gb-bg3)", textAlign: "right", paddingRight: 16 }}>~</td>
              <td colSpan={3} style={{ color: "var(--gb-gray)" }}>no logs yet</td>
            </tr>
          ) : logs.map((log: any, i: number) => (
            <tr key={log.id}>
              <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>
                {i + 1 + (page - 1) * (data?.perPage ?? 30)}
              </td>
              <td style={{ paddingRight: 14 }}>
                <span style={{
                  fontSize: 11, fontWeight: 700, letterSpacing: ".06em",
                  color: TYPE_COLOR[log.type] ?? "var(--gb-fg4)",
                }}>
                  {log.type}
                </span>
              </td>
              <td style={{ fontSize: 12, color: "var(--gb-fg)" }}>{log.summary}</td>
              <td className="gb-col-modified" style={{ textAlign: "right", paddingRight: 12, fontSize: 11, color: "var(--gb-gray)", whiteSpace: "nowrap" }}>
                {relTime(log.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 8, borderTop: "1px solid var(--gb-bg2)" }}>
          <button className="gb-btn" style={{ padding: "2px 10px" }} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>prev</button>
          <span style={{ color: "var(--gb-gray)", fontSize: 12 }}>{page} / {totalPages}</span>
          <button className="gb-btn" style={{ padding: "2px 10px" }} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>next</button>
        </div>
      )}
    </div>
  );
}
