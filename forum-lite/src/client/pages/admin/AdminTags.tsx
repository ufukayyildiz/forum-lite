import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus } from "lucide-react";
import { api } from "../../lib/api";
import { toast } from "sonner";
import { useConfirm } from "../../components/ConfirmDialog";

export default function AdminTags() {
  const qc = useQueryClient();
  const [newTag, setNewTag] = useState("");

  const { data: tags, isLoading } = useQuery({ queryKey: ["tags"], queryFn: api.tags });

  const create = useMutation({
    mutationFn: () => api.createTag(newTag.trim()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tags"] }); setNewTag(""); toast.success("Tag created"); },
    onError: (e: any) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (slug: string) => api.deleteTag(slug),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tags"] }); toast.success("Tag deleted"); },
    onError: (e: any) => toast.error(e.message),
  });
  const { ask: askConfirm, dialog: confirmDialog } = useConfirm();

  return (
    <>
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

      {/* Create row */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--gb-bg2)" }}>
        <span style={{ fontSize: 11, color: "var(--gb-gray)", whiteSpace: "nowrap" }}>$ mkdir tag /</span>
        <input
          className="gb-input"
          placeholder="tag name..."
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && newTag.trim().length >= 2) create.mutate(); }}
          maxLength={40}
          style={{ maxWidth: 240 }}
        />
        <button
          className="gb-btn gb-btn-primary"
          style={{ padding: "3px 12px", whiteSpace: "nowrap" }}
          onClick={() => create.mutate()}
          disabled={newTag.trim().length < 2 || create.isPending}
        >
          <Plus size={13} /> {create.isPending ? "creating..." : "create"}
        </button>
      </div>

      <table className="gb-table">
        <thead>
          <tr>
            <th style={{ textAlign: "right", paddingRight: 16 }}>#</th>
            <th style={{ width: 20 }} />
            <th>TAG</th>
            <th style={{ textAlign: "right", paddingRight: 16 }}>THREADS</th>
            <th>ACTIONS</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16 }}>~</td>
              <td colSpan={4} style={{ color: "var(--gb-gray)" }}>$ loading...</td>
            </tr>
          ) : (tags ?? []).map((t, i) => (
            <tr key={t.id}>
              <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>{i + 1}</td>
              <td style={{ width: 20 }}>
                <span style={{ color: "var(--gb-aqua)", fontSize: 13 }}>#</span>
              </td>
              <td>
                <span style={{ color: "var(--gb-aqua)", fontSize: 13 }}>{t.name}</span>
                <span style={{ fontSize: 11, color: "var(--gb-bg3)", marginLeft: 8 }}>{t.slug}</span>
              </td>
              <td style={{ textAlign: "right", paddingRight: 16, color: "var(--gb-fg4)", fontSize: 13 }}>
                {t.threadCount}
              </td>
              <td>
                <button
                  className="gb-btn gb-btn-danger"
                  style={{ fontSize: 11, padding: "2px 10px" }}
                  onClick={() => askConfirm(`Delete tag "${t.name}"?`, () => remove.mutate(t.slug), { danger: true, confirmLabel: "delete" })}
                  disabled={remove.isPending}
                >
                  delete
                </button>
              </td>
            </tr>
          ))}
          {!isLoading && !tags?.length && (
            <tr>
              <td style={{ color: "var(--gb-bg3)", textAlign: "right", paddingRight: 16 }}>~</td>
              <td colSpan={4} style={{ color: "var(--gb-gray)" }}>no tags yet</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
    {confirmDialog}
    </>
  );
}
