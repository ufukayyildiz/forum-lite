import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type AdminAnalyticsResponse } from "../../lib/api";
import { relativeTime } from "../../lib/utils";

function fmt(n: number) {
  return Number(n || 0).toLocaleString("en-US");
}

function pct(value: number, total: number) {
  if (!total) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function duration(ms: number) {
  if (!ms) return "-";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function Metric({ label, value, sub, color = "var(--gb-yellow)" }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="gb-analytics-metric">
      <div className="gb-analytics-label">{label}</div>
      <div className="gb-analytics-value" style={{ color }}>{value}</div>
      {sub && <div className="gb-analytics-sub">{sub}</div>}
    </div>
  );
}

function MiniTable<T extends Record<string, any>>({
  title,
  rows,
  columns,
  max,
}: {
  title: string;
  rows: T[];
  columns: Array<{ key: keyof T | string; label: string; render?: (row: T) => ReactNode; align?: "right" | "left" }>;
  max?: number;
}) {
  const top = rows.slice(0, max ?? rows.length);
  return (
    <section className="gb-analytics-panel">
      <div className="gb-analytics-panel-title">{title}</div>
      <table className="gb-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={String(col.key)} style={{ textAlign: col.align ?? "left" }}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {top.length ? top.map((row, index) => (
            <tr key={`${title}-${index}`}>
              {columns.map((col) => (
                <td key={String(col.key)} style={{ textAlign: col.align ?? "left" }}>
                  {col.render ? col.render(row) : row[col.key as keyof T]}
                </td>
              ))}
            </tr>
          )) : (
            <tr>
              <td colSpan={columns.length} style={{ color: "var(--gb-gray)" }}>no data yet</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function SourceBadge({ source, medium }: { source: string; medium: string }) {
  const color = medium === "organic" ? "var(--gb-green)"
    : medium === "social" ? "var(--gb-purple)"
      : medium === "referral" ? "var(--gb-aqua)"
        : medium === "internal" ? "var(--gb-blue)"
          : "var(--gb-yellow)";
  return <span style={{ color }}>{source}<span style={{ color: "var(--gb-gray)" }}> / {medium}</span></span>;
}

type AnalyticsVisitRow = AdminAnalyticsResponse["online"][number] | AdminAnalyticsResponse["recent"][number];

function shortUrl(url?: string | null) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}${parsed.search}`.slice(0, 140);
  } catch {
    return url.slice(0, 140);
  }
}

function compactParts(parts: Array<[string, string | null | undefined]>) {
  return parts.filter(([, value]) => Boolean(value)).map(([key, value]) => `${key}=${value}`).join(" · ");
}

function SourceDetail({ row }: { row: AnalyticsVisitRow }) {
  const utm = compactParts([
    ["source", row.utmSource],
    ["medium", row.utmMedium],
    ["campaign", row.utmCampaign ?? row.campaign],
    ["term", row.utmTerm],
    ["content", row.utmContent],
  ]);
  const hasEntry = Boolean(row.entrySource && row.entryMedium);
  const entryDiffers = hasEntry && (
    row.entrySource !== row.source ||
    row.entryMedium !== row.medium ||
    row.entryCampaign !== row.campaign ||
    row.entryPath !== row.path
  );
  const showEntry = entryDiffers && (row.source === "internal" || row.medium === "internal" || row.source === "direct" || row.medium === "none");
  const entryUtm = compactParts([
    ["source", row.entryUtmSource],
    ["medium", row.entryUtmMedium],
    ["campaign", row.entryUtmCampaign ?? row.entryCampaign],
    ["term", row.entryUtmTerm],
    ["content", row.entryUtmContent],
  ]);
  return (
    <div className="gb-analytics-source-detail">
      <div><SourceBadge source={row.source} medium={row.medium} /></div>
      {(row.campaign || row.utmCampaign) && <div>campaign: {row.utmCampaign ?? row.campaign}</div>}
      {utm && <div>utm: {utm}</div>}
      {(row.referrerHost || row.referrer) && (
        <div title={row.referrer ?? undefined}>
          ref: {row.referrerHost || "unknown"}{row.referrer ? ` · ${shortUrl(row.referrer)}` : ""}
        </div>
      )}
      {showEntry && (
        <div>
          entry: <SourceBadge source={row.entrySource || "direct"} medium={row.entryMedium || "none"} />
          {row.entryCampaign ? ` · ${row.entryCampaign}` : ""}
          {row.entryPath ? ` · ${row.entryPath}` : ""}
        </div>
      )}
      {showEntry && entryUtm && <div>entry utm: {entryUtm}</div>}
    </div>
  );
}

export default function AdminAnalytics() {
  const [days, setDays] = useState(7);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-analytics", days],
    queryFn: () => api.adminAnalytics(days),
    refetchInterval: 10_000,
  });

  const summary = data?.summary;
  const maxPathViews = useMemo(() => Math.max(1, ...(data?.paths ?? []).map((row) => row.views)), [data?.paths]);
  const activeTotal = summary?.pageviews ?? 0;
  const onlineWindowMinutes = Math.max(1, Math.round((summary?.onlineWindowSeconds ?? 300) / 60));

  return (
    <div className="gb-analytics-page">
      <div className="gb-analytics-head">
        <div>
          <div style={{ color: "var(--gb-yellow)", fontWeight: 700 }}>$ analytics</div>
          <div style={{ color: "var(--gb-gray)", fontSize: 12, marginTop: 6 }}>
            Traffic source, real referrer, UTM campaign, country, duration and visitor overview.
          </div>
        </div>
        <div className="gb-analytics-range" aria-label="Analytics range">
          {[1, 7, 30, 90].map((value) => (
            <button
              key={value}
              className={`gb-btn${days === value ? " gb-btn-primary" : ""}`}
              type="button"
              onClick={() => setDays(value)}
            >
              {value}d
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="gb-analytics-panel" style={{ color: "var(--gb-gray)" }}>$ loading analytics...</div>
      )}

      {summary && (
        <>
          <section className="gb-analytics-metrics">
            <Metric
              label="ONLINE"
              value={fmt(summary.onlineVisitors)}
              sub={`${fmt(summary.onlineSignedIn)} signed-in / ${fmt(summary.onlineAnonymous)} anonymous · ${onlineWindowMinutes}m`}
              color="var(--gb-green)"
            />
            <Metric label="PAGEVIEWS" value={fmt(summary.pageviews)} sub={`${fmt(summary.visitors)} unique visitors`} />
            <Metric label="SIGNED-IN" value={fmt(summary.userViews)} sub={pct(summary.userViews, activeTotal)} color="var(--gb-green)" />
            <Metric label="ANONYMOUS" value={fmt(summary.anonymousViews)} sub={pct(summary.anonymousViews, activeTotal)} color="var(--gb-aqua)" />
            <Metric label="REPEAT" value={fmt(summary.repeatViews)} sub={pct(summary.repeatViews, activeTotal)} color="var(--gb-purple)" />
            <Metric label="AVG TIME" value={duration(summary.avgDurationMs)} sub={summary.lastSeenAt ? `last ${relativeTime(summary.lastSeenAt)}` : "no visits"} color="var(--gb-orange)" />
          </section>

          <section className="gb-analytics-panel">
            <div className="gb-analytics-panel-title">" online now</div>
            <table className="gb-table">
              <thead>
                <tr>
                  <th style={{ textAlign: "right" }}>#</th>
                  <th>VISITOR</th>
                  <th>PATH</th>
                  <th>SOURCE</th>
                  <th>GEO</th>
                  <th>DEVICE</th>
                  <th style={{ textAlign: "right" }}>TIME</th>
                  <th style={{ textAlign: "right" }}>ACTIVE</th>
                </tr>
              </thead>
              <tbody>
                {(data?.online ?? []).map((row, index) => (
                  <tr key={row.id}>
                    <td style={{ textAlign: "right", color: "var(--gb-gray)" }}>{index + 1}</td>
                    <td>
                      <span style={{ color: row.username ? "var(--gb-green)" : "var(--gb-aqua)" }}>
                        {row.username ? `@${row.username}` : "anonymous"}
                      </span>
                      <br />
                      <span style={{ color: row.isBot ? "var(--gb-red)" : row.isRepeat ? "var(--gb-purple)" : "var(--gb-gray)", fontSize: 11 }}>
                        {row.isBot ? "bot" : row.isRepeat ? "repeat" : "new"}
                      </span>
                    </td>
                    <td style={{ maxWidth: 420 }}>
                      <span className="gb-analytics-ellipsis">{row.path}</span>
                    </td>
                    <td style={{ minWidth: 260 }}><SourceDetail row={row} /></td>
                    <td style={{ color: "var(--gb-gray)" }}>{row.country || "-"} {row.city ? `/ ${row.city}` : ""} {row.colo ? `/ ${row.colo}` : ""}</td>
                    <td style={{ color: "var(--gb-gray)" }}>{row.deviceType} / {row.browser} / {row.os}</td>
                    <td style={{ textAlign: "right" }}>{duration(row.durationMs)}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap", color: "var(--gb-green)" }}>{relativeTime(row.lastSeenAt)}</td>
                  </tr>
                ))}
                {!(data?.online ?? []).length && (
                  <tr><td colSpan={8} style={{ color: "var(--gb-gray)" }}>no active visitors in the last {onlineWindowMinutes}m</td></tr>
                )}
              </tbody>
            </table>
          </section>

          <div className="gb-analytics-grid">
            <MiniTable
              title='" sources'
              rows={data?.sources ?? []}
              columns={[
                { key: "source", label: "SOURCE", render: (row) => <SourceBadge source={row.source} medium={row.medium} /> },
                { key: "views", label: "VIEWS", align: "right", render: (row) => fmt(row.views) },
                { key: "visitors", label: "USERS", align: "right", render: (row) => fmt(row.visitors) },
                { key: "avgDurationMs", label: "TIME", align: "right", render: (row) => duration(row.avgDurationMs) },
              ]}
            />
            <MiniTable
              title='" utm campaigns'
              rows={data?.campaigns ?? []}
              columns={[
                {
                  key: "utmCampaign",
                  label: "UTM",
                  render: (row) => (
                    <div className="gb-analytics-source-detail">
                      <div><SourceBadge source={row.utmSource || row.source} medium={row.utmMedium || row.medium} /></div>
                      <div>campaign: {row.utmCampaign || row.campaign || "-"}</div>
                      {row.utmTerm && <div>term: {row.utmTerm}</div>}
                      {row.utmContent && <div>content: {row.utmContent}</div>}
                    </div>
                  ),
                },
                { key: "views", label: "VIEWS", align: "right", render: (row) => fmt(row.views) },
                { key: "visitors", label: "USERS", align: "right", render: (row) => fmt(row.visitors) },
                { key: "avgDurationMs", label: "TIME", align: "right", render: (row) => duration(row.avgDurationMs) },
              ]}
            />
          </div>

          <div className="gb-analytics-grid">
            <MiniTable
              title='" countries'
              rows={data?.countries ?? []}
              columns={[
                { key: "country", label: "COUNTRY", render: (row) => <span style={{ color: row.country === "unknown" ? "var(--gb-gray)" : "var(--gb-fg)" }}>{row.country}</span> },
                { key: "views", label: "VIEWS", align: "right", render: (row) => fmt(row.views) },
                { key: "visitors", label: "USERS", align: "right", render: (row) => fmt(row.visitors) },
              ]}
            />
            <MiniTable
              title='" route types'
              rows={data?.routes ?? []}
              columns={[
                { key: "routeType", label: "ROUTE", render: (row) => <span style={{ color: "var(--gb-yellow)" }}>{row.routeType}</span> },
                { key: "views", label: "VIEWS", align: "right", render: (row) => fmt(row.views) },
                { key: "visitors", label: "USERS", align: "right", render: (row) => fmt(row.visitors) },
                { key: "avgDurationMs", label: "TIME", align: "right", render: (row) => duration(row.avgDurationMs) },
              ]}
            />
            <MiniTable
              title='" device / browser'
              rows={data?.devices ?? []}
              columns={[
                { key: "deviceType", label: "DEVICE", render: (row) => <span style={{ color: "var(--gb-aqua)" }}>{row.deviceType}</span> },
                { key: "browser", label: "BROWSER" },
                { key: "os", label: "OS" },
                { key: "views", label: "VIEWS", align: "right", render: (row) => fmt(row.views) },
              ]}
            />
          </div>

          <section className="gb-analytics-panel">
            <div className="gb-analytics-panel-title">" top pages</div>
            <table className="gb-table">
              <thead>
                <tr>
                  <th>PATH</th>
                  <th>TYPE</th>
                  <th style={{ textAlign: "right" }}>VIEWS</th>
                  <th style={{ textAlign: "right" }}>USERS</th>
                  <th style={{ textAlign: "right" }}>SIGNED-IN</th>
                  <th style={{ textAlign: "right" }}>TIME</th>
                </tr>
              </thead>
              <tbody>
                {(data?.paths ?? []).map((row) => (
                  <tr key={row.path}>
                    <td>
                      <div className="gb-analytics-path">
                        <span>{row.path}</span>
                        <i style={{ width: `${Math.max(4, (row.views / maxPathViews) * 100)}%` }} />
                      </div>
                    </td>
                    <td style={{ color: "var(--gb-gray)" }}>{row.routeType}</td>
                    <td style={{ textAlign: "right", color: "var(--gb-green)" }}>{fmt(row.views)}</td>
                    <td style={{ textAlign: "right" }}>{fmt(row.visitors)}</td>
                    <td style={{ textAlign: "right", color: row.userViews ? "var(--gb-aqua)" : "var(--gb-gray)" }}>{fmt(row.userViews)}</td>
                    <td style={{ textAlign: "right" }}>{duration(row.avgDurationMs)}</td>
                  </tr>
                ))}
                {!(data?.paths ?? []).length && (
                  <tr><td colSpan={6} style={{ color: "var(--gb-gray)" }}>no pages yet</td></tr>
                )}
              </tbody>
            </table>
          </section>

          <div className="gb-analytics-grid">
            <MiniTable
              title='" signed-in users'
              rows={data?.users ?? []}
              columns={[
                { key: "username", label: "USER", render: (row) => <span style={{ color: "var(--gb-fg)" }}>{row.displayName}<br /><span style={{ color: "var(--gb-gray)", fontSize: 11 }}>@{row.username}</span></span> },
                { key: "views", label: "VIEWS", align: "right", render: (row) => fmt(row.views) },
                { key: "avgDurationMs", label: "TIME", align: "right", render: (row) => duration(row.avgDurationMs) },
                { key: "lastSeenAt", label: "LAST", align: "right", render: (row) => row.lastSeenAt ? relativeTime(row.lastSeenAt) : "-" },
              ]}
            />
            <MiniTable
              title='" referrers'
              rows={data?.referrers ?? []}
              columns={[
                {
                  key: "referrerHost",
                  label: "REFERRER",
                  render: (row) => (
                    <span style={{ color: row.referrerHost === "direct" ? "var(--gb-gray)" : "var(--gb-fg)" }}>
                      {row.referrerHost}
                      {row.sampleReferrer && (
                        <>
                          <br />
                          <span className="gb-analytics-referrer-url" title={row.sampleReferrer}>{shortUrl(row.sampleReferrer)}</span>
                        </>
                      )}
                    </span>
                  ),
                },
                { key: "views", label: "VIEWS", align: "right", render: (row) => fmt(row.views) },
                { key: "visitors", label: "USERS", align: "right", render: (row) => fmt(row.visitors) },
              ]}
            />
          </div>

          <section className="gb-analytics-panel">
            <div className="gb-analytics-panel-title">" recent visits</div>
            <table className="gb-table">
              <thead>
                <tr>
                  <th style={{ textAlign: "right" }}>#</th>
                  <th>VISITOR</th>
                  <th>PATH</th>
                  <th>SOURCE</th>
                  <th>GEO</th>
                  <th>DEVICE</th>
                  <th style={{ textAlign: "right" }}>TIME</th>
                  <th style={{ textAlign: "right" }}>WHEN</th>
                </tr>
              </thead>
              <tbody>
                {(data?.recent ?? []).map((row, index) => (
                  <tr key={row.id}>
                    <td style={{ textAlign: "right", color: "var(--gb-gray)" }}>{index + 1}</td>
                    <td>
                      <span style={{ color: row.username ? "var(--gb-green)" : "var(--gb-aqua)" }}>
                        {row.username ? `@${row.username}` : "anonymous"}
                      </span>
                      <br />
                      <span style={{ color: row.isBot ? "var(--gb-red)" : row.isRepeat ? "var(--gb-purple)" : "var(--gb-gray)", fontSize: 11 }}>
                        {row.isBot ? "bot" : row.isRepeat ? "repeat" : "new"}
                      </span>
                    </td>
                    <td style={{ maxWidth: 420 }}>
                      <span className="gb-analytics-ellipsis">{row.path}</span>
                    </td>
                    <td style={{ minWidth: 260 }}><SourceDetail row={row} /></td>
                    <td style={{ color: "var(--gb-gray)" }}>{row.country || "-"} {row.city ? `/ ${row.city}` : ""} {row.colo ? `/ ${row.colo}` : ""}</td>
                    <td style={{ color: "var(--gb-gray)" }}>{row.deviceType} / {row.browser} / {row.os}</td>
                    <td style={{ textAlign: "right" }}>{duration(row.durationMs)}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap", color: "var(--gb-gray)" }}>{relativeTime(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
