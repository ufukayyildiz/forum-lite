import { useState, useRef, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Search, X, Plus } from "lucide-react";
import { useMe } from "../../lib/useAuth";
import { api } from "../../lib/api";
import { DAvatar } from "../DAvatar";
import { ThreadLink } from "../ThreadLink";
import { memberPath, publicPath } from "../../lib/routes";

interface Props {
  crumbs?: { label: string; href?: string }[];
  actions?: React.ReactNode;
}

export function GbToolbar({ crumbs = [], actions }: Props) {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const [showSearch, setShowSearch] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const newThreadHref = me ? "/new-thread" : "/login?next=/new-thread";

  useEffect(() => { if (showSearch) inputRef.current?.focus(); }, [showSearch]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); setShowSearch(true); }
      if (e.key === "Escape") { setShowSearch(false); setResults(null); setQ(""); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    const res = await api.search(q.trim()).catch(() => null);
    setResults(res);
  }

  return (
    <>
      <div className="gb-toolbar">
        {/* Breadcrumb */}
        <div className="gb-breadcrumb">
          <span style={{ color: "var(--gb-purple)", flexShrink: 0 }}>~</span>
          <span className="gb-breadcrumb-sep">/</span>
          {crumbs.map((c, i) => (
            <span key={i} className={`gb-breadcrumb-item${i === crumbs.length - 1 ? " is-current" : ""}`}>
              {c.href
                ? <Link to={publicPath(c.href)} className="gb-breadcrumb-label" style={{ color: i === crumbs.length - 1 ? "var(--gb-green)" : "var(--gb-blue)" }}>{c.label}</Link>
                : <span className="gb-breadcrumb-label" style={{ color: i === crumbs.length - 1 ? "var(--gb-green)" : "var(--gb-blue)" }}>{c.label}</span>
              }
              {i < crumbs.length - 1 && <span className="gb-breadcrumb-sep">/</span>}
            </span>
          ))}
          <span className="gb-breadcrumb-sep">/</span>
        </div>

        {/* Actions */}
        <div className="gb-toolbar-actions">
          {actions}
          <button className="gb-btn-icon" onClick={() => setShowSearch(true)} title="Search (Ctrl+K)">
            <Search size={15} />
          </button>
          <Link to={newThreadHref} className="gb-btn gb-btn-new">
            <Plus size={13} /> new
          </Link>
        </div>
      </div>

      {showSearch && (
        <div className="gb-search-overlay" onClick={(e) => e.target === e.currentTarget && setShowSearch(false)}>
          <div className="gb-search-box">
            <form onSubmit={handleSearch} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--gb-bg2)" }}>
              <span style={{ color: "var(--gb-gray)", fontFamily: "inherit" }}>/search...</span>
              <input
                ref={inputRef}
                style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--gb-fg)", fontFamily: "inherit", fontSize: 13 }}
                placeholder="type to search threads, members..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <button type="button" className="gb-btn-icon" onClick={() => { setShowSearch(false); setResults(null); setQ(""); }}>
                <X size={14} />
              </button>
            </form>
            {results && (
              <div style={{ maxHeight: 360, overflowY: "auto" }}>
                {!results.threads.length && !results.posts.length && !results.users.length && (
                  <div style={{ padding: "12px 14px", color: "var(--gb-gray)", fontSize: 13 }}>no results</div>
                )}
                {results.threads.map((t: any, i: number) => (
                  <ThreadLink key={t.id} thread={t} className="gb-search-result" onClick={() => setShowSearch(false)}>
                    <span style={{ color: "var(--gb-gray)", width: 28, textAlign: "right", flexShrink: 0 }}>{i + 1}</span>
                    <span style={{ color: "var(--gb-green)" }}>#</span>
                    <div>
                      <div style={{ fontSize: 13 }}>{t.title}</div>
                      <div style={{ fontSize: 11, color: "var(--gb-gray)" }}>{t.categoryName} &bull; {t.replyCount} replies</div>
                    </div>
                  </ThreadLink>
                ))}
                {results.users.map((u: any) => (
                  <Link key={u.id} to={memberPath(u.username)} className="gb-search-result" onClick={() => setShowSearch(false)}>
                    <DAvatar src={u.avatarUrl} name={u.displayName} size={20} />
                    <div>
                      <div style={{ fontSize: 13 }}>{u.displayName}</div>
                      <div style={{ fontSize: 11, color: "var(--gb-gray)" }}>@{u.username}</div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
