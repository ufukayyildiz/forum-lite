import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { api } from "../../lib/api";
import { toast } from "sonner";
import { useConfirm } from "../../components/ConfirmDialog";

const GB_COLORS = ["#b8bb26","#83a598","#fabd2f","#d3869b","#8ec07c","#fe8019","#fb4934","#a89984","#83a598","#fabd2f"];

function Form({ initial, onSave, onCancel }: { initial?: any; onSave: (v: any) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [desc, setDesc] = useState(initial?.description ?? "");
  const [color, setColor] = useState(initial?.color ?? GB_COLORS[0]);
  const [pos, setPos] = useState(String(initial?.position ?? 0));

  return (
    <div style={{ background: "var(--gb-bg1)", border: "1px solid var(--gb-yellow)", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 11, color: "var(--gb-yellow)", letterSpacing: ".06em", marginBottom: 2 }}>
        " {initial ? "edit category" : "new category"}
      </div>
      {[
        { l: "--name *", v: name, s: setName, p: "category name" },
        { l: "--description", v: desc, s: setDesc, p: "optional description" },
        { l: "--position", v: pos, s: setPos, p: "0", t: "number", w: 100 },
      ].map(({ l, v, s, p, t, w }) => (
        <div key={l}>
          <label style={{ fontSize: 11, color: "var(--gb-gray)", display: "block", marginBottom: 3 }}>{l}</label>
          <input className="gb-input" type={t ?? "text"} value={v} onChange={(e) => s(e.target.value)} placeholder={p} style={w ? { maxWidth: w } : undefined} />
        </div>
      ))}
      <div>
        <label style={{ fontSize: 11, color: "var(--gb-gray)", display: "block", marginBottom: 6 }}>--color</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {GB_COLORS.map((c) => (
            <button key={c} type="button" onClick={() => setColor(c)}
              style={{ width: 20, height: 20, background: c, border: `2px solid ${color === c ? "var(--gb-fg)" : "transparent"}`, cursor: "pointer" }} />
          ))}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button className="gb-btn gb-btn-primary" style={{ padding: "3px 12px" }}
          onClick={() => onSave({ name, description: desc, color, position: Number(pos) })} disabled={!name.trim()}>
          $ save
        </button>
        <button className="gb-btn" style={{ padding: "3px 12px" }} onClick={onCancel}>cancel</button>
      </div>
    </div>
  );
}

export default function AdminCategories() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);

  const { data: cats, isLoading } = useQuery({ queryKey: ["categories"], queryFn: api.categories });

  const create = useMutation({
    mutationFn: api.createCategory,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["categories"] }); setAdding(false); toast.success("Category created"); },
    onError: (e: any) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: ({ id, ...body }: any) => api.updateCategory(id, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["categories"] }); setEditing(null); toast.success("Updated"); },
    onError: (e: any) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: api.deleteCategory,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["categories"] }); toast.success("Deleted"); },
    onError: (e: any) => toast.error(e.message),
  });
  const { ask: askConfirm, dialog: confirmDialog } = useConfirm();

  return (
    <>
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 11, color: "var(--gb-gray)", letterSpacing: ".06em" }}>
          " {cats?.length ?? 0} categories
        </div>
        <button className="gb-btn gb-btn-primary" style={{ padding: "3px 12px" }}
          onClick={() => { setAdding(!adding); setEditing(null); }}>
          <Plus size={13} /> new
        </button>
      </div>

      {adding && (
        <Form onSave={(v) => create.mutate(v)} onCancel={() => setAdding(false)} />
      )}

      <table className="gb-table">
        <thead>
          <tr>
            <th style={{ textAlign: "right", paddingRight: 16 }}>#</th>
            <th style={{ width: 20 }} />
            <th>NAME</th>
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
          ) : cats?.map((cat, i) => (
            editing === cat.id ? (
              <tr key={cat.id}>
                <td colSpan={5} style={{ padding: "8px 0" }}>
                  <Form initial={cat}
                    onSave={(v) => update.mutate({ id: cat.id, ...v })}
                    onCancel={() => setEditing(null)} />
                </td>
              </tr>
            ) : (
              <tr key={cat.id}>
                <td style={{ color: "var(--gb-gray)", textAlign: "right", paddingRight: 16, fontSize: 12 }}>{i + 1}</td>
                <td style={{ width: 20 }}>
                  <span style={{ display: "inline-block", width: 10, height: 10, background: cat.color }} />
                </td>
                <td>
                  <span style={{ color: cat.color, fontWeight: 500, fontSize: 13 }}>{cat.name}</span>
                  {cat.description && (
                    <div style={{ fontSize: 11, color: "var(--gb-gray)" }}>{cat.description}</div>
                  )}
                </td>
                <td style={{ textAlign: "right", paddingRight: 16, color: "var(--gb-aqua)", fontSize: 13 }}>
                  {cat.threadCount}
                </td>
                <td>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button className="gb-btn-icon" title="Edit"
                      onClick={() => { setEditing(cat.id); setAdding(false); }}>
                      <Pencil size={13} />
                    </button>
                    <button className="gb-btn-icon" style={{ color: "var(--gb-red)" }} title="Delete"
                      onClick={() => askConfirm("Delete this category?", () => del.mutate(cat.id), { danger: true, confirmLabel: "delete" })}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            )
          ))}
        </tbody>
      </table>
    </div>
    {confirmDialog}
    </>
  );
}
