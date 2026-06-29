import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { Edit2 } from "lucide-react";
import { api, type EmailPreferences } from "../lib/api";
import { DAvatar } from "../components/DAvatar";
import { useMe } from "../lib/useAuth";
import { relativeTime, formatDate } from "../lib/utils";
import { GbToolbar } from "../components/layout/Header";
import { SEOHead } from "../components/SEOHead";
import { categoryPathFromRow } from "../lib/routes";
import { toast } from "sonner";
import { ThreadLink } from "../components/ThreadLink";
import { ListAdRow, shouldShowLeadListAd, shouldShowListAd } from "../components/ListAdRow";

const ROLE_LABEL: Record<string, string> = { admin: "[admin]", moderator: "[mod]", member: "[member]" };
const ROLE_COLOR: Record<string, string> = { admin: "var(--gb-red)", moderator: "var(--gb-blue)", member: "var(--gb-gray)" };
const VISIBLE_ROWS = 15;
const DEFAULT_EMAIL_PREFERENCES: EmailPreferences = {
  allEmail: true,
  replyEmail: true,
  likeEmail: true,
  marketingEmail: true,
};
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
  const [email, setEmail] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [emailPreferences, setEmailPreferences] = useState<EmailPreferences>(DEFAULT_EMAIL_PREFERENCES);

  const activityTab = tab === "replies" ? "replies" : "threads";
  const { data, isLoading } = useQuery({
    queryKey: ["member", username, activityTab, "all"],
    queryFn: () => api.member(username!, { tab: activityTab, all: 1 }),
    enabled: !!username,
    placeholderData: (previous) => previous,
    refetchOnMount: false,
  });
  const { data: adsConfig } = useQuery({ queryKey: ["ads-config"], queryFn: api.adsConfig });

  const update = useMutation({
    mutationFn: () => {
      const payload: Parameters<typeof api.updateMember>[1] = { displayName, bio, avatarUrl };
      if (data?.user.email !== undefined) {
        payload.email = email;
        payload.emailPreferences = emailPreferences;
      }
      return api.updateMember(username!, payload);
    },
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
    setEmail(data.user.email ?? "");
    setBio(data.user.bio ?? "");
    setAvatarUrl(data.user.avatarUrl ?? "");
    setEmailPreferences(data.user.emailPreferences ?? DEFAULT_EMAIL_PREFERENCES);
    setEditing(true);
    setTab("about");
  }

  function setEmailPreference(key: keyof EmailPreferences) {
    setEmailPreferences((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function selectTab(next: ActivityTab) {
    setTab(next);
    if (next !== "about") setEditing(false);
  }

  const u = data?.user;
  const isOwn = me?.username === username;
  const canEdit = isOwn || me?.role === "admin";
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  if (isLoading && !data) return (
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
  const hasPrivateEmail = u.email !== undefined;
  const emailStatus = u.emailSuppressedAt ? "suppressed" : u.emailVerifiedAt ? "verified" : "unverified";
  const emailStatusColor =
    emailStatus === "suppressed" ? "var(--gb-red)" : emailStatus === "verified" ? "var(--gb-green)" : "var(--gb-yellow)";
  const aboutRows = [
    { key: "display-name", val: u.displayName, color: "var(--gb-fg)" },
    { key: "username", val: "@" + u.username, color: "var(--gb-green)" },
    ...(hasPrivateEmail ? [
      { key: "email", val: `${u.email} [${emailStatus}]`, color: emailStatusColor },
      { key: "email-all", val: u.emailPreferences?.allEmail ? "on" : "off", color: u.emailPreferences?.allEmail ? "var(--gb-green)" : "var(--gb-red)" },
      { key: "email-replies", val: u.emailPreferences?.replyEmail ? "on" : "off", color: u.emailPreferences?.replyEmail ? "var(--gb-green)" : "var(--gb-red)" },
      { key: "email-likes", val: u.emailPreferences?.likeEmail ? "on" : "off", color: u.emailPreferences?.likeEmail ? "var(--gb-green)" : "var(--gb-red)" },
      { key: "email-marketing", val: u.emailPreferences?.marketingEmail ? "on" : "off", color: u.emailPreferences?.marketingEmail ? "var(--gb-green)" : "var(--gb-red)" },
    ] : []),
    { key: "role", val: ROLE_LABEL[u.role], color: ROLE_COLOR[u.role] },
    { key: "threads", val: String(u.threadCount), color: "var(--gb-aqua)" },
    { key: "replies", val: String(u.postCount), color: "var(--gb-green)" },
    { key: "joined", val: formatDate(u.createdAt), color: "var(--gb-fg4)" },
    { key: "bio", val: u.bio ?? "-", color: "var(--gb-fg4)" },
    { key: "public-id", val: u.publicId, color: "var(--gb-bg3)" },
  ];

  return (
    <>
      <SEOHead
        title={u.displayName}
        description={u.bio ?? `${u.displayName} (@${u.username}) — ${u.postCount} replies, ${u.threadCount} threads.`}
        canonical={`/u/${u.username}`}
        type="profile"
        breadcrumbs={[
          { name: "FSTDESK", url: origin + "/" },
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
      <div className="gb-member-identity" style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "8px 20px", borderBottom: "1px solid var(--gb-bg2)",
        background: "var(--gb-bg1)", fontSize: 13, flexWrap: "wrap",
      }}>
        <DAvatar src={u.avatarUrl} name={u.displayName} size={28} />
        <span className="gb-member-display-name" style={{ color: "var(--gb-fg)", fontWeight: 600 }}>{u.displayName}</span>
        <span style={{ color: ROLE_COLOR[u.role], fontSize: 12, fontWeight: 700 }}>{ROLE_LABEL[u.role]}</span>
        {u.banned && <span style={{ color: "var(--gb-red)", fontSize: 11, border: "1px solid var(--gb-red)", padding: "0 4px" }}>[banned]</span>}
        <span className="gb-member-username" style={{ color: "var(--gb-gray)", fontSize: 12 }}>@{u.username}</span>
        <div className="gb-member-stats">
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
          <table className="gb-table gb-member-threads-table">
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
              {shouldShowLeadListAd(adsConfig, threads.length) && (
                <ListAdRow config={adsConfig} index={0} colSpan={5} lead />
              )}
              {threads.map((t: any, i: number) => {
                const position = i + 1;
                return (
                  <Fragment key={t.id}>
                    <tr>
                      <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>{position}</td>
                      <td style={{ width: 20 }}><span style={{ color: "var(--gb-green)", fontSize: 13 }}>#</span></td>
                      <td className="gb-topic-cell">
                        <div className="gb-topic-line">
                          <ThreadLink thread={t} className="gb-col-name gb-topic-title" style={{ color: "var(--gb-fg)" }}>{t.title}</ThreadLink>
                          {t.categoryName && (
                            <Link to={categoryPathFromRow(t)} className="gb-cat gb-topic-cat" style={{ fontSize: 11 }} title={t.categoryName}>
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
                    {shouldShowListAd(adsConfig, position, threads.length, "topic") && (
                      <ListAdRow config={adsConfig} index={position} colSpan={5} />
                    )}
                  </Fragment>
                );
              })}
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
          <table className="gb-table gb-member-replies-table">
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
              {shouldShowLeadListAd(adsConfig, replies.length) && (
                <ListAdRow config={adsConfig} index={0} colSpan={5} lead />
              )}
              {replies.map((p: any, i: number) => {
                const position = i + 1;
                return (
                  <Fragment key={p.id}>
                    <tr>
                      <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>{position}</td>
                      <td style={{ width: 20 }}><span style={{ color: "var(--gb-aqua)", fontSize: 13 }}>~</span></td>
                      <td className="gb-topic-cell" style={{ minWidth: 0 }}>
                        <div className="gb-topic-line">
                          <ThreadLink thread={{ id: p.threadId, publicId: p.threadPublicId }} className="gb-col-name gb-topic-title" style={{ color: "var(--gb-fg)" }}>{p.threadTitle}</ThreadLink>
                          {p.categoryName && (
                            <Link to={categoryPathFromRow(p)} className="gb-cat gb-topic-cat" style={{ fontSize: 11 }} title={p.categoryName}>
                              {p.categoryName.toLowerCase()}
                            </Link>
                          )}
                        </div>
                      </td>
                      <td className="gb-member-reply-preview" style={{ color: "var(--gb-fg4)", fontSize: 12 }}>
                        {previewText(p.content)}
                      </td>
                      <td style={{ textAlign: "right", paddingRight: 12, color: "var(--gb-gray)", fontSize: 12, whiteSpace: "nowrap" }}>
                        {relativeTime(p.createdAt)}
                      </td>
                    </tr>
                    {shouldShowListAd(adsConfig, position, replies.length, "post") && (
                      <ListAdRow config={adsConfig} index={position} colSpan={5} />
                    )}
                  </Fragment>
                );
              })}
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
            <table className="gb-table gb-member-about-table">
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
                {hasPrivateEmail && (
                  <>
                    <tr>
                      <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>3</td>
                      <td style={{ color: "var(--gb-gray)", fontSize: 12, paddingRight: 16 }}>--email</td>
                      <td>
                        <input
                          className="gb-input"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          maxLength={160}
                          placeholder="you@example.com"
                          style={{ width: "100%", maxWidth: 400 }}
                        />
                      </td>
                    </tr>
                    {([
                      ["allEmail", "--email-all"],
                      ["replyEmail", "--email-replies"],
                      ["likeEmail", "--email-likes"],
                      ["marketingEmail", "--email-marketing"],
                    ] as Array<[keyof EmailPreferences, string]>).map(([key, label], i) => (
                      <tr key={key}>
                        <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>{i + 4}</td>
                        <td style={{ color: "var(--gb-gray)", fontSize: 12, paddingRight: 16 }}>{label}</td>
                        <td>
                          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--gb-fg4)", fontSize: 13 }}>
                            <input
                              type="checkbox"
                              checked={emailPreferences[key]}
                              onChange={() => setEmailPreference(key)}
                              style={{ accentColor: "var(--gb-yellow)" }}
                            />
                            {emailPreferences[key] ? "on" : "off"}
                          </label>
                        </td>
                      </tr>
                    ))}
                  </>
                )}
                <tr>
                  <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>{hasPrivateEmail ? 8 : 3}</td>
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
            <table className="gb-table gb-member-about-table">
              <thead>
                <tr>
                  <th style={{ textAlign: "right", paddingRight: 16 }}>#</th>
                  <th style={{ width: 160 }}>KEY</th>
                  <th>VALUE</th>
                </tr>
              </thead>
              <tbody>
                {aboutRows.map(({ key, val, color }, i) => (
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
