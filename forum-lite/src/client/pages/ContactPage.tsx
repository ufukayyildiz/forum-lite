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

export default function ContactPage() {
  const { data: me } = useMe();
  const [form, setForm] = useState(initialForm);
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
    onError: (error: any) => toast.error(error.message || "Message could not be sent"),
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
      setForm((current) => ({ ...current, [key]: event.target.value }));
    };
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    send.mutate({
      name: form.name,
      email: form.email,
      subject: form.subject,
      message: form.message,
      website: form.website,
    });
  }

  return (
    <>
      <SEOHead
        title="Contact"
        description="Send a message to the FSTDESK Forum team."
        canonical="/contact"
        breadcrumbs={[
          { name: "Forum", url: origin + "/" },
          { name: "Contact", url: origin + "/contact" },
        ]}
        structuredData={{
          "@context": "https://schema.org",
          "@type": "ContactPage",
          name: "Contact FSTDESK Forum",
          url: origin + "/contact",
          inLanguage: "en-US",
        }}
      />
      <GbToolbar crumbs={[{ label: "contact" }]} />
      <div className="gb-content gb-contact-page" style={{ padding: "18px 20px", maxWidth: 920 }}>
        <form onSubmit={submit}>
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
                  <input className="gb-input" value={form.name} onChange={setField("name")} maxLength={80} required />
                </td>
              </tr>
              <tr>
                <td>2</td>
                <td style={{ color: "var(--gb-gray)" }}>--email *</td>
                <td>
                  <input className="gb-input" type="email" value={form.email} onChange={setField("email")} maxLength={160} required />
                </td>
              </tr>
              <tr>
                <td>3</td>
                <td style={{ color: "var(--gb-gray)" }}>--subject *</td>
                <td>
                  <input className="gb-input" value={form.subject} onChange={setField("subject")} maxLength={140} required />
                </td>
              </tr>
              <tr>
                <td>4</td>
                <td style={{ color: "var(--gb-gray)" }}>--message *</td>
                <td>
                  <textarea className="gb-input" value={form.message} onChange={setField("message")} rows={9} maxLength={5000} required />
                </td>
              </tr>
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
                  <button className="gb-btn gb-btn-primary" type="submit" disabled={send.isPending}>
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
