import { Fragment, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { DAvatar } from "../components/DAvatar";
import { GbToolbar } from "../components/layout/Header";
import { SEOHead } from "../components/SEOHead";
import { ListAdRow, shouldShowLeadListAd, shouldShowListAd } from "../components/ListAdRow";
import { bootstrapQueryOptions } from "../lib/bootstrap";
import { memberPath } from "../lib/routes";

const ROLE_LABEL: Record<string, string> = { admin: "[admin]", moderator: "[mod]" };
const ROLE_COLOR: Record<string, string> = { admin: "var(--gb-red)", moderator: "var(--gb-blue)" };
const VISIBLE_ROWS = 18;
const MEMBERS_PAGE_SIZE = 200;

export default function MembersPage() {
  const [sort, setSort] = useState("posts");
  const membersKey = ["members", sort, "pages"];

  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: membersKey,
    queryFn: ({ pageParam }) => api.members({ sort, page: pageParam, perPage: MEMBERS_PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.perPage < last.total ? last.page + 1 : undefined),
    ...bootstrapQueryOptions<any>(membersKey, { staleTime: 60_000 }),
  });
  const { data: adsConfig } = useQuery({
    queryKey: ["ads-config"],
    queryFn: api.adsConfig,
    ...bootstrapQueryOptions<any>(["ads-config"]),
  });

  const pages = data?.pages ?? [];
  const list = pages.flatMap((page) => page.members);
  const total = pages[0]?.total ?? 0;
  const emptyCount = Math.max(0, VISIBLE_ROWS - list.length);
  const showLoading = isLoading && !data;

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <>
      <SEOHead
        title="Members"
        description="FSTDESK members, authors, moderators and administrators."
        canonical="/members"
        breadcrumbs={[
          { name: "FSTDESK", url: origin + "/" },
          { name: "Members", url: origin + "/members" },
        ]}
        structuredData={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "FSTDESK Members",
          url: origin + "/members",
          inLanguage: "en-US",
          numberOfItems: total,
        }}
      />
      <GbToolbar crumbs={[{ label: "members" }]} />

      <div className="gb-tabs">
        {[["posts","by posts"],["threads","by threads"],["newest","newest"]].map(([v,l]) => (
          <div key={v} className={`gb-tab-item${sort === v ? " active" : ""}`}
            onClick={() => setSort(v)}>{l.toUpperCase()}</div>
        ))}
      </div>

      <div className="gb-content">
        {showLoading ? (
          <div className="gb-state-pad" style={{ color: "var(--gb-gray)" }}>$ loading...</div>
        ) : (
          <table className="gb-table gb-members-table">
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
              {shouldShowLeadListAd(adsConfig, list.length) && (
                <ListAdRow config={adsConfig} index={0} colSpan={6} lead />
              )}
              {list.map((m, i) => {
                const position = i + 1;
                return (
                  <Fragment key={m.id}>
                    <tr>
                      <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>{position}</td>
                      <td style={{ width: 36, paddingRight: 8 }}>
                        <DAvatar src={m.avatarUrl} name={m.displayName} size={24} />
                      </td>
                      <td className="gb-member-name-cell">
                        <div className="gb-member-name-line">
                          <Link to={memberPath(m.username)} className="gb-col-name gb-member-name-link" style={{ color: "var(--gb-green)" }}>
                            {m.displayName}
                          </Link>
                          {ROLE_LABEL[m.role] && (
                            <span className="gb-member-role-label" style={{ fontSize: 11, color: ROLE_COLOR[m.role], marginLeft: 6, fontWeight: 700 }}>
                              {ROLE_LABEL[m.role]}
                            </span>
                          )}
                        </div>
                        <div className="gb-member-handle-line">@{m.username}</div>
                      </td>
                      <td style={{ textAlign: "right", paddingRight: 16, color: "var(--gb-aqua)", fontSize: 13 }}>{m.postCount}</td>
                      <td className="gb-col-threads" style={{ textAlign: "right", paddingRight: 16, color: "var(--gb-fg4)", fontSize: 13 }}>{m.threadCount}</td>
                      <td className="gb-col-joined" style={{ textAlign: "right", paddingRight: 12, color: "var(--gb-gray)", fontSize: 12 }}>
                        {new Date(m.createdAt).toLocaleDateString("en-GB")}
                      </td>
                    </tr>
                    {shouldShowListAd(adsConfig, position, list.length, "user") && (
                      <ListAdRow config={adsConfig} index={position} colSpan={6} />
                    )}
                  </Fragment>
                );
              })}
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
              {isFetchingNextPage && (
                <tr>
                  <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16 }}>~</td>
                  <td colSpan={5} style={{ color: "var(--gb-gray)" }}>loading more...</td>
                </tr>
              )}
              {hasNextPage && !isFetchingNextPage && (
                <tr>
                  <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16 }}>+</td>
                  <td colSpan={5}>
                    <button className="gb-btn" type="button" onClick={() => void fetchNextPage()}>
                      $ load more members
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
