import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../../lib/api";
import { relativeTime } from "../../lib/utils";
import { GbSelect, type GbSelectOption } from "../../components/GbSelect";

const MAX_BULK_RECIPIENTS = 20;

type MarketingUser = {
  id: number;
  username: string;
  displayName: string;
  email: string;
  marketingStatus: "subscribed" | "unsubscribed" | "suppressed";
  canReceiveMarketing: boolean;
  marketingUnsubscribed: boolean;
  emailSuppressedAt?: string | null;
  suppressionReason?: string | null;
  sendCount: number;
  lastSentAt?: string | null;
};

export default function AdminMarketing() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<number | "">("");
  const [checkedIds, setCheckedIds] = useState<number[]>([]);
  const [page, setPage] = useState(1);
  const [previewOpen, setPreviewOpen] = useState(false);

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
  const audience = users.data?.users ?? [];
  const audienceCounts = useMemo(() => ({
    subscribed: audience.filter((u: any) => u.marketingStatus === "subscribed").length,
    unsubscribed: audience.filter((u: any) => u.marketingStatus === "unsubscribed").length,
    suppressed: audience.filter((u: any) => u.marketingStatus === "suppressed").length,
  }), [audience]);
  const checkedUsers = useMemo(
    () => checkedIds
      .map((id) => audience.find((u: MarketingUser) => u.id === id))
      .filter(Boolean) as MarketingUser[],
    [audience, checkedIds],
  );
  const eligibleAudience = useMemo(
    () => audience.filter((u: MarketingUser) => u.canReceiveMarketing),
    [audience],
  );
  const recipientUsers = useMemo(() => {
    const group = (user: MarketingUser) => {
      if (!user.canReceiveMarketing) return 2;
      if (user.sendCount || user.lastSentAt) return 1;
      return 0;
    };
    return [...audience].sort((a: MarketingUser, b: MarketingUser) => {
      const byGroup = group(a) - group(b);
      if (byGroup) return byGroup;
      return (a.displayName || a.username).localeCompare(b.displayName || b.username);
    });
  }, [audience]);
  const recipientOptions: GbSelectOption[] = useMemo(() => recipientUsers.map((u: MarketingUser) => ({
    value: u.id,
    label: `@${u.username} - ${u.email} - ${u.marketingStatus}${u.sendCount ? ` - sent ${u.sendCount}x` : ""}`,
    description: `${u.displayName} @${u.username} / ${u.email}`,
    meta: u.sendCount ? `sent ${u.sendCount}x${u.lastSentAt ? ` ${relativeTime(u.lastSentAt)}` : ""}` : u.marketingStatus,
    disabled: !u.canReceiveMarketing,
    tone: !u.canReceiveMarketing ? "red" : u.sendCount ? "yellow" : "green",
  })), [recipientUsers]);

  const send = useMutation({
    mutationFn: (body: { test?: boolean; userId?: number; userIds?: number[] }) =>
      api.adminSendMarketing({ campaignKey: template.data?.campaignKey ?? "we-are-back", ...body }),
    onSuccess: (res, vars) => {
      qc.invalidateQueries({ queryKey: ["admin-marketing-users"] });
      qc.invalidateQueries({ queryKey: ["admin-marketing-sends"] });
      qc.invalidateQueries({ queryKey: ["admin-email-events"] });
      if (vars.userIds?.length) {
        toast.success(`Bulk sent: ${res.sent ?? 0}/${res.total ?? vars.userIds.length}`);
        setCheckedIds([]);
      } else if (res.status === "sent") toast.success(vars.test ? "Test email sent" : "Campaign email sent");
      else toast.warning(`Email ${res.status}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  function toggleChecked(user: MarketingUser) {
    if (!user.canReceiveMarketing) return;
    setCheckedIds((current) => {
      if (current.includes(user.id)) return current.filter((id) => id !== user.id);
      if (current.length >= MAX_BULK_RECIPIENTS) {
        toast.error(`Max ${MAX_BULK_RECIPIENTS} users`);
        return current;
      }
      return [...current, user.id];
    });
  }

  function toggleFirstVisible() {
    setCheckedIds((current) => {
      const visibleIds = eligibleAudience.map((u: MarketingUser) => u.id);
      const allVisibleSelected = visibleIds.length > 0 && visibleIds.slice(0, MAX_BULK_RECIPIENTS).every((id) => current.includes(id));
      if (allVisibleSelected) return current.filter((id) => !visibleIds.includes(id));
      const next = [...current];
      for (const id of visibleIds) {
        if (next.length >= MAX_BULK_RECIPIENTS) break;
        if (!next.includes(id)) next.push(id);
      }
      if (visibleIds.length > MAX_BULK_RECIPIENTS || next.length >= MAX_BULK_RECIPIENTS) toast.message(`Selected first ${MAX_BULK_RECIPIENTS} eligible users`);
      return next;
    });
  }

  const totalPages = sends.data ? Math.max(1, Math.ceil(sends.data.total / sends.data.perPage)) : 1;
  const engagement = (count: number, at?: string | null) => (
    <span style={{ color: count ? "var(--gb-green)" : "var(--gb-gray)", fontSize: 11, whiteSpace: "nowrap" }}>
      {count ? `${count}x ${at ? relativeTime(at) : ""}` : "-"}
    </span>
  );
  const statusColor = (status?: string) => {
    if (status === "subscribed") return "var(--gb-green)";
    if (status === "unsubscribed") return "var(--gb-yellow)";
    return "var(--gb-red)";
  };

  return (
    <div className="gb-admin-marketing-page">
      <section className="gb-admin-marketing-panel">
        <div className="gb-admin-marketing-head">
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "var(--gb-yellow)", fontWeight: 700, marginBottom: 6 }}>$ marketing --we-are-back</div>
            <div style={{ color: "var(--gb-gray)", fontSize: 12, lineHeight: 1.7 }}>
              Single-user campaign sender. Re-sending is allowed, but previous sends are shown before sending.
            </div>
          </div>
          <div className="gb-admin-marketing-actions">
            <button className="gb-btn" type="button" onClick={() => setPreviewOpen(true)}>$ preview template</button>
            <button className="gb-btn" disabled={send.isPending} onClick={() => send.mutate({ test: true })}>$ send test to me</button>
            <button
              className="gb-btn gb-btn-primary"
              disabled={!checkedIds.length || send.isPending}
              onClick={() => checkedIds.length && send.mutate({ userIds: checkedIds })}
            >
              $ send checked ({checkedIds.length})
            </button>
            <button
              className="gb-btn gb-btn-primary"
              disabled={!selectedUser || !selectedUser.canReceiveMarketing || send.isPending}
              onClick={() => selectedUser && send.mutate({ userId: selectedUser.id })}
            >
              $ send selected
            </button>
          </div>
        </div>

        <div className="gb-admin-marketing-controls">
          <div>
            <label style={{ fontSize: 10, color: "var(--gb-gray)", display: "block", marginBottom: 4, letterSpacing: ".08em" }}>SEARCH USER</label>
            <input className="gb-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="username, name, email..." style={{ width: "100%" }} />
          </div>

          <div>
            <label style={{ fontSize: 10, color: "var(--gb-gray)", display: "block", marginBottom: 4, letterSpacing: ".08em" }}>RECIPIENT</label>
            <GbSelect
              value={selectedId}
              options={recipientOptions}
              placeholder={users.isLoading ? "$ loading users..." : "select user..."}
              onChange={(value) => setSelectedId(Number(value))}
              renderOption={(option) => (
                <>
                  <span className="gb-select-option-label">{option.label}</span>
                  {option.meta && <span className="gb-select-option-meta">{option.meta}</span>}
                  {option.description && <span className="gb-select-option-desc">{option.description}</span>}
                </>
              )}
            />
          </div>
        </div>

        {selectedUser && (
          <div className="gb-admin-marketing-recipient">
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "var(--gb-fg)" }}>{selectedUser.displayName} <span style={{ color: "var(--gb-gray)" }}>@{selectedUser.username}</span></div>
              <div style={{ color: selectedUser.emailSuppressedAt ? "var(--gb-red)" : "var(--gb-gray)", overflow: "hidden", textOverflow: "ellipsis" }}>{selectedUser.email}</div>
            </div>
            <div style={{ color: statusColor(selectedUser.marketingStatus), whiteSpace: "nowrap" }}>{selectedUser.marketingStatus}</div>
            {selectedUser.lastSentAt && (
              <div style={{ color: "var(--gb-yellow)", marginTop: 5 }}>
                previously sent {relativeTime(selectedUser.lastSentAt)}; sending again is allowed
              </div>
            )}
            {selectedUser.emailSuppressedAt && (
              <div style={{ color: "var(--gb-red)", marginTop: 5 }}>email is suppressed; send is blocked</div>
            )}
            {selectedUser.marketingUnsubscribed && (
              <div style={{ color: "var(--gb-yellow)", marginTop: 5 }}>user unsubscribed from marketing; send is blocked</div>
            )}
          </div>
        )}
      </section>

      <section className="gb-admin-marketing-section">
        <div style={{ color: "var(--gb-gray)", fontSize: 10, letterSpacing: ".08em", marginBottom: 6 }}>
            MARKETING USERS
            <span style={{ color: "var(--gb-green)", marginLeft: 10 }}>{audienceCounts.subscribed} subscribed</span>
            <span style={{ color: "var(--gb-yellow)", marginLeft: 10 }}>{audienceCounts.unsubscribed} unsubscribed</span>
            <span style={{ color: "var(--gb-red)", marginLeft: 10 }}>{audienceCounts.suppressed} suppressed</span>
            <span style={{ color: checkedIds.length ? "var(--gb-yellow)" : "var(--gb-gray)", marginLeft: 10 }}>
              {checkedIds.length}/{MAX_BULK_RECIPIENTS} checked
            </span>
        </div>
        {checkedUsers.length > 0 && (
          <div style={{ color: "var(--gb-gray)", fontSize: 11, marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            checked: {checkedUsers.map((u) => `@${u.username}`).join(", ")}
          </div>
        )}
        <div className="gb-admin-marketing-tablewrap">
          <table className="gb-table">
            <thead>
              <tr>
                <th style={{ width: 34, textAlign: "center" }}>
                  <button className="gb-check-all" type="button" onClick={toggleFirstVisible} title={`select up to ${MAX_BULK_RECIPIENTS}`}>
                    ✓
                  </button>
                </th>
                <th style={{ textAlign: "right", paddingRight: 16 }}>#</th>
                <th>USER</th>
                <th>EMAIL</th>
                <th>MARKETING</th>
                <th className="gb-col-modified" style={{ textAlign: "right", paddingRight: 12 }}>SENT</th>
              </tr>
            </thead>
            <tbody>
              {audience.map((u: MarketingUser, i: number) => {
                const checked = checkedIds.includes(u.id);
                const disabled = !u.canReceiveMarketing || (!checked && checkedIds.length >= MAX_BULK_RECIPIENTS);
                return (
                <tr key={u.id}>
                  <td style={{ textAlign: "center" }}>
                    <label className={`gb-check${disabled ? " is-disabled" : ""}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleChecked(u)}
                      />
                      <span />
                    </label>
                  </td>
                  <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>{i + 1}</td>
                  <td>
                    <div style={{ color: "var(--gb-fg)", fontSize: 12 }}>{u.displayName}</div>
                    <div style={{ color: "var(--gb-gray)", fontSize: 11 }}>@{u.username}</div>
                  </td>
                  <td style={{ color: u.canReceiveMarketing ? "var(--gb-gray)" : "var(--gb-red)", fontSize: 11 }}>{u.email}</td>
                  <td>
                    <div style={{ color: statusColor(u.marketingStatus), fontSize: 12 }}>{u.marketingStatus}</div>
                    {u.suppressionReason && <div style={{ color: "var(--gb-gray)", fontSize: 10 }}>{u.suppressionReason}</div>}
                  </td>
                  <td className="gb-col-modified" style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 12, fontSize: 11 }}>
                    {u.sendCount ? `${u.sendCount}x${u.lastSentAt ? ` ${relativeTime(u.lastSentAt)}` : ""}` : "-"}
                  </td>
                </tr>
                );
              })}
              {!users.isLoading && !audience.length && (
                <tr><td style={{ color: "var(--gb-gray)", textAlign: "center" }}>~</td><td colSpan={5} style={{ color: "var(--gb-gray)" }}>no users found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="gb-admin-marketing-section">
        <div style={{ color: "var(--gb-gray)", fontSize: 10, letterSpacing: ".08em", marginTop: 4 }}>SEND LOG</div>
        <div className="gb-admin-marketing-tablewrap gb-admin-marketing-logwrap">
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
        </div>

        {totalPages > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 8, borderTop: "1px solid var(--gb-bg2)" }}>
            <button className="gb-btn" style={{ padding: "2px 10px" }} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>prev</button>
            <span style={{ color: "var(--gb-gray)", fontSize: 12 }}>{page} / {totalPages}</span>
            <button className="gb-btn" style={{ padding: "2px 10px" }} disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>next</button>
          </div>
        )}
      </section>

      {previewOpen && (
        <div className="gb-preview-overlay" role="presentation" onClick={(event) => event.target === event.currentTarget && setPreviewOpen(false)}>
          <section className="gb-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="marketing-preview-title">
            <div className="gb-preview-titlebar">
              <div id="marketing-preview-title" className="gb-preview-title">template preview</div>
              <button className="gb-btn" type="button" onClick={() => setPreviewOpen(false)}>$ close</button>
            </div>
            <div className="gb-preview-subject">{template.data?.subject ?? "$ loading..."}</div>
            <div className="gb-preview-body" dangerouslySetInnerHTML={{ __html: template.data?.html ?? "" }} />
          </section>
        </div>
      )}
    </div>
  );
}
