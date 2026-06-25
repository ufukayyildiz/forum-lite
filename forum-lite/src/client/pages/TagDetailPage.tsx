import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";
import { GbToolbar } from "../components/layout/Header";
import { SEOHead } from "../components/SEOHead";
import { TopicRow, EmptyRows } from "../components/TopicRow";
import { threadPath } from "../lib/routes";

const VISIBLE_ROWS = 20;

export default function TagDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [sort, setSort] = useState("recent");

  const { data, isLoading } = useQuery({
    queryKey: ["tag-threads", slug, sort, "all"],
    queryFn: () => api.tagThreads(slug!, { sort, all: 1 }),
    enabled: !!slug,
    placeholderData: (previous) => previous,
  });

  const threads = data?.threads ?? [];
  const tag = data?.tag;
  const emptyCount = Math.max(0, VISIBLE_ROWS - threads.length);
  const showLoading = isLoading && !data;

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <>
      <SEOHead
        title={tag ? `#${tag.name}` : slug ?? "Tag"}
        description={`Forum discussions tagged "${tag?.name ?? slug}".`}
        canonical={`/tag/${slug}`}
        breadcrumbs={[
          { name: "Forum", url: origin + "/" },
          { name: "Tags", url: origin + "/tags" },
          { name: tag ? `#${tag.name}` : slug ?? "Tag", url: `${origin}/tag/${slug}` },
        ]}
        structuredData={[
          {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: `${tag?.name ?? slug} — Forum Threads`,
            url: `${origin}/tag/${slug}`,
            inLanguage: "en-US",
            numberOfItems: data?.total ?? 0,
          },
          {
            "@context": "https://schema.org",
            "@type": "ItemList",
            itemListElement: threads.map((thread, i) => ({
              "@type": "ListItem",
              position: i + 1,
              url: `${origin}${threadPath(thread)}`,
              name: thread.title,
            })),
          },
        ]}
      />
      <GbToolbar crumbs={[
        { label: "tags", href: "/tags" },
        { label: tag ? `#${tag.name}` : slug ?? "..." },
      ]} />

      <div className="gb-tabs">
        {[["recent", "RECENT"], ["replies", "MOST REPLIES"], ["popular", "POPULAR"]].map(([v, l]) => (
          <div key={v} className={`gb-tab-item${sort === v ? " active" : ""}`}
            onClick={() => setSort(v)}>{l}</div>
        ))}
      </div>

      <div className="gb-content">
        {showLoading ? (
          <div className="gb-state-pad" style={{ color: "var(--gb-gray)" }}>$ loading...</div>
        ) : (
          <table className="gb-table">
            <thead>
              <tr>
                <th scope="col" style={{ textAlign: "right", paddingRight: 16 }}>#</th>
                <th scope="col" aria-label="Status" style={{ width: 20 }} />
                <th scope="col">NAME</th>
                <th scope="col" style={{ textAlign: "right", paddingRight: 16 }}>REPLIES</th>
                <th scope="col" style={{ textAlign: "right", paddingRight: 16 }}>VIEWS</th>
                <th scope="col" style={{ textAlign: "right", paddingRight: 12 }}>MODIFIED</th>
              </tr>
            </thead>
            <tbody>
              {threads.length === 0 && (
                <tr>
                  <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>~</td>
                  <td colSpan={5} style={{ color: "var(--gb-gray)" }}>
                    empty — no threads with #{slug} tag
                  </td>
                </tr>
              )}
              {threads.map((t, i) => (
                <TopicRow key={t.id} thread={t} lineNum={i + 1} />
              ))}
              <EmptyRows count={emptyCount} />
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
