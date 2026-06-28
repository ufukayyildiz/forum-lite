import { useParams, Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";
import { api } from "../lib/api";
import { TopicRow, EmptyRows } from "../components/TopicRow";
import { useMe } from "../lib/useAuth";
import { GbToolbar } from "../components/layout/Header";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SEOHead } from "../components/SEOHead";
import { categoryPath, threadPath } from "../lib/routes";
import { ListAdRow, shouldShowLeadListAd, shouldShowListAd } from "../components/ListAdRow";

const VISIBLE_ROWS = 18;

export default function CategoryPage() {
  const { id: catId } = useParams<{ id: string }>();
  const { data: me } = useMe();
  const [sp, setSp] = useSearchParams();
  const sort = sp.get("sort") ?? "recent";
  const requestedPage = Number(sp.get("page") ?? 1);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? Math.floor(requestedPage) : 1;

  const { data: cat } = useQuery({ queryKey: ["category", catId], queryFn: () => api.category(catId!), enabled: !!catId });
  const { data, isLoading } = useQuery({
    queryKey: ["threads", "cat", catId, sort, "page", page],
    queryFn: () => api.threads({ category: catId!, sort, page }),
    enabled: !!catId,
    placeholderData: (previous) => previous,
  });
  const { data: adsConfig } = useQuery({ queryKey: ["ads-config"], queryFn: api.adsConfig });

  const list = data?.threads ?? [];
  const emptyCount = Math.max(0, VISIBLE_ROWS - list.length);
  const showLoading = isLoading && !data;
  const total = data?.total ?? 0;
  const perPage = data?.perPage ?? 20;
  const pageCount = Math.max(1, Math.ceil(total / perPage));

  const setPageParam = (nextPage: number) => {
    const next = new URLSearchParams(sp);
    if (sort === "recent") next.delete("sort");
    else next.set("sort", sort);
    if (nextPage <= 1) next.delete("page");
    else next.set("page", String(nextPage));
    setSp(next);
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const catPath = cat ? categoryPath(cat) : `/c/${catId}`;

  return (
    <>
      <SEOHead
        title={cat?.name ?? "Category"}
        description={cat?.description ?? `${cat?.name ?? "Category"} discussions and threads on FSTDESK.`}
        canonical={catPath}
        breadcrumbs={[
          { name: "FSTDESK", url: origin + "/" },
          { name: cat?.name ?? "Category", url: `${origin}${catPath}` },
        ]}
        structuredData={[
          {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: cat?.name ?? "Category",
            description: cat?.description ?? undefined,
            url: `${origin}${catPath}`,
            inLanguage: "en-US",
            numberOfItems: data?.total ?? 0,
          },
          {
            "@context": "https://schema.org",
            "@type": "ItemList",
            itemListElement: list.slice(0, 20).map((thread, i) => ({
              "@type": "ListItem",
              position: (page - 1) * perPage + i + 1,
              url: `${origin}${threadPath(thread)}`,
              name: thread.title,
            })),
          },
        ]}
      />
      <GbToolbar
        crumbs={[
          { label: "threads", href: "/" },
          { label: cat ? cat.name.toLowerCase() : "..." },
        ]}
      />

      <div className="gb-tabs">
        {[["recent","RECENT"],["replies","MOST REPLIES"],["popular","POPULAR"]].map(([v,l]) => (
          <div key={v} className={`gb-tab-item${sort === v ? " active" : ""}`}
            onClick={() => setSp(v === "recent" ? {} : { sort: v })}>{l}</div>
        ))}
      </div>

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
                    <TopicRow thread={t} showCategory={false} lineNum={position} />
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
                    empty — <Link
                      to={me ? `/new-thread?category=${catId}` : `/login?next=${encodeURIComponent(`/new-thread?category=${catId}`)}`}
                      style={{ color: "var(--gb-green)", fontWeight: 700 }}
                    >
                      $ new thread
                    </Link>
                  </td>
                </tr>
              )}
              <EmptyRows count={emptyCount} />
            </tbody>
          </table>
        )}
        {pageCount > 1 && (
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, padding: "10px 0", color: "var(--gb-gray)", fontSize: 12 }}>
            <button className="gb-btn" aria-label="Previous page" disabled={page <= 1} onClick={() => setPageParam(Math.max(1, page - 1))}>
              <ChevronLeft size={13} />
            </button>
            <span>{page} / {pageCount}</span>
            <button className="gb-btn" aria-label="Next page" disabled={page >= pageCount} onClick={() => setPageParam(Math.min(pageCount, page + 1))}>
              <ChevronRight size={13} />
            </button>
          </div>
        )}
      </div>
    </>
  );
}
