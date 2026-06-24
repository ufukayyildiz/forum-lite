import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { relativeTime } from "../../lib/utils";

export default function AdminDashboard() {
  const { data, isLoading } = useQuery({ queryKey: ["admin-stats"], queryFn: api.adminStats });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ fontSize: 11, color: "var(--gb-gray)", letterSpacing: ".08em", padding: "4px 0 6px", borderBottom: "1px solid var(--gb-bg2)" }}>
        " recent activity
      </div>
      <table className="gb-table">
        <tbody>
          {isLoading && (
            <tr>
              <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16 }}>~</td>
              <td style={{ color: "var(--gb-gray)" }}>$ loading...</td>
            </tr>
          )}
          {data?.recentActivity.map((a: any, i: number) => (
            <tr key={a.id}>
              <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12, width: 40 }}>{i + 1}</td>
              <td>
                <div style={{ fontSize: 13, color: "var(--gb-fg)" }}>{a.summary}</div>
                <div style={{ fontSize: 11, color: "var(--gb-gray)" }}>{relativeTime(a.createdAt)}</div>
              </td>
            </tr>
          ))}
          {!isLoading && data?.recentActivity.length === 0 && (
            <tr>
              <td style={{ color: "var(--gb-bg3)", textAlign: "right", paddingRight: 16 }}>~</td>
              <td style={{ color: "var(--gb-gray)" }}>no activity yet</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
