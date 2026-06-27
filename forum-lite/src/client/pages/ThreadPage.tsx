import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useState, useRef } from "react";
import { Heart, Reply, Pin, Lock, Star, Edit, Trash2, Paperclip } from "lucide-react";
import { api, type Post, type Thread } from "../lib/api";
import { DAvatar } from "../components/DAvatar";
import { useMe } from "../lib/useAuth";
import { relativeTime, formatDate } from "../lib/utils";
import { GbToolbar } from "../components/layout/Header";
import { SEOHead } from "../components/SEOHead";
import { AdSlot } from "../components/AdSlot";
import { MarkdownContent } from "../components/MarkdownContent";
import { categoryPath, threadPath } from "../lib/routes";
import { activeAdInterval } from "../lib/ads";
import { toast } from "sonner";
import { useConfirm } from "../components/ConfirmDialog";

const TOOLS: [string, string, string][] = [
  ["**", "**", "bold"], ["_", "_", "italic"], ["`", "`", "code"],
  ["\n\n```\n", "\n```\n", "block"], ["\n> ", "\n", "quote"], ["\n- ", "", "list"],
];
const ATTACH_ACCEPT = "image/jpeg,image/png,image/gif,image/webp,application/pdf";

function isThreadPreview(value: any): value is Thread {
  return !!value && typeof value === "object" && !!value.id && !!value.category && !!value.author;
}

function findCachedThreadPreview(qc: QueryClient, id: string | undefined): Thread | undefined {
  if (!id) return undefined;
  const queries = qc.getQueryCache().findAll();
  for (const query of queries) {
    const data: any = query.state.data;
    const rows = Array.isArray(data?.threads) ? data.threads : Array.isArray(data) ? data : [];
    const found = rows.find((thread: any) => {
      if (!isThreadPreview(thread)) return false;
      return String(thread.publicId) === id || String(thread.id) === id;
    });
    if (found) return found;
  }
  return undefined;
}

function markdownLabel(label: string): string {
  return label.replace(/([\\[\]])/g, "\\$1");
}

function dateMs(value: string | number | null | undefined): number {
  if (!value) return NaN;
  if (typeof value === "number") return value > 1e10 ? value : value * 1000;
  return Date.parse(value);
}

function newestIso(...values: Array<string | number | null | undefined>): string {
  let newest = "";
  let newestMs = NaN;
  for (const value of values) {
    const ms = dateMs(value);
    if (!Number.isNaN(ms) && (Number.isNaN(newestMs) || ms > newestMs)) {
      newest = typeof value === "number" ? new Date(ms).toISOString() : String(value);
      newestMs = ms;
    }
  }
  return new Date(newestMs).toISOString();
}

function isMeaningfullyEdited(createdAt: string, updatedAt?: string | null): boolean {
  const createdMs = dateMs(createdAt);
  const updatedMs = dateMs(updatedAt);
  return !Number.isNaN(createdMs) && !Number.isNaN(updatedMs) && updatedMs - createdMs > 1000;
}

function useAttachmentUploader(
  taRef: React.RefObject<HTMLTextAreaElement | null>,
  getValue: () => string,
  setValue: (v: string) => void
) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function trigger() { fileRef.current?.click(); }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await api.uploadAttachment(file);
      const ta = taRef.current;
      const cur = getValue();
      const pos = ta ? ta.selectionStart ?? cur.length : cur.length;
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      const label = markdownLabel(file.name || (isPdf ? "attachment.pdf" : "image"));
      const md = isPdf ? `\n[${label}](${url} "pdf")\n` : `\n![${label}](${url})\n`;
      const next = cur.slice(0, pos) + md + cur.slice(pos);
      setValue(next);
      setTimeout(() => {
        if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = pos + md.length; }
      }, 0);
      toast.success(isPdf ? "PDF uploaded" : "Image uploaded");
    } catch (err: any) {
      toast.error(err.message ?? "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const input = (
    <input ref={fileRef} type="file" accept={ATTACH_ACCEPT}
      style={{ display: "none" }} onChange={onFile} />
  );

  return { trigger, uploading, input };
}

function PostItem({ post, threadId, onQuote }: {
  post: Post; threadId: number;
  onQuote: (content: string, author: string) => void;
}) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(post.content);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const { ask: askConfirm, dialog: confirmDialog } = useConfirm();

  const like = useMutation({
    mutationFn: () => api.likePost(post.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["posts", threadId, "all"] }),
    onError: (e: any) => toast.error(e.message ?? "Like failed"),
  });
  const update = useMutation({
    mutationFn: () => api.updatePost(post.id, content),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["posts", threadId, "all"] }); setEditing(false); toast.success("Updated"); },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: () => api.deletePost(post.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["posts", threadId, "all"] }); toast.success("Deleted"); },
  });

  const canEdit = me && (me.id === post.author.id || me.role !== "member");
  const fileUp = useAttachmentUploader(taRef, () => content, setContent);

  function insertTool(before: string, after: string) {
    const ta = taRef.current; if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = content.slice(s, e);
    setContent(content.slice(0, s) + before + sel + after + content.slice(e));
    setTimeout(() => { ta.selectionStart = s + before.length; ta.selectionEnd = s + before.length + sel.length; ta.focus(); }, 0);
  }

  return (
    <>
    <div className="gb-post" style={{ padding: "12px 20px" }}>
      <div style={{ flexShrink: 0 }}>
        <Link to={`/u/${post.author.username}`}>
          <DAvatar src={post.author.avatarUrl} name={post.author.displayName} size={32} />
        </Link>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="gb-post-meta">
          <Link to={`/u/${post.author.username}`} className="gb-post-author" style={{ textDecoration: "none" }}>
            {post.author.displayName}
          </Link>
          {post.author.role === "admin" && <span className="gb-post-role-admin">[admin]</span>}
          {post.author.role === "moderator" && <span className="gb-post-role-mod">[mod]</span>}
          <span style={{ fontSize: 11, color: "var(--gb-gray)", fontFamily: "inherit" }}>{post.author.postCount} posts</span>
          <span className="gb-post-time" title={formatDate(post.createdAt)}>
            {relativeTime(post.createdAt)}
            {post.editedAt && (
              <span style={{ color: "var(--gb-gray)", marginLeft: 4 }} title={`edited ${formatDate(post.editedAt)}`}>
                (edited {relativeTime(post.editedAt)})
              </span>
            )}
          </span>
        </div>

        {editing ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="gb-composer-bar">
              {TOOLS.map(([b, a, l]) => (
                <button key={l} className="gb-composer-btn" onClick={() => insertTool(b, a)}>{l}</button>
              ))}
              <button className="gb-composer-btn" onClick={fileUp.trigger} disabled={fileUp.uploading} title="Upload image or PDF">
                <Paperclip size={11} style={{ verticalAlign: "middle" }} />{fileUp.uploading ? " ..." : " file"}
              </button>
              {fileUp.input}
            </div>
            <textarea ref={taRef} className="gb-input" value={content} onChange={(e) => setContent(e.target.value)} rows={6} />
            <div style={{ display: "flex", gap: 6 }}>
              <button className="gb-btn gb-btn-primary" style={{ padding: "3px 12px" }} onClick={() => update.mutate()}>save</button>
              <button className="gb-btn" style={{ padding: "3px 12px" }} onClick={() => { setEditing(false); setContent(post.content); }}>cancel</button>
            </div>
          </div>
        ) : (
          <MarkdownContent content={post.content} />
        )}

        <div className="gb-post-actions">
          {me ? (
            <button className={`gb-post-action${post.likedByMe ? " liked" : ""}`} onClick={() => like.mutate()} disabled={like.isPending}>
              <Heart size={12} fill={post.likedByMe ? "currentColor" : "none"} />
              {post.likeCount > 0 && <span>{post.likeCount}</span>}
            </button>
          ) : post.likeCount > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: "var(--gb-gray)", padding: "2px 8px" }}>
              <Heart size={11} /> {post.likeCount}
            </span>
          )}
          {me && (
            <button className="gb-post-action" onClick={() => onQuote(post.content, post.author.displayName)}>
              <Reply size={12} /> quote
            </button>
          )}
          {canEdit && !editing && (
            <>
              <button className="gb-post-action" onClick={() => setEditing(true)}><Edit size={12} /> edit</button>
              <button className="gb-post-action" style={{ color: "var(--gb-red)" }}
                onClick={() => askConfirm("Delete this post?", () => del.mutate(), { danger: true, confirmLabel: "delete" })}>
                <Trash2 size={12} /> del
              </button>
            </>
          )}
        </div>
      </div>
    </div>
    {confirmDialog}
    </>
  );
}

export default function ThreadPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [reply, setReply] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [threadEditing, setThreadEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const replyRef = useRef<HTMLTextAreaElement>(null);
  const threadEditRef = useRef<HTMLTextAreaElement>(null);
  const replyFileUp = useAttachmentUploader(replyRef, () => reply, setReply);
  const threadFileUp = useAttachmentUploader(threadEditRef, () => editContent, setEditContent);
  const { ask: askThreadConfirm, dialog: threadConfirmDialog } = useConfirm();
  const threadPreview = (location.state as { threadPreview?: Thread } | null)?.threadPreview;
  const matchingPreview =
    threadPreview && id && (String(threadPreview.publicId) === id || String(threadPreview.id) === id)
      ? threadPreview
      : undefined;
  const cachedPreview = matchingPreview ?? findCachedThreadPreview(qc, id);

  const { data: thread, isLoading, isPlaceholderData } = useQuery({
    queryKey: ["thread", id],
    queryFn: () => api.thread(id!),
    enabled: !!id,
    placeholderData: () => cachedPreview,
  });
  const { data: postsData, isLoading: pLoading } = useQuery({
    queryKey: ["posts", thread?.id, "all"],
    queryFn: () => api.posts(thread!.id, { all: 1 }),
    enabled: !!thread?.id,
  });
  const { data: adsConfig } = useQuery({
    queryKey: ["ads-config"],
    queryFn: api.adsConfig,
  });
  const postReply = useMutation({
    mutationFn: () => api.createPost({ threadId: thread!.id, content: reply }),
    onSuccess: () => {
      setReply(""); setComposerOpen(false);
      qc.invalidateQueries({ queryKey: ["posts", thread?.id] });
      qc.invalidateQueries({ queryKey: ["thread", id] });
      toast.success("Reply posted");
    },
    onError: (e: any) => toast.error(e.message),
  });
  const updateThread = useMutation({
    mutationFn: () => api.updateThread(thread!.publicId, { title: editTitle, content: editContent }),
    onSuccess: () => {
      setThreadEditing(false);
      qc.invalidateQueries({ queryKey: ["thread", id] });
      toast.success("Thread updated");
    },
    onError: (e: any) => toast.error(e.message),
  });
  const deleteThread = useMutation({
    mutationFn: () => api.deleteThread(thread!.publicId),
    onSuccess: () => {
      toast.success("Thread deleted");
      navigate(thread ? categoryPath(thread.category) : "/");
    },
    onError: (e: any) => toast.error(e.message),
  });

  function startThreadEdit() {
    if (!thread) return;
    setEditTitle(thread.title);
    setEditContent(thread.content || "");
    setThreadEditing(true);
    setTimeout(() => threadEditRef.current?.focus(), 50);
  }

  function handleQuote(content: string, author: string) {
    const q = `> **${author}:**\n> ${content.split("\n").join("\n> ")}\n\n`;
    setReply((prev) => {
      // Quote goes at the bottom; user types above it
      if (!prev.trim()) return "\n\n" + q;
      return prev.trimEnd() + "\n\n" + q;
    });
    setComposerOpen(true);
    setTimeout(() => {
      const ta = replyRef.current;
      if (ta) { ta.focus(); ta.selectionStart = 0; ta.selectionEnd = 0; }
    }, 100);
  }

  function insertTool(before: string, after: string) {
    const ta = replyRef.current; if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = reply.slice(s, e);
    setReply(reply.slice(0, s) + before + sel + after + reply.slice(e));
    setTimeout(() => { ta.selectionStart = s + before.length; ta.selectionEnd = s + before.length + sel.length; ta.focus(); }, 0);
  }

  const canMod = me && (me.role === "admin" || me.role === "moderator");
  const adInterval = activeAdInterval(adsConfig, "post");

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  if (isLoading && !thread) return (
    <>
      <SEOHead title="Loading..." noindex={true} />
      <GbToolbar crumbs={[{ label: "thread" }]} />
      <div className="gb-state-pad" aria-busy="true" />
    </>
  );
  if (!thread) return (
    <>
      <SEOHead title="Not Found" noindex={true} />
      <GbToolbar crumbs={[{ label: "error" }]} />
      <div className="gb-state-pad" style={{ color: "var(--gb-red)" }}>error: thread not found</div>
    </>
  );

  const currentThreadPath = threadPath(thread);
  const currentCategoryPath = categoryPath(thread.category);
  const threadUrl = `${origin}${currentThreadPath}`;
  const threadDesc = (thread.content ?? "").replace(/[#*`>_]/g, "").slice(0, 160).trim();
  const threadEdited = isMeaningfullyEdited(thread.createdAt, thread.updatedAt) ? thread.updatedAt : null;

  return (
    <>
      <SEOHead
        title={thread.title}
        description={threadDesc || `${thread.title} — Forum thread with ${thread.replyCount} replies.`}
        canonical={currentThreadPath}
        image={`${origin}/og/thread/${thread.publicId}.webp`}
        type="article"
        breadcrumbs={[
          { name: "Forum", url: origin + "/" },
          { name: thread.category.name, url: `${origin}${currentCategoryPath}` },
          { name: thread.title, url: threadUrl },
        ]}
        structuredData={[
          {
            "@context": "https://schema.org",
            "@type": "DiscussionForumPosting",
            "@id": threadUrl,
            url: threadUrl,
            mainEntityOfPage: threadUrl,
            headline: thread.title,
            text: threadDesc || thread.title,
            datePublished: new Date(typeof thread.createdAt === "number" ? thread.createdAt * 1000 : thread.createdAt).toISOString(),
            dateModified: newestIso(thread.updatedAt, thread.lastPostAt, thread.createdAt),
            inLanguage: "en-US",
            articleSection: thread.category.name,
            interactionStatistic: [
              { "@type": "InteractionCounter", interactionType: "https://schema.org/ReplyAction", userInteractionCount: thread.replyCount },
              { "@type": "InteractionCounter", interactionType: "https://schema.org/ViewAction", userInteractionCount: thread.views },
            ],
            author: {
              "@type": "Person",
              name: thread.author.displayName,
              url: `${origin}/u/${thread.author.username}`,
            },
            isPartOf: {
              "@type": "WebPage",
              "@id": `${origin}${currentCategoryPath}`,
              name: thread.category.name,
            },
            keywords: thread.tags?.map((t) => t.name).join(", ") || undefined,
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Forum", item: origin + "/" },
              { "@type": "ListItem", position: 2, name: thread.category.name, item: `${origin}${currentCategoryPath}` },
              { "@type": "ListItem", position: 3, name: thread.title, item: threadUrl },
            ],
          },
        ]}
      />
      {threadConfirmDialog}
      <GbToolbar
        crumbs={[
          { label: thread.category.name.toLowerCase(), href: currentCategoryPath },
          { label: thread.title },
        ]}
        actions={
          canMod ? (
            <div style={{ display: "flex", gap: 2 }}>
              <button className="gb-btn-icon" title="Pin" onClick={() => api.pinThread(thread.publicId).then(() => { qc.invalidateQueries({ queryKey: ["thread", id] }); toast.success("Updated"); })}>
                <Pin size={14} style={{ color: thread.pinned ? "var(--gb-yellow)" : undefined }} />
              </button>
              <button className="gb-btn-icon" title="Lock" onClick={() => api.lockThread(thread.publicId).then(() => { qc.invalidateQueries({ queryKey: ["thread", id] }); toast.success("Updated"); })}>
                <Lock size={14} style={{ color: thread.locked ? "var(--gb-orange)" : undefined }} />
              </button>
              <button className="gb-btn-icon" title="Feature" onClick={() => api.featureThread(thread.publicId).then(() => { qc.invalidateQueries({ queryKey: ["thread", id] }); toast.success("Updated"); })}>
                <Star size={14} style={{ color: thread.featured ? "var(--gb-yellow)" : undefined }} />
              </button>
              <button className="gb-btn-icon" title="Edit thread" onClick={startThreadEdit}>
                <Edit size={14} style={{ color: threadEditing ? "var(--gb-yellow)" : undefined }} />
              </button>
              <button className="gb-btn-icon" title="Delete thread" style={{ color: "var(--gb-red)" }}
                onClick={() => askThreadConfirm("Delete this thread?", () => deleteThread.mutate(), { danger: true, confirmLabel: "delete" })}>
                <Trash2 size={14} />
              </button>
            </div>
          ) : undefined
        }
      />

      <div className="gb-content" style={{ padding: "0 20px 20px" }}>
        {/* Thread meta bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "8px 0", borderBottom: "1px solid var(--gb-bg2)", fontSize: 12, color: "var(--gb-gray)", flexWrap: "wrap" }}>
          <span>by <Link to={`/u/${thread.author.username}`} style={{ color: "var(--gb-green)" }}>{thread.author.displayName}</Link></span>
          <span>{formatDate(thread.createdAt)}</span>
          {threadEdited && <span title={formatDate(threadEdited)}>edited {relativeTime(threadEdited)}</span>}
          <span style={{ color: "var(--gb-aqua)" }}>{thread.replyCount} replies</span>
          <span>{thread.views} views</span>
          {thread.locked && <span style={{ color: "var(--gb-orange)", fontWeight: 700 }}>[LOCKED]</span>}
          {thread.pinned && <span style={{ color: "var(--gb-yellow)", fontWeight: 700 }}>[PINNED]</span>}
          {thread.tags?.map((t) => (
            <Link key={t.id} to={`/tag/${t.slug}`} className="gb-tag">{t.name}</Link>
          ))}
        </div>

        {adsConfig?.enabled && (
          <div className="gb-thread-sticky-ad">
            <AdSlot config={adsConfig} index={0} height={100} />
          </div>
        )}

        {/* OP post */}
        <div style={{ borderBottom: "1px solid var(--gb-bg2)" }}>
          <div className="gb-post" style={{ padding: "12px 20px" }}>
            <div style={{ flexShrink: 0 }}>
              <Link to={`/u/${thread.author.username}`}>
                <DAvatar src={thread.author.avatarUrl} name={thread.author.displayName} size={32} />
              </Link>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="gb-post-meta">
                <Link to={`/u/${thread.author.username}`} className="gb-post-author" style={{ textDecoration: "none" }}>
                  {thread.author.displayName}
                </Link>
                {(thread.author.role === "admin" || thread.author.role === "moderator") && (
                  <span className={thread.author.role === "admin" ? "gb-post-role-admin" : "gb-post-role-mod"}>
                    [{thread.author.role}]
                  </span>
                )}
                <span className="gb-post-time">
                  {formatDate(thread.createdAt)}
                  {threadEdited && (
                    <span style={{ color: "var(--gb-gray)", marginLeft: 4 }} title={`edited ${formatDate(threadEdited)}`}>
                      (edited {relativeTime(threadEdited)})
                    </span>
                  )}
                </span>
              </div>
              {threadEditing ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <input className="gb-input" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} maxLength={200} />
                  <div className="gb-composer-bar">
                    {TOOLS.map(([b, a, l]) => (
                      <button key={l} className="gb-composer-btn" onClick={() => {
                        const ta = threadEditRef.current; if (!ta) return;
                        const s = ta.selectionStart, end = ta.selectionEnd;
                        const sel = editContent.slice(s, end);
                        setEditContent(editContent.slice(0, s) + b + sel + a + editContent.slice(end));
                        setTimeout(() => { ta.selectionStart = s + b.length; ta.selectionEnd = s + b.length + sel.length; ta.focus(); }, 0);
                      }}>{l}</button>
                    ))}
                    <button className="gb-composer-btn" onClick={threadFileUp.trigger} disabled={threadFileUp.uploading} title="Upload image or PDF">
                      <Paperclip size={11} style={{ verticalAlign: "middle" }} />{threadFileUp.uploading ? " ..." : " file"}
                    </button>
                    {threadFileUp.input}
                  </div>
                  <textarea ref={threadEditRef} className="gb-input" value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={10} />
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button className="gb-btn gb-btn-primary" style={{ padding: "3px 12px" }}
                      onClick={() => updateThread.mutate()}
                      disabled={updateThread.isPending || editTitle.trim().length < 5 || editContent.trim().length < 2}>
                      {updateThread.isPending ? "saving..." : "save thread"}
                    </button>
                    <button className="gb-btn" style={{ padding: "3px 12px" }} onClick={() => setThreadEditing(false)}>cancel</button>
                  </div>
                </div>
              ) : isPlaceholderData && !thread.content ? (
                <div style={{ minHeight: 24 }} aria-busy="true" />
              ) : (
                <MarkdownContent content={thread.content || ""} />
              )}
              <div className="gb-post-actions">
                {me && !thread.locked && (
                  <button className="gb-post-action" onClick={() => handleQuote(thread.content || "", thread.author.displayName)}>
                    <Reply size={12} /> quote
                  </button>
                )}
                {canMod && !threadEditing && (
                  <>
                    <button className="gb-post-action" onClick={startThreadEdit}><Edit size={12} /> edit thread</button>
                    <button className="gb-post-action" style={{ color: "var(--gb-red)" }}
                      onClick={() => askThreadConfirm("Delete this thread?", () => deleteThread.mutate(), { danger: true, confirmLabel: "delete" })}>
                      <Trash2 size={12} /> del thread
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
        {adsConfig?.enabled && adInterval === 1 && <AdSlot config={adsConfig} index={1} />}

        {/* Replies */}
        {pLoading && !postsData && <div style={{ minHeight: 32 }} aria-busy="true" />}

        {!pLoading && postsData && postsData.posts.length > 0 && (
          <div style={{ borderBottom: "1px solid var(--gb-bg2)" }}>
            {postsData.posts.map((p, i) => {
              const absolutePostNumber = 2 + i;
              return (
                <div key={p.id}>
                  <PostItem post={p} threadId={thread.id} onQuote={handleQuote} />
                  {adsConfig?.enabled && absolutePostNumber % adInterval === 0 && (
                    <AdSlot config={adsConfig} index={absolutePostNumber} />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Reply box */}
        {me && !thread.locked && (
          <div style={{ marginTop: 16 }}>
            {!composerOpen ? (
              <button className="gb-btn gb-btn-primary" style={{ width: "100%", justifyContent: "center", padding: "8px" }}
                onClick={() => { setComposerOpen(true); setTimeout(() => replyRef.current?.focus(), 100); }}>
                <Reply size={14} /> $ put reply
              </button>
            ) : (
              <div style={{ background: "var(--gb-bg1)", border: "1px solid var(--gb-bg2)" }}>
                <div className="gb-composer-bar">
                  {TOOLS.map(([b, a, l]) => (
                    <button key={l} className="gb-composer-btn" onClick={() => insertTool(b, a)}>{l}</button>
                  ))}
                  <button className="gb-composer-btn" onClick={replyFileUp.trigger} disabled={replyFileUp.uploading} title="Upload image or PDF">
                    <Paperclip size={11} style={{ verticalAlign: "middle" }} />{replyFileUp.uploading ? " ..." : " file"}
                  </button>
                  {replyFileUp.input}
                </div>
                <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                  <textarea ref={replyRef} className="gb-input" placeholder="$ write reply... (markdown supported)"
                    value={reply} onChange={(e) => setReply(e.target.value)} rows={6} />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="gb-btn gb-btn-primary" onClick={() => postReply.mutate()} disabled={postReply.isPending || reply.trim().length < 2}>
                      {postReply.isPending ? "posting..." : "$ post"}
                    </button>
                    <button className="gb-btn" onClick={() => { setComposerOpen(false); setReply(""); }}>cancel</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {me && thread.locked && me.role === "member" && (
          <div style={{ marginTop: 16, padding: 12, background: "rgba(251,73,52,.06)", border: "1px solid rgba(251,73,52,.2)", color: "var(--gb-red)", fontSize: 12 }}>
            error: thread is locked — replies disabled
          </div>
        )}

        {!me && (
          <div style={{ marginTop: 16, padding: 14, background: "var(--gb-bg1)", border: "1px solid var(--gb-bg2)", textAlign: "center", fontSize: 12, color: "var(--gb-gray)" }}>
            <Link to="/login" style={{ color: "var(--gb-yellow)" }}>$ login</Link> or <Link to="/register" style={{ color: "var(--gb-yellow)" }}>$ register</Link> to reply
          </div>
        )}
      </div>
    </>
  );
}
