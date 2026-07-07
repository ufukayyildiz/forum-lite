import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../../lib/api";

const TRANSLATION_FIELDS = [
  { key: "translation_enabled", label: "--translation-enabled", placeholder: "true", hint: "localized pages use cache; missing pages stay noindex", type: "select", options: ["true", "false"] },
  { key: "translation_provider", label: "--translation-provider", placeholder: "openai_compatible", hint: "openai_compatible / disabled", type: "select", options: ["openai_compatible", "disabled"] },
  { key: "translation_api_url", label: "--translation-api-url", placeholder: "https://api.openai.com/v1/chat/completions", hint: "OpenAI-compatible chat completions endpoint" },
  { key: "translation_model", label: "--translation-model", placeholder: "gpt-4o-mini", hint: "Model used by background translation jobs" },
  { key: "translation_batch_limit", label: "--translation-batch", placeholder: "4", hint: "Jobs processed per queue/cron run" },
];

const TRANSLATION_KEYS = new Set(TRANSLATION_FIELDS.map((field) => field.key));

export default function AdminTranslations() {
  const qc = useQueryClient();
  const { data: settings, isLoading: settingsLoading } = useQuery({ queryKey: ["admin-settings"], queryFn: api.adminSettings });
  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["admin-translations"],
    queryFn: api.adminTranslations,
    refetchInterval: 15000,
  });
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  const save = useMutation({
    mutationFn: () => api.adminSaveSettings(Object.fromEntries(Object.entries(form).filter(([key]) => TRANSLATION_KEYS.has(key)))),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
      qc.invalidateQueries({ queryKey: ["admin-translations"] });
      toast.success("Translation settings saved");
    },
    onError: (error: any) => toast.error(error.message),
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
    onError: (error: any) => toast.error(error.message),
  });

  const processTranslations = useMutation({
    mutationFn: () => api.adminProcessTranslations({ limit: Number(form.translation_batch_limit || status?.batchLimit || 4) || 4 }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["admin-translations"] });
      if (res.started) {
        toast.success("Translation processing started");
        globalThis.setTimeout(() => qc.invalidateQueries({ queryKey: ["admin-translations"] }), 3000);
        return;
      }
      toast.success(`Processed ${res.processed}: ${res.complete} complete, ${res.error} error`);
    },
    onError: (error: any) => toast.error(error.message),
  });

  const isLoading = settingsLoading || statusLoading;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 980 }}>
      {status && (
        <div style={{ border: "1px solid var(--gb-bg2)", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", color: "var(--gb-gray)", fontSize: 12 }}>
            <span>translation: <strong style={{ color: status.configured ? "var(--gb-green)" : "var(--gb-red)" }}>{status.provider}</strong></span>
            <span>{status.enabled ? "enabled" : "disabled"}</span>
            <span>{status.configured ? "configured" : "missing TRANSLATION_API_KEY"}</span>
            <span>queue: {status.queueBinding ? "bound" : "waitUntil fallback"}</span>
            <span>jobs q/r/c/e: {status.jobs.queued}/{status.jobs.running}/{status.jobs.complete}/{status.jobs.error}</span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button className="gb-btn" onClick={() => queueTranslations.mutate()} disabled={queueTranslations.isPending || save.isPending}>
              {queueTranslations.isPending ? "$ queueing..." : "$ queue missing translations"}
            </button>
            <button className="gb-btn" onClick={() => processTranslations.mutate()} disabled={processTranslations.isPending || save.isPending}>
              {processTranslations.isPending ? "$ processing..." : "$ process now"}
            </button>
            <span style={{ color: "var(--gb-gray)", fontSize: 11 }}>
              {status.locales.map((row) => `${row.locale}:${row.complete}`).join(" ")}
            </span>
          </div>
          {status.errors.length > 0 && (
            <div style={{ color: "var(--gb-red)", fontSize: 11, lineHeight: 1.5 }}>
              {status.errors.slice(0, 5).map((row) => `${row.locale} ${row.path}: ${row.error}`).join(" | ")}
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
            {TRANSLATION_FIELDS.map(({ key, label, placeholder, hint, type, options }, index) => (
              <tr key={key}>
                <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>{index + 1}</td>
                <td style={{ fontSize: 12, color: "var(--gb-gray)", whiteSpace: "nowrap", paddingRight: 16 }}>{label}</td>
                <td style={{ paddingRight: 12 }}>
                  {type === "select" ? (
                    <select
                      className="gb-input"
                      value={form[key] ?? placeholder}
                      onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                      style={{ width: "100%", maxWidth: 320 }}
                    >
                      {options?.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  ) : (
                    <input
                      className="gb-input"
                      value={form[key] ?? ""}
                      onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                      placeholder={placeholder}
                      style={{ width: "100%", maxWidth: 320 }}
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
          disabled={save.isPending || settingsLoading}
        >
          {save.isPending ? "$ saving..." : "$ save --translations"}
        </button>
      </div>
    </div>
  );
}
