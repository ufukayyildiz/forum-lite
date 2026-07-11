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

function shortTime(value: number | null | undefined) {
  if (!value) return "-";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - value));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function timeUntil(value: number | null | undefined) {
  if (!value) return "-";
  const seconds = Math.floor(value - Date.now() / 1000);
  if (seconds <= 0) return "expired";
  if (seconds < 60) return `${seconds}s left`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes}m left`;
}

export default function AdminTranslations() {
  const qc = useQueryClient();
  const { data: settings, isLoading: settingsLoading } = useQuery({ queryKey: ["admin-settings"], queryFn: api.adminSettings });
  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["admin-translations"],
    queryFn: api.adminTranslations,
    refetchInterval: 5000,
  });
  const [form, setForm] = useState<Record<string, string>>({});
  const [queueStarted, setQueueStarted] = useState(false);
  const [processStarted, setProcessStarted] = useState(false);

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
    mutationFn: (locale?: string) => api.adminQueueTranslations({ limit: 10000, ...(locale ? { locale } : {}) }),
    onSuccess: (res) => {
      setQueueStarted(true);
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
    mutationFn: (locale?: string) => api.adminProcessTranslations({ limit: Number(form.translation_batch_limit || status?.batchLimit || 4) || 4, ...(locale ? { locale } : {}) }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["admin-translations"] });
      if (res.started) {
        setProcessStarted(true);
        toast.success(res.queuedProcessor ? "Translation processor queued" : "Translation processing started");
        globalThis.setTimeout(() => qc.invalidateQueries({ queryKey: ["admin-translations"] }), 3000);
        globalThis.setTimeout(() => setProcessStarted(false), 12000);
        return;
      }
      toast.success(`Processed ${res.processed}: ${res.complete} complete, ${res.error} error`);
    },
    onError: (error: any) => toast.error(error.message),
  });

  const queuedJobs = status?.jobs.queued ?? 0;
  const runningJobs = status?.jobs.running ?? 0;
  const queueReady = queuedJobs > 0;
  const processDisabled = processTranslationsDisabled(status, processTranslations.isPending, queueTranslations.isPending, save.isPending, queueStarted, processStarted);
  const processHint = processHintText(status, queueStarted, processStarted);
  const isLoading = settingsLoading || statusLoading;

  useEffect(() => {
    if (queueStarted && (queuedJobs > 0 || runningJobs > 0)) setQueueStarted(false);
  }, [queueStarted, queuedJobs, runningJobs]);

  useEffect(() => {
    if (processStarted && runningJobs > 0) setProcessStarted(false);
  }, [processStarted, runningJobs]);

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
            <button className="gb-btn" onClick={() => queueTranslations.mutate(undefined)} disabled={queueTranslations.isPending || queueStarted || save.isPending}>
              {queueTranslations.isPending ? "$ queueing..." : "$ queue all languages"}
            </button>
            <button
              className="gb-btn"
              onClick={() => processTranslations.mutate(undefined)}
              disabled={processDisabled}
              title={processHint}
            >
              {processTranslations.isPending ? "$ processing..." : "$ process now"}
            </button>
            <span style={{ color: queueReady ? "var(--gb-green)" : "var(--gb-yellow)", fontSize: 11 }}>
              {processHint}
            </span>
          </div>
          {queueStarted && !queueReady && runningJobs === 0 && (
            <div style={{ color: "var(--gb-yellow)", fontSize: 11 }}>
              queue started; waiting until jobs appear in queued/running counts...
            </div>
          )}
          {status.recoveredStale > 0 && (
            <div style={{ color: "var(--gb-yellow)", fontSize: 11 }}>
              recovered stale running jobs: {status.recoveredStale}
            </div>
          )}
          {status.errors.length > 0 && (
            <div style={{ color: "var(--gb-red)", fontSize: 11, lineHeight: 1.5 }}>
              {status.errors.slice(0, 5).map((row) => `${row.locale} ${row.path}: ${row.error}`).join(" | ")}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 10 }}>
            <TranslationJobPanel title="$ running now" jobs={status.runningJobs} empty="no running translation job" showLock />
            <TranslationJobPanel title="$ next queued" jobs={status.nextJobs.slice(0, 8)} empty="queue is empty" />
          </div>
          <table className="gb-table" style={{ marginTop: 2 }}>
            <thead>
              <tr>
                <th style={{ width: 52 }}>LANG</th>
                <th>LABEL</th>
                <th style={{ textAlign: "right", paddingRight: 12 }}>QUEUED</th>
                <th style={{ textAlign: "right", paddingRight: 12 }}>RUNNING</th>
                <th style={{ textAlign: "right", paddingRight: 12 }}>DONE</th>
                <th style={{ textAlign: "right", paddingRight: 12 }}>ERROR</th>
                <th style={{ textAlign: "right", paddingRight: 12 }}>TRANSLATED</th>
                <th style={{ width: 150 }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {status.byLocale.map((row) => (
                <tr key={row.locale}>
                  <td style={{ color: row.queued > 0 ? "var(--gb-yellow)" : "var(--gb-gray)", fontWeight: 700 }}>{row.locale}</td>
                  <td>{row.label}</td>
                  <td style={{ color: row.queued > 0 ? "var(--gb-yellow)" : "var(--gb-gray)", textAlign: "right", paddingRight: 12 }}>{row.queued}</td>
                  <td style={{ color: row.running > 0 ? "var(--gb-blue)" : "var(--gb-gray)", textAlign: "right", paddingRight: 12 }}>{row.running}</td>
                  <td style={{ color: "var(--gb-green)", textAlign: "right", paddingRight: 12 }}>{row.complete}</td>
                  <td style={{ color: row.error > 0 ? "var(--gb-red)" : "var(--gb-gray)", textAlign: "right", paddingRight: 12 }}>{row.error}</td>
                  <td style={{ color: "var(--gb-green)", textAlign: "right", paddingRight: 12 }}>{row.translated}</td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button
                        className="gb-btn"
                        style={{ padding: "3px 8px" }}
                        onClick={() => queueTranslations.mutate(row.locale)}
                        disabled={queueTranslations.isPending || save.isPending}
                      >
                        $ queue
                      </button>
                      <button
                        className="gb-btn"
                        style={{ padding: "3px 8px" }}
                        onClick={() => processTranslations.mutate(row.locale)}
                        disabled={processStarted || processTranslations.isPending || queueTranslations.isPending || save.isPending || !status.enabled || !status.configured || status.jobs.running > 0 || row.queued <= 0}
                      >
                        {row.running > 0 ? "$ running" : "$ process"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ color: "var(--gb-gray)", fontSize: 11 }}>$ recent translation jobs</div>
          <table className="gb-table">
            <thead>
              <tr>
                <th style={{ width: 52 }}>LANG</th>
                <th>PATH</th>
                <th style={{ width: 82 }}>STATUS</th>
                <th style={{ width: 70 }}>TRY</th>
                <th style={{ width: 70 }}>UPDATED</th>
                <th>ERROR</th>
              </tr>
            </thead>
            <tbody>
              {status.recentJobs.length > 0 ? status.recentJobs.map((job) => (
                <tr key={`${job.locale}-${job.path}-${job.updatedAt}`}>
                  <td style={{ color: "var(--gb-yellow)", fontWeight: 700 }}>{job.locale}</td>
                  <td style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.path}</td>
                  <td style={{ color: job.status === "error" ? "var(--gb-red)" : job.status === "queued" ? "var(--gb-yellow)" : job.status === "running" ? "var(--gb-blue)" : "var(--gb-green)" }}>{job.status}</td>
                  <td>{job.attempts}</td>
                  <td>{shortTime(job.updatedAt)}</td>
                  <td style={{ color: job.error ? "var(--gb-red)" : "var(--gb-gray)", maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.error || "-"}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6} style={{ color: "var(--gb-gray)" }}>no translation jobs yet</td>
                </tr>
              )}
            </tbody>
          </table>
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

function TranslationJobPanel({
  title,
  jobs,
  empty,
  showLock = false,
}: {
  title: string;
  jobs: Array<{ locale: string; path: string; attempts: number; updatedAt: number; lockedUntil: number | null }>;
  empty: string;
  showLock?: boolean;
}) {
  return (
    <div style={{ border: "1px solid var(--gb-bg2)", padding: 8 }}>
      <div style={{ color: "var(--gb-gray)", fontSize: 11, marginBottom: 6 }}>{title}</div>
      {jobs.length > 0 ? (
        <table className="gb-table">
          <tbody>
            {jobs.map((job) => (
              <tr key={`${title}-${job.locale}-${job.path}-${job.updatedAt}`}>
                <td style={{ width: 42, color: "var(--gb-yellow)", fontWeight: 700 }}>{job.locale}</td>
                <td style={{ maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.path}</td>
                <td style={{ width: 58, color: "var(--gb-gray)" }}>try {job.attempts}</td>
                <td style={{ width: showLock ? 120 : 70, color: showLock ? "var(--gb-blue)" : "var(--gb-gray)" }}>
                  {showLock ? `${shortTime(job.updatedAt)} / ${timeUntil(job.lockedUntil)}` : shortTime(job.updatedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div style={{ color: "var(--gb-gray)", fontSize: 12 }}>{empty}</div>
      )}
    </div>
  );
}

function processTranslationsDisabled(
  status: Awaited<ReturnType<typeof api.adminTranslations>> | undefined,
  processPending: boolean,
  queuePending: boolean,
  savePending: boolean,
  queueStarted: boolean,
  processStarted: boolean,
) {
  if (processPending || queuePending || savePending || queueStarted || processStarted) return true;
  if (!status?.enabled || !status.configured) return true;
  if (status.jobs.running > 0) return true;
  if (status.jobs.queued <= 0) return true;
  return false;
}

function processHintText(status: Awaited<ReturnType<typeof api.adminTranslations>> | undefined, queueStarted: boolean, processStarted: boolean) {
  if (!status) return "loading translation status";
  if (!status.enabled) return "translation disabled";
  if (!status.configured) return "missing TRANSLATION_API_KEY";
  if (processStarted) return "processor queued; waiting for running job";
  if (status.jobs.queued > 0 && status.jobs.running > 0) return `${status.jobs.running} running; wait before next process`;
  if (status.jobs.queued > 0) return `${status.jobs.queued} queued jobs ready; process now is safe`;
  if (status.jobs.running > 0) return `${status.jobs.running} jobs already running`;
  if (queueStarted) return "waiting for queue to create jobs";
  return "queue missing translations first";
}
