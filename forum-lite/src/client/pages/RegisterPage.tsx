import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useRegister } from "../lib/useAuth";
import { GbToolbar } from "../components/layout/Header";
import { SEOHead } from "../components/SEOHead";
import { toast } from "sonner";
import { api } from "../lib/api";

export default function RegisterPage() {
  const navigate = useNavigate();
  const register = useRegister();
  const [form, setForm] = useState({ username: "", email: "", displayName: "" });
  const [err, setErr] = useState("");
  const [availability, setAvailability] = useState<{ usernameAvailable: boolean; emailAvailable: boolean; emailSuppressed: boolean } | null>(null);

  function set(k: string) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = k === "username" ? e.target.value.toLowerCase().replace(/[^a-z0-9]/g, "") : e.target.value;
      setForm((f) => ({ ...f, [k]: value }));
    };
  }

  useEffect(() => {
    const usernameReady = /^[a-z0-9]{3,12}$/.test(form.username);
    const emailReady = form.email.includes("@") && form.email.includes(".");
    if (!usernameReady && !emailReady) {
      setAvailability(null);
      return;
    }

    const timer = window.setTimeout(() => {
      api.checkAvailability({
        ...(usernameReady ? { username: form.username } : {}),
        ...(emailReady ? { email: form.email.trim().toLowerCase() } : {}),
      })
        .then(setAvailability)
        .catch(() => setAvailability(null));
    }, 300);

    return () => window.clearTimeout(timer);
  }, [form.username, form.email]);

  async function handle(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (availability?.usernameAvailable === false) { setErr("username is already in use"); return; }
    if (availability?.emailAvailable === false) { setErr("email is already in use"); return; }
    if (availability?.emailSuppressed) { setErr("email cannot receive forum emails"); return; }
    try {
      const res = await register.mutateAsync(form);
      toast.success(res.message || "Password emailed");
      navigate("/login");
    } catch (e: any) {
      setErr(e.message || "registration failed");
    }
  }

  return (
    <>
      <SEOHead
        title="Register"
        description="Create a new FSTDESK account."
        canonical="/register"
        noindex={true}
        breadcrumbs={[
          { name: "FSTDESK", url: typeof window !== "undefined" ? window.location.origin + "/" : "/" },
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
            <div style={{ color: "var(--gb-gray)", fontSize: 12 }}>create account, receive password by email</div>
          </div>

          <form onSubmit={handle} style={{ background: "var(--gb-bg1)", border: "1px solid var(--gb-bg2)", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
            {[
              { k: "username", l: "--username *", p: "abc123 (max 12 chars)", pat: "[a-z0-9]+", min: 3, max: 12, note: "lowercase letters and digits only, cannot be changed later" },
              { k: "displayName", l: "--display-name", p: "Display Name (optional)", max: 60 },
              { k: "email", l: "--email *", p: "you@example.com", type: "email" },
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
                {k === "username" && availability?.usernameAvailable === false && (
                  <div style={{ fontSize: 11, color: "var(--gb-red)", marginTop: 3 }}># username already exists</div>
                )}
                {k === "username" && availability?.usernameAvailable === true && (
                  <div style={{ fontSize: 11, color: "var(--gb-aqua)", marginTop: 3 }}># username available</div>
                )}
                {k === "email" && availability?.emailAvailable === false && (
                  <div style={{ fontSize: 11, color: "var(--gb-red)", marginTop: 3 }}># email already exists</div>
                )}
                {k === "email" && availability?.emailSuppressed && (
                  <div style={{ fontSize: 11, color: "var(--gb-red)", marginTop: 3 }}># this email is suppressed</div>
                )}
              </div>
            ))}

            <div style={{ fontSize: 11, color: "var(--gb-gray)", lineHeight: 1.6 }}>
              # no password field; FSTDESK sends an 8-character temporary password to your email.
              Your email is marked verified after the first successful login.
            </div>

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
