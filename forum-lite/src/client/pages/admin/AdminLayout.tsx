import { Outlet, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useMe } from "../../lib/useAuth";
import { GbToolbar } from "../../components/layout/Header";
import { SEOHead } from "../../components/SEOHead";

const ALL_TABS = [
  { path: "/admin",            label: "DASHBOARD", exact: true, adminOnly: true },
  { path: "/admin/users",      label: "USERS",                  adminOnly: true },
  { path: "/admin/categories", label: "CATEGORIES",             adminOnly: false },
  { path: "/admin/tags",       label: "TAGS",                   adminOnly: false },
  { path: "/admin/ads",        label: "ADS",                    adminOnly: true },
  { path: "/admin/analytics",  label: "ANALYTICS",              adminOnly: true },
  { path: "/admin/notifications", label: "NOTIFY",               adminOnly: true },
  { path: "/admin/marketing",  label: "MARKETING",              adminOnly: true },
  { path: "/admin/email-verify", label: "EMAIL VERIFY",          adminOnly: true },
  { path: "/admin/bounces",    label: "BOUNCES",                adminOnly: true },
  { path: "/admin/logs",       label: "LOGS",                   adminOnly: true },
  { path: "/admin/settings",   label: "SETTINGS",               adminOnly: true },
];

export default function AdminLayout() {
  const { data: me, isLoading } = useMe();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  if (isLoading) return null;
  if (!me || (me.role !== "admin" && me.role !== "moderator")) return <Navigate to="/" replace />;

  const isAdmin = me.role === "admin";
  const TABS = ALL_TABS.filter((t) => isAdmin || !t.adminOnly);

  const activeTab = TABS.find((t) => t.exact ? pathname === t.path : pathname.startsWith(t.path));
  if (!activeTab) return <Navigate to={TABS[0]?.path ?? "/"} replace />;
  const contentClass = `gb-content gb-admin-content${pathname.startsWith("/admin/marketing") ? " gb-admin-content-marketing" : ""}`;

  return (
    <>
      <SEOHead title="Admin" noindex={true} />
      <GbToolbar crumbs={[{ label: "admin" }]} />

      <div className="gb-tabs">
        {TABS.map((t) => {
          const isActive = t.exact ? pathname === t.path : pathname.startsWith(t.path);
          return (
            <div
              key={t.path}
              className={`gb-tab-item${isActive ? " active" : ""}`}
              onClick={() => navigate(t.path)}
            >
              {t.label}
            </div>
          );
        })}
        <div style={{ flex: 1 }} />
        <div style={{ padding: "4px 12px", fontSize: 11, color: "var(--gb-red)", alignSelf: "center" }}>
          [{me.role}]
        </div>
      </div>

      <div className={contentClass} style={{ padding: "16px 20px" }}>
        <Outlet />
      </div>
    </>
  );
}
