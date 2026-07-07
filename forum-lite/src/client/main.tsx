import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import { Toaster } from "sonner";
import { queryClient } from "./lib/queryClient";
import { primeQueryClientFromBootstrap } from "./lib/bootstrap";
import { Layout } from "./components/layout/Layout";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import "./index.css";

import HomePage from "./pages/HomePage";
import CategoryPage from "./pages/CategoryPage";
import ThreadPage from "./pages/ThreadPage";
import NewThreadPage from "./pages/NewThreadPage";
import MembersPage from "./pages/MembersPage";
import MemberPage from "./pages/MemberPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import SearchPage from "./pages/SearchPage";
import TagsPage from "./pages/TagsPage";
import TagDetailPage from "./pages/TagDetailPage";
import ContactPage from "./pages/ContactPage";
import AboutPage from "./pages/AboutPage";
import WhatIsFstdeskPage from "./pages/WhatIsFstdeskPage";
import NotFoundPage from "./pages/NotFoundPage";
import AdminLayout from "./pages/admin/AdminLayout";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminCategories from "./pages/admin/AdminCategories";
import AdminSettings from "./pages/admin/AdminSettings";
import AdminTags from "./pages/admin/AdminTags";
import AdminLogs from "./pages/admin/AdminLogs";
import AdminAds from "./pages/admin/AdminAds";
import AdminBounces from "./pages/admin/AdminBounces";
import AdminNotifications from "./pages/admin/AdminNotifications";
import AdminMarketing from "./pages/admin/AdminMarketing";
import AdminAnalytics from "./pages/admin/AdminAnalytics";
import AdminEmailVerify from "./pages/admin/AdminEmailVerify";
import AdminSuppressions from "./pages/admin/AdminSuppressions";
import AdminAnchors from "./pages/admin/AdminAnchors";
import AdminTranslations from "./pages/admin/AdminTranslations";
import { AnalyticsTracker } from "./components/AnalyticsTracker";
import { installClientErrorReporting } from "./lib/error-reporting";
import { LOCALIZED_LOCALES } from "../shared/locales";

installClientErrorReporting();

try {
  primeQueryClientFromBootstrap(queryClient);
} catch (error) {
  console.warn("FSTDESK bootstrap skipped", error);
}

const publicRoutes = [
  { path: "/", element: <HomePage /> },
  { path: "/c/:id", element: <CategoryPage /> },
  { path: "/t/:id", element: <ThreadPage /> },
  { path: "/members", element: <MembersPage /> },
  { path: "/u/:username", element: <MemberPage /> },
  { path: "/search", element: <SearchPage /> },
  { path: "/tags", element: <TagsPage /> },
  { path: "/tag/:slug", element: <TagDetailPage /> },
  { path: "/what-is-fstdesk", element: <WhatIsFstdeskPage /> },
  { path: "/contact", element: <ContactPage /> },
  { path: "/about", element: <AboutPage /> },
];

function routePath(prefix: string, path: string) {
  if (!prefix) return path;
  return path === "/" ? prefix : `${prefix}${path}`;
}

const localizedPrefixes = LOCALIZED_LOCALES.map((locale) => `/${locale}`);

const app = (
  <React.StrictMode>
    <AppErrorBoundary>
    <HelmetProvider>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AnalyticsTracker />
        <Routes>
          {publicRoutes.map((route) => (
            <Route key={route.path} path={route.path} element={<Layout>{route.element}</Layout>} />
          ))}
          {localizedPrefixes.flatMap((prefix) => publicRoutes.map((route) => (
            <Route key={`${prefix}${route.path}`} path={routePath(prefix, route.path)} element={<Layout>{route.element}</Layout>} />
          )))}
          <Route path="/new-thread" element={<Layout><NewThreadPage /></Layout>} />
          <Route path="/login" element={<Layout><LoginPage /></Layout>} />
          <Route path="/register" element={<Layout><RegisterPage /></Layout>} />
          <Route path="/admin" element={<Layout><AdminLayout /></Layout>}>
            <Route index element={<AdminDashboard />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="categories" element={<AdminCategories />} />
            <Route path="tags" element={<AdminTags />} />
            <Route path="ads" element={<AdminAds />} />
            <Route path="analytics" element={<AdminAnalytics />} />
            <Route path="notifications" element={<AdminNotifications />} />
            <Route path="marketing" element={<AdminMarketing />} />
            <Route path="anchors" element={<AdminAnchors />} />
            <Route path="translations" element={<AdminTranslations />} />
            <Route path="email-verify" element={<AdminEmailVerify />} />
            <Route path="suppressions" element={<AdminSuppressions />} />
            <Route path="bounces" element={<AdminBounces />} />
            <Route path="logs" element={<AdminLogs />} />
            <Route path="settings" element={<AdminSettings />} />
          </Route>
          <Route path="*" element={<Layout><NotFoundPage /></Layout>} />
        </Routes>
      </BrowserRouter>
      <Toaster position="bottom-right" theme="dark" richColors />
    </QueryClientProvider>
    </HelmetProvider>
    </AppErrorBoundary>
  </React.StrictMode>
);

const root = document.getElementById("root")!;
if (root.hasChildNodes()) {
  ReactDOM.hydrateRoot(root, app, {
    onRecoverableError: () => {
      // The Worker ships a hand-built SEO shell. Hydration may patch small
      // markup differences, but it should not clear the whole first paint.
    },
  });
} else {
  ReactDOM.createRoot(root).render(app);
}
