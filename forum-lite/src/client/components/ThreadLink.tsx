import type React from "react";
import { useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api, type Thread } from "../lib/api";
import { threadPath } from "../lib/routes";

type ThreadLike = {
  id?: number | string;
  publicId?: number | string | null;
  title?: string;
  category?: unknown;
  author?: unknown;
};

type Props = {
  thread: ThreadLike;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
};

const NAVIGATION_WARMUP_MS = 420;
const THREAD_STALE_TIME = 5 * 60_000;

function isFullThread(thread: ThreadLike): thread is Thread {
  return !!thread.category && !!thread.author;
}

function isPlainNavigation(event: React.MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

export function ThreadLink({ thread, children, className, style, onClick }: Props) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const warmupRef = useRef<Promise<void> | null>(null);
  const path = threadPath(thread);
  const routeId = String(thread.publicId ?? thread.id);

  function warmThreadBundle() {
    if (!routeId) return Promise.resolve();
    if (warmupRef.current) return warmupRef.current;

    warmupRef.current = (async () => {
      const cached = qc.getQueryData<Thread>(["thread", routeId]);
      const detail = cached?.content
        ? cached
        : await qc.fetchQuery({
            queryKey: ["thread", routeId],
            queryFn: () => api.thread(routeId),
            staleTime: THREAD_STALE_TIME,
          });

      if (detail?.id) {
        await qc.prefetchQuery({
          queryKey: ["posts", detail.id, "all"],
          queryFn: () => api.posts(detail.id, { all: 1 }),
          staleTime: THREAD_STALE_TIME,
        });
      }
    })()
      .catch(() => undefined)
      .finally(() => {
        warmupRef.current = null;
      });

    return warmupRef.current;
  }

  async function handleClick(event: React.MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || !isPlainNavigation(event)) return;

    event.preventDefault();
    await Promise.race([warmThreadBundle(), wait(NAVIGATION_WARMUP_MS)]);

    const warmed = qc.getQueryData<Thread>(["thread", routeId]);
    navigate(path, {
      state: { threadPreview: warmed ?? (isFullThread(thread) ? thread : undefined) },
    });
  }

  return (
    <Link
      to={path}
      state={isFullThread(thread) ? { threadPreview: thread } : undefined}
      className={className}
      style={style}
      onClick={handleClick}
      onFocus={warmThreadBundle}
      onPointerEnter={warmThreadBundle}
      onPointerDown={warmThreadBundle}
      onTouchStart={warmThreadBundle}
    >
      {children}
    </Link>
  );
}
