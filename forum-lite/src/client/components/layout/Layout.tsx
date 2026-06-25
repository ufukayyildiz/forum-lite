import { useState, useEffect } from "react";
import { useLocation, Link } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useMe } from "../../lib/useAuth";
import { AlignLeft } from "lucide-react";

function Tabline({ onMenu }: { onMenu: () => void }) {
  return (
    <div className="gb-tabline">
      <div className="gb-tabline-left">
        <button className="gb-hamburger" onClick={onMenu} title="Menu" aria-label="Open sidebar">
          <AlignLeft size={16} />
        </button>
        <div className="gb-tab active" style={{ paddingLeft: 12 }}>
          <Link to="/" style={{ color: "var(--gb-yellow)", fontWeight: 700, textDecoration: "none" }}>FSTDESK</Link>
        </div>
      </div>
      <div className="gb-tabline-right">utf-8 | unix</div>
    </div>
  );
}

function Statusbar() {
  const { pathname } = useLocation();
  const { data: me } = useMe();
  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: api.stats,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const page = pathname === "/" ? "threads" : pathname.replace("/", "").split("/")[0];

  return (
    <div className="gb-statusbar">
      <span className="gb-statusbar-mode">NORMAL &nbsp; {me ? me.username : "guest"}</span>
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
  const { pathname } = useLocation();
  useEffect(() => { setSidebarOpen(false); }, [pathname]);

  return (
    <div className="gb-shell">
      <Tabline onMenu={() => setSidebarOpen(true)} />
      <div className="gb-body">
        <div className={`gb-sidebar${sidebarOpen ? " open" : ""}`}>
          <Sidebar onClose={() => setSidebarOpen(false)} />
        </div>
        {sidebarOpen && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 199 }}
            onClick={() => setSidebarOpen(false)} />
        )}
        <div className="gb-main">{children}</div>
      </div>
      <Statusbar />
    </div>
  );
}
