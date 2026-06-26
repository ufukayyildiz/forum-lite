const BASE = "/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error((body as any).error ?? res.statusText), { status: res.status });
  }
  return res.json() as Promise<T>;
}

const get = <T>(path: string) => req<T>(path);
const post = <T>(path: string, body?: unknown) =>
  req<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined });
const patch = <T>(path: string, body: unknown) =>
  req<T>(path, { method: "PATCH", body: JSON.stringify(body) });
const del = <T>(path: string) => req<T>(path, { method: "DELETE" });
const put = <T>(path: string, body: unknown) =>
  req<T>(path, { method: "PUT", body: JSON.stringify(body) });

export type PublicUser = {
  id: number; publicId: string; username: string; displayName: string; avatarUrl: string | null;
  bio: string | null; role: "admin" | "moderator" | "member"; banned: boolean;
  postCount: number; threadCount: number; createdAt: string;
  email?: string;
  emailVerifiedAt?: string | null;
  emailSuppressedAt?: string | null;
  emailSuppressionReason?: string | null;
  emailPreferences?: EmailPreferences | null;
};
export type EmailPreferences = {
  allEmail: boolean;
  replyEmail: boolean;
  likeEmail: boolean;
  marketingEmail: boolean;
};
export type AdminUser = PublicUser & {
  email: string;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  emailSuppressedAt: string | null;
  emailSuppressionReason: string | null;
};
export type Category = {
  id: number; publicId: string; name: string; slug: string; description: string | null;
  color: string; icon: string; position: number; createdAt: string;
  threadCount: number; postCount: number;
};
export type Thread = {
  id: number; publicId: string; title: string; slug: string; pinned: boolean; locked: boolean;
  featured: boolean; views: number; replyCount: number; createdAt: string;
  updatedAt: string; lastPostAt: string; content?: string;
  category: { id: number; publicId: string; name: string; slug: string; color: string };
  author: { id: number; publicId?: string; username: string; displayName: string; avatarUrl: string | null; bio?: string | null; role?: string };
  tags?: { id: number; name: string; slug: string }[];
};
export type Post = {
  id: number; content: string; likeCount: number; likedByMe: boolean;
  editedAt: string | null; createdAt: string;
  author: { id: number; publicId?: string; username: string; displayName: string; avatarUrl: string | null; role: string; postCount: number; threadCount: number; createdAt: string; bio: string | null };
};
export type Tag = { id: number; name: string; slug: string; threadCount: number };
export type AdsConfig = {
  enabled: boolean;
  postInterval: number;
  adsenseClient: string;
  adsenseSlot: string;
  adsenseFormat: string;
  fullWidthResponsive: boolean;
  html: string;
};
export type MemberActivityResponse = {
  user: PublicUser;
  threads: any[];
  replies: any[];
  totals: { threads: number; replies: number; authoredThreads?: number };
  page: number;
  perPage: number;
  tab: "threads" | "replies";
};

export type AdminAnalyticsResponse = {
  days: number;
  summary: {
    pageviews: number;
    visitors: number;
    userViews: number;
    anonymousViews: number;
    repeatViews: number;
    botViews: number;
    avgDurationMs: number;
    lastSeenAt: string | null;
    onlineVisitors: number;
    onlineSignedIn: number;
    onlineAnonymous: number;
    onlineRepeat: number;
    onlineBots: number;
    onlineWindowSeconds: number;
    onlineLastSeenAt: string | null;
  };
  sources: Array<{ source: string; medium: string; views: number; visitors: number; avgDurationMs: number }>;
  countries: Array<{ country: string; views: number; visitors: number }>;
  routes: Array<{ routeType: string; views: number; visitors: number; avgDurationMs: number }>;
  devices: Array<{ deviceType: string; browser: string; os: string; views: number; visitors: number }>;
  paths: Array<{ path: string; routeType: string; views: number; visitors: number; userViews: number; avgDurationMs: number }>;
  users: Array<{ username: string; displayName: string; views: number; visitors: number; avgDurationMs: number; lastSeenAt: string | null }>;
  referrers: Array<{ referrerHost: string; views: number; visitors: number }>;
  timeline: Array<{ bucket: string; views: number; visitors: number }>;
  online: Array<{
    id: number;
    path: string;
    routeType: string;
    source: string;
    medium: string;
    country: string | null;
    city: string | null;
    colo: string | null;
    deviceType: string;
    browser: string;
    os: string;
    isRepeat: boolean;
    isBot: boolean;
    durationMs: number;
    createdAt: string;
    lastSeenAt: string;
    username: string | null;
    displayName: string | null;
  }>;
  recent: Array<{
    id: number;
    path: string;
    routeType: string;
    source: string;
    medium: string;
    country: string | null;
    city: string | null;
    colo: string | null;
    deviceType: string;
    browser: string;
    os: string;
    isRepeat: boolean;
    isBot: boolean;
    durationMs: number;
    createdAt: string;
    lastSeenAt: string;
    username: string | null;
    displayName: string | null;
  }>;
};

export type EmailPreflightResult = {
  input: string;
  email: string;
  local: string;
  domain: string;
  validSyntax: boolean;
  disposable: boolean;
  typoSuggestion: string | null;
  hasMx: boolean;
  hasA: boolean;
  hasAaaa: boolean;
  domainExists: boolean;
  canSend: boolean;
  mxRecords: string[];
  errors: string[];
};

export type AdminEmailVerifyRow = {
  email: string;
  userId: number | null;
  username: string | null;
  displayName: string | null;
  suppressed: boolean;
  suppressionReason: string | null;
  suppressionUpdatedAt: string | null;
  cfSuppressionStatus: string | null;
  category: string;
  label: string;
  risk: "critical" | "high" | "medium" | "low" | "system";
  action: "suppress" | "review" | "ignore";
  score: number;
  temporary: boolean;
  reason: string;
  evidence: string[];
  attempts: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  statuses: string[];
  subjects: string[];
  details: string;
  preflight: EmailPreflightResult | null;
};

export type AdminEmailVerifyResponse = {
  configured: boolean;
  hours: number;
  errors: string[];
  total: number;
  candidateTotal: number;
  candidatePreview: Array<{ id: number; username: string; displayName: string; email: string; preflight?: EmailPreflightResult }>;
  summary: {
    risk: Record<string, number>;
    category: Record<string, number>;
    action: Record<string, number>;
    suppressed: number;
  };
  rows: AdminEmailVerifyRow[];
};

export const api = {
  // auth
  me: () => get<{ user: PublicUser | null }>("/auth/me"),
  login: (b: { identifier: string; password: string }) => post<{ user: PublicUser }>("/auth/login", b),
  checkAvailability: (params: { username?: string; email?: string }) =>
    get<{ usernameAvailable: boolean; emailAvailable: boolean; emailSuppressed: boolean }>(
      "/auth/availability?" + new URLSearchParams(params as Record<string, string>).toString()
    ),
  register: (b: { username: string; email: string; displayName?: string }) =>
    post<{ ok: boolean; message: string }>("/auth/register", b),
  resetPassword: (b: { email: string }) => post<{ ok: boolean; message: string }>("/auth/reset-password", b),
  logout: () => post<{ ok: boolean }>("/auth/logout"),

  // categories
  categories: () => get<Category[]>("/categories"),
  category: (id: number | string) => get<Category>(`/categories/${id}`),
  createCategory: (b: object) => post<Category>("/categories", b),
  updateCategory: (id: number, b: object) => patch<Category>(`/categories/${id}`, b),
  deleteCategory: (id: number) => del<{ ok: boolean }>(`/categories/${id}`),

  // threads
  threads: (params?: Record<string, string | number>) =>
    get<{ threads: Thread[]; total: number; page: number; perPage: number }>(
      "/threads?" + new URLSearchParams(params as any).toString()
    ),
  recentThreads: () => get<Thread[]>("/threads/recent"),
  featuredThreads: () => get<Thread[]>("/threads/featured"),
  thread: (id: number | string) => get<Thread>(`/threads/${id}`),
  createThread: (b: object) => post<{ id: number; publicId: string; slug: string }>("/threads", b),
  updateThread: (id: number | string, b: object) => patch<{ id: number; publicId: string; slug: string }>(`/threads/${id}`, b),
  deleteThread: (id: number | string) => del<{ ok: boolean }>(`/threads/${id}`),
  pinThread: (id: number | string) => patch<any>(`/threads/${id}/pin`, {}),
  lockThread: (id: number | string) => patch<any>(`/threads/${id}/lock`, {}),
  featureThread: (id: number | string) => patch<any>(`/threads/${id}/feature`, {}),

  // posts
  posts: (threadId: number, params: number | Record<string, string | number> = 1) => {
    const query =
      typeof params === "number"
        ? { threadId: String(threadId), page: String(params) }
        : {
            threadId: String(threadId),
            ...Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])),
          };
    return get<{ posts: Post[]; total: number; page: number; perPage: number }>(
      "/posts?" + new URLSearchParams(query as Record<string, string>).toString()
    );
  },
  createPost: (b: { threadId: number; content: string }) => post<Post>("/posts", b),
  updatePost: (id: number, content: string) => patch<Post>(`/posts/${id}`, { content }),
  deletePost: (id: number) => del<{ ok: boolean }>(`/posts/${id}`),
  likePost: (id: number) => post<{ liked: boolean; likeCount: number }>(`/posts/${id}/like`),

  members: (params?: Record<string, string | number>) =>
    get<{ members: PublicUser[]; total: number; page: number; perPage: number }>(
      "/members?" + new URLSearchParams(params as any).toString()
    ),
  member: (username: string, params?: Record<string, string | number>) =>
    get<MemberActivityResponse>(
      "/members/" + username + (params ? "?" + new URLSearchParams(params as any).toString() : "")
    ),
  updateMember: (username: string, b: {
    displayName?: string;
    email?: string;
    bio?: string;
    avatarUrl?: string;
    emailPreferences?: Partial<EmailPreferences>;
  }) => patch<{ user: PublicUser }>(`/members/${username}`, b),

  // tags
  tags: () => get<Tag[]>("/tags"),
  tagThreads: (slug: string, params?: Record<string, string | number>) =>
    get<{ tag: { id: number; name: string; slug: string }; threads: Thread[]; total: number; page: number; perPage: number }>(
      "/tags/" + slug + (params ? "?" + new URLSearchParams(params as any).toString() : "")
    ),
  createTag: (name: string) => post<Tag>("/tags", { name }),
  deleteTag: (slug: string) => del<{ ok: boolean }>(`/tags/${slug}`),

  // public stats
  stats: () => get<{ users: number; threads: number; posts: number }>("/stats"),
  adsConfig: () => get<AdsConfig>("/ads"),

  // search
  search: (q: string) => get<{ threads: any[]; posts: any[]; users: any[] }>(`/search?q=${encodeURIComponent(q)}`),

  // admin
  adminStats: () => get<{ userCount: number; threadCount: number; postCount: number; recentActivity: any[] }>("/admin/stats"),
  adminAnalytics: (days = 7) => get<AdminAnalyticsResponse>(`/admin/analytics?days=${days}`),
  adminUsers: (page = 1) => get<{ users: AdminUser[]; total: number }>(`/admin/users?page=${page}`),
  adminSetRole: (id: number, role: string) => patch<{ user: PublicUser }>(`/admin/users/${id}/role`, { role }),
  adminBanUser: (id: number) => post<{ user: PublicUser }>(`/admin/users/${id}/ban`),
  adminEditUser: (id: number, data: { displayName?: string; email?: string; bio?: string; avatarUrl?: string }) =>
    patch<{ ok: boolean; user: PublicUser }>(`/admin/users/${id}`, data),
  adminDeleteUser: (id: number) => del<{ ok: boolean }>(`/admin/users/${id}`),
  adminLogs: (page = 1) => get<{ logs: any[]; total: number; page: number; perPage: number }>(`/admin/logs?page=${page}`),
  adminEmailSuppressions: (page = 1) => get<{ suppressions: any[]; syncConfigured: boolean; total: number; page: number; perPage: number }>(`/admin/email-suppressions?page=${page}`),
  adminAddEmailSuppression: (email: string, reason = "manual_admin_suppression") =>
    post<{ ok: boolean; email: string }>("/admin/email-suppressions", { email, reason }),
  adminSyncEmailSuppressions: (hours = 72) =>
    post<{ ok: boolean; configured: boolean; hours: number; cfSuppressions: number; deliveryFailures: number; localUpdates: number; cfWriteAttempts: number; cfWriteSynced: number; cfWriteErrors: number; errors: string[] }>(
      "/admin/email-suppressions/sync",
      { hours },
    ),
  adminEmailVerify: (params?: { hours?: number; q?: string; risk?: string; action?: string; includeSuppressed?: boolean }) =>
    get<AdminEmailVerifyResponse>("/admin/email-verify?" + new URLSearchParams({
      hours: String(params?.hours ?? 72),
      q: params?.q ?? "",
      risk: params?.risk ?? "all",
      action: params?.action ?? "all",
      includeSuppressed: params?.includeSuppressed === false ? "false" : "true",
    }).toString()),
  adminEmailVerifySuppress: (emails: string[], reason = "admin_email_verify_risky") =>
    post<{ ok: boolean; total: number; suppressed: number; errors: any[]; results: any[] }>("/admin/email-verify/suppress", { emails, reason }),
  adminEmailVerifyRun: (limit = 25) =>
    post<{ ok: boolean; total: number; remaining: number; sent: number; skipped: number; suppressed: number; preflightBlocked: number; error: number; results: any[] }>("/admin/email-verify/run", { limit }),
  adminEmailEvents: (page = 1, kind = "") =>
    get<{ events: Array<any & { openCount?: number; clickCount?: number; openedAt?: string | null; clickedAt?: string | null; lastOpenedAt?: string | null; lastClickedAt?: string | null }>; total: number; page: number; perPage: number }>(
      `/admin/email-events?page=${page}${kind ? `&kind=${encodeURIComponent(kind)}` : ""}`
    ),
  adminNotifications: () => get<{
    eventCount: number;
    suppressionCount: number;
    preferenceCount: number;
    byStatus: { status: string; count: number }[];
    byKind: { kind: string; count: number }[];
    cfSuppressionStatus: { status: string; count: number }[];
  }>("/admin/notifications"),
  adminMarketingTemplate: () => get<{ campaignKey: string; name: string; subject: string; text: string; html: string }>("/admin/marketing/template"),
  adminMarketingUsers: (q = "", campaign = "we-are-back") =>
    get<{ total: number; summary: { subscribed: number; unsubscribed: number; suppressed: number }; users: Array<any & { marketingStatus: "subscribed" | "unsubscribed" | "suppressed"; canReceiveMarketing: boolean; marketingUnsubscribed: boolean; suppressionReason?: string | null; sendCount: number; lastSentAt?: string | null }> }>(`/admin/marketing/users?campaign=${encodeURIComponent(campaign)}&q=${encodeURIComponent(q)}`),
  adminMarketingSends: (page = 1) => get<{ sends: Array<any & { openCount: number; clickCount: number; openedAt: string | null; clickedAt: string | null; lastOpenedAt: string | null; lastClickedAt: string | null }>; total: number; page: number; perPage: number }>(`/admin/marketing/sends?page=${page}`),
  adminSendMarketing: (b: { campaignKey: string; userId?: number; userIds?: number[]; test?: boolean }) =>
    post<{ ok: boolean; status: string; previousSentAt?: string | null; total?: number; sent?: number; duplicate?: number; skipped?: number; suppressed?: number; error?: number; results?: any[] }>("/admin/marketing/send", b),
  adminSettings: () => get<Record<string, string>>("/admin/settings"),
  adminSaveSettings: (b: Record<string, string>) => post<{ ok: boolean }>("/admin/settings", b),

  // attachments
  attachmentConfig: () => get<{ enabled: boolean; maxMb: number; allowedMime: string[] }>("/attachments/config"),
  uploadAttachment: async (file: File): Promise<{ id: number; key: string; url: string; filename: string; mime: string }> => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/attachments/upload`, { method: "POST", credentials: "include", body: fd });
    if (!res.ok) { const e = await res.json() as any; throw new Error(e.error || "Upload failed"); }
    return res.json();
  },
};
