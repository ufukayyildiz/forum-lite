import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Edit2 } from "lucide-react";
import { api } from "../lib/api";
import { DAvatar } from "../components/DAvatar";
import { useMe } from "../lib/useAuth";
import { relativeTime, formatDate } from "../lib/utils";
import { GbToolbar } from "../components/layout/Header";
import { SEOHead } from "../components/SEOHead";
import { categoryPathFromRow } from "../lib/routes";
import { toast } from "sonner";
import { ThreadLink } from "../components/ThreadLink";

const ROLE_LABEL: Record<string, string> = { admin: "[admin]", moderator: "[mod]", member: "[member]" };
const ROLE_COLOR: Record<string, string> = { admin: "var(--gb-red)", moderator: "var(--gb-blue)", member: "var(--gb-gray)" };
const VISIBLE_ROWS = 15;
type ActivityTab = "threads" | "replies" | "about";

function previewText(input: string | null | undefined): string {
  const text = (input ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[[^\]]+\]\([^)]*\)/g, " ")
    .replace(/[`*_>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 150 ? text.slice(0, 147) + "..." : text || "reply";
}

export default function MemberPage() {
  const { username } = useParams<{ username: string }>();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [tab, setTab] = useState<ActivityTab>("threads");
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");

  const activityTab = tab === "replies" ? "replies" : "threads";
  const { data, isLoading } = useQuery({
    queryKey: ["member", username, activityTab, "all"],
    queryFn: () => api.member(username!, { tab: activityTab, all: 1 }),
    enabled: !!username,
  });

  const update = useMutation({
    mutationFn: () => api.updateMember(username!, { displayName, bio, avatarUrl }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["member", username] });
      qc.invalidateQueries({ queryKey: ["me"] });
      setEditing(false);
      toast.success("Profile updated");
    },
    onError: (e: any) => toast.error(e.message),
  });

  function startEdit() {
    if (!data) return;
    setDisplayName(data.user.displayName);
    setBio(data.user.bio ?? "");
    setAvatarUrl(data.user.avatarUrl ?? "");
    setEditing(true);
    setTab("about");
  }

  function selectTab(next: ActivityTab) {
    setTab(next);
    if (next !== "about") setEditing(false);
  }

  const u = data?.user;
  const isOwn = me?.username === username;
  const canEdit = isOwn || me?.role === "admin";
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  if (isLoading) return (
    <>
      <SEOHead title={username ?? "Member"} noindex={true} />
      <GbToolbar crumbs={[{ label: "members", href: "/members" }, { label: username ?? "..." }]} />
      <div className="gb-state-pad" style={{ color: "var(--gb-gray)" }}>$ loading...</div>
    </>
  );

  if (!u) return (
    <>
      <SEOHead title="Not Found" noindex={true} />
      <GbToolbar crumbs={[{ label: "members", href: "/members" }, { label: "error" }]} />
      <div className="gb-state-pad" style={{ color: "var(--gb-red)" }}>error: member not found</div>
    </>
  );

  const memberUrl = `${origin}/u/${u.username}`;
  const threads = data?.threads ?? [];
  const replies = data?.replies ?? [];
  const activeRows = tab === "replies" ? replies : threads;
  const emptyCount = Math.max(0, VISIBLE_ROWS - activeRows.length);

  return (
    <>
      <SEOHead
        title={u.displayName}
        description={u.bio ?? `${u.displayName} (@${u.username}) — ${u.postCount} replies, ${u.threadCount} threads.`}
        canonical={`/u/${u.username}`}
        type="profile"
        breadcrumbs={[
          { name: "Forum", url: origin + "/" },
          { name: "Members", url: origin + "/members" },
          { name: u.displayName, url: memberUrl },
        ]}
        structuredData={{
          "@context": "https://schema.org",
          "@type": "ProfilePage",
          "@id": memberUrl,
          url: memberUrl,
          name: u.displayName,
          description: u.bio ?? undefined,
          inLanguage: "en-US",
          dateCreated: new Date(typeof u.createdAt === "number" ? u.createdAt * 1000 : u.createdAt).toISOString(),
          mainEntity: {
            "@type": "Person",
            "@id": memberUrl + "#person",
            name: u.displayName,
            alternateName: u.username,
            url: memberUrl,
            image: u.avatarUrl ?? undefined,
            description: u.bio ?? undefined,
          },
        }}
      />

      <GbToolbar
        crumbs={[{ label: "members", href: "/members" }, { label: u.username }]}
        actions={
          canEdit && !editing ? (
            <button className="gb-btn-icon" onClick={startEdit} title="Edit profile">
              <Edit2 size={14} />
            </button>
          ) : undefined
        }
      />

      {/* Identity row — single line like a file listing */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "8px 20px", borderBottom: "1px solid var(--gb-bg2)",
        background: "var(--gb-bg1)", fontSize: 13,
      }}>
        <DAvatar src={u.avatarUrl} name={u.displayName} size={28} />
        <span style={{ color: "var(--gb-fg)", fontWeight: 600 }}>{u.displayName}</span>
        <span style={{ color: ROLE_COLOR[u.role], fontSize: 12, fontWeight: 700 }}>{ROLE_LABEL[u.role]}</span>
        {u.banned && <span style={{ color: "var(--gb-red)", fontSize: 11, border: "1px solid var(--gb-red)", padding: "0 4px" }}>[banned]</span>}
        <span style={{ color: "var(--gb-gray)", fontSize: 12 }}>@{u.username}</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => selectTab("threads")}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--gb-fg4)", fontSize: 12, fontFamily: "inherit" }}
        >
          {u.threadCount} threads
        </button>
        <button
          onClick={() => selectTab("replies")}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--gb-fg4)", fontSize: 12, fontFamily: "inherit" }}
        >
          {u.postCount} replies
        </button>
        <span style={{ color: "var(--gb-gray)", fontSize: 12 }}>joined {formatDate(u.createdAt)}</span>
      </div>

      {/* Tabs */}
      <div className="gb-tabs">
        {(["threads", "replies", "about"] as const).map((t) => (
          <div key={t} className={`gb-tab-item${tab === t ? " active" : ""}`}
            onClick={() => selectTab(t)}>
            {t === "threads" ? "THREADS" : t === "replies" ? "REPLIES" : "ABOUT"}
          </div>
        ))}
      </div>

      {/* THREADS tab */}
      {tab === "threads" && (
        <div className="gb-content">
          <table className="gb-table">
            <thead>
              <tr>
                <th style={{ textAlign: "right", paddingRight: 16 }}>#</th>
                <th style={{ width: 20 }} />
                <th>NAME</th>
                <th style={{ textAlign: "right", paddingRight: 16 }}>REPLIES</th>
                <th style={{ textAlign: "right", paddingRight: 12 }}>MODIFIED</th>
              </tr>
            </thead>
            <tbody>
              {threads.map((t: any, i: number) => (
                <tr key={t.id}>
                  <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>{i + 1}</td>
                  <td style={{ width: 20 }}><span style={{ color: "var(--gb-green)", fontSize: 13 }}>#</span></td>
                  <td className="gb-topic-cell">
                    <div className="gb-topic-line">
                      <ThreadLink thread={t} className="gb-col-name gb-topic-title" style={{ color: "var(--gb-fg)" }}>{t.title}</ThreadLink>
                      {t.categoryName && (
                        <Link to={categoryPathFromRow(t)} className="gb-cat gb-topic-cat" style={{ fontSize: 11 }}>
                          {t.categoryName.toLowerCase()}
                        </Link>
                      )}
                    </div>
                  </td>
                  <td style={{ textAlign: "right", paddingRight: 16, color: "var(--gb-aqua)", fontSize: 13 }}>
                    {t.replyCount ?? 0}
                  </td>
                  <td style={{ textAlign: "right", paddingRight: 12, color: "var(--gb-gray)", fontSize: 12, whiteSpace: "nowrap" }}>
                    {relativeTime(t.activityAt ?? t.lastPostAt ?? t.createdAt)}
                  </td>
                </tr>
              ))}
              {!threads.length && (
                <tr>
                  <td style={{ color: "var(--gb-bg3)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>~</td>
                  <td colSpan={4} style={{ color: "var(--gb-gray)" }}>no threads yet</td>
                </tr>
              )}
              {Array.from({ length: emptyCount }).map((_, i) => (
                <tr key={"e" + i}>
                  <td style={{ color: "var(--gb-bg3)", textAlign: "right", paddingRight: 16, fontSize: 12, paddingTop: 2, paddingBottom: 2 }}>~</td>
                  <td colSpan={4} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* REPLIES tab */}
      {tab === "replies" && (
        <div className="gb-content">
          <table className="gb-table">
            <thead>
              <tr>
                <th style={{ textAlign: "right", paddingRight: 16 }}>#</th>
                <th style={{ width: 20 }} />
                <th>THREAD</th>
                <th>REPLY</th>
                <th style={{ textAlign: "right", paddingRight: 12 }}>MODIFIED</th>
              </tr>
            </thead>
            <tbody>
              {replies.map((p: any, i: number) => (
                <tr key={p.id}>
                  <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>{i + 1}</td>
                  <td style={{ width: 20 }}><span style={{ color: "var(--gb-aqua)", fontSize: 13 }}>~</span></td>
                  <td className="gb-topic-cell" style={{ minWidth: 0 }}>
                    <div className="gb-topic-line">
                      <ThreadLink thread={{ id: p.threadId, publicId: p.threadPublicId }} className="gb-col-name gb-topic-title" style={{ color: "var(--gb-fg)" }}>{p.threadTitle}</ThreadLink>
                      {p.categoryName && (
                        <Link to={categoryPathFromRow(p)} className="gb-cat gb-topic-cat" style={{ fontSize: 11 }}>
                          {p.categoryName.toLowerCase()}
                        </Link>
                      )}
                    </div>
                  </td>
                  <td style={{ color: "var(--gb-fg4)", fontSize: 12 }}>
                    {previewText(p.content)}
                  </td>
                  <td style={{ textAlign: "right", paddingRight: 12, color: "var(--gb-gray)", fontSize: 12, whiteSpace: "nowrap" }}>
                    {relativeTime(p.createdAt)}
                  </td>
                </tr>
              ))}
              {!replies.length && (
                <tr>
                  <td style={{ color: "var(--gb-bg3)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>~</td>
                  <td colSpan={4} style={{ color: "var(--gb-gray)" }}>no replies yet</td>
                </tr>
              )}
              {Array.from({ length: emptyCount }).map((_, i) => (
                <tr key={"r-e" + i}>
                  <td style={{ color: "var(--gb-bg3)", textAlign: "right", paddingRight: 16, fontSize: 12, paddingTop: 2, paddingBottom: 2 }}>~</td>
                  <td colSpan={4} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ABOUT tab */}
      {tab === "about" && (
        <div className="gb-content">
          {editing ? (
            /* Edit form as table */
            <table className="gb-table">
              <thead>
                <tr>
                  <th style={{ textAlign: "right", paddingRight: 16 }}>#</th>
                  <th style={{ width: 160 }}>KEY</th>
                  <th>VALUE</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { i: 1, key: "--display-name", val: displayName, set: setDisplayName, max: 60, ph: "Display Name" },
                  { i: 2, key: "--avatar-url",   val: avatarUrl,   set: setAvatarUrl,   max: 500, ph: "https://..." },
                ].map(({ i, key, val, set, max, ph }) => (
                  <tr key={key}>
                    <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>{i}</td>
                    <td style={{ color: "var(--gb-gray)", fontSize: 12, paddingRight: 16 }}>{key}</td>
                    <td>
                      <input
                        className="gb-input"
                        value={val}
                        onChange={(e) => set(e.target.value)}
                        maxLength={max}
                        placeholder={ph}
                        style={{ width: "100%", maxWidth: 400 }}
                      />
                    </td>
                  </tr>
                ))}
                <tr>
                  <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>3</td>
                  <td style={{ color: "var(--gb-gray)", fontSize: 12, paddingRight: 16 }}>--bio</td>
                  <td>
                    <textarea
                      className="gb-input"
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      rows={3}
                      maxLength={300}
                      style={{ width: "100%", maxWidth: 400 }}
                    />
                  </td>
                </tr>
                <tr>
                  <td style={{ color: "var(--gb-bg3)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>~</td>
                  <td colSpan={2} style={{ paddingTop: 8 }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="gb-btn gb-btn-primary" style={{ padding: "3px 14px" }}
                        onClick={() => update.mutate()} disabled={update.isPending}>
                        {update.isPending ? "$ saving..." : "$ save"}
                      </button>
                      <button className="gb-btn" style={{ padding: "3px 14px" }}
                        onClick={() => setEditing(false)}>cancel</button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            /* Read-only info table */
            <table className="gb-table">
              <thead>
                <tr>
                  <th style={{ textAlign: "right", paddingRight: 16 }}>#</th>
                  <th style={{ width: 160 }}>KEY</th>
                  <th>VALUE</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { key: "display-name", val: u.displayName, color: "var(--gb-fg)" },
                  { key: "username",     val: "@" + u.username, color: "var(--gb-green)" },
                  { key: "role",         val: ROLE_LABEL[u.role], color: ROLE_COLOR[u.role] },
                  { key: "threads",      val: String(u.threadCount), color: "var(--gb-aqua)" },
                  { key: "replies",      val: String(u.postCount), color: "var(--gb-green)" },
                  { key: "joined",       val: formatDate(u.createdAt), color: "var(--gb-fg4)" },
                  { key: "bio",          val: u.bio ?? "—", color: "var(--gb-fg4)" },
                  { key: "public-id",    val: u.publicId, color: "var(--gb-bg3)" },
                ].map(({ key, val, color }, i) => (
                  <tr key={key}>
                    <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>{i + 1}</td>
                    <td style={{ color: "var(--gb-gray)", fontSize: 12, paddingRight: 16 }}>{key}</td>
                    <td style={{ color, fontSize: 13 }}>{val}</td>
                  </tr>
                ))}
                {Array.from({ length: 4 }).map((_, i) => (
                  <tr key={"e" + i}>
                    <td style={{ color: "var(--gb-bg3)", textAlign: "right", paddingRight: 16, fontSize: 12, paddingTop: 2, paddingBottom: 2 }}>~</td>
                    <td colSpan={2} />
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
