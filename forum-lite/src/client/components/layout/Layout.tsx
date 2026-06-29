import { useState, useEffect, useRef } from "react";
import { useLocation, Link } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useMe } from "../../lib/useAuth";
import { AlignLeft } from "lucide-react";
import { bootstrapQueryOptions } from "../../lib/bootstrap";

function Tabline({ onMenu }: { onMenu: () => void }) {
  const { pathname } = useLocation();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const isStaff = me?.role === "admin" || me?.role === "moderator";
  const navItems = [
    { to: "/", label: "threads" },
    { to: "/members", label: "members" },
    { to: "/tags", label: "tags" },
    { to: "/what-is-fstdesk", label: "what is fstdesk" },
  ];
  const active = (to: string) => {
    if (to === "/") return pathname === "/" || pathname.startsWith("/t/") || pathname.startsWith("/c/");
    return pathname === to || pathname.startsWith(`${to}/`);
  };
  const warmQuery = (to: string) => {
    if (to === "/") {
      qc.prefetchQuery({
        queryKey: ["threads", "all", "recent", "page", 1],
        queryFn: () => api.threads({ sort: "recent", page: 1 }),
      }).catch(() => undefined);
    } else if (to === "/members") {
      qc.prefetchInfiniteQuery({
        queryKey: ["members", "posts", "pages"],
        queryFn: ({ pageParam }) => api.members({ sort: "posts", page: pageParam as number, perPage: 200 }),
        initialPageParam: 1,
      }).catch(() => undefined);
    } else if (to === "/tags") {
      qc.prefetchQuery({ queryKey: ["tags"], queryFn: api.tags }).catch(() => undefined);
    }
  };

  return (
    <div className="gb-tabline">
      <div className="gb-tabline-left">
        <button className="gb-hamburger" onClick={onMenu} title="Menu" aria-label="Open sidebar">
          <AlignLeft size={16} />
        </button>
        <div className="gb-tab active" style={{ paddingLeft: 12 }}>
          <Link to="/" style={{ color: "var(--gb-yellow)", fontWeight: 700, textDecoration: "none" }}>FSTDESK</Link>
        </div>
        <nav className="gb-header-nav" aria-label="Primary">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`gb-header-link${active(item.to) ? " active" : ""}`}
              onFocus={() => warmQuery(item.to)}
              onPointerEnter={() => warmQuery(item.to)}
              onPointerDown={() => warmQuery(item.to)}
              onTouchStart={() => warmQuery(item.to)}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="gb-tabline-right">
        <span className="gb-encoding">utf-8 | unix</span>
        {me ? (
          <Link to={isStaff ? "/admin" : `/u/${me.username}`} className={`gb-header-user${isStaff ? " is-admin" : ""}`}>
            {isStaff ? "[admin]" : `@${me.username}`}
          </Link>
        ) : (
          <span className="gb-header-auth">
            <Link to="/login">login</Link>
            <Link to="/register">register</Link>
          </span>
        )}
      </div>
    </div>
  );
}

function Statusbar() {
  const { pathname } = useLocation();
  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: api.stats,
    ...bootstrapQueryOptions<any>(["stats"], { staleTime: 60_000 }),
  });
  const page = pathname === "/" ? "threads" : pathname.replace("/", "").split("/")[0];

  return (
    <div className="gb-statusbar">
      <span className="gb-statusbar-mode">NORMAL</span>
      <span className="gb-statusbar-links">
        <Link to="/contact">contact</Link>
        <Link to="/about">about</Link>
      </span>
      <span style={{ flex: 1 }} />
      {stats && (
        <span className="gb-statusbar-stats">
          <span><span style={{ color: "var(--gb-blue)" }}>{stats.users.toLocaleString()}</span> users</span>
          <span><span style={{ color: "var(--gb-green)" }}>{stats.threads.toLocaleString()}</span> threads</span>
          <span><span style={{ color: "var(--gb-aqua)" }}>{stats.posts.toLocaleString()}</span> posts</span>
        </span>
      )}
      <span className="gb-statusbar-right">{page} &nbsp; 100%</span>
    </div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const { pathname, search } = useLocation();
  const embedded = new URLSearchParams(search).get("embed") === "1";

  useEffect(() => { setSidebarOpen(false); }, [pathname, embedded]);
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell || typeof MutationObserver === "undefined") return;

    const lockShell = () => {
      const rules: Array<[keyof CSSStyleDeclaration, string]> = [
        ["height", "100dvh"],
        ["minHeight", "100dvh"],
        ["maxHeight", "100dvh"],
        ["overflow", "hidden"],
      ];
      for (const [property, value] of rules) {
        const cssName = String(property).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
        if (shell.style.getPropertyValue(cssName) !== value || shell.style.getPropertyPriority(cssName) !== "important") {
          shell.style.setProperty(cssName, value, "important");
        }
      }
    };

    lockShell();
    const observer = new MutationObserver(lockShell);
    observer.observe(shell, { attributes: true, attributeFilter: ["style"] });
    window.addEventListener("resize", lockShell);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", lockShell);
    };
  }, []);

  if (embedded) {
    return (
      <div ref={shellRef} className="gb-shell gb-shell-embedded">
        <div className="gb-main gb-main-embedded">{children}</div>
      </div>
    );
  }

  return (
    <div ref={shellRef} className="gb-shell">
      <Tabline onMenu={() => setSidebarOpen(true)} />
      <div className="gb-body">
        <div className={`gb-sidebar${sidebarOpen ? " open" : ""}`}>
          <Sidebar onClose={() => setSidebarOpen(false)} />
        </div>
        {sidebarOpen && (
          <div className="gb-sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
        )}
        <div className="gb-main">{children}</div>
      </div>
      <Statusbar />
    </div>
  );
}
