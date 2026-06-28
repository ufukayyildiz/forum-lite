import { SEOHead } from "../components/SEOHead";
import { GbToolbar } from "../components/layout/Header";

const features = [
  {
    key: "threads",
    value: "Browse and continue food science, food safety, product development and food technology discussions.",
  },
  {
    key: "categories",
    value: "Follow focused areas such as product development, food safety, ingredients, nutrition, packaging and regulations.",
  },
  {
    key: "tags",
    value: "Use tags to find practical questions, technical replies, ingredients, processes and recurring topics quickly.",
  },
  {
    key: "members",
    value: "Open member profiles to see their threads, replies and community history.",
  },
  {
    key: "search",
    value: "Search the archive for old forum conversations and indexed technical answers.",
  },
  {
    key: "account",
    value: "Registered members can create threads, reply, like posts and manage email preferences.",
  },
  {
    key: "contact",
    value: "Reach the FSTDESK team from the contact page for account, content or community requests.",
  },
];

export default function AboutPage() {
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <>
      <SEOHead
        title="About"
        description="About FSTDESK, the Food Science and Technology Desk."
        canonical="/about"
        breadcrumbs={[
          { name: "FSTDESK", url: origin + "/" },
          { name: "About", url: origin + "/about" },
        ]}
        structuredData={{
          "@context": "https://schema.org",
          "@type": "AboutPage",
          name: "About FSTDESK",
          description: "Food Science and Technology Desk for food science, food safety, product development and food technology discussions.",
          url: origin + "/about",
          inLanguage: "en-US",
        }}
      />
      <GbToolbar crumbs={[{ label: "about" }]} />
      <div className="gb-content gb-about-page" style={{ padding: "18px 20px", maxWidth: 980 }}>
        <table className="gb-table gb-about-table">
          <thead>
            <tr>
              <th style={{ textAlign: "right", paddingRight: 16 }}>#</th>
              <th style={{ width: 180 }}>FUNCTION</th>
              <th>DESCRIPTION</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ color: "var(--gb-yellow)" }}>$</td>
              <td style={{ color: "var(--gb-yellow)", fontWeight: 700 }}>about</td>
              <td>
                FSTDESK is a forum archive and active discussion space for food science, food safety,
                product development and ingredient questions.
              </td>
            </tr>
            {features.map((feature, index) => (
              <tr key={feature.key}>
                <td>{index + 1}</td>
                <td style={{ color: "var(--gb-green)", fontWeight: 700 }}>{feature.key}</td>
                <td>{feature.value}</td>
              </tr>
            ))}
            {Array.from({ length: 5 }).map((_, i) => (
              <tr key={i} className="empty-row">
                <td>~</td>
                <td colSpan={2} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
