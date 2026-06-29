import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../../lib/api";

const DEFAULTS: Record<string, string> = {
  ads_enabled: "false",
  ads_disable_adsense_for_admins: "true",
  ads_post_interval: "3",
  ads_topic_interval: "7",
  ads_user_interval: "7",
  ads_tag_interval: "7",
  ads_mobile_post_interval: "3",
  ads_mobile_topic_interval: "7",
  ads_mobile_user_interval: "7",
  ads_mobile_tag_interval: "7",
  ad_desktop_html: "",
  ad_mobile_html: "",
  ad_sidebar_html: "",
  ad_thread_html: "",
  ads_txt: "",
};
const AD_SETTING_KEYS = Object.keys(DEFAULTS);

const ROWS = [
  { key: "ads_enabled", label: "--ads-enabled", placeholder: "true" },
  {
    key: "ads_disable_adsense_for_admins",
    label: "--disable-adsense-for-admins",
    placeholder: "true",
    type: "boolean",
    hint: "true = admin sees only in-house fallback ads",
  },
];

const INTERVAL_ROWS = [
  { label: "--post-interval", desktop: "ads_post_interval", mobile: "ads_mobile_post_interval", placeholder: "3" },
  { label: "--topic-interval", desktop: "ads_topic_interval", mobile: "ads_mobile_topic_interval", placeholder: "7" },
  { label: "--user-interval", desktop: "ads_user_interval", mobile: "ads_mobile_user_interval", placeholder: "7" },
  { label: "--tag-interval", desktop: "ads_tag_interval", mobile: "ads_mobile_tag_interval", placeholder: "7" },
];

export default function AdminAds() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin-settings"], queryFn: api.adminSettings });
  const [form, setForm] = useState<Record<string, string>>(DEFAULTS);

  useEffect(() => {
    if (!data) return;
    const merged = { ...DEFAULTS, ...data };
    merged.ad_desktop_html = merged.ad_desktop_html || merged.ad_thread_html || "";
    merged.ad_thread_html = merged.ad_desktop_html;
    merged.ad_mobile_html = merged.ad_mobile_html || "";
    setForm(merged);
  }, [data]);

  const save = useMutation({
    mutationFn: () => {
      const payload = Object.fromEntries(AD_SETTING_KEYS.map((key) => [key, form[key] ?? ""]));
      payload.ad_thread_html = form.ad_desktop_html || form.ad_thread_html || "";
      return api.adminSaveSettings(payload);
    },
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
                    {row.type === "boolean" ? (
                      <label style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--gb-fg)", fontSize: 12 }}>
                        <input
                          type="checkbox"
                          checked={(form[row.key] ?? "false") === "true"}
                          onChange={(e) => setForm((f) => ({ ...f, [row.key]: e.target.checked ? "true" : "false" }))}
                        />
                        <span>{(form[row.key] ?? "false") === "true" ? "on" : "off"}</span>
                        {row.hint && <span style={{ color: "var(--gb-gray)" }}>{row.hint}</span>}
                      </label>
                    ) : (
                      <input
                        className="gb-input"
                        value={form[row.key] ?? ""}
                        onChange={(e) => setForm((f) => ({ ...f, [row.key]: e.target.value }))}
                        placeholder={row.placeholder}
                        style={{ width: "100%", maxWidth: 320 }}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <table className="gb-table">
            <thead>
              <tr>
                <th style={{ textAlign: "right", paddingRight: 16 }}>#</th>
                <th>INTERVAL</th>
                <th>DESKTOP</th>
                <th>MOBILE</th>
              </tr>
            </thead>
            <tbody>
              {INTERVAL_ROWS.map((row, i) => (
                <tr key={row.desktop}>
                  <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>{i + 2}</td>
                  <td style={{ fontSize: 12, color: "var(--gb-gray)", whiteSpace: "nowrap", paddingRight: 16 }}>{row.label}</td>
                  <td>
                    <input
                      className="gb-input"
                      value={form[row.desktop] ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, [row.desktop]: e.target.value }))}
                      placeholder={row.placeholder}
                      inputMode="numeric"
                      style={{ width: "100%", maxWidth: 180 }}
                    />
                  </td>
                  <td>
                    <input
                      className="gb-input"
                      value={form[row.mobile] ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, [row.mobile]: e.target.value }))}
                      placeholder={row.placeholder}
                      inputMode="numeric"
                      style={{ width: "100%", maxWidth: 180 }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <table className="gb-table">
            <tbody>
              <tr>
                <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, width: 40, fontSize: 12 }}>6</td>
                <td style={{ color: "var(--gb-gray)", width: 180, fontSize: 12 }}>--desktop-ad-code</td>
                <td>
                  <textarea
                    className="gb-input"
                    value={form.ad_desktop_html ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_desktop_html: e.target.value, ad_thread_html: e.target.value }))}
                    rows={10}
                    placeholder="<script async src=&quot;https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-...&quot; crossorigin=&quot;anonymous&quot;></script>&#10;<ins class=&quot;adsbygoogle&quot; ...></ins>&#10;<script>(adsbygoogle = window.adsbygoogle || []).push({});</script>"
                    style={{ width: "100%", maxWidth: 620 }}
                  />
                </td>
              </tr>
              <tr>
                <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>7</td>
                <td style={{ color: "var(--gb-gray)", width: 180, fontSize: 12 }}>--mobile-ad-code</td>
                <td>
                  <textarea
                    className="gb-input"
                    value={form.ad_mobile_html ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_mobile_html: e.target.value }))}
                    rows={10}
                    placeholder="optional mobile-specific Adsense code; blank falls back to desktop"
                    style={{ width: "100%", maxWidth: 620 }}
                  />
                </td>
              </tr>
              <tr>
                <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>8</td>
                <td style={{ color: "var(--gb-gray)", width: 180, fontSize: 12 }}>--sidebar-sticky-ad-code</td>
                <td>
                  <textarea
                    className="gb-input"
                    value={form.ad_sidebar_html ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, ad_sidebar_html: e.target.value }))}
                    rows={8}
                    placeholder="desktop sidebar 200x200 small square Adsense code; hidden on mobile"
                    style={{ width: "100%", maxWidth: 620 }}
                  />
                </td>
              </tr>
              <tr>
                <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>9</td>
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
