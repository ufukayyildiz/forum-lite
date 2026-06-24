import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useRegister } from "../lib/useAuth";
import { GbToolbar } from "../components/layout/Header";
import { SEOHead } from "../components/SEOHead";
import { toast } from "sonner";

export default function RegisterPage() {
  const navigate = useNavigate();
  const register = useRegister();
  const [form, setForm] = useState({ username: "", email: "", password: "", displayName: "" });
  const [err, setErr] = useState("");

  function set(k: string) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  async function handle(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (form.password.length < 8) { setErr("password must be at least 8 characters"); return; }
    try {
      await register.mutateAsync(form);
      toast.success("Welcome!");
      navigate("/");
    } catch (e: any) {
      setErr(e.message || "registration failed");
    }
  }

  return (
    <>
      <SEOHead
        title="Register"
        description="Create a new FSTDESK Forum account."
        canonical="/register"
        noindex={true}
        breadcrumbs={[
          { name: "Forum", url: typeof window !== "undefined" ? window.location.origin + "/" : "/" },
          { name: "Register", url: typeof window !== "undefined" ? window.location.origin + "/register" : "/register" },
        ]}
      />
      <GbToolbar crumbs={[{ label: "register" }]} />
      <div className="gb-content" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 400 }}>
        <div style={{ width: "100%", maxWidth: 440, padding: "0 16px" }}>
          <div style={{ marginBottom: 20 }}>
            <div style={{ color: "var(--gb-yellow)", fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
              $ forum --register
            </div>
            <div style={{ color: "var(--gb-gray)", fontSize: 12 }}>create a new account</div>
          </div>

          <form onSubmit={handle} style={{ background: "var(--gb-bg1)", border: "1px solid var(--gb-bg2)", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
            {[
              { k: "username", l: "--username *", p: "abc123 (max 12 chars)", pat: "[a-z0-9]+", min: 3, max: 12, note: "lowercase letters and digits only, cannot be changed later" },
              { k: "displayName", l: "--display-name", p: "Display Name (optional)", max: 60 },
              { k: "email", l: "--email *", p: "you@example.com", type: "email" },
              { k: "password", l: "--password *", p: "min 8 characters", type: "password", min: 8 },
            ].map(({ k, l, p, type, pat, min, max, note }) => (
              <div key={k}>
                <label style={{ display: "block", fontSize: 11, color: "var(--gb-gray)", marginBottom: 5, letterSpacing: ".06em" }}>
                  {l}
                </label>
                <input
                  className="gb-input"
                  type={type ?? "text"}
                  value={(form as any)[k]}
                  onChange={set(k)}
                  placeholder={p}
                  pattern={pat}
                  minLength={min}
                  maxLength={max}
                  required={l.includes("*")}
                  autoFocus={k === "username"}
                />
                {note && <div style={{ fontSize: 11, color: "var(--gb-gray)", marginTop: 3 }}># {note}</div>}
              </div>
            ))}

            {err && (
              <div style={{ fontSize: 12, color: "var(--gb-red)", background: "rgba(251,73,52,.08)", border: "1px solid rgba(251,73,52,.25)", padding: "7px 10px" }}>
                error: {err}
              </div>
            )}

            <button type="submit" className="gb-btn gb-btn-primary" style={{ width: "100%", justifyContent: "center", padding: "7px" }} disabled={register.isPending}>
              {register.isPending ? "$ creating..." : "$ create-account"}
            </button>
          </form>

          <div style={{ textAlign: "center", marginTop: 12, fontSize: 12, color: "var(--gb-gray)" }}>
            have an account?{" "}
            <Link to="/login" style={{ color: "var(--gb-yellow)" }}>$ login</Link>
          </div>
        </div>
      </div>
    </>
  );
}
