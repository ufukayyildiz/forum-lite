import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { TopicRow, EmptyRows } from "../components/TopicRow";
import { GbToolbar } from "../components/layout/Header";
import { useMe } from "../lib/useAuth";
import { SEOHead } from "../components/SEOHead";
import { threadPath } from "../lib/routes";
import { ListAdRow, shouldShowLeadListAd, shouldShowListAd } from "../components/ListAdRow";
import { PaginationControls } from "../components/PaginationControls";

const THREAD_ROWS = 15;

export default function HomePage() {
  const [sort, setSort] = useState("recent");
  const [page, setPage] = useState(1);
  const { data: me } = useMe();

  const { data: threads, isLoading: tLoading } = useQuery({
    queryKey: ["threads", "all", sort, "page", page],
    queryFn: () => api.threads({ sort, page }),
    placeholderData: (previous) => previous,
  });
  const { data: adsConfig } = useQuery({ queryKey: ["ads-config"], queryFn: api.adsConfig });

  const list = threads?.threads ?? [];
  const emptyCount = Math.max(0, THREAD_ROWS - list.length);
  const showLoading = tLoading && !threads;
  const total = threads?.total ?? 0;
  const perPage = threads?.perPage ?? 20;
  const pageCount = Math.max(1, Math.ceil(total / perPage));

  return (
    <>
      <SEOHead
        title="Food Science and Technology Desk"
        description="Food Science and Technology Desk for food science, food safety, product development and food technology discussions."
        canonical="/"
        breadcrumbs={[{ name: "FSTDESK", url: typeof window !== "undefined" ? window.location.origin + "/" : "/" }]}
        structuredData={[
          {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            "@id": typeof window !== "undefined" ? window.location.origin + "/#webpage" : "/#webpage",
            name: "FSTDESK",
            alternateName: "Food Science and Technology Desk",
            description: "Food science, food safety and food technology discussions.",
            inLanguage: "en-US",
          },
          {
            "@context": "https://schema.org",
            "@type": "ItemList",
            itemListElement: list.map((thread, i) => ({
              "@type": "ListItem",
              position: i + 1,
              url: typeof window !== "undefined" ? `${window.location.origin}${threadPath(thread)}` : threadPath(thread),
              name: thread.title,
            })),
          },
        ]}
      />
      <GbToolbar crumbs={[{ label: "home" }]} />

      {/* Sort tabs */}
      <div className="gb-tabs">
        {[["recent","RECENT"],["replies","MOST REPLIES"],["popular","POPULAR"]].map(([v, l]) => (
          <div key={v} className={`gb-tab-item${sort === v ? " active" : ""}`}
            onClick={() => { setSort(v); setPage(1); }}>{l}</div>
        ))}
      </div>

      {/* Threads table */}
      <div className="gb-content">
        {showLoading ? (
          <div className="gb-state-pad" style={{ color: "var(--gb-gray)" }}>$ loading...</div>
        ) : (
          <table className="gb-table gb-topic-table">
            <thead>
              <tr>
                <th scope="col" style={{ textAlign: "right", paddingRight: 16 }}>#</th>
                <th scope="col" aria-label="Status" style={{ width: 20 }} />
                <th scope="col">NAME</th>
                <th scope="col" style={{ textAlign: "right", paddingRight: 16 }}>REPLIES</th>
                <th scope="col" className="gb-col-views" style={{ textAlign: "right", paddingRight: 16 }}>VIEWS</th>
                <th scope="col" className="gb-col-modified" style={{ textAlign: "right", paddingRight: 12 }}>MODIFIED</th>
              </tr>
            </thead>
            <tbody>
              {shouldShowLeadListAd(adsConfig, list.length) && (
                <ListAdRow config={adsConfig} index={0} colSpan={6} lead />
              )}
              {list.map((t, i) => {
                const position = (page - 1) * perPage + i + 1;
                return (
                  <Fragment key={t.id}>
                    <TopicRow thread={t} showCategory lineNum={position} />
                    {shouldShowListAd(adsConfig, position, list.length, "topic") && (
                      <ListAdRow config={adsConfig} index={position} colSpan={6} />
                    )}
                  </Fragment>
                );
              })}
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
        <PaginationControls page={page} totalPages={pageCount} onPage={setPage} />
      </div>
    </>
  );
}
