import { useParams, Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { TopicRow, EmptyRows } from "../components/TopicRow";
import { useMe } from "../lib/useAuth";
import { GbToolbar } from "../components/layout/Header";
import { Plus } from "lucide-react";
import { SEOHead } from "../components/SEOHead";
import { categoryPath, threadPath } from "../lib/routes";

const VISIBLE_ROWS = 18;

export default function CategoryPage() {
  const { id: catId } = useParams<{ id: string }>();
  const { data: me } = useMe();
  const [sp, setSp] = useSearchParams();
  const sort = sp.get("sort") ?? "recent";

  const { data: cat } = useQuery({ queryKey: ["category", catId], queryFn: () => api.category(catId!), enabled: !!catId });
  const { data, isLoading } = useQuery({
    queryKey: ["threads", "cat", catId, sort, "all"],
    queryFn: () => api.threads({ category: catId!, sort, all: 1 }),
    enabled: !!catId,
  });

  const list = data?.threads ?? [];
  const emptyCount = Math.max(0, VISIBLE_ROWS - list.length);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const catPath = cat ? categoryPath(cat) : `/c/${catId}`;

  return (
    <>
      <SEOHead
        title={cat?.name ?? "Category"}
        description={cat?.description ?? `${cat?.name ?? "Category"} forum discussions and threads.`}
        canonical={catPath}
        breadcrumbs={[
          { name: "Forum", url: origin + "/" },
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
              position: i + 1,
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
        {isLoading ? (
          <div className="gb-state-pad" style={{ color: "var(--gb-gray)" }}>$ loading...</div>
        ) : (
          <table className="gb-table">
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
              {list.map((t, i) => (
                <TopicRow key={t.id} thread={t} showCategory={false} lineNum={i + 1} />
              ))}
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
      </div>
    </>
  );
}
