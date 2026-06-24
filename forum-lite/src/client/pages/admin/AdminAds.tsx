import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../../lib/api";

const DEFAULTS: Record<string, string> = {
  ads_enabled: "false",
  ads_post_interval: "3",
  ad_thread_html: "",
  ads_txt: "",
};
const AD_SETTING_KEYS = Object.keys(DEFAULTS);

const ROWS = [
  { key: "ads_enabled", label: "--ads-enabled", placeholder: "true" },
  { key: "ads_post_interval", label: "--post-interval", placeholder: "3" },
];

export default function AdminAds() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin-settings"], queryFn: api.adminSettings });
  const [form, setForm] = useState<Record<string, string>>(DEFAULTS);

  useEffect(() => {
    if (data) setForm({ ...DEFAULTS, ...data });
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api.adminSaveSettings(Object.fromEntries(AD_SETTING_KEYS.map((key) => [key, form[key] ?? ""]))),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-settings"] });
      qc.invalidateQueries({ queryKey: ["ads-config"] });
      toast.success("Ads saved");
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 860 }}>
      {isLoading ? (
        <div style={{ color: "var(--gb-gray)" }}>$ loading...</div>
      ) : (
        <>
          <table className="gb-table">
            <thead>
              <tr>
                <th style={{ textAlign: "right", paddingRight: 16 }}>#</th>
                <th>KEY</th>
                <th>VALUE</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, i) => (
                <tr key={row.key}>
                  <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>{i + 1}</td>
                  <td style={{ fontSize: 12, color: "var(--gb-gray)", whiteSpace: "nowrap", paddingRight: 16 }}>{row.label}</td>
                  <td>
                    <input
                      className="gb-input"
                      value={form[row.key] ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, [row.key]: e.target.value }))}
                      placeholder={row.placeholder}
                      style={{ width: "100%", maxWidth: 320 }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <table className="gb-table">
            <tbody>
              <tr>
                <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, width: 40, fontSize: 12 }}>3</td>
                <td style={{ color: "var(--gb-gray)", width: 180, fontSize: 12 }}>--ad-code</td>
                <td>
                  <textarea
                    className="gb-input"
                    value={form.ad_thread_html ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_thread_html: e.target.value }))}
                    rows={10}
                    placeholder="<script async src=&quot;https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-...&quot; crossorigin=&quot;anonymous&quot;></script>&#10;<ins class=&quot;adsbygoogle&quot; ...></ins>&#10;<script>(adsbygoogle = window.adsbygoogle || []).push({});</script>"
                    style={{ width: "100%", maxWidth: 620 }}
                  />
                </td>
              </tr>
              <tr>
                <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>4</td>
                <td style={{ color: "var(--gb-gray)", width: 180, fontSize: 12 }}>--ads-txt</td>
                <td>
                  <textarea
                    className="gb-input"
                    value={form.ads_txt ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ads_txt: e.target.value }))}
                    rows={4}
                    placeholder="google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0"
                    style={{ width: "100%", maxWidth: 620 }}
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      <div style={{ paddingTop: 4 }}>
        <button
          className="gb-btn gb-btn-primary"
          style={{ padding: "5px 18px" }}
          onClick={() => save.mutate()}
          disabled={save.isPending || isLoading}
        >
          {save.isPending ? "$ saving..." : "$ save --ads"}
        </button>
      </div>
    </div>
  );
}
