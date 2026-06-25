import { Link } from "react-router-dom";
import { MessageSquare, Eye, Pin, Lock } from "lucide-react";
import { Avatar } from "./ui/avatar";
import { Badge } from "./ui/badge";
import { relativeTime } from "../lib/utils";
import { categoryPath } from "../lib/routes";
import type { Thread } from "../lib/api";
import { ThreadLink } from "./ThreadLink";

export function ThreadCard({ thread }: { thread: Thread }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3.5 border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-accent)]/30 transition-colors">
      <Avatar src={thread.author.avatarUrl} name={thread.author.displayName} size="sm" className="mt-0.5 flex-shrink-0" />

      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2 flex-wrap">
          {thread.pinned && <Pin size={13} className="text-[var(--color-primary)] mt-0.5 flex-shrink-0" />}
          {thread.locked && <Lock size={13} className="text-[var(--color-muted-foreground)] mt-0.5 flex-shrink-0" />}
          <ThreadLink
            thread={thread}
            className="text-sm font-medium hover:text-[var(--color-primary)] transition-colors leading-snug break-words min-w-0"
          >
            {thread.title}
          </ThreadLink>
        </div>

        <div className="mt-1 flex items-center gap-3 text-xs text-[var(--color-muted-foreground)] flex-wrap">
          <Link to={`/u/${thread.author.username}`} className="hover:text-[var(--color-foreground)]">
            {thread.author.displayName}
          </Link>
          <span>{relativeTime(thread.createdAt)}</span>
          <Link
            to={categoryPath(thread.category)}
            className="hidden sm:inline-flex items-center gap-1 hover:text-[var(--color-foreground)]"
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: thread.category.color }} />
            {thread.category.name}
          </Link>
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs text-[var(--color-muted-foreground)] flex-shrink-0 ml-2">
        <span className="flex items-center gap-1">
          <MessageSquare size={13} /> {thread.replyCount}
        </span>
        <span className="hidden sm:flex items-center gap-1">
          <Eye size={13} /> {thread.views}
        </span>
        <span className="hidden md:block text-right min-w-[70px]">{relativeTime(thread.lastPostAt)}</span>
      </div>
    </div>
  );
}
