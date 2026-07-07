import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { api } from "../../lib/api";
import { toast } from "sonner";
import { Send } from "lucide-react";

const FIELDS = [
  { key: "forum_title",           label: "--forum-title",          placeholder: "Forum",                hint: "Site title" },
  { key: "forum_description",     label: "--forum-description",    placeholder: "Community forum",      hint: "Short description" },
  { key: "forum_contact_email",   label: "--contact-email",        placeholder: "admin@forum.com",      hint: "Contact email" },
  { key: "forum_logo_url",        label: "--logo-url",             placeholder: "https://...",          hint: "Logo URL (blank = text)" },
  { key: "threads_per_page",      label: "--threads-per-page",     placeholder: "20",                   hint: "Threads per page" },
  { key: "posts_per_page",        label: "--posts-per-page",       placeholder: "20",                   hint: "Replies per page" },
  { key: "registration_open",     label: "--registration-open",    placeholder: "true",                 hint: "true / false" },
  { key: "maintenance_mode",      label: "--maintenance-mode",     placeholder: "false",                hint: "true = maintenance mode" },
  { key: "uploads_enabled",       label: "--uploads-enabled",      placeholder: "true",                 hint: "true = allow file uploads (R2)" },
  { key: "max_attachment_size_mb",label: "--max-attachment-mb",    placeholder: "10",                   hint: "Max upload size in MB (R2)" },
  { key: "allowed_file_types",    label: "--allowed-file-types",   placeholder: "jpg,jpeg,png,gif,webp,pdf", hint: "Comma-separated extensions (R2)" },
  { key: "email_provider",        label: "--email-provider",       placeholder: "cloudflare",           hint: "cloudflare / ses", type: "select", options: ["cloudflare", "ses"] },
  { key: "email_from",            label: "--email-from",           placeholder: "noreply@devfox.net", hint: "From address for outgoing email" },
  { key: "email_ses_from",        label: "--ses-from",             placeholder: "support@fstdesk.com", hint: "SES sender identity" },
  { key: "email_ses_region",      label: "--ses-region",           placeholder: "eu-west-1", hint: "AWS SES region" },
  { key: "email_ses_transport",   label: "--ses-transport",        placeholder: "smtp", hint: "smtp STARTTLS / api", type: "select", options: ["smtp", "api"] },
  { key: "email_ses_port",        label: "--ses-port",             placeholder: "587", hint: "SMTP STARTTLS port" },
  { key: "email_test_to",         label: "--test-email-to",        placeholder: "ufuk@devfox.net", hint: "Default test recipient" },
  { key: "site_url",              label: "--site-url",             placeholder: "https://fstdesk.com", hint: "Public site URL (used in emails)" },
  { key: "translation_enabled",   label: "--translation-enabled",  placeholder: "true", hint: "localized pages use cache; missing pages stay noindex", type: "select", options: ["true", "false"] },
  { key: "translation_provider",  label: "--translation-provider", placeholder: "openai_compatible", hint: "openai_compatible / disabled", type: "select", options: ["openai_compatible", "disabled"] },
  { key: "translation_api_url",   label: "--translation-api-url",  placeholder: "https://api.openai.com/v1/chat/completions", hint: "OpenAI-compatible chat completions endpoint" },
  { key: "translation_model",     label: "--translation-model",    placeholder: "gpt-4o-mini", hint: "Model used by background translation jobs" },
  { key: "translation_batch_limit",label: "--translation-batch",   placeholder: "4", hint: "Jobs processed per queue/cron run" },
];

const SAVED_KEYS = new Set(FIELDS.map((field) => field.key));

export default function AdminSettings() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin-settings"], queryFn: api.adminSettings });
  const { data: translationStatus } = useQuery({ queryKey: ["admin-translations"], queryFn: api.adminTranslations, refetchInterval: 15000 });
  const [form, setForm] = useState<Record<string, string>>({});
  const [testTo, setTestTo] = useState("ufuk@devfox.net");

  useEffect(() => {
    if (data) {
      setForm(data);
      setTestTo(data.email_test_to || "ufuk@devfox.net");
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => api.adminSaveSettings(Object.fromEntries(Object.entries(form).filter(([key]) => SAVED_KEYS.has(key)))),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-settings"] }); toast.success("Settings saved"); },
    onError: (e: any) => toast.error(e.message),
  });
  const testEmail = useMutation({
    mutationFn: () => api.adminSendTestEmail({ to: testTo || undefined }),
    onSuccess: (res) => toast.success(`Test email ${res.status}: ${res.to}`),
    onError: (e: any) => toast.error(e.message),
  });
  const queueTranslations = useMutation({
    mutationFn: () => api.adminQueueTranslations({ limit: 100 }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["admin-translations"] });
      if (res.started) {
        toast.success("Translation queue started");
        globalThis.setTimeout(() => qc.invalidateQueries({ queryKey: ["admin-translations"] }), 3000);
        return;
      }
      toast.success(`Queued ${res.queued}, skipped ${res.skipped}`);
    },
    onError: (e: any) => toast.error(e.message),
  });
  const processTranslations = useMutation({
    mutationFn: () => api.adminProcessTranslations({ limit: Number(form.translation_batch_limit || 4) || 4 }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["admin-translations"] });
      if (res.started) {
        toast.success("Translation processing started");
        globalThis.setTimeout(() => qc.invalidateQueries({ queryKey: ["admin-translations"] }), 3000);
        return;
      }
      toast.success(`Processed ${res.processed}: ${res.complete} complete, ${res.error} error`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const provider = form.email_provider || "cloudflare";
  const sesTransport = form.email_ses_transport || "smtp";
  const sesPort = form.email_ses_port || "587";
  const providerConfigured = provider === "ses"
    ? data?._email_ses_configured === "true"
    : data?._email_cf_configured === "true";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 760 }}>
      {!isLoading && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", color: "var(--gb-gray)", fontSize: 12 }}>
          <span>provider: <strong style={{ color: providerConfigured ? "var(--gb-green)" : "var(--gb-red)" }}>{provider}</strong></span>
          <span>{providerConfigured ? "configured" : "missing secrets/binding"}</span>
          {provider === "ses" && <span>transport: {sesTransport}{sesTransport === "smtp" ? `:${sesPort}` : ""}</span>}
          {provider === "ses" && <span>sender: {form.email_ses_from || "support@fstdesk.com"}</span>}
        </div>
      )}
      {translationStatus && (
        <div style={{ border: "1px solid var(--gb-bg2)", padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", color: "var(--gb-gray)", fontSize: 12 }}>
            <span>translation: <strong style={{ color: translationStatus.configured ? "var(--gb-green)" : "var(--gb-red)" }}>{translationStatus.provider}</strong></span>
            <span>{translationStatus.enabled ? "enabled" : "disabled"}</span>
            <span>{translationStatus.configured ? "configured" : "missing TRANSLATION_API_KEY"}</span>
            <span>queue: {translationStatus.queueBinding ? "bound" : "waitUntil fallback"}</span>
            <span>jobs q/r/e: {translationStatus.jobs.queued}/{translationStatus.jobs.running}/{translationStatus.jobs.error}</span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button className="gb-btn" onClick={() => queueTranslations.mutate()} disabled={queueTranslations.isPending || save.isPending}>
              {queueTranslations.isPending ? "$ queueing..." : "$ queue missing translations"}
            </button>
            <button className="gb-btn" onClick={() => processTranslations.mutate()} disabled={processTranslations.isPending || save.isPending}>
              {processTranslations.isPending ? "$ processing..." : "$ process now"}
            </button>
            <span style={{ color: "var(--gb-gray)", fontSize: 11 }}>
              {translationStatus.locales.map((row) => `${row.locale}:${row.complete}`).join(" ")}
            </span>
          </div>
          {translationStatus.errors.length > 0 && (
            <div style={{ color: "var(--gb-red)", fontSize: 11, lineHeight: 1.5 }}>
              {translationStatus.errors.slice(0, 3).map((row) => `${row.locale} ${row.path}: ${row.error}`).join(" | ")}
            </div>
          )}
        </div>
      )}
      {isLoading ? (
        <div style={{ color: "var(--gb-gray)" }}>$ loading...</div>
      ) : (
        <table className="gb-table">
          <thead>
            <tr>
              <th style={{ textAlign: "right", paddingRight: 16 }}>#</th>
              <th>KEY</th>
              <th>VALUE</th>
              <th style={{ color: "var(--gb-bg3)" }}>HINT</th>
            </tr>
          </thead>
          <tbody>
            {FIELDS.map(({ key, label, placeholder, hint, type, options }, i) => (
              <tr key={key}>
                <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>{i + 1}</td>
                <td style={{ fontSize: 12, color: "var(--gb-gray)", whiteSpace: "nowrap", paddingRight: 16 }}>{label}</td>
                <td style={{ paddingRight: 12 }}>
                  {type === "select" ? (
                    <select
                      className="gb-input"
                      value={form[key] ?? placeholder}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                      style={{ width: "100%", maxWidth: 240 }}
                    >
                      {options?.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  ) : (
                    <input
                      className="gb-input"
                      value={form[key] ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                      placeholder={placeholder}
                      style={{ width: "100%", maxWidth: 240 }}
                    />
                  )}
                </td>
                <td style={{ fontSize: 11, color: "var(--gb-bg3)", whiteSpace: "nowrap" }}>{hint}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", paddingTop: 4 }}>
        <button
          className="gb-btn gb-btn-primary"
          style={{ padding: "5px 18px" }}
          onClick={() => save.mutate()}
          disabled={save.isPending || isLoading}
        >
          {save.isPending ? "$ saving..." : "$ save --settings"}
        </button>
        <input
          className="gb-input"
          type="email"
          value={testTo}
          onChange={(e) => setTestTo(e.target.value)}
          placeholder="ufuk@devfox.net"
          style={{ width: 220 }}
        />
        <button
          className="gb-btn"
          style={{ padding: "5px 12px", display: "inline-flex", alignItems: "center", gap: 6 }}
          onClick={() => testEmail.mutate()}
          disabled={testEmail.isPending || isLoading}
          title="Send test email"
        >
          <Send size={13} />
          {testEmail.isPending ? "testing..." : "test email"}
        </button>
      </div>
    </div>
  );
}
