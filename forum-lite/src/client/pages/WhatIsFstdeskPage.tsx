import { Link } from "react-router-dom";
import { SEOHead } from "../components/SEOHead";
import { GbToolbar } from "../components/layout/Header";
import {
  WHAT_IS_FSTDESK_DESCRIPTION,
  WHAT_IS_FSTDESK_FAQS,
  WHAT_IS_FSTDESK_KEYWORDS,
  WHAT_IS_FSTDESK_PATH,
  WHAT_IS_FSTDESK_PUBLISHED,
  WHAT_IS_FSTDESK_SECTIONS,
  WHAT_IS_FSTDESK_TITLE,
  WHAT_IS_FSTDESK_TOPIC_EXAMPLES,
} from "../../shared/what-is-fstdesk";

export default function WhatIsFstdeskPage() {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const canonicalUrl = `${origin}${WHAT_IS_FSTDESK_PATH}`;
  const articleTags = [...WHAT_IS_FSTDESK_KEYWORDS];

  return (
    <>
      <SEOHead
        title={WHAT_IS_FSTDESK_TITLE}
        description={WHAT_IS_FSTDESK_DESCRIPTION}
        canonical={WHAT_IS_FSTDESK_PATH}
        type="article"
        articlePublishedTime={WHAT_IS_FSTDESK_PUBLISHED}
        articleModifiedTime={WHAT_IS_FSTDESK_PUBLISHED}
        articleSection="Food Science and Technology"
        articleTags={articleTags}
        breadcrumbs={[
          { name: "FSTDESK", url: origin + "/" },
          { name: WHAT_IS_FSTDESK_TITLE, url: canonicalUrl },
        ]}
        structuredData={[
          {
            "@context": "https://schema.org",
            "@type": "Article",
            headline: WHAT_IS_FSTDESK_TITLE,
            description: WHAT_IS_FSTDESK_DESCRIPTION,
            url: canonicalUrl,
            datePublished: WHAT_IS_FSTDESK_PUBLISHED,
            dateModified: WHAT_IS_FSTDESK_PUBLISHED,
            inLanguage: "en-US",
            articleSection: "Food Science and Technology",
            keywords: articleTags.join(", "),
            publisher: {
              "@type": "Organization",
              name: "FSTDESK",
              alternateName: "Food Science and Technology Desk",
              slogan: "Food Science and Technology Desk",
              url: origin,
            },
            mainEntityOfPage: {
              "@type": "WebPage",
              "@id": canonicalUrl,
            },
          },
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: WHAT_IS_FSTDESK_FAQS.map((item) => ({
              "@type": "Question",
              name: item.question,
              acceptedAnswer: {
                "@type": "Answer",
                text: item.answer,
              },
            })),
          },
          {
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: "Example FSTDESK discussion topics",
            itemListElement: WHAT_IS_FSTDESK_TOPIC_EXAMPLES.map((topic, index) => ({
              "@type": "ListItem",
              position: index + 1,
              name: topic.title,
              description: topic.summary,
              url: `${origin}${topic.href}`,
            })),
          },
        ]}
      />
      <GbToolbar crumbs={[{ label: "what-is-fstdesk" }]} />
      <div className="gb-content gb-what-page">
        <article className="gb-what-article" data-testid="what-is-fstdesk-page">
          <header className="gb-what-hero">
            <div className="gb-what-command">$ what-is-fstdesk</div>
            <h1>{WHAT_IS_FSTDESK_TITLE}</h1>
            <p>{WHAT_IS_FSTDESK_DESCRIPTION}</p>
            <div className="gb-what-quicklinks" aria-label="Quick links">
              <Link to="/">threads</Link>
              <Link to="/members">members</Link>
              <Link to="/tags">tags</Link>
              <Link to="/contact">contact</Link>
            </div>
          </header>

          <section className="gb-what-grid" aria-label="FSTDESK overview">
            {WHAT_IS_FSTDESK_SECTIONS.map((section, index) => (
              <article className="gb-what-section" key={section.title}>
                <div className="gb-what-index">{String(index + 1).padStart(2, "0")}</div>
                <h2>{section.title}</h2>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </article>
            ))}
          </section>

          <section className="gb-what-topics" aria-labelledby="what-topic-examples">
            <h2 id="what-topic-examples">Example FSTDESK topics</h2>
            <p>
              These are the kinds of practical, searchable discussions FSTDESK is built to support. Each
              topic starts as a concrete food science problem and becomes part of the archive.
            </p>
            <table className="gb-table gb-what-topic-table">
              <thead>
                <tr>
                  <th style={{ textAlign: "right", width: 44 }}>#</th>
                  <th>TOPIC</th>
                  <th>AREA</th>
                  <th>WHY IT MATTERS</th>
                </tr>
              </thead>
              <tbody>
                {WHAT_IS_FSTDESK_TOPIC_EXAMPLES.map((topic, index) => (
                  <tr key={topic.title}>
                    <td>{index + 1}</td>
                    <td>
                      <Link to={topic.href}>{topic.title}</Link>
                    </td>
                    <td>
                      <span className="gb-what-area">{topic.area}</span>
                    </td>
                    <td>{topic.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="gb-what-faq" aria-labelledby="what-faq">
            <h2 id="what-faq">FAQ</h2>
            {WHAT_IS_FSTDESK_FAQS.map((item) => (
              <details key={item.question} open>
                <summary>{item.question}</summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </section>
        </article>
      </div>
    </>
  );
}
