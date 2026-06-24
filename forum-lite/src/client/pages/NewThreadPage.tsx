import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import { api } from "../lib/api";
import { useMe } from "../lib/useAuth";
import { GbToolbar } from "../components/layout/Header";
import { SEOHead } from "../components/SEOHead";
import { MarkdownContent } from "../components/MarkdownContent";
import { threadPath } from "../lib/routes";
import { toast } from "sonner";

const TOOLS: [string, string, string][] = [
  ["**", "**", "bold"], ["_", "_", "italic"], ["`", "`", "code"],
  ["\n\n```\n", "\n```\n", "block"], ["\n> ", "\n", "quote"], ["\n- ", "", "list"], ["\n## ", "\n", "heading"],
];
const MAX_TAGS = 5;

export default function NewThreadPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: me, isLoading: meLoading } = useMe();
  const [sp] = useSearchParams();
  const { data: categories } = useQuery({ queryKey: ["categories"], queryFn: api.categories });
  const { data: tags } = useQuery({ queryKey: ["tags"], queryFn: api.tags });

  const defaultCatSlug = sp.get("categorySlug");
  const defaultCatId = sp.get("category");
  const defaultCat = categories?.find((c) => c.slug === defaultCatSlug || String(c.id) === defaultCatId || c.publicId === defaultCatId);

  const [categoryId, setCategoryId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [preview, setPreview] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (defaultCat && !categoryId) setCategoryId(String(defaultCat.id)); }, [defaultCat, categoryId]);
  useEffect(() => {
    if (!meLoading && !me) {
      navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
    }
  }, [location.pathname, location.search, me, meLoading, navigate]);

  const activeCatId = Number(categoryId) || defaultCat?.id;

  const create = useMutation({
    mutationFn: () => api.createThread({ categoryId: activeCatId!, title, content, tagIds: selectedTags }),
    onSuccess: (thread) => { navigate(threadPath(thread)); toast.success("Thread created"); },
    onError: (e: any) => toast.error(e.message),
  });

  function insertTool(before: string, after: string) {
    const ta = textRef.current; if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = content.slice(s, e);
    setContent(content.slice(0, s) + before + sel + after + content.slice(e));
    setTimeout(() => { ta.selectionStart = s + before.length; ta.selectionEnd = s + before.length + sel.length; ta.focus(); }, 0);
  }

  function addTag(id: number) {
    if (!id) return;
    setSelectedTags((prev) => {
      if (prev.includes(id)) return prev;
      if (prev.length >= MAX_TAGS) {
        toast.error(`Max ${MAX_TAGS} tags`);
        return prev;
      }
      return [...prev, id];
    });
  }

  function removeTag(id: number) {
    setSelectedTags((prev) => prev.filter((t) => t !== id));
  }

  const canSubmit = title.trim().length >= 5 && content.trim().length >= 10 && !!activeCatId;
  const selectedTagOptions = tags?.filter((t) => selectedTags.includes(t.id)) ?? [];
  const remainingTagOptions = tags?.filter((t) => !selectedTags.includes(t.id)) ?? [];

  return (
    <>
      <SEOHead title="New Thread" noindex={true} />
      <GbToolbar crumbs={[{ label: "new-thread" }]} />
      <div className="gb-content gb-thread-form-wrap" style={{ padding: "20px", maxWidth: 860 }}>

        {/* mkdir heading */}
        <div style={{ marginBottom: 20, color: "var(--gb-yellow)", fontWeight: 700 }}>$ new thread</div>

        {/* Category */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 11, color: "var(--gb-gray)", marginBottom: 5, letterSpacing: ".06em" }}>
            --category *
          </label>
          <select data-testid="new-thread-category" className="gb-input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} style={{ maxWidth: 320 }}>
            <option value="">select category...</option>
            {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {/* Title */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 11, color: "var(--gb-gray)", marginBottom: 5, letterSpacing: ".06em" }}>
            --title *
          </label>
          <input data-testid="new-thread-title" className="gb-input" placeholder="thread title..." value={title}
            onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
            {title.trim().length > 0 && title.trim().length < 5
              ? <span style={{ fontSize: 11, color: "var(--gb-red)" }}>min 5 characters</span>
              : <span />}
            <span style={{ fontSize: 11, color: "var(--gb-gray)" }}>{title.length}/200</span>
          </div>
        </div>

        {/* Content editor */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
            <label style={{ fontSize: 11, color: "var(--gb-gray)", letterSpacing: ".06em" }}>
              --content *
            </label>
            <div style={{ display: "flex", gap: 4 }}>
              <button className="gb-btn" style={{ fontSize: 11, padding: "2px 8px", color: !preview ? "var(--gb-yellow)" : undefined }}
                onClick={() => setPreview(false)}>{!preview && "> "}write</button>
              <button className="gb-btn" style={{ fontSize: 11, padding: "2px 8px", color: preview ? "var(--gb-yellow)" : undefined }}
                onClick={() => setPreview(true)}>{preview && "> "}preview</button>
            </div>
          </div>

          {!preview ? (
            <div style={{ background: "var(--gb-bg1)", border: "1px solid var(--gb-bg2)" }}>
              <div className="gb-composer-bar">
                {TOOLS.map(([b, a, l]) => (
                  <button key={l} type="button" className="gb-composer-btn" onClick={() => insertTool(b, a)}>{l}</button>
                ))}
              </div>
              <div style={{ padding: 12 }}>
                <textarea data-testid="new-thread-content" ref={textRef} className="gb-input" style={{ background: "transparent", border: "none" }}
                  placeholder="$ write content... (markdown supported)"
                  value={content} onChange={(e) => setContent(e.target.value)} rows={14} />
              </div>
            </div>
          ) : (
            <div style={{ background: "var(--gb-bg1)", border: "1px solid var(--gb-bg2)", minHeight: 200 }}>
              <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--gb-bg2)", fontSize: 11, color: "var(--gb-gray)" }}>
                $ preview --render
              </div>
              {content ? (
                <MarkdownContent content={content} style={{ padding: 16 }} />
              ) : (
                <div className="gb-post-content" style={{ padding: 16, color: "var(--gb-gray)" }}>no content</div>
              )}
            </div>
          )}
        </div>

        {/* Tags */}
        {tags && tags.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 5 }}>
              <label style={{ display: "block", fontSize: 11, color: "var(--gb-gray)", letterSpacing: ".06em" }}>
                --tags (optional)
              </label>
              <span style={{ fontSize: 11, color: selectedTags.length >= MAX_TAGS ? "var(--gb-yellow)" : "var(--gb-gray)" }}>
                {selectedTags.length}/{MAX_TAGS}
              </span>
            </div>
            <select
              className="gb-input"
              data-testid="new-thread-tag-select"
              value=""
              disabled={selectedTags.length >= MAX_TAGS || remainingTagOptions.length === 0}
              onChange={(e) => addTag(Number(e.target.value))}
              style={{ maxWidth: 420, marginBottom: selectedTagOptions.length ? 8 : 0 }}
            >
              <option value="">
                {selectedTags.length >= MAX_TAGS ? "max tags selected" : "select tag..."}
              </option>
              {remainingTagOptions.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {selectedTagOptions.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {selectedTagOptions.map((t) => (
                  <button key={t.id} type="button" data-testid="selected-tag" onClick={() => removeTag(t.id)} style={{
                    fontFamily: "inherit", fontSize: 12, padding: "2px 10px", cursor: "pointer",
                    border: "1px solid var(--gb-aqua)",
                    background: "rgba(142,192,124,.12)",
                    color: "var(--gb-aqua)",
                  }}>
                    {t.name} x
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button className="gb-btn gb-btn-new" style={{ padding: "6px 18px" }}
            onClick={() => create.mutate()} disabled={!canSubmit || create.isPending}>
            {create.isPending ? "$ creating..." : "$ new"}
          </button>
          <button className="gb-btn" style={{ padding: "6px 18px" }} onClick={() => navigate(-1)}>cancel</button>
        </div>
      </div>
    </>
  );
}
