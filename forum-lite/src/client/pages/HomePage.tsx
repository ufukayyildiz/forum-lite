import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { TopicRow, EmptyRows } from "../components/TopicRow";
import { GbToolbar } from "../components/layout/Header";
import { useMe } from "../lib/useAuth";
import { SEOHead } from "../components/SEOHead";
import { categoryPath, threadPath } from "../lib/routes";

const CAT_COLORS = ["#b8bb26","#83a598","#fabd2f","#d3869b","#8ec07c","#fe8019","#fb4934","#a89984"];
const THREAD_ROWS = 15;

export default function HomePage() {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("recent");
  const { data: me } = useMe();

  const { data: threads, isLoading: tLoading } = useQuery({
    queryKey: ["threads", "all", page, sort],
    queryFn: () => api.threads({ page, sort }),
  });
  const { data: categories, isLoading: cLoading } = useQuery({
    queryKey: ["categories"],
    queryFn: api.categories,
  });

  const totalPages = threads ? Math.ceil(threads.total / threads.perPage) : 1;
  const list = threads?.threads ?? [];
  const emptyCount = Math.max(0, THREAD_ROWS - list.length);

  return (
    <>
      <SEOHead
        title="Threads"
        description="Food science, food safety, product development and food technology forum discussions."
        canonical="/"
        breadcrumbs={[{ name: "Forum", url: typeof window !== "undefined" ? window.location.origin + "/" : "/" }]}
        structuredData={[
          {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            "@id": typeof window !== "undefined" ? window.location.origin + "/#webpage" : "/#webpage",
            name: "FSTDESK Forum",
            description: "Food science, food safety and food technology forum discussions.",
            inLanguage: "en-US",
          },
          {
            "@context": "https://schema.org",
            "@type": "ItemList",
            itemListElement: list.slice(0, 20).map((thread, i) => ({
              "@type": "ListItem",
              position: i + 1 + (page - 1) * (threads?.perPage ?? 20),
              url: typeof window !== "undefined" ? `${window.location.origin}${threadPath(thread)}` : threadPath(thread),
              name: thread.title,
            })),
          },
        ]}
      />
      <GbToolbar crumbs={[{ label: "home" }]} />

      {/* CATEGORIES strip */}
      <div className="gb-home-categories" style={{ borderBottom: "1px solid var(--gb-bg2)", background: "var(--gb-bg1)" }}>
        <div style={{ padding: "4px 0" }}>
          <div style={{ padding: "2px 20px 4px", fontSize: 10, color: "var(--gb-bg3)", letterSpacing: ".08em", fontWeight: 700 }}>
            " CATEGORIES
          </div>
          {cLoading ? (
            <div style={{ padding: "4px 20px", fontSize: 12, color: "var(--gb-gray)" }}>$ loading...</div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 0 }}>
              {categories?.map((cat, i) => (
                <Link
                  key={cat.id}
                  to={categoryPath(cat)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "3px 16px", textDecoration: "none",
                    borderRight: "1px solid var(--gb-bg2)",
                    fontSize: 12, color: "var(--gb-fg4)",
                  }}
                  className="gb-cat-link"
                >
                  <span style={{ color: CAT_COLORS[i % CAT_COLORS.length], fontSize: 13 }}>#</span>
                  <span style={{ color: "var(--gb-fg)" }}>{cat.name.toLowerCase()}</span>
                  <span style={{ color: "var(--gb-bg3)", fontSize: 11 }}>{cat.threadCount}</span>
                </Link>
              ))}
              {!cLoading && !categories?.length && (
                <div style={{ padding: "4px 20px", fontSize: 12, color: "var(--gb-gray)" }}>no categories</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Sort tabs */}
      <div className="gb-tabs">
        {[["recent","RECENT"],["replies","MOST REPLIES"],["popular","POPULAR"]].map(([v, l]) => (
          <div key={v} className={`gb-tab-item${sort === v ? " active" : ""}`}
            onClick={() => { setSort(v); setPage(1); }}>{l}</div>
        ))}
      </div>

      {/* Threads table */}
      <div className="gb-content">
        {tLoading ? (
          <div className="gb-state-pad" style={{ color: "var(--gb-gray)" }}>$ loading...</div>
        ) : (
          <table className="gb-table">
            <thead>
              <tr>
                <th style={{ textAlign: "right", paddingRight: 16 }}>#</th>
                <th style={{ width: 20 }} />
                <th>NAME</th>
                <th style={{ textAlign: "right", paddingRight: 16 }}>REPLIES</th>
                <th className="gb-col-views" style={{ textAlign: "right", paddingRight: 16 }}>VIEWS</th>
                <th className="gb-col-modified" style={{ textAlign: "right", paddingRight: 12 }}>MODIFIED</th>
              </tr>
            </thead>
            <tbody>
              {list.map((t, i) => (
                <TopicRow key={t.id} thread={t} showCategory lineNum={i + 1 + (page - 1) * (threads?.perPage ?? 20)} />
              ))}
              {!list.length && (
                <tr>
                  <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16 }}>1</td>
                  <td colSpan={5} style={{ color: "var(--gb-gray)", padding: "20px 0" }}>
                    empty — <Link to={me ? "/new-thread" : "/login?next=/new-thread"} style={{ color: "var(--gb-green)", fontWeight: 700 }}>$ new thread</Link>
                  </td>
                </tr>
              )}
              <EmptyRows count={emptyCount} />
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
