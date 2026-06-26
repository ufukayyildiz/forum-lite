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
import { AnalyticsTracker } from "./components/AnalyticsTracker";

try {
  primeQueryClientFromBootstrap(queryClient);
} catch (error) {
  console.warn("FSTDESK bootstrap skipped", error);
}

const app = (
  <React.StrictMode>
    <AppErrorBoundary>
    <HelmetProvider>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AnalyticsTracker />
        <Routes>
          <Route path="/" element={<Layout><HomePage /></Layout>} />
          <Route path="/c/:id" element={<Layout><CategoryPage /></Layout>} />
          <Route path="/t/:id" element={<Layout><ThreadPage /></Layout>} />
          <Route path="/new-thread" element={<Layout><NewThreadPage /></Layout>} />
          <Route path="/members" element={<Layout><MembersPage /></Layout>} />
          <Route path="/u/:username" element={<Layout><MemberPage /></Layout>} />
          <Route path="/login" element={<Layout><LoginPage /></Layout>} />
          <Route path="/register" element={<Layout><RegisterPage /></Layout>} />
          <Route path="/search" element={<Layout><SearchPage /></Layout>} />
          <Route path="/tags" element={<Layout><TagsPage /></Layout>} />
          <Route path="/tag/:slug" element={<Layout><TagDetailPage /></Layout>} />
          <Route path="/contact" element={<Layout><ContactPage /></Layout>} />
          <Route path="/about" element={<Layout><AboutPage /></Layout>} />
          <Route path="/admin" element={<Layout><AdminLayout /></Layout>}>
            <Route index element={<AdminDashboard />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="categories" element={<AdminCategories />} />
            <Route path="tags" element={<AdminTags />} />
            <Route path="ads" element={<AdminAds />} />
            <Route path="analytics" element={<AdminAnalytics />} />
            <Route path="notifications" element={<AdminNotifications />} />
            <Route path="marketing" element={<AdminMarketing />} />
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
