import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { DAvatar } from "../../components/DAvatar";
import { useMe } from "../../lib/useAuth";
import { relativeTime } from "../../lib/utils";
import { toast } from "sonner";

const roles = ["admin", "moderator", "member"] as const;

type EditState = { displayName: string; email: string; bio: string; avatarUrl: string };

function EditRow({ user, onSave, onCancel }: {
  user: any;
  onSave: (data: EditState) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<EditState>({
    displayName: user.displayName ?? "",
    email: user.email ?? "",
    bio: user.bio ?? "",
    avatarUrl: user.avatarUrl ?? "",
  });
  const set = (k: keyof EditState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <tr style={{ background: "var(--gb-bg1)" }}>
      <td />
      <td colSpan={5} style={{ padding: "10px 12px" }}>
        <div className="gb-admin-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, maxWidth: 560 }}>
          <div>
            <label style={{ fontSize: 10, color: "var(--gb-gray)", display: "block", marginBottom: 3, letterSpacing: ".06em" }}>DISPLAY NAME</label>
            <input className="gb-input" value={form.displayName} onChange={set("displayName")} style={{ width: "100%" }} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: "var(--gb-gray)", display: "block", marginBottom: 3, letterSpacing: ".06em" }}>EMAIL</label>
            <input className="gb-input" value={form.email} onChange={set("email")} style={{ width: "100%" }} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: "var(--gb-gray)", display: "block", marginBottom: 3, letterSpacing: ".06em" }}>AVATAR URL</label>
            <input className="gb-input" value={form.avatarUrl} onChange={set("avatarUrl")} style={{ width: "100%" }} />
          </div>
          <div>
            <label style={{ fontSize: 10, color: "var(--gb-gray)", display: "block", marginBottom: 3, letterSpacing: ".06em" }}>BIO</label>
            <input className="gb-input" value={form.bio} onChange={set("bio")} style={{ width: "100%" }} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button className="gb-btn gb-btn-primary" style={{ fontSize: 11, padding: "3px 14px" }} onClick={() => onSave(form)}>$ save</button>
          <button className="gb-btn" style={{ fontSize: 11, padding: "3px 10px" }} onClick={onCancel}>cancel</button>
        </div>
      </td>
    </tr>
  );
}

export default function AdminUsers() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [editId, setEditId] = useState<number | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["admin-users", page], queryFn: () => api.adminUsers(page) });

  const setRole = useMutation({
    mutationFn: ({ id, role }: { id: number; role: string }) => api.adminSetRole(id, role),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-users"] }); toast.success("Role updated"); },
    onError: (e: any) => toast.error(e.message),
  });
  const ban = useMutation({
    mutationFn: (id: number) => api.adminBanUser(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-users"] }); toast.success("Updated"); },
    onError: (e: any) => toast.error(e.message),
  });
  const edit = useMutation({
    mutationFn: ({ id, data }: { id: number; data: EditState }) => api.adminEditUser(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      setEditId(null);
      toast.success("User updated");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const totalPages = data ? Math.ceil(data.total / 25) : 1;
  const list = data?.users ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {data && (
        <div style={{ fontSize: 11, color: "var(--gb-gray)", letterSpacing: ".06em" }}>
          " {data.total} total users
        </div>
      )}

      <table className="gb-table">
        <thead>
          <tr>
            <th style={{ textAlign: "right", paddingRight: 16 }}>#</th>
            <th style={{ width: 36 }} />
            <th>NAME</th>
            <th style={{ textAlign: "right", paddingRight: 16 }}>POSTS</th>
            <th style={{ paddingRight: 16 }}>ROLE</th>
            <th>ACTIONS</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16 }}>~</td>
              <td colSpan={5} style={{ color: "var(--gb-gray)" }}>$ loading...</td>
            </tr>
          ) : list.map((u, i) => (
            <React.Fragment key={u.id}>
              <tr style={editId === u.id ? { background: "var(--gb-bg1)" } : undefined}>
                <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>
                  {i + 1 + (page - 1) * 25}
                </td>
                <td style={{ width: 36, paddingRight: 8 }}>
                  <DAvatar src={u.avatarUrl} name={u.displayName} size={24} />
                </td>
                <td>
                  <div style={{ fontSize: 13, color: "var(--gb-fg)", fontWeight: 500 }}>
                    {u.displayName}
                    {u.banned && <span style={{ fontSize: 11, color: "var(--gb-red)", marginLeft: 8 }}>[banned]</span>}
                    {!u.emailVerifiedAt && <span style={{ fontSize: 11, color: "var(--gb-yellow)", marginLeft: 8 }}>[unverified]</span>}
                    {u.emailSuppressedAt && <span style={{ fontSize: 11, color: "var(--gb-red)", marginLeft: 8 }}>[email bounced]</span>}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--gb-gray)" }}>@{u.username} &bull; {u.email} &bull; {relativeTime(u.createdAt)}</div>
                  {u.emailSuppressionReason && (
                    <div style={{ fontSize: 11, color: "var(--gb-red)" }}>mail: {u.emailSuppressionReason}</div>
                  )}
                </td>
                <td style={{ textAlign: "right", paddingRight: 16, color: "var(--gb-aqua)", fontSize: 13 }}>{u.postCount}</td>
                <td style={{ paddingRight: 14 }}>
                  {me?.role === "admin" && me.id !== u.id ? (
                    <select
                      value={u.role}
                      onChange={(e) => setRole.mutate({ id: u.id, role: e.target.value })}
                      style={{
                        background: "var(--gb-bg)", border: "1px solid var(--gb-bg3)",
                        color: "var(--gb-fg)", fontFamily: "inherit", fontSize: 12,
                        padding: "2px 6px", cursor: "pointer",
                      }}
                    >
                      {roles.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  ) : (
                    <span style={{ fontSize: 12, color: "var(--gb-gray)" }}>{u.role}</span>
                  )}
                </td>
                <td>
                  {me?.role === "admin" && me.id !== u.id && (
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <button
                        className="gb-btn"
                        style={{ fontSize: 11, padding: "2px 10px", color: editId === u.id ? "var(--gb-yellow)" : undefined }}
                        onClick={() => setEditId(editId === u.id ? null : u.id)}
                      >
                        {editId === u.id ? "close" : "edit"}
                      </button>
                      <button
                        className="gb-btn gb-btn-danger"
                        style={{ fontSize: 11, padding: "2px 10px" }}
                        onClick={() => ban.mutate(u.id)}
                        disabled={ban.isPending}
                      >
                        {u.banned ? "unban" : "ban"}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
              {editId === u.id && (
                <EditRow
                  user={u}
                  onSave={(data) => edit.mutate({ id: u.id, data })}
                  onCancel={() => setEditId(null)}
                />
              )}
            </React.Fragment>
          ))}
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
