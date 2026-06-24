import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { DAvatar } from "../components/DAvatar";
import { GbToolbar } from "../components/layout/Header";
import { SEOHead } from "../components/SEOHead";

const ROLE_LABEL: Record<string, string> = { admin: "[admin]", moderator: "[mod]" };
const ROLE_COLOR: Record<string, string> = { admin: "var(--gb-red)", moderator: "var(--gb-blue)" };
const VISIBLE_ROWS = 18;

export default function MembersPage() {
  const [sort, setSort] = useState("posts");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["members", sort, page],
    queryFn: () => api.members({ sort, page }),
  });

  const totalPages = data ? Math.ceil(data.total / data.perPage) : 1;
  const list = data?.members ?? [];
  const emptyCount = Math.max(0, VISIBLE_ROWS - list.length);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <>
      <SEOHead
        title="Members"
        description="Forum members, authors, moderators and administrators."
        canonical="/members"
        breadcrumbs={[
          { name: "Forum", url: origin + "/" },
          { name: "Members", url: origin + "/members" },
        ]}
        structuredData={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "Forum Members",
          url: origin + "/members",
          inLanguage: "en-US",
          numberOfItems: data?.total ?? 0,
        }}
      />
      <GbToolbar crumbs={[{ label: "members" }]} />

      <div className="gb-tabs">
        {[["posts","by posts"],["threads","by threads"],["newest","newest"]].map(([v,l]) => (
          <div key={v} className={`gb-tab-item${sort === v ? " active" : ""}`}
            onClick={() => { setSort(v); setPage(1); }}>{l.toUpperCase()}</div>
        ))}
      </div>

      <div className="gb-content">
        {isLoading ? (
          <div className="gb-state-pad" style={{ color: "var(--gb-gray)" }}>$ loading...</div>
        ) : (
          <table className="gb-table">
            <thead>
              <tr>
                <th style={{ textAlign: "right", paddingRight: 16 }}>#</th>
                <th style={{ width: 36 }} />
                <th>NAME</th>
                <th style={{ textAlign: "right", paddingRight: 16 }}>POSTS</th>
                <th className="gb-col-threads" style={{ textAlign: "right", paddingRight: 16 }}>THREADS</th>
                <th className="gb-col-joined" style={{ textAlign: "right", paddingRight: 12 }}>JOINED</th>
              </tr>
            </thead>
            <tbody>
              {list.map((m, i) => (
                <tr key={m.id}>
                  <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>{i + 1 + (page - 1) * (data?.perPage ?? 20)}</td>
                  <td style={{ width: 36, paddingRight: 8 }}>
                    <DAvatar src={m.avatarUrl} name={m.displayName} size={24} />
                  </td>
                  <td>
                    <Link to={`/u/${m.username}`} className="gb-col-name" style={{ color: "var(--gb-green)" }}>
                      {m.displayName}
                    </Link>
                    <span style={{ color: "var(--gb-gray)", fontSize: 12, marginLeft: 8 }}>@{m.username}</span>
                    {ROLE_LABEL[m.role] && (
                      <span style={{ fontSize: 11, color: ROLE_COLOR[m.role], marginLeft: 6, fontWeight: 700 }}>
                        {ROLE_LABEL[m.role]}
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: "right", paddingRight: 16, color: "var(--gb-aqua)", fontSize: 13 }}>{m.postCount}</td>
                  <td className="gb-col-threads" style={{ textAlign: "right", paddingRight: 16, color: "var(--gb-fg4)", fontSize: 13 }}>{m.threadCount}</td>
                  <td className="gb-col-joined" style={{ textAlign: "right", paddingRight: 12, color: "var(--gb-gray)", fontSize: 12 }}>
                    {new Date(m.createdAt).toLocaleDateString("en-GB")}
                  </td>
                </tr>
              ))}
              {!list.length && (
                <tr>
                  <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16 }}>~</td>
                  <td colSpan={5} style={{ color: "var(--gb-gray)" }}>no results</td>
                </tr>
              )}
              {Array.from({ length: emptyCount }).map((_, i) => (
                <tr key={"e" + i}>
                  <td style={{ color: "var(--gb-bg3)", textAlign: "right", paddingRight: 16, fontSize: 12, paddingTop: 2, paddingBottom: 2 }}>~</td>
                  <td colSpan={5} />
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {totalPages > 1 && (
          <div className="gb-pag-row">
            <button className="gb-btn" style={{ padding: "2px 10px" }} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>prev</button>
            <span style={{ color: "var(--gb-gray)", fontSize: 12 }}>{page} / {totalPages}</span>
            <button className="gb-btn" style={{ padding: "2px 10px" }} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>next</button>
          </div>
        )}
      </div>
    </>
  );
}
