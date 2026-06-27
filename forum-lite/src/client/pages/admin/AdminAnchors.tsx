import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, type AnchorLink } from "../../lib/api";
import { relativeTime } from "../../lib/utils";

const EMPTY_FORM = { term: "", url: "", title: "", enabled: true };

export default function AdminAnchors() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [autoLimit, setAutoLimit] = useState(10);
  const [autoResult, setAutoResult] = useState<{ created: number; skipped: number; found: number } | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-anchors", q],
    queryFn: () => api.adminAnchors(q),
  });

  const anchors = data?.anchors ?? [];
  const editing = editingId ? anchors.find((a) => a.id === editingId) ?? null : null;

  useEffect(() => {
    if (!editing) return;
    setForm({
      term: editing.term,
      url: editing.url,
      title: editing.title,
      enabled: editing.enabled,
    });
  }, [editing]);

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["admin-anchors"] }),
      qc.invalidateQueries({ queryKey: ["anchors"] }),
    ]);
  };

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        term: form.term.trim(),
        url: form.url.trim(),
        title: form.title.trim() || form.term.trim(),
        enabled: form.enabled,
      };
      if (!payload.term || !payload.url) throw new Error("Term and URL are required");
      return editingId ? api.adminUpdateAnchor(editingId, payload) : api.adminCreateAnchor(payload);
    },
    onSuccess: async () => {
      setForm(EMPTY_FORM);
      setEditingId(null);
      await refresh();
      toast.success("Anchor saved");
    },
    onError: (error: any) => toast.error(error?.message ?? "Anchor save failed"),
  });

  const autoFind = useMutation({
    mutationFn: () => {
      const term = form.term.trim();
      if (!term) throw new Error("Term is required");
      return api.adminAutoAnchors({ term, limit: autoLimit, enabled: form.enabled });
    },
    onSuccess: async (result) => {
      setAutoResult({ created: result.created, skipped: result.skipped, found: result.found });
      await refresh();
      toast.success(`Auto anchors: ${result.created} created, ${result.skipped} skipped`);
    },
    onError: (error: any) => toast.error(error?.message ?? "Auto anchor search failed"),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.adminDeleteAnchor(id),
    onSuccess: async () => {
      await refresh();
      toast.success("Anchor deleted");
    },
    onError: (error: any) => toast.error(error?.message ?? "Anchor delete failed"),
  });

  const toggle = useMutation({
    mutationFn: (anchor: AnchorLink) => api.adminUpdateAnchor(anchor.id, { enabled: !anchor.enabled }),
    onSuccess: refresh,
    onError: (error: any) => toast.error(error?.message ?? "Anchor update failed"),
  });

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  return (
    <div className="gb-admin-anchor-page">
      <div className="gb-admin-anchor-head">
        <div>
          <h3 style={{ margin: 0, color: "var(--gb-yellow)", fontSize: 14 }}>$ anchors</h3>
          <p style={{ margin: "8px 0 0", color: "var(--gb-gray)", fontSize: 12 }}>
            Type a term, auto-find matching threads/posts, and link those pages to each other. Manual internal targets are still supported.
          </p>
        </div>
        <input
          className="gb-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="search anchors..."
          style={{ maxWidth: 320 }}
        />
      </div>

      <div className="gb-admin-anchor-form">
        <label>
          <span>TERM</span>
          <input
            className="gb-input"
            value={form.term}
            onChange={(e) => setForm((f) => ({ ...f, term: e.target.value }))}
            placeholder="recipe"
            maxLength={80}
          />
        </label>
        <label>
          <span>URL</span>
          <input
            className="gb-input"
            value={form.url}
            onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
            placeholder="/t/253989"
            maxLength={500}
          />
        </label>
        <label>
          <span>TITLE</span>
          <input
            className="gb-input"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="preview title"
            maxLength={160}
          />
        </label>
        <label className="gb-admin-anchor-check">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
          />
          enabled
        </label>
        <button className="gb-btn gb-btn-primary" onClick={() => save.mutate()} disabled={save.isPending}>
          {editingId ? "$ update" : "$ add"}
        </button>
        {editingId && <button className="gb-btn" onClick={resetForm}>cancel</button>}
      </div>

      <div className="gb-admin-anchor-auto">
        <span>$ auto target finder</span>
        <span>scan thread titles, first posts and replies for the term above</span>
        <label>
          <span>LIMIT</span>
          <input
            className="gb-input"
            type="number"
            min={1}
            max={50}
            value={autoLimit}
            onChange={(e) => setAutoLimit(Math.max(1, Math.min(50, Number(e.target.value) || 10)))}
          />
        </label>
        <button className="gb-btn gb-btn-primary" onClick={() => autoFind.mutate()} disabled={autoFind.isPending || !form.term.trim()}>
          {autoFind.isPending ? "$ finding..." : "$ find & add targets"}
        </button>
        {autoResult && (
          <span className="gb-admin-anchor-result">
            {autoResult.created} created / {autoResult.skipped} skipped / {autoResult.found} found
          </span>
        )}
      </div>

      <div style={{ color: "var(--gb-gray)", fontSize: 12 }}>
        {isLoading ? "$ loading..." : `${anchors.length} anchors listed`}
      </div>

      <table className="gb-table">
        <thead>
          <tr>
            <th style={{ width: 42 }}>#</th>
            <th>TERM</th>
            <th>URL</th>
            <th>TITLE</th>
            <th style={{ width: 90 }}>CLICKS</th>
            <th style={{ width: 92 }}>STATUS</th>
            <th style={{ width: 92 }}>UPDATED</th>
            <th style={{ width: 180 }}>ACTIONS</th>
          </tr>
        </thead>
        <tbody>
          {anchors.map((anchor, index) => (
            <tr key={anchor.id}>
              <td>{index + 1}</td>
              <td style={{ color: "var(--gb-green)", fontWeight: 700 }}>{anchor.term}</td>
              <td className="gb-admin-anchor-url">{anchor.url}</td>
              <td>{anchor.title || "-"}</td>
              <td style={{ color: "var(--gb-yellow)" }}>{anchor.clickCount}</td>
              <td style={{ color: anchor.enabled ? "var(--gb-green)" : "var(--gb-red)" }}>
                {anchor.enabled ? "enabled" : "off"}
              </td>
              <td>{anchor.updatedAt ? relativeTime(anchor.updatedAt) : "-"}</td>
              <td>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button className="gb-btn" onClick={() => setEditingId(anchor.id)}>edit</button>
                  <button className="gb-btn" onClick={() => toggle.mutate(anchor)}>
                    {anchor.enabled ? "disable" : "enable"}
                  </button>
                  <button className="gb-btn" style={{ color: "var(--gb-red)" }} onClick={() => remove.mutate(anchor.id)}>
                    del
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {!isLoading && !anchors.length && (
            <tr>
              <td colSpan={8} style={{ color: "var(--gb-gray)" }}>~ no anchors yet</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
