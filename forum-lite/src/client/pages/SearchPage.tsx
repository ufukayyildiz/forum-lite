import { useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { DAvatar } from "../components/DAvatar";
import { GbToolbar } from "../components/layout/Header";
import { SEOHead } from "../components/SEOHead";
import { relativeTime } from "../lib/utils";
import { ThreadLink } from "../components/ThreadLink";
import { memberPath } from "../lib/routes";

export default function SearchPage() {
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");

  const { data, isLoading } = useQuery({
    queryKey: ["search", sp.get("q")],
    queryFn: () => api.search(sp.get("q")!),
    enabled: (sp.get("q") ?? "").length >= 2,
  });

  function submit(e: React.FormEvent) { e.preventDefault(); if (q.trim()) setSp({ q: q.trim() }); }

  const hasResults = data && (data.threads.length + data.posts.length + data.users.length > 0);

  const query = sp.get("q") ?? "";

  return (
    <>
      <SEOHead
        title={query ? `Search: ${query}` : "Search"}
        description="Search forum threads, posts and members."
        canonical="/search"
        noindex={true}
        breadcrumbs={[
          { name: "FSTDESK", url: typeof window !== "undefined" ? window.location.origin + "/" : "/" },
          { name: "Search", url: typeof window !== "undefined" ? window.location.origin + "/search" : "/search" },
        ]}
      />
      <GbToolbar crumbs={[{ label: "search" }]} />
      <div className="gb-content gb-search-content" style={{ padding: "16px 20px", maxWidth: 800 }}>
        <form onSubmit={submit} style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <div className="gb-search" style={{ flex: 1 }}>
            <span style={{ color: "var(--gb-gray)", fontSize: 12 }}>/search... </span>
            <input
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--gb-fg)", fontFamily: "inherit", fontSize: 13 }}
              placeholder="type query..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />
          </div>
          <button type="submit" className="gb-btn gb-btn-primary">search</button>
        </form>

        {isLoading && <div style={{ color: "var(--gb-gray)" }}>$ searching...</div>}

        {sp.get("q") && !isLoading && !hasResults && (
          <div style={{ color: "var(--gb-red)" }}>error: no results for "{sp.get("q")}"</div>
        )}

        {hasResults && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {data.threads.length > 0 && (
              <div>
                <div style={{ fontSize: 11, color: "var(--gb-gray)", letterSpacing: ".08em", marginBottom: 4 }}>
                  " threads ({data.threads.length})
                </div>
                <table className="gb-table">
                  <tbody>
                    {data.threads.map((t: any, i: number) => (
                      <tr key={t.id}>
                        <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, width: 48, fontSize: 12 }}>{i + 1}</td>
                        <td style={{ width: 20 }}><span style={{ color: "var(--gb-green)" }}>#</span></td>
                        <td>
                          <ThreadLink thread={t} className="gb-col-name" style={{ color: "var(--gb-fg)" }}>{t.title}</ThreadLink>
                          <div style={{ fontSize: 11, color: "var(--gb-gray)" }}>{t.categoryName} &bull; {t.replyCount} replies</div>
                        </td>
                        <td style={{ textAlign: "right", paddingRight: 12, color: "var(--gb-gray)", fontSize: 12, whiteSpace: "nowrap" }}>
                          {relativeTime(t.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.users.length > 0 && (
              <div>
                <div style={{ fontSize: 11, color: "var(--gb-gray)", letterSpacing: ".08em", marginBottom: 4 }}>
                  " members ({data.users.length})
                </div>
                <table className="gb-table">
                  <tbody>
                    {data.users.map((u: any, i: number) => (
                      <tr key={u.id}>
                        <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, width: 48, fontSize: 12 }}>{i + 1}</td>
                        <td style={{ width: 36 }}><DAvatar src={u.avatarUrl} name={u.displayName} size={24} /></td>
                        <td>
                          <Link to={memberPath(u.username)} className="gb-col-name" style={{ color: "var(--gb-green)" }}>{u.displayName}</Link>
                          <span style={{ color: "var(--gb-gray)", fontSize: 12, marginLeft: 8 }}>@{u.username}</span>
                        </td>
                        <td />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
