import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, ChevronDown, Shield, LogOut, User, Settings, Plus } from "lucide-react";
import { api } from "../../lib/api";
import { categoryPath } from "../../lib/routes";
import { useMe, useLogout } from "../../lib/useAuth";
import { useState, useRef, useEffect } from "react";
import { DAvatar } from "../DAvatar";
import { toast } from "sonner";

const CAT_COLORS = ["#b8bb26","#83a598","#fabd2f","#d3869b","#8ec07c","#fe8019","#fb4934","#a89984"];

export function Sidebar({ onClose }: { onClose?: () => void }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const logout = useLogout();
  const { data: categories } = useQuery({ queryKey: ["categories"], queryFn: api.categories });
  const [catsOpen, setCatsOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function h(e: MouseEvent) { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  async function doLogout() {
    await logout.mutateAsync();
    setMenuOpen(false);
    toast.success("Logged out");
    navigate("/");
    onClose?.();
  }

  const active = (to: string, exact = false) => exact ? pathname === to : pathname.startsWith(to);
  const newThreadHref = me ? "/new-thread" : "/login?next=/new-thread";
  const warmQuery = (to: string) => {
    if (to === "/") {
      qc.prefetchQuery({
        queryKey: ["threads", "all", "recent", "all"],
        queryFn: () => api.threads({ sort: "recent", all: 1 }),
      }).catch(() => undefined);
    } else if (to === "/members") {
      qc.prefetchQuery({
        queryKey: ["members", "posts", "all"],
        queryFn: () => api.members({ sort: "posts", all: 1 }),
      }).catch(() => undefined);
    } else if (to === "/tags") {
      qc.prefetchQuery({ queryKey: ["tags"], queryFn: api.tags }).catch(() => undefined);
    }
  };
  const warmCategory = (id: string | number) => {
    qc.prefetchQuery({ queryKey: ["category", String(id)], queryFn: () => api.category(id) }).catch(() => undefined);
    qc.prefetchQuery({
      queryKey: ["threads", "cat", String(id), "recent", "all"],
      queryFn: () => api.threads({ category: id, sort: "recent", all: 1 }),
    }).catch(() => undefined);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="gb-sidebar-scroll">

        {/* Navigation */}
        <div className="gb-section">NAVIGATION</div>

        {[
          { to: "/", label: "threads", icon: "#", exact: true },
          { to: "/members", label: "members", icon: "#" },
          { to: "/tags", label: "tags", icon: "#" },
        ].map(({ to, label, icon, exact }) => (
          <Link
            key={to}
            to={to}
            className={`gb-tree-item${active(to, exact) ? " active" : ""}`}
            onClick={onClose}
            onFocus={() => warmQuery(to)}
            onPointerEnter={() => warmQuery(to)}
            onPointerDown={() => warmQuery(to)}
            onTouchStart={() => warmQuery(to)}
          >
            <span style={{ color: active(to, exact) ? "var(--gb-yellow)" : "var(--gb-gray)", width: 16, flexShrink: 0 }}>{icon}</span>
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
          </Link>
        ))}

        {me && (me.role === "admin" || me.role === "moderator") && (
          <Link to="/admin" className={`gb-tree-item${active("/admin") ? " active" : ""}`} onClick={onClose}>
            <span style={{ color: "var(--gb-red)", width: 16, flexShrink: 0 }}>#</span>
            <span style={{ flex: 1 }}>admin</span>
          </Link>
        )}

        {/* Categories */}
        <div className="gb-section" style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
          onClick={() => setCatsOpen(!catsOpen)}>
          <span>CATEGORIES</span>
          {catsOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </div>

        {catsOpen && categories?.map((cat, i) => {
          const href = categoryPath(cat);
          const activeCat = pathname === href || pathname === `/c/${cat.id}`;
          return (
            <Link
              key={cat.id}
              to={href}
              className={`gb-tree-item${activeCat ? " active" : ""}`}
              onClick={onClose}
              onFocus={() => warmCategory(cat.publicId)}
              onPointerEnter={() => warmCategory(cat.publicId)}
              onPointerDown={() => warmCategory(cat.publicId)}
              onTouchStart={() => warmCategory(cat.publicId)}
            >
              <span style={{ color: CAT_COLORS[i % CAT_COLORS.length], width: 16, flexShrink: 0, fontSize: 14 }}>
                {activeCat ? ">" : "#"}
              </span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                {cat.name.toLowerCase()}
              </span>
              {cat.threadCount > 0 && <span className="gb-tree-count">{cat.threadCount}</span>}
            </Link>
          );
        })}

        {!categories?.length && (
          <div style={{ padding: "3px 16px 3px 38px", fontSize: 12, color: "var(--gb-gray)" }}>no categories</div>
        )}
      </div>

      {/* Bottom user panel */}
      <div className="gb-sidebar-bottom">
        {me ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Link to={`/u/${me.username}`} onClick={onClose} style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, textDecoration: "none" }}>
              <DAvatar src={me.avatarUrl} name={me.displayName} size={28} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--gb-fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {me.displayName}
                </div>
                <div style={{ fontSize: 11, color: "var(--gb-gray)" }}>@{me.username}</div>
              </div>
            </Link>
            <div style={{ position: "relative" }} ref={menuRef}>
              <button className="gb-btn-icon" onClick={() => setMenuOpen(!menuOpen)}><Settings size={14} /></button>
              {menuOpen && (
                <div style={{
                  position: "absolute", bottom: "calc(100% + 4px)", right: 0,
                  background: "var(--gb-bg1)", border: "1px solid var(--gb-yellow)",
                  minWidth: 160, zIndex: 300,
                }}>
                  <Link to={`/u/${me.username}`} className="gb-search-result" style={{ fontSize: 12 }}
                    onClick={() => { setMenuOpen(false); onClose?.(); }}>
                    <User size={12} /> profile
                  </Link>
                  {(me.role === "admin" || me.role === "moderator") && (
                    <Link to="/admin" className="gb-search-result" style={{ fontSize: 12 }}
                      onClick={() => { setMenuOpen(false); onClose?.(); }}>
                      <Shield size={12} /> admin
                    </Link>
                  )}
                  <div style={{ borderTop: "1px solid var(--gb-bg2)", margin: "2px 0" }} />
                  <button className="gb-search-result" style={{ border: "none", cursor: "pointer", color: "var(--gb-red)", fontSize: 12, width: "100%" }}
                    onClick={doLogout}>
                    <LogOut size={12} /> logout
                  </button>
                </div>
              )}
            </div>
            <Link to={newThreadHref} className="gb-btn gb-btn-new" style={{ padding: "3px 8px", fontSize: 11 }} onClick={onClose}>
              <Plus size={12} /> new
            </Link>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Link to={newThreadHref} className="gb-btn gb-btn-new" style={{ flex: "1 1 100%", justifyContent: "center", fontSize: 12 }} onClick={onClose}>
              <Plus size={12} /> new
            </Link>
            <Link to="/login" className="gb-btn" style={{ flex: 1, justifyContent: "center", fontSize: 12 }} onClick={onClose}>login</Link>
            <Link to="/register" className="gb-btn gb-btn-primary" style={{ flex: 1, justifyContent: "center", fontSize: 12 }} onClick={onClose}>register</Link>
          </div>
        )}
      </div>
    </div>
  );
}
