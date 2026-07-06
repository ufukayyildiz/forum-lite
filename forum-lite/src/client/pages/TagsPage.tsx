import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Fragment } from "react";
import { api } from "../lib/api";
import { GbToolbar } from "../components/layout/Header";
import { SEOHead } from "../components/SEOHead";
import { ListAdRow, shouldShowLeadListAd, shouldShowListAd } from "../components/ListAdRow";
import { bootstrapQueryOptions } from "../lib/bootstrap";
import { tagPath } from "../lib/routes";

const VISIBLE_ROWS = 18;

export default function TagsPage() {
  const { data: tags, isLoading } = useQuery({
    queryKey: ["tags"],
    queryFn: api.tags,
    ...bootstrapQueryOptions<any>(["tags"]),
  });
  const { data: adsConfig } = useQuery({
    queryKey: ["ads-config"],
    queryFn: api.adsConfig,
    ...bootstrapQueryOptions<any>(["ads-config"]),
  });
  const showLoading = isLoading && !tags;

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <>
      <SEOHead
        title="Tags"
        description="Browse FSTDESK topics by tag."
        canonical="/tags"
        breadcrumbs={[
          { name: "FSTDESK", url: origin + "/" },
          { name: "Tags", url: origin + "/tags" },
        ]}
        structuredData={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "FSTDESK Tags",
          url: origin + "/tags",
          inLanguage: "en-US",
          numberOfItems: tags?.length ?? 0,
        }}
      />
      <GbToolbar crumbs={[{ label: "tags" }]} />
      <div className="gb-content">
        {showLoading ? (
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
              {shouldShowLeadListAd(adsConfig, tags?.length ?? 0) && (
                <ListAdRow config={adsConfig} index={0} colSpan={6} lead />
              )}
              {tags?.map((t, i) => {
                const position = i + 1;
                return (
                  <Fragment key={t.id}>
                    <tr>
                      <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>{position}</td>
                      <td style={{ width: 20 }}>
                        <span style={{ color: "var(--gb-aqua)", fontSize: 13 }}>#</span>
                      </td>
                      <td>
                        <Link to={tagPath(t.slug)} className="gb-col-name" style={{ color: "var(--gb-aqua)" }}>{t.name}</Link>
                      </td>
                      <td style={{ textAlign: "right", paddingRight: 16, color: "var(--gb-fg4)", fontSize: 13 }}>{t.threadCount}</td>
                      <td colSpan={2} />
                    </tr>
                    {shouldShowListAd(adsConfig, position, tags.length, "tag") && (
                      <ListAdRow config={adsConfig} index={position} colSpan={6} />
                    )}
                  </Fragment>
                );
              })}
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
