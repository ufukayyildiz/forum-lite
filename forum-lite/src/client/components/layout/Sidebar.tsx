import { Link, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { CSSProperties } from "react";
import { api } from "../../lib/api";
import { categoryPath } from "../../lib/routes";
import { useState } from "react";
import { AdSlot } from "../AdSlot";

const CAT_COLORS = ["#b8bb26","#83a598","#fabd2f","#d3869b","#8ec07c","#fe8019","#fb4934","#a89984"];
const MOBILE_NAV_ITEMS = [
  { href: "/", label: "threads", exact: true },
  { href: "/members", label: "members" },
  { href: "/tags", label: "tags" },
  { href: "/what-is-fstdesk", label: "what is fstdesk" },
];

function SidebarStickyAd({ routeKey }: { routeKey: string }) {
  const { data: config } = useQuery({
    queryKey: ["ads-config"],
    queryFn: api.adsConfig,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  if (!config?.enabled) return null;

  const sidebarHtml = config.sidebar?.html?.trim() ?? "";
  const sidebarConfig = {
    ...config,
    html: sidebarHtml,
    desktop: { ...config.desktop, html: sidebarHtml },
    mobile: { ...config.mobile, html: "" },
  };
  const sidebarAdWidth = Math.max(180, config.sidebar?.width ?? 200);
  const sidebarAdHeight = Math.max(120, config.sidebar?.height ?? 200);
  const sidebarAdStyle = {
    "--gb-sidebar-ad-width": `${sidebarAdWidth}px`,
    "--gb-sidebar-ad-height": `${sidebarAdHeight}px`,
  } as CSSProperties;

  return (
    <div className="gb-sidebar-ad-wrap" data-ad-route-key={routeKey} aria-label="Sidebar advertisement" style={sidebarAdStyle}>
      <AdSlot key={routeKey} config={sidebarConfig} index={9001} height={sidebarAdHeight} format="rectangle" />
    </div>
  );
}

export function Sidebar({ onClose }: { onClose?: () => void }) {
  const location = useLocation();
  const { pathname } = location;
  const adRouteKey = `${location.pathname}${location.search}${location.hash}`;
  const qc = useQueryClient();
  const { data: categories } = useQuery({ queryKey: ["categories"], queryFn: api.categories });
  const [catsOpen, setCatsOpen] = useState(true);

  const warmCategory = (id: string | number) => {
    qc.prefetchQuery({ queryKey: ["category", String(id)], queryFn: () => api.category(id) }).catch(() => undefined);
    qc.prefetchQuery({
      queryKey: ["threads", "cat", String(id), "recent", "page", 1],
      queryFn: () => api.threads({ category: id, sort: "recent", page: 1 }),
    }).catch(() => undefined);
  };

  return (
    <div className="gb-sidebar-shell">
      <div className="gb-sidebar-scroll">
        <div className="gb-sidebar-mobile-nav">
          <div className="gb-section">NAVIGATION</div>
          {MOBILE_NAV_ITEMS.map((item) => {
            const activeNav = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link key={item.href} to={item.href} className={`gb-tree-item${activeNav ? " active" : ""}`} onClick={onClose}>
                <span style={{ color: activeNav ? "var(--gb-yellow)" : "var(--gb-gray)", width: 16, flexShrink: 0 }}>
                  {activeNav ? ">" : "#"}
                </span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{item.label}</span>
              </Link>
            );
          })}
        </div>

        <div className="gb-section gb-section-categories" style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
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

      <div className="gb-sidebar-bottom">
        <SidebarStickyAd routeKey={adRouteKey} />
      </div>
    </div>
  );
}
