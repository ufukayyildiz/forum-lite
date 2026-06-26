import { Pin, Lock } from "lucide-react";
import { relativeTime, formatCount } from "../lib/utils";
import { categoryPath } from "../lib/routes";
import type { Thread } from "../lib/api";
import { Link } from "react-router-dom";
import { ThreadLink } from "./ThreadLink";

interface Props {
  thread: Thread;
  showCategory?: boolean;
  lineNum: number;
}

export function TopicRow({ thread, showCategory = true, lineNum }: Props) {
  const catColor = thread.category.color ?? "var(--gb-fg4)";

  return (
    <tr>
      <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, width: 48, userSelect: "none", fontSize: 12 }}>{lineNum}</td>
      <td style={{ paddingRight: 4, width: 20 }}>
        {thread.pinned && <Pin size={11} style={{ color: "var(--gb-yellow)" }} />}
        {thread.locked && !thread.pinned && <Lock size={11} style={{ color: "var(--gb-gray)" }} />}
        {!thread.pinned && !thread.locked && <span style={{ color: "var(--gb-green)", fontSize: 13 }}>#</span>}
      </td>
      <td style={{ minWidth: 0, paddingRight: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <ThreadLink
            thread={thread}
            className="gb-col-name"
            style={{ color: thread.pinned ? "var(--gb-yellow)" : "var(--gb-fg)", fontWeight: thread.pinned ? 600 : 400 }}
          >
            {thread.title}
          </ThreadLink>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 2, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "var(--gb-gray)" }}>by {thread.author.displayName}</span>
          {showCategory && (
            <Link
              to={categoryPath(thread.category)}
              className="gb-cat"
              style={{ borderColor: catColor, fontSize: 11 }}
              title={thread.category.name}
            >
              {thread.category.name.toLowerCase()}
            </Link>
          )}
          {thread.tags?.map((t) => (
            <Link key={t.id} to={`/tag/${t.slug}`} className="gb-tag">{t.name}</Link>
          ))}
        </div>
      </td>
      <td style={{ textAlign: "right", paddingRight: 16, whiteSpace: "nowrap" }}>
        <span style={{ color: thread.replyCount > 0 ? "var(--gb-aqua)" : "var(--gb-gray)", fontSize: 13 }}>{formatCount(thread.replyCount)}</span>
        <div style={{ fontSize: 10, color: "var(--gb-gray)" }}>REPLIES</div>
      </td>
      <td className="gb-col-views" style={{ textAlign: "right", paddingRight: 16, whiteSpace: "nowrap" }}>
        <span style={{ color: "var(--gb-fg4)", fontSize: 13 }}>{formatCount(thread.views)}</span>
        <div style={{ fontSize: 10, color: "var(--gb-gray)" }}>VIEWS</div>
      </td>
      <td className="gb-col-modified" style={{ textAlign: "right", paddingRight: 12, whiteSpace: "nowrap", color: "var(--gb-gray)", fontSize: 12 }}>
        {relativeTime(thread.lastPostAt || thread.createdAt)}
      </td>
    </tr>
  );
}

export function EmptyRows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <tr key={"empty-" + i} className="empty-row">
          <td style={{ color: "var(--gb-bg3)", textAlign: "right", paddingRight: 16, width: 48, fontSize: 12, paddingTop: 2, paddingBottom: 2 }}>~</td>
          <td colSpan={5} />
        </tr>
      ))}
    </>
  );
}
