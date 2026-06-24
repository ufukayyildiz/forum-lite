import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { GbToolbar } from "../components/layout/Header";
import { SEOHead } from "../components/SEOHead";

const VISIBLE_ROWS = 18;

export default function TagsPage() {
  const { data: tags, isLoading } = useQuery({ queryKey: ["tags"], queryFn: api.tags });

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <>
      <SEOHead
        title="Tags"
        description="Browse forum topics by tag."
        canonical="/tags"
        breadcrumbs={[
          { name: "Forum", url: origin + "/" },
          { name: "Tags", url: origin + "/tags" },
        ]}
        structuredData={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "Forum Tags",
          url: origin + "/tags",
          inLanguage: "en-US",
          numberOfItems: tags?.length ?? 0,
        }}
      />
      <GbToolbar crumbs={[{ label: "tags" }]} />
      <div className="gb-content">
        {isLoading ? (
          <div className="gb-state-pad" style={{ color: "var(--gb-gray)" }}>$ loading...</div>
        ) : (
          <table className="gb-table">
            <thead>
              <tr>
                <th style={{ textAlign: "right", paddingRight: 16 }}>#</th>
                <th style={{ width: 20 }} />
                <th>TAG</th>
                <th style={{ textAlign: "right", paddingRight: 16 }}>THREADS</th>
                <th colSpan={2} />
              </tr>
            </thead>
            <tbody>
              {tags?.map((t, i) => (
                <tr key={t.id}>
                  <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>{i + 1}</td>
                  <td style={{ width: 20 }}>
                    <span style={{ color: "var(--gb-aqua)", fontSize: 13 }}>#</span>
                  </td>
                  <td>
                    <Link to={`/tag/${t.slug}`} className="gb-col-name" style={{ color: "var(--gb-aqua)" }}>{t.name}</Link>
                  </td>
                  <td style={{ textAlign: "right", paddingRight: 16, color: "var(--gb-fg4)", fontSize: 13 }}>{t.threadCount}</td>
                  <td colSpan={2} />
                </tr>
              ))}
              {!tags?.length && (
                <tr>
                  <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16 }}>~</td>
                  <td colSpan={5} style={{ color: "var(--gb-gray)" }}>no tags</td>
                </tr>
              )}
              {Array.from({ length: Math.max(0, VISIBLE_ROWS - (tags?.length ?? 0)) }).map((_, i) => (
                <tr key={"e" + i}>
                  <td style={{ color: "var(--gb-bg3)", textAlign: "right", paddingRight: 16, fontSize: 12, paddingTop: 2, paddingBottom: 2 }}>~</td>
                  <td colSpan={5} />
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
