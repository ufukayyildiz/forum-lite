import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../lib/api";
import { useMe } from "../lib/useAuth";
import { SEOHead } from "../components/SEOHead";
import { GbToolbar } from "../components/layout/Header";

const initialForm = {
  name: "",
  email: "",
  subject: "",
  message: "",
  website: "",
};

const CONTACT_LIMITS = {
  nameMin: 2,
  subjectMin: 3,
  messageMin: 10,
  messageMax: 5000,
};

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default function ContactPage() {
  const { data: me } = useMe();
  const [form, setForm] = useState(initialForm);
  const [warning, setWarning] = useState("");
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const send = useMutation({
    mutationFn: api.contactMessage,
    onSuccess: (result) => {
      toast.success(result.message || "Message sent");
      setForm((current) => ({
        ...initialForm,
        name: current.name,
        email: current.email,
      }));
    },
    onError: (error: any) => toast.warning(error.message || "Message could not be sent"),
  });

  useEffect(() => {
    if (!me) return;
    setForm((current) => ({
      ...current,
      name: current.name || me.displayName || "",
      email: current.email || me.email || "",
    }));
  }, [me]);

  function setField(key: keyof typeof initialForm) {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setWarning("");
      setForm((current) => ({ ...current, [key]: event.target.value }));
    };
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const name = form.name.trim();
    const email = form.email.trim();
    const subject = form.subject.trim();
    const message = form.message.trim();

    const nextWarning =
      name.length < CONTACT_LIMITS.nameMin
        ? `Name must be at least ${CONTACT_LIMITS.nameMin} characters.`
        : !validEmail(email)
          ? "Enter a valid email address."
          : subject.length < CONTACT_LIMITS.subjectMin
            ? `Subject must be at least ${CONTACT_LIMITS.subjectMin} characters.`
            : message.length < CONTACT_LIMITS.messageMin
              ? `Message must be at least ${CONTACT_LIMITS.messageMin} characters.`
              : "";

    if (nextWarning) {
      setWarning(nextWarning);
      toast.warning(nextWarning);
      return;
    }

    send.mutate({
      name,
      email,
      subject,
      message,
      website: form.website,
    });
  }

  return (
    <>
      <SEOHead
        title="Contact"
        description="Send a message to the FSTDESK team."
        canonical="/contact"
        breadcrumbs={[
          { name: "FSTDESK", url: origin + "/" },
          { name: "Contact", url: origin + "/contact" },
        ]}
        structuredData={{
          "@context": "https://schema.org",
          "@type": "ContactPage",
          name: "Contact FSTDESK",
          url: origin + "/contact",
          inLanguage: "en-US",
        }}
      />
      <GbToolbar crumbs={[{ label: "contact" }]} />
      <div className="gb-content gb-contact-page" style={{ padding: "18px 20px", maxWidth: 920 }}>
        <form onSubmit={submit} noValidate>
          <table className="gb-table gb-contact-table">
            <thead>
              <tr>
                <th style={{ textAlign: "right", paddingRight: 16 }}>#</th>
                <th style={{ width: 180 }}>KEY</th>
                <th>VALUE</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>1</td>
                <td style={{ color: "var(--gb-gray)" }}>--name *</td>
                <td>
                  <input data-testid="contact-name" className="gb-input" value={form.name} onChange={setField("name")} minLength={CONTACT_LIMITS.nameMin} maxLength={80} required />
                </td>
              </tr>
              <tr>
                <td>2</td>
                <td style={{ color: "var(--gb-gray)" }}>--email *</td>
                <td>
                  <input data-testid="contact-email" className="gb-input" type="email" value={form.email} onChange={setField("email")} maxLength={160} required />
                </td>
              </tr>
              <tr>
                <td>3</td>
                <td style={{ color: "var(--gb-gray)" }}>--subject * <span style={{ color: "var(--gb-bg4)" }}>min {CONTACT_LIMITS.subjectMin}</span></td>
                <td>
                  <input data-testid="contact-subject" className="gb-input" value={form.subject} onChange={setField("subject")} minLength={CONTACT_LIMITS.subjectMin} maxLength={140} required />
                </td>
              </tr>
              <tr>
                <td>4</td>
                <td style={{ color: "var(--gb-gray)" }}>--message * <span style={{ color: "var(--gb-bg4)" }}>min {CONTACT_LIMITS.messageMin}</span></td>
                <td>
                  <textarea
                    data-testid="contact-message"
                    className="gb-input"
                    value={form.message}
                    onChange={setField("message")}
                    rows={9}
                    minLength={CONTACT_LIMITS.messageMin}
                    maxLength={CONTACT_LIMITS.messageMax}
                    aria-describedby="contact-message-help"
                    required
                  />
                  <div id="contact-message-help" style={{ marginTop: 4, fontSize: 11, color: form.message.trim().length < CONTACT_LIMITS.messageMin ? "var(--gb-yellow)" : "var(--gb-gray)" }}>
                    {Math.min(form.message.trim().length, CONTACT_LIMITS.messageMax)} / {CONTACT_LIMITS.messageMin} minimum characters
                  </div>
                </td>
              </tr>
              {warning && (
                <tr>
                  <td style={{ color: "var(--gb-bg3)" }}>!</td>
                  <td style={{ color: "var(--gb-yellow)" }}>warning</td>
                  <td style={{ color: "var(--gb-yellow)" }}>{warning}</td>
                </tr>
              )}
              <tr style={{ display: "none" }} aria-hidden="true">
                <td>~</td>
                <td>website</td>
                <td>
                  <input tabIndex={-1} autoComplete="off" value={form.website} onChange={setField("website")} />
                </td>
              </tr>
              <tr className="gb-contact-action-row">
                <td style={{ color: "var(--gb-bg3)" }}>~</td>
                <td colSpan={2}>
                  <button data-testid="contact-submit" className="gb-btn gb-btn-primary" type="submit" disabled={send.isPending}>
                    {send.isPending ? "$ sending..." : "$ send message"}
                  </button>
                  <span className="gb-contact-hint" style={{ color: "var(--gb-gray)", marginLeft: 10, fontSize: 12 }}>
                    Messages go directly to the FSTDESK team.
                  </span>
                </td>
              </tr>
              {Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="empty-row">
                  <td>~</td>
                  <td colSpan={2} />
                </tr>
              ))}
            </tbody>
          </table>
        </form>
      </div>
    </>
  );
}
