import { memo, useCallback, useEffect, useMemo, useState, type UIEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../../lib/api";
import { relativeTime } from "../../lib/utils";
import { GbSelect, type GbSelectOption } from "../../components/GbSelect";

const MAX_BULK_RECIPIENTS = 20;
const DUPLICATE_SETTING_KEY = "marketing_block_duplicate_sends";

type BulkResult = {
  userId?: number;
  username?: string;
  email?: string;
  status: string;
  previousSentAt?: string | null;
  error?: string;
};

type BulkSendLog = {
  open: boolean;
  phase: "sending" | "done" | "error";
  recipients: MarketingUser[];
  results: BulkResult[];
  message?: string;
};

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

function marketingStatusColor(status?: string) {
  if (status === "subscribed") return "var(--gb-green)";
  if (status === "unsubscribed") return "var(--gb-yellow)";
  return "var(--gb-red)";
}

function userSortName(user: MarketingUser) {
  return (user.displayName || user.username || user.email || "").toLocaleLowerCase();
}

function sameNumberList(a: number[], b: number[]) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

const MarketingUserRow = memo(function MarketingUserRow({
  user,
  index,
  checked,
  disabled,
  onToggle,
}: {
  user: MarketingUser;
  index: number;
  checked: boolean;
  disabled: boolean;
  onToggle: (user: MarketingUser) => void;
}) {
  return (
    <tr>
      <td style={{ textAlign: "center" }}>
        <label className={`gb-check${disabled ? " is-disabled" : ""}`}>
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={() => onToggle(user)}
            aria-label={`Select ${user.displayName || user.username}`}
          />
          <span />
        </label>
      </td>
      <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>{index + 1}</td>
      <td>
        <div style={{ color: "var(--gb-fg)", fontSize: 12 }}>{user.displayName}</div>
        <div style={{ color: "var(--gb-gray)", fontSize: 11 }}>@{user.username}</div>
      </td>
      <td style={{ color: user.canReceiveMarketing ? "var(--gb-gray)" : "var(--gb-red)", fontSize: 11 }}>{user.email}</td>
      <td>
        <div style={{ color: marketingStatusColor(user.marketingStatus), fontSize: 12 }}>{user.marketingStatus}</div>
        {user.suppressionReason && <div style={{ color: "var(--gb-gray)", fontSize: 10 }}>{user.suppressionReason}</div>}
      </td>
      <td className="gb-col-modified" style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 12, fontSize: 11 }}>
        {user.sendCount ? `${user.sendCount}x${user.lastSentAt ? ` ${relativeTime(user.lastSentAt)}` : ""}` : "-"}
      </td>
    </tr>
  );
});

export default function AdminMarketing() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<number | "">("");
  const [checkedIds, setCheckedIds] = useState<number[]>([]);
  const [visibleUserLimit, setVisibleUserLimit] = useState(180);
  const [page, setPage] = useState(1);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [bulkLog, setBulkLog] = useState<BulkSendLog>({
    open: false,
    phase: "sending",
    recipients: [],
    results: [],
  });

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
  const settings = useQuery({ queryKey: ["admin-settings"], queryFn: api.adminSettings });
  const duplicateBlockEnabled = settings.data?.[DUPLICATE_SETTING_KEY] !== "false";

  const selectedUser = useMemo(
    () => users.data?.users.find((u: any) => u.id === selectedId),
    [users.data?.users, selectedId],
  );
  const audience = useMemo(() => (users.data?.users ?? []) as MarketingUser[], [users.data?.users]);
  const canSelectForBulk = useCallback(
    (user: MarketingUser) => user.canReceiveMarketing && (!duplicateBlockEnabled || !user.sendCount),
    [duplicateBlockEnabled],
  );
  const marketingUsers = useMemo(() => {
    const group = (user: MarketingUser) => {
      if (canSelectForBulk(user)) return 0;
      if (user.sendCount || user.lastSentAt) return 2;
      return 1;
    };
    return [...audience].sort((a, b) => {
      const byGroup = group(a) - group(b);
      if (byGroup) return byGroup;
      if (a.lastSentAt && b.lastSentAt) return new Date(b.lastSentAt).getTime() - new Date(a.lastSentAt).getTime();
      return userSortName(a).localeCompare(userSortName(b));
    });
  }, [audience, canSelectForBulk]);
  const selectableIdList = useMemo(
    () => marketingUsers.filter(canSelectForBulk).map((user) => user.id),
    [marketingUsers, canSelectForBulk],
  );
  const selectableIds = useMemo(() => new Set(selectableIdList), [selectableIdList]);
  const activeCheckedIds = useMemo(
    () => checkedIds.filter((id) => selectableIds.has(id)),
    [checkedIds, selectableIds],
  );
  useEffect(() => {
    setCheckedIds((current) => {
      const next = current.filter((id) => selectableIds.has(id)).slice(0, MAX_BULK_RECIPIENTS);
      return sameNumberList(current, next) ? current : next;
    });
  }, [selectableIds]);
  const audienceCounts = useMemo(() => ({
    subscribed: users.data?.summary?.subscribed ?? audience.filter((u: any) => u.marketingStatus === "subscribed").length,
    unsubscribed: users.data?.summary?.unsubscribed ?? audience.filter((u: any) => u.marketingStatus === "unsubscribed").length,
    suppressed: users.data?.summary?.suppressed ?? audience.filter((u: any) => u.marketingStatus === "suppressed").length,
  }), [audience, users.data?.summary]);
  const audienceById = useMemo(
    () => new Map(audience.map((user) => [user.id, user])),
    [audience],
  );
  const checkedUsers = useMemo(
    () => activeCheckedIds
      .map((id) => audienceById.get(id))
      .filter(Boolean) as MarketingUser[],
    [activeCheckedIds, audienceById],
  );
  const checkedSet = useMemo(() => new Set(activeCheckedIds), [activeCheckedIds]);
  const eligibleAudience = useMemo(
    () => marketingUsers.filter(canSelectForBulk),
    [marketingUsers, canSelectForBulk],
  );
  const visibleMarketingUsers = useMemo(
    () => marketingUsers.slice(0, visibleUserLimit),
    [marketingUsers, visibleUserLimit],
  );
  useEffect(() => {
    setVisibleUserLimit(180);
  }, [q, users.data?.total, duplicateBlockEnabled]);
  const loadMoreMarketingUsers = useCallback((event: UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    if (node.scrollTop + node.clientHeight < node.scrollHeight - 180) return;
    setVisibleUserLimit((current) => Math.min(marketingUsers.length, current + 180));
  }, [marketingUsers.length]);
  const recipientUsers = useMemo(() => {
    const group = (user: MarketingUser) => canSelectForBulk(user) ? 0 : (user.sendCount || user.lastSentAt) ? 2 : 1;
    return [...audience].sort((a: MarketingUser, b: MarketingUser) => {
      const byGroup = group(a) - group(b);
      if (byGroup) return byGroup;
      if (a.lastSentAt && b.lastSentAt) return new Date(b.lastSentAt).getTime() - new Date(a.lastSentAt).getTime();
      return userSortName(a).localeCompare(userSortName(b));
    });
  }, [audience, canSelectForBulk]);
  const recipientOptions: GbSelectOption[] = useMemo(() => recipientUsers.map((u: MarketingUser) => ({
    value: u.id,
    label: `@${u.username} - ${u.email} - ${u.marketingStatus}${u.sendCount ? ` - sent ${u.sendCount}x` : ""}`,
    description: `${u.displayName} @${u.username} / ${u.email}`,
    meta: u.sendCount ? `sent ${u.sendCount}x${u.lastSentAt ? ` ${relativeTime(u.lastSentAt)}` : ""}` : u.marketingStatus,
    disabled: !u.canReceiveMarketing || (duplicateBlockEnabled && Boolean(u.sendCount)),
    tone: !u.canReceiveMarketing ? "red" : duplicateBlockEnabled && u.sendCount ? "red" : u.sendCount ? "yellow" : "green",
  })), [recipientUsers, duplicateBlockEnabled]);

  const saveDuplicateSetting = useMutation({
    mutationFn: (enabled: boolean) => api.adminSaveSettings({ [DUPLICATE_SETTING_KEY]: enabled ? "true" : "false" }),
    onSuccess: (_, enabled) => {
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
      toast.success(enabled ? "Duplicate campaign sends are blocked" : "Duplicate campaign sends are allowed");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const send = useMutation({
    mutationFn: (body: { test?: boolean; userId?: number; userIds?: number[] }) =>
      api.adminSendMarketing({ campaignKey: template.data?.campaignKey ?? "we-are-back", ...body }),
    onSuccess: (res, vars) => {
      qc.invalidateQueries({ queryKey: ["admin-marketing-users"] });
      qc.invalidateQueries({ queryKey: ["admin-marketing-sends"] });
      qc.invalidateQueries({ queryKey: ["admin-email-events"] });
      if (vars.userIds?.length) {
        const userIds = vars.userIds;
        const duplicates = res.duplicate ?? 0;
        const message = `Bulk sent: ${res.sent ?? 0}/${res.total ?? userIds.length}${duplicates ? `, duplicate blocked: ${duplicates}` : ""}`;
        (res.sent ?? 0) ? toast.success(message) : toast.warning(message);
        if (userIds.length > 2) {
          setBulkLog((current) => ({
            ...current,
            open: true,
            phase: "done",
            results: (res.results ?? []) as BulkResult[],
            message: `Done: ${res.sent ?? 0} sent / ${duplicates} duplicate blocked / ${res.total ?? userIds.length} total`,
          }));
        }
        setCheckedIds([]);
      } else if (res.status === "sent") toast.success(vars.test ? "Test email sent" : "Campaign email sent");
      else if (res.status === "duplicate") toast.warning(`Duplicate blocked${res.previousSentAt ? `: already sent ${relativeTime(res.previousSentAt)}` : ""}`);
      else toast.warning(`Email ${res.status}`);
    },
    onError: (e: any) => {
      toast.error(e.message);
      setBulkLog((current) => current.open ? { ...current, phase: "error", message: e.message } : current);
    },
  });

  function sendChecked() {
    if (!activeCheckedIds.length || send.isPending) return;
    const recipients = checkedUsers;
    if (recipients.length > 2) {
      setBulkLog({
        open: true,
        phase: "sending",
        recipients,
        results: recipients.map((user) => ({ userId: user.id, username: user.username, email: user.email, status: "sending" })),
      });
    }
    send.mutate({ userIds: activeCheckedIds });
  }

  const toggleChecked = useCallback((user: MarketingUser) => {
    if (!canSelectForBulk(user)) return;
    setCheckedIds((current) => {
      const currentActive = current.filter((id) => selectableIds.has(id));
      if (currentActive.includes(user.id)) return currentActive.filter((id) => id !== user.id);
      if (currentActive.length >= MAX_BULK_RECIPIENTS) {
        toast.error(`Max ${MAX_BULK_RECIPIENTS} users`);
        return currentActive;
      }
      return [...currentActive, user.id];
    });
  }, [canSelectForBulk, selectableIds]);

  function toggleFirstVisible() {
    setCheckedIds((current) => {
      const currentActive = current.filter((id) => selectableIds.has(id));
      if (currentActive.length) return [];
      const visibleIds = eligibleAudience.map((u: MarketingUser) => u.id);
      const next: number[] = [];
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

  return (
    <div className="gb-admin-marketing-page">
      <section className="gb-admin-marketing-panel">
        <div className="gb-admin-marketing-head">
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "var(--gb-yellow)", fontWeight: 700, marginBottom: 6 }}>$ marketing --we-are-back</div>
            <div style={{ color: "var(--gb-gray)", fontSize: 12, lineHeight: 1.7 }}>
              Single-user campaign sender. Duplicate welcome sends are {duplicateBlockEnabled ? "blocked by default." : "allowed by admin setting."}
            </div>
          </div>
          <div className="gb-admin-marketing-actions">
            <button
              className="gb-btn"
              type="button"
              disabled={settings.isLoading || saveDuplicateSetting.isPending}
              onClick={() => saveDuplicateSetting.mutate(!duplicateBlockEnabled)}
              style={{ color: duplicateBlockEnabled ? "var(--gb-green)" : "var(--gb-yellow)" }}
            >
              $ duplicate block {duplicateBlockEnabled ? "on" : "off"}
            </button>
            <button className="gb-btn" type="button" onClick={() => setPreviewOpen(true)}>$ preview template</button>
            <button className="gb-btn" disabled={send.isPending} onClick={() => send.mutate({ test: true })}>$ send test to me</button>
            <button
              className="gb-btn gb-btn-primary"
              disabled={!activeCheckedIds.length || send.isPending}
              onClick={sendChecked}
            >
              $ send checked ({activeCheckedIds.length})
            </button>
            <button
              className="gb-btn gb-btn-primary"
              disabled={!selectedUser || !selectedUser.canReceiveMarketing || (duplicateBlockEnabled && Boolean(selectedUser.sendCount)) || send.isPending}
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
            <div style={{ color: marketingStatusColor(selectedUser.marketingStatus), whiteSpace: "nowrap" }}>{selectedUser.marketingStatus}</div>
            {selectedUser.lastSentAt && (
              <div style={{ color: "var(--gb-yellow)", marginTop: 5 }}>
                previously sent {relativeTime(selectedUser.lastSentAt)}; {duplicateBlockEnabled ? "duplicate send is blocked" : "sending again is allowed"}
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

      <section className="gb-admin-marketing-section gb-admin-marketing-users-section">
        <div style={{ color: "var(--gb-gray)", fontSize: 10, letterSpacing: ".08em", marginBottom: 6 }}>
            MARKETING USERS
            <span style={{ color: "var(--gb-fg4)", marginLeft: 10 }}>
              {visibleMarketingUsers.length} visible / {audience.length} loaded / {users.data?.total ?? audience.length} total
            </span>
            <span style={{ color: "var(--gb-green)", marginLeft: 10 }}>{audienceCounts.subscribed} subscribed total</span>
            <span style={{ color: "var(--gb-yellow)", marginLeft: 10 }}>{audienceCounts.unsubscribed} unsubscribed total</span>
            <span style={{ color: "var(--gb-red)", marginLeft: 10 }}>{audienceCounts.suppressed} suppressed total</span>
            <span style={{ color: activeCheckedIds.length ? "var(--gb-yellow)" : "var(--gb-gray)", marginLeft: 10 }}>
              {activeCheckedIds.length}/{MAX_BULK_RECIPIENTS} checked
            </span>
        </div>
        <div className={`gb-admin-marketing-checked-summary${checkedUsers.length ? "" : " is-empty"}`}>
          {checkedUsers.length ? `checked: ${checkedUsers.map((u) => `@${u.username}`).join(", ")}` : "checked:"}
        </div>
        <div className="gb-admin-marketing-tablewrap" onScroll={loadMoreMarketingUsers}>
          <table className="gb-table">
            <thead>
              <tr>
                <th style={{ width: 34, textAlign: "center" }}>
                  <button className="gb-check-all" type="button" onClick={toggleFirstVisible} title={`select up to ${MAX_BULK_RECIPIENTS}`}>
                    {activeCheckedIds.length ? "−" : "✓"}
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
              {visibleMarketingUsers.map((u: MarketingUser, i: number) => (
                <MarketingUserRow
                  key={u.id}
                  user={u}
                  index={i}
                  checked={checkedSet.has(u.id)}
                  disabled={!canSelectForBulk(u)}
                  onToggle={toggleChecked}
                />
              ))}
              {!users.isLoading && !audience.length && (
                <tr><td style={{ color: "var(--gb-gray)", textAlign: "center" }}>~</td><td colSpan={5} style={{ color: "var(--gb-gray)" }}>no users found</td></tr>
              )}
              {visibleMarketingUsers.length < marketingUsers.length && (
                <tr>
                  <td style={{ color: "var(--gb-gray)", textAlign: "center" }}>~</td>
                  <td colSpan={5} style={{ color: "var(--gb-gray)" }}>
                    scroll for more users ({marketingUsers.length - visibleMarketingUsers.length} remaining)
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="gb-admin-marketing-section gb-admin-marketing-send-section">
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

      {bulkLog.open && (
        <div className="gb-preview-overlay" role="presentation" onClick={(event) => {
          if (event.target === event.currentTarget && bulkLog.phase !== "sending") setBulkLog((current) => ({ ...current, open: false }));
        }}>
          <section className="gb-preview-dialog gb-send-dialog" role="dialog" aria-modal="true" aria-labelledby="bulk-send-title">
            <div className="gb-preview-titlebar">
              <div id="bulk-send-title" className="gb-preview-title">
                {bulkLog.phase === "sending" ? "$ sending marketing emails" : "$ marketing send log"}
              </div>
              <button
                className="gb-btn"
                type="button"
                disabled={bulkLog.phase === "sending"}
                onClick={() => setBulkLog((current) => ({ ...current, open: false }))}
              >
                $ close
              </button>
            </div>
            <div className="gb-preview-subject">
              {bulkLog.message ?? `${bulkLog.recipients.length} recipients queued`}
            </div>
            <div className="gb-send-log">
              <table className="gb-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: "right", paddingRight: 16 }}>#</th>
                    <th>USER</th>
                    <th>EMAIL</th>
                    <th>STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {(bulkLog.results.length ? bulkLog.results : bulkLog.recipients.map((user): BulkResult => ({
                    userId: user.id,
                    username: user.username,
                    email: user.email,
                    status: "sending",
                  }))).map((row, index) => (
                    <tr key={`${row.userId ?? row.email}-${index}`}>
                      <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>{index + 1}</td>
                      <td style={{ color: "var(--gb-fg)", fontSize: 12 }}>@{row.username ?? "unknown"}</td>
                      <td style={{ color: "var(--gb-gray)", fontSize: 11 }}>{row.email ?? "-"}</td>
                      <td style={{
                        color: row.status === "sent" ? "var(--gb-green)" : row.status === "sending" || row.status === "duplicate" ? "var(--gb-yellow)" : "var(--gb-red)",
                        fontSize: 12,
                      }}>
                        {row.status}
                        {row.error ? ` / ${row.error}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
