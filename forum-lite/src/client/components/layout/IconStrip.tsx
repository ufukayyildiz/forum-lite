import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Home, Users, AlignLeft } from "lucide-react";
import { api } from "../../lib/api";
import { categoryPath, publicPath } from "../../lib/routes";
import { bootstrapQueryOptions } from "../../lib/bootstrap";
import { parseLocalePath } from "../../../shared/locales";

function catInitials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

const PALETTE = ["#5865F2","#57F287","#FEE75C","#EB459E","#5b73e8","#3abaa4","#ff7043","#9c6ad8"];
function colorFor(id: number) { return PALETTE[id % PALETTE.length]; }

export function IconStrip({ onMobileMenu }: { onMobileMenu: () => void }) {
  const { pathname } = useLocation();
  const publicPathname = parseLocalePath(pathname).path;
  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: api.categories,
    ...bootstrapQueryOptions<any>(["categories"]),
  });

  return (
    <div className="icon-strip">
      {/* Mobile hamburger */}
      <button
        className="strip-icon mobile-menu-btn"
        onClick={onMobileMenu}
        title="Menu"
        style={{ fontSize: 14 }}
      >
        <AlignLeft size={20} />
      </button>

      {/* Home */}
      <Link to={publicPath("/")} style={{ textDecoration: "none" }}>
        <div className={`strip-icon ${publicPathname === "/" ? "active" : ""}`} title="Forum Ana Sayfa">
          <div className="pill" />
          <span style={{ fontSize: 22, fontWeight: 900, fontFamily: "serif" }}>F</span>
        </div>
      </Link>

      <div className="strip-divider" />

      {/* Category shortcuts */}
      {categories?.map((cat) => {
        const href = categoryPath(cat);
        const active = publicPathname === `/c/${cat.publicId}` || publicPathname === `/c/${cat.id}`;
        return (
          <Link key={cat.id} to={href} style={{ textDecoration: "none" }}>
            <div
              className={`strip-icon ${active ? "active" : ""}`}
              title={cat.name}
              style={{
                background: active ? colorFor(cat.id) : `${colorFor(cat.id)}33`,
                color: active ? "#fff" : colorFor(cat.id),
                fontSize: 12,
              }}
            >
              <div className="pill" />
              {catInitials(cat.name)}
            </div>
          </Link>
        );
      })}

      <div className="strip-divider" />

      {/* Members */}
      <Link to={publicPath("/members")} style={{ textDecoration: "none" }}>
        <div className={`strip-icon ${publicPathname.startsWith("/members") ? "active" : ""}`} title="Members">
          <div className="pill" />
          <Users size={20} />
        </div>
      </Link>
    </div>
  );
}
