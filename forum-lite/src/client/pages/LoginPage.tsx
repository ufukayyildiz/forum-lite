import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useLogin } from "../lib/useAuth";
import { api } from "../lib/api";
import { GbToolbar } from "../components/layout/Header";
import { SEOHead } from "../components/SEOHead";
import { toast } from "sonner";

export default function LoginPage() {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const login = useLogin();
  const nextPath = sp.get("next");
  const safeNext = nextPath?.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/";
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [resetting, setResetting] = useState(false);
  const [err, setErr] = useState("");

  async function handle(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      await login.mutateAsync({ identifier, password });
      toast.success("Welcome back");
      navigate(safeNext);
    } catch (e: any) {
      setErr(e.message || "login failed");
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setResetting(true);
    try {
      const res = await api.resetPassword({ email: resetEmail });
      toast.success(res.message || "Yeni şifre e-postaya gönderildi");
      setResetEmail("");
    } catch (e: any) {
      setErr(e.message || "reset failed");
    } finally {
      setResetting(false);
    }
  }

  return (
    <>
      <SEOHead
        title="Login"
        description="Sign in to FSTDESK Forum."
        canonical="/login"
        noindex={true}
        breadcrumbs={[
          { name: "Forum", url: typeof window !== "undefined" ? window.location.origin + "/" : "/" },
          { name: "Login", url: typeof window !== "undefined" ? window.location.origin + "/login" : "/login" },
        ]}
      />
      <GbToolbar crumbs={[{ label: "login" }]} />
      <div className="gb-content" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 400 }}>
        <div style={{ width: "100%", maxWidth: 420, padding: "0 16px" }}>
          <div style={{ marginBottom: 20 }}>
            <div style={{ color: "var(--gb-yellow)", fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
              $ forum --login
            </div>
            <div style={{ color: "var(--gb-gray)", fontSize: 12 }}>authenticate to continue</div>
          </div>

          <form onSubmit={handle} style={{ background: "var(--gb-bg1)", border: "1px solid var(--gb-bg2)", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={{ display: "block", fontSize: 11, color: "var(--gb-gray)", marginBottom: 5, letterSpacing: ".06em" }}>
                --user / --email
              </label>
              <input className="gb-input" value={identifier} onChange={(e) => setIdentifier(e.target.value)}
                placeholder="username_or@email.com" required autoFocus />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11, color: "var(--gb-gray)", marginBottom: 5, letterSpacing: ".06em" }}>
                --password
              </label>
              <input type="password" className="gb-input" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••" required />
            </div>

            {err && (
              <div style={{ fontSize: 12, color: "var(--gb-red)", background: "rgba(251,73,52,.08)", border: "1px solid rgba(251,73,52,.25)", padding: "7px 10px" }}>
                error: {err}
              </div>
            )}

            <button type="submit" className="gb-btn gb-btn-primary" style={{ width: "100%", justifyContent: "center", padding: "7px" }} disabled={login.isPending}>
              {login.isPending ? "$ authenticating..." : "$ login"}
            </button>
          </form>

          <div style={{ textAlign: "center", marginTop: 12, fontSize: 12, color: "var(--gb-gray)" }}>
            no account?{" "}
            <Link to="/register" style={{ color: "var(--gb-yellow)" }}>$ register</Link>
          </div>

          <form onSubmit={handleReset} style={{ marginTop: 18, background: "var(--gb-bg1)", border: "1px solid var(--gb-bg2)", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <label style={{ display: "block", fontSize: 11, color: "var(--gb-gray)", letterSpacing: ".06em" }}>
              --reset-password
            </label>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="email"
                className="gb-input"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                placeholder="email@domain.com"
                required
              />
              <button type="submit" className="gb-btn" style={{ padding: "4px 10px", whiteSpace: "nowrap" }} disabled={resetting}>
                {resetting ? "..." : "$ send"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
