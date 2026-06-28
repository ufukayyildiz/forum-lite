import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type AdminErrorEvent } from "../../lib/api";
import { PaginationControls } from "../../components/PaginationControls";

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function short(value: string | null | undefined, max = 120) {
  if (!value) return "-";
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function prettyJson(value: string | null) {
  if (!value) return "";
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

const TYPE_COLOR: Record<string, string> = {
  register: "var(--gb-green)",
  login: "var(--gb-aqua)",
  thread: "var(--gb-yellow)",
  post: "var(--gb-blue)",
  like: "var(--gb-purple)",
  ban: "var(--gb-red)",
  role: "var(--gb-orange)",
  settings: "var(--gb-fg4)",
  email_bounce: "var(--gb-red)",
  error: "var(--gb-red)",
};

const LEVEL_COLOR: Record<string, string> = {
  error: "var(--gb-red)",
  warn: "var(--gb-orange)",
  info: "var(--gb-blue)",
};

function Pagination({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return <PaginationControls page={page} totalPages={totalPages} onPage={onPage} />;
}

function ErrorDetail({ event }: { event: AdminErrorEvent }) {
  const metadata = prettyJson(event.metadata);
  return (
    <div
      style={{
        border: "1px solid var(--gb-bg3)",
        background: "var(--gb-bg0)",
        padding: 12,
        display: "grid",
        gap: 10,
        fontSize: 12,
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
        <div><span style={{ color: "var(--gb-gray)" }}>request</span><br />{event.requestId ?? "-"}</div>
        <div><span style={{ color: "var(--gb-gray)" }}>user</span><br />{event.username ? `${event.username} #${event.userId ?? "-"}` : "-"}</div>
        <div><span style={{ color: "var(--gb-gray)" }}>client</span><br />{[event.ip, event.country, event.colo].filter(Boolean).join(" / ") || "-"}</div>
        <div><span style={{ color: "var(--gb-gray)" }}>when</span><br />{event.createdAt} ({relTime(event.createdAt)})</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8 }}>
        <span style={{ color: "var(--gb-gray)" }}>url</span>
        <span style={{ overflowWrap: "anywhere" }}>{event.url ?? event.path ?? "-"}</span>
        <span style={{ color: "var(--gb-gray)" }}>referrer</span>
        <span style={{ overflowWrap: "anywhere" }}>{event.referrer ?? "-"}</span>
        <span style={{ color: "var(--gb-gray)" }}>user-agent</span>
        <span style={{ overflowWrap: "anywhere" }}>{event.userAgent ?? "-"}</span>
      </div>
      {metadata && (
        <pre style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "var(--gb-fg3)", borderTop: "1px solid var(--gb-bg2)", paddingTop: 10 }}>
          {metadata}
        </pre>
      )}
      {event.stack && (
        <pre style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "var(--gb-red)", borderTop: "1px solid var(--gb-bg2)", paddingTop: 10 }}>
          {event.stack}
        </pre>
      )}
    </div>
  );
}

export default function AdminLogs() {
  const [tab, setTab] = useState<"errors" | "activity">("errors");
  const [errorPage, setErrorPage] = useState(1);
  const [activityPage, setActivityPage] = useState(1);
  const [level, setLevel] = useState("");
  const [source, setSource] = useState("");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [clearing, setClearing] = useState<"errors" | "activity" | null>(null);
  const [clearMessage, setClearMessage] = useState("");

  const errorParams = useMemo(() => ({ page: errorPage, level, source, q, perPage: 50 }), [errorPage, level, source, q]);
  const errors = useQuery({
    queryKey: ["admin-error-events", errorParams],
    queryFn: () => api.adminErrorEvents(errorParams),
    refetchInterval: 15000,
    enabled: tab === "errors",
  });

  const activity = useQuery({
    queryKey: ["admin-logs", activityPage],
    queryFn: () => api.adminLogs({ page: activityPage, perPage: 50 }),
    refetchInterval: 15000,
    enabled: tab === "activity",
  });

  const errorEvents = errors.data?.events ?? [];
  const selectedEvent = errorEvents.find((event) => event.id === selectedId) ?? null;
  const errorTotalPages = errors.data ? Math.ceil(errors.data.total / errors.data.perPage) : 1;
  const activityTotalPages = activity.data ? Math.ceil(activity.data.total / activity.data.perPage) : 1;

  const setFilter = (setter: (value: string) => void, value: string) => {
    setter(value);
    setErrorPage(1);
    setSelectedId(null);
  };

  const clearErrors = async () => {
    if (!window.confirm("Delete all error logs?")) return;
    setClearing("errors");
    setClearMessage("");
    try {
      const result = await api.adminClearErrorEvents();
      setSelectedId(null);
      setErrorPage(1);
      await errors.refetch();
      setClearMessage(`deleted ${result.deleted} error events`);
    } finally {
      setClearing(null);
    }
  };

  const clearActivity = async () => {
    if (!window.confirm("Delete all activity logs?")) return;
    setClearing("activity");
    setClearMessage("");
    try {
      const result = await api.adminClearLogs();
      setActivityPage(1);
      await activity.refetch();
      setClearMessage(`deleted ${result.deleted} activity log entries`);
    } finally {
      setClearing(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button className={`gb-btn${tab === "errors" ? " gb-btn-primary" : ""}`} onClick={() => setTab("errors")}>errors</button>
          <button className={`gb-btn${tab === "activity" ? " gb-btn-primary" : ""}`} onClick={() => setTab("activity")}>activity</button>
        </div>
        {tab === "errors" ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input className="gb-input" value={q} onChange={(event) => setFilter(setQ, event.target.value)} placeholder="message, path, user, metadata..." style={{ width: 300 }} />
            <select className="gb-input" value={level} onChange={(event) => setFilter(setLevel, event.target.value)} style={{ width: 120 }}>
              <option value="">all levels</option>
              <option value="error">error</option>
              <option value="warn">warn</option>
              <option value="info">info</option>
            </select>
            <select className="gb-input" value={source} onChange={(event) => setFilter(setSource, event.target.value)} style={{ width: 130 }}>
              <option value="">all sources</option>
              <option value="worker">worker</option>
              <option value="api">api</option>
              <option value="client">client</option>
              <option value="react">react</option>
            </select>
            <a className="gb-btn" href={api.adminErrorEventsExportUrl({ level, source, q, format: "csv" })} download>$ csv</a>
            <a className="gb-btn" href={api.adminErrorEventsExportUrl({ level, source, q, format: "json" })} download>$ json</a>
            <button type="button" className="gb-btn" onClick={clearErrors} disabled={clearing !== null}>
              {clearing === "errors" ? "$ clearing..." : "$ clear errors"}
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <a className="gb-btn" href={api.adminLogsExportUrl({ format: "csv" })} download>$ csv</a>
            <a className="gb-btn" href={api.adminLogsExportUrl({ format: "json" })} download>$ json</a>
            <button type="button" className="gb-btn" onClick={clearActivity} disabled={clearing !== null}>
              {clearing === "activity" ? "$ clearing..." : "$ clear activity"}
            </button>
          </div>
        )}
      </div>

      {clearMessage && (
        <div style={{ fontSize: 11, color: "var(--gb-green)", letterSpacing: ".06em" }}>
          " {clearMessage}
        </div>
      )}

      {tab === "errors" ? (
        <>
          <div style={{ fontSize: 11, color: "var(--gb-gray)", letterSpacing: ".06em" }}>
            " {errors.data?.total ?? 0} error events — auto-refresh 15s
          </div>
          <table className="gb-table">
            <thead>
              <tr>
                <th style={{ textAlign: "right", paddingRight: 16 }}>#</th>
                <th>LEVEL</th>
                <th>SOURCE</th>
                <th>KIND</th>
                <th>STATUS</th>
                <th>PATH</th>
                <th>MESSAGE</th>
                <th className="gb-col-modified" style={{ textAlign: "right", paddingRight: 12 }}>WHEN</th>
              </tr>
            </thead>
            <tbody>
              {errors.isLoading ? (
                <tr><td style={{ textAlign: "right", paddingRight: 16 }}>~</td><td colSpan={7} style={{ color: "var(--gb-gray)" }}>$ loading...</td></tr>
              ) : errorEvents.length === 0 ? (
                <tr><td style={{ textAlign: "right", paddingRight: 16 }}>~</td><td colSpan={7} style={{ color: "var(--gb-gray)" }}>no error events yet</td></tr>
              ) : errorEvents.map((event, i) => (
                <tr key={event.id} className={selectedId === event.id ? "selected" : ""} onClick={() => setSelectedId((id) => id === event.id ? null : event.id)} style={{ cursor: "pointer" }}>
                  <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>
                    {i + 1 + (errorPage - 1) * (errors.data?.perPage ?? 50)}
                  </td>
                  <td style={{ color: LEVEL_COLOR[event.level] ?? "var(--gb-fg4)", fontWeight: 700 }}>{event.level}</td>
                  <td>{event.source}</td>
                  <td>{short(event.kind, 42)}</td>
                  <td style={{ color: event.status && event.status >= 500 ? "var(--gb-red)" : "var(--gb-gray)" }}>{event.status ?? "-"}</td>
                  <td style={{ overflowWrap: "anywhere" }}>{short(event.path, 64)}</td>
                  <td style={{ overflowWrap: "anywhere" }}>{short(event.message, 160)}</td>
                  <td className="gb-col-modified" style={{ textAlign: "right", paddingRight: 12, fontSize: 11, color: "var(--gb-gray)", whiteSpace: "nowrap" }}>
                    {relTime(event.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {selectedEvent && <ErrorDetail event={selectedEvent} />}
          <Pagination page={errorPage} totalPages={errorTotalPages} onPage={setErrorPage} />
        </>
      ) : (
        <>
          <div style={{ fontSize: 11, color: "var(--gb-gray)", letterSpacing: ".06em" }}>
            " {activity.data?.total ?? 0} activity log entries — auto-refresh 15s
          </div>
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
              {activity.isLoading ? (
                <tr>
                  <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16 }}>~</td>
                  <td colSpan={3} style={{ color: "var(--gb-gray)" }}>$ loading...</td>
                </tr>
              ) : (activity.data?.logs ?? []).length === 0 ? (
                <tr>
                  <td style={{ color: "var(--gb-bg3)", textAlign: "right", paddingRight: 16 }}>~</td>
                  <td colSpan={3} style={{ color: "var(--gb-gray)" }}>no logs yet</td>
                </tr>
              ) : (activity.data?.logs ?? []).map((log, i) => (
                <tr key={log.id}>
                  <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>
                    {i + 1 + (activityPage - 1) * (activity.data?.perPage ?? 50)}
                  </td>
                  <td style={{ paddingRight: 14 }}>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: ".06em",
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
          <Pagination page={activityPage} totalPages={activityTotalPages} onPage={setActivityPage} />
        </>
      )}
    </div>
  );
}
