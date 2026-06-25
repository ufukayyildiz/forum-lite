import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../../lib/api";
import { relativeTime } from "../../lib/utils";

export default function AdminMarketing() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<number | "">("");
  const [page, setPage] = useState(1);

  const template = useQuery({ queryKey: ["admin-marketing-template"], queryFn: api.adminMarketingTemplate });
  const users = useQuery({
    queryKey: ["admin-marketing-users", q, template.data?.campaignKey],
    queryFn: () => api.adminMarketingUsers(q, template.data?.campaignKey ?? "we-are-back"),
    enabled: !!template.data,
  });
  const sends = useQuery({
    queryKey: ["admin-marketing-sends", page],
    queryFn: () => api.adminMarketingSends(page),
    refetchInterval: 15000,
  });

  const selectedUser = useMemo(
    () => users.data?.users.find((u: any) => u.id === selectedId),
    [users.data?.users, selectedId],
  );

  const send = useMutation({
    mutationFn: (body: { test?: boolean; userId?: number }) =>
      api.adminSendMarketing({ campaignKey: template.data?.campaignKey ?? "we-are-back", ...body }),
    onSuccess: (res, vars) => {
      qc.invalidateQueries({ queryKey: ["admin-marketing-users"] });
      qc.invalidateQueries({ queryKey: ["admin-marketing-sends"] });
      qc.invalidateQueries({ queryKey: ["admin-email-events"] });
      if (res.status === "sent") toast.success(vars.test ? "Test email sent" : "Campaign email sent");
      else toast.warning(`Email ${res.status}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const totalPages = sends.data ? Math.max(1, Math.ceil(sends.data.total / sends.data.perPage)) : 1;
  const engagement = (count: number, at?: string | null) => (
    <span style={{ color: count ? "var(--gb-green)" : "var(--gb-gray)", fontSize: 11, whiteSpace: "nowrap" }}>
      {count ? `${count}x ${at ? relativeTime(at) : ""}` : "-"}
    </span>
  );

  return (
    <div className="gb-admin-marketing-grid" style={{ display: "grid", gridTemplateColumns: "minmax(320px, 520px) 1fr", gap: 18, alignItems: "start" }}>
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ border: "1px solid var(--gb-bg2)", padding: 12 }}>
          <div style={{ color: "var(--gb-yellow)", fontWeight: 700, marginBottom: 6 }}>$ marketing --we-are-back</div>
          <div style={{ color: "var(--gb-gray)", fontSize: 12, lineHeight: 1.7 }}>
            Single-user campaign sender. Re-sending is allowed, but previous sends are shown before sending.
          </div>
        </div>

        <div>
          <label style={{ fontSize: 10, color: "var(--gb-gray)", display: "block", marginBottom: 4, letterSpacing: ".08em" }}>SEARCH USER</label>
          <input className="gb-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="username, name, email..." style={{ width: "100%" }} />
        </div>

        <div>
          <label style={{ fontSize: 10, color: "var(--gb-gray)", display: "block", marginBottom: 4, letterSpacing: ".08em" }}>RECIPIENT</label>
          <select
            className="gb-input"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : "")}
            style={{ width: "100%" }}
          >
            <option value="">select user...</option>
            {(users.data?.users ?? []).map((u: any) => (
              <option key={u.id} value={u.id}>
                @{u.username} — {u.email}{u.sendCount ? ` — sent ${u.sendCount}x` : ""}
              </option>
            ))}
          </select>
        </div>

        {selectedUser && (
          <div style={{ border: "1px solid var(--gb-bg2)", padding: 10, fontSize: 12 }}>
            <div style={{ color: "var(--gb-fg)" }}>{selectedUser.displayName} <span style={{ color: "var(--gb-gray)" }}>@{selectedUser.username}</span></div>
            <div style={{ color: selectedUser.emailSuppressedAt ? "var(--gb-red)" : "var(--gb-gray)" }}>{selectedUser.email}</div>
            {selectedUser.lastSentAt && (
              <div style={{ color: "var(--gb-yellow)", marginTop: 5 }}>
                previously sent {relativeTime(selectedUser.lastSentAt)}; sending again is allowed
              </div>
            )}
            {selectedUser.emailSuppressedAt && (
              <div style={{ color: "var(--gb-red)", marginTop: 5 }}>email is suppressed; send will be skipped</div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="gb-btn" disabled={send.isPending} onClick={() => send.mutate({ test: true })}>$ send test to me</button>
          <button
            className="gb-btn gb-btn-primary"
            disabled={!selectedUser || send.isPending}
            onClick={() => selectedUser && send.mutate({ userId: selectedUser.id })}
          >
            $ send selected
          </button>
        </div>

        <table className="gb-table">
          <thead>
            <tr>
              <th style={{ textAlign: "right", paddingRight: 16 }}>#</th>
              <th>USER</th>
              <th>STATUS</th>
              <th>OPENED</th>
              <th>CLICKED</th>
              <th className="gb-col-modified" style={{ textAlign: "right", paddingRight: 12 }}>WHEN</th>
            </tr>
          </thead>
          <tbody>
            {(sends.data?.sends ?? []).map((row: any, i: number) => (
              <tr key={row.id}>
                <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>{i + 1 + (page - 1) * (sends.data?.perPage ?? 30)}</td>
                <td>
                  <div style={{ color: "var(--gb-fg)", fontSize: 12 }}>{row.displayName || row.email}</div>
                  <div style={{ color: "var(--gb-gray)", fontSize: 11 }}>@{row.username || "deleted"} / by {row.sentByUsername || "admin"}</div>
                </td>
                <td style={{ color: row.status === "sent" ? "var(--gb-green)" : "var(--gb-red)", fontSize: 12 }}>{row.status}</td>
                <td>{engagement(row.openCount ?? 0, row.lastOpenedAt ?? row.openedAt)}</td>
                <td>{engagement(row.clickCount ?? 0, row.lastClickedAt ?? row.clickedAt)}</td>
                <td className="gb-col-modified" style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 12, fontSize: 11 }}>{relativeTime(row.createdAt)}</td>
              </tr>
            ))}
            {!sends.isLoading && !(sends.data?.sends ?? []).length && (
              <tr><td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16 }}>~</td><td colSpan={5} style={{ color: "var(--gb-gray)" }}>no marketing sends yet</td></tr>
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
      </section>

      <section style={{ minWidth: 0 }}>
        <div style={{ color: "var(--gb-gray)", fontSize: 10, letterSpacing: ".08em", marginBottom: 6 }}>TEMPLATE PREVIEW</div>
        <div style={{ border: "1px solid var(--gb-bg2)", background: "var(--gb-bg1)", padding: 10, marginBottom: 8 }}>
          <div style={{ color: "var(--gb-yellow)", fontSize: 13 }}>{template.data?.subject ?? "$ loading..."}</div>
        </div>
        <div
          style={{ border: "1px solid var(--gb-bg2)", maxHeight: 640, overflow: "auto", background: "#282828" }}
          dangerouslySetInnerHTML={{ __html: template.data?.html ?? "" }}
        />
      </section>
    </div>
  );
}
