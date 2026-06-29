import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { SEOHead } from "../components/SEOHead";
import { GbToolbar } from "../components/layout/Header";
import { AdSlot } from "../components/AdSlot";
import { api } from "../lib/api";
import { bootstrapQueryOptions } from "../lib/bootstrap";

export default function NotFoundPage() {
  const location = useLocation();
  const { data: adsConfig } = useQuery({
    queryKey: ["ads-config"],
    queryFn: api.adsConfig,
    ...bootstrapQueryOptions<any>(["ads-config"]),
  });

  return (
    <>
      <SEOHead
        title="404"
        description="The requested forum page could not be found."
        canonical={location.pathname}
        noindex
      />
      <GbToolbar crumbs={[{ label: "error" }, { label: "404" }]} />
      <div className="gb-content">
        <table className="gb-table">
          <thead>
            <tr>
              <th style={{ textAlign: "right", paddingRight: 16 }}>#</th>
              <th>STATUS</th>
              <th>PATH</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ color: "var(--gb-red)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>!</td>
              <td style={{ color: "var(--gb-red)", fontWeight: 700 }}>error: page not found</td>
              <td style={{ color: "var(--gb-gray)" }}>{location.pathname}</td>
            </tr>
            <tr>
              <td style={{ color: "var(--gb-bg3)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>~</td>
              <td colSpan={2} style={{ color: "var(--gb-fg4)" }}>
                <Link to="/" style={{ color: "var(--gb-yellow)", fontWeight: 700 }}>$ threads</Link>
                <span style={{ color: "var(--gb-gray)" }}> / </span>
                <Link to="/members" style={{ color: "var(--gb-green)", fontWeight: 700 }}>$ members</Link>
                <span style={{ color: "var(--gb-gray)" }}> / </span>
                <Link to="/tags" style={{ color: "var(--gb-aqua)", fontWeight: 700 }}>$ tags</Link>
              </td>
            </tr>
            {Array.from({ length: 8 }).map((_, i) => (
              <tr key={i}>
                <td style={{ color: "var(--gb-bg3)", textAlign: "right", paddingRight: 16, fontSize: 12, paddingTop: 2, paddingBottom: 2 }}>~</td>
                <td colSpan={2} />
              </tr>
            ))}
          </tbody>
        </table>
        {adsConfig?.enabled && <AdSlot config={adsConfig} index={404} />}
      </div>
    </>
  );
}
