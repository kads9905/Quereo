import { useEffect, useState } from "react";
import { Link } from "react-router";
import clsx from "clsx";
import { Eyebrow, Note, Reveal, Words } from "../ui/motion";
import { SiteFooter, SiteNav } from "./Chrome";
import { scrollToTarget, useSmoothScroll } from "./smooth";

const UPDATED = "28 October 2026";

const P = ({ children }) => <p className="mt-4 text-[15px] leading-[1.75] text-ink-2">{children}</p>;
const List = ({ items }) => (
  <ul className="mt-4 space-y-2.5">
    {items.map((item, i) => (
      <li key={i} className="flex gap-3 text-[15px] leading-[1.7] text-ink-2">
        <span aria-hidden className="mt-[0.7em] size-1.5 shrink-0 bg-accent" />
        <span>{item}</span>
      </li>
    ))}
  </ul>
);
const Code = ({ children }) => <code className="rounded-[3px] bg-fill px-1.5 py-0.5 font-mono text-[13px] text-ink">{children}</code>;

// What Quereo stores and sends, as the backend actually does it
const PRIVACY = {
  title: ["Privacy,", "in plain words."],
  intro: "What Quereo keeps about you, what it sends elsewhere, and what it never touches.",
  tldr: [
    "Your database rows are never stored by Quereo or sent to the AI.",
    "Database passwords are encrypted; your own password is hashed.",
    "Query history deletes itself after 90 days. No trackers, no ads.",
  ],
  sections: [
    {
      id: "what-we-keep",
      title: "What Quereo keeps",
      body: (
        <>
          <P>To run your account and do its job, Quereo stores:</P>
          <List
            items={[
              <>Your <strong className="text-ink">name and email</strong>, and your password as a bcrypt hash. Nobody can read the original password, including whoever runs Quereo.</>,
              <><strong className="text-ink">Connection details</strong> you add: host, port, database name and username. The database password is encrypted with AES-256-GCM and is never sent back to the browser.</>,
              <><strong className="text-ink">Query history</strong>: the text of each query you run, its timing, row count and verdict. Not the rows it returned.</>,
              <><strong className="text-ink">Things you create</strong>: saved queries, monitors and their run results, incidents and schema snapshots (table and column structure).</>,
            ]}
          />
        </>
      ),
    },
    {
      id: "your-data",
      title: "Your database's data",
      body: (
        <>
          <P>Rows returned by your queries are shown to you and then dropped. Quereo doesn't write them anywhere. What it does read from your database is mostly metadata: execution plans, query statistics such as <Code>pg_stat_statements</Code>, index usage and table structure.</P>
          <P>Connections are read-only by default, so Quereo can't change your data unless you turn that off for a connection.</P>
        </>
      ),
    },
    {
      id: "ai",
      title: "The AI features",
      body: (
        <>
          <P>When you use <em>Explain with AI</em> or <em>Ask in English</em>, Quereo sends a request to Groq, its AI provider. That request contains:</P>
          <List items={["the names of your tables or collections, and their columns and types", "the query text and its execution plan, or the question you typed", "Quereo's own findings about the plan"]} />
          <P>It never contains rows from your database. One thing worth knowing: a query's text can include literal values (for example <Code>WHERE email = 'a@b.com'</Code>), and those go along with the query. The AI features are optional, and nothing is sent unless you use them.</P>
        </>
      ),
    },
    {
      id: "alerts",
      title: "Alerts and webhooks",
      body: <P>If you give a monitor a webhook URL (Slack, Discord or anything else), Quereo posts a short message there when the monitor fails or recovers: the monitor's name, what was checked and the value it saw. It only ever posts to URLs you entered.</P>,
    },
    {
      id: "cookies",
      title: "Cookies and browser storage",
      body: (
        <>
          <P>Quereo uses exactly one cookie, <Code>accessToken</Code>, to keep you signed in. It's httpOnly (scripts can't read it) and expires after a day by default. It also remembers which connection you last opened in your browser's local storage.</P>
          <P>There are no analytics, advertising or third-party tracking scripts.</P>
        </>
      ),
    },
    {
      id: "retention",
      title: "How long things are kept",
      body: (
        <List
          items={[
            "Query history and monitor runs are deleted automatically after 90 days.",
            "Deleting a connection deletes everything attached to it: its history, saved queries, monitors, runs, incidents and snapshots.",
            "Your account stays until you ask for it to be removed. There's no self-serve delete button yet, so ask the operator of this Quereo instance and it will be deleted with everything in it.",
          ]}
        />
      ),
    },
    {
      id: "security",
      title: "Security",
      body: <P>Passwords are hashed, database credentials are encrypted at rest, sessions use httpOnly cookies, and every query runs one statement at a time inside a read-only transaction unless you allow writes. No system is perfectly secure, so give Quereo a database user with the least access it needs.</P>,
    },
    {
      id: "changes",
      title: "Changes and contact",
      body: <P>If this policy changes, the date at the top changes with it. Questions, or a request to see or delete your data, go to the operator of the Quereo instance you're using. If you run Quereo yourself, that's you.</P>,
    },
  ],
};

const TERMS = {
  title: ["Terms,", "without the fine print."],
  intro: "The deal between you and Quereo, written to be read.",
  tldr: [
    "Only connect databases you're allowed to access.",
    "Index trials can briefly lock writes. Use staging or a replica.",
    "Check AI-written queries before you run them.",
  ],
  sections: [
    {
      id: "using",
      title: "Using Quereo",
      body: <P>Quereo helps you find slow queries, understand why they're slow and test fixes, for PostgreSQL, MySQL and MongoDB. By creating an account you agree to these terms. If you don't agree, please don't use it.</P>,
    },
    {
      id: "account",
      title: "Your account",
      body: <P>Keep your password to yourself. You're responsible for what happens under your account and for the connections you add to it. Tell the operator if you think someone else has access.</P>,
    },
    {
      id: "databases",
      title: "Your databases",
      body: (
        <>
          <P>Only connect databases you own or have permission to access, and use credentials you're allowed to use. Quereo works best with a dedicated read-only user.</P>
          <List
            items={[
              "Connections are read-only by default. If you turn that off, queries you run can change data, and that's on you.",
              "Index trials build an index, measure the query again and remove the index. Building an index can briefly lock writes on that table, so run trials on staging or a replica, not a busy production database.",
              "Monitors run your query on the schedule you set. Pick an interval your database can comfortably handle.",
            ]}
          />
        </>
      ),
    },
    {
      id: "ai",
      title: "AI-generated queries",
      body: <P>Queries written by the AI are checked with EXPLAIN before you see them, and Quereo never runs them on its own. They can still be wrong or slow. Read them before you run them, the same way you would review a teammate's query.</P>,
    },
    {
      id: "acceptable-use",
      title: "Acceptable use",
      body: <List items={["Don't use Quereo to access systems you're not authorised to.", "Don't try to break, overload or get around Quereo's safety checks.", "Don't use it for anything unlawful."]} />,
    },
    {
      id: "as-is",
      title: "No guarantees",
      body: <P>Quereo is provided as it is, without warranties. Verdicts, suggestions and timings are measurements and advice, not promises about your production workload. The service may change, pause or stop. As far as the law allows, Quereo and the people behind it aren't liable for lost data, downtime or other losses from using it.</P>,
    },
    {
      id: "ending",
      title: "Ending things",
      body: <P>You can stop using Quereo at any time and ask for your account and data to be deleted. Accounts that break these terms can be suspended or removed.</P>,
    },
    {
      id: "changes",
      title: "Changes",
      body: <P>If these terms change, the date at the top changes with them. Using Quereo after a change means you accept the new version. How your data is handled is covered in the <Link to="/privacy" className="text-ink underline decoration-accent underline-offset-4 hover:text-accent-ink">privacy policy</Link>.</P>,
    },
  ],
};

export default function Legal({ doc }) {
  const page = doc === "privacy" ? PRIVACY : TERMS;
  const [active, setActive] = useState(page.sections[0].id);
  useSmoothScroll();

  useEffect(() => {
    window.scrollTo(0, 0);
    setActive(page.sections[0].id);
  }, [doc, page.sections]);

  // Highlight the section being read in the contents list
  useEffect(() => {
    const nodes = page.sections.map((s) => document.getElementById(s.id)).filter(Boolean);
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -65% 0px" }
    );
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [page.sections]);

  return (
    <div className="min-h-screen overflow-x-clip bg-bg">
      <SiteNav />

      <header className="relative overflow-hidden border-b border-line">
        <div aria-hidden className="dots pointer-events-none absolute inset-0 opacity-40" />
        <div className="gutter relative pt-20 pb-14 lg:pt-28">
          <div className="flex flex-wrap items-center gap-2">
            {[["terms", "Terms of service", "/terms"], ["privacy", "Privacy policy", "/privacy"]].map(([key, label, to]) => (
              <Link
                key={key}
                to={to}
                className={clsx("press rounded-sm border px-3.5 py-1.5 text-sm transition-colors duration-300", doc === key ? "border-ink bg-ink text-bg" : "border-line-2 text-ink-2 hover:border-ink-3 hover:text-ink")}
              >
                {label}
              </Link>
            ))}
          </div>
          <div className="mt-12 grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-7">
              <Eyebrow key={`e-${doc}`} text="Legal" />
              <Words key={`w-${doc}`} as="h1" lines={page.title} dim={[1]} className="heading mt-6 text-[38px] leading-[42px] sm:text-[60px] sm:leading-[64px]" />
              <Reveal key={`p-${doc}`} i={3} className="mt-5 max-w-[48ch] text-md text-ink-2">{page.intro}</Reveal>
              <p className="mt-4 font-mono text-[11px] text-ink-3">last updated · {UPDATED}</p>
            </div>
            <Reveal key={`t-${doc}`} i={4} className="lg:col-span-5">
              <div className="rounded-md border border-line-2 bg-subtle p-5">
                <p className="caps text-ink-3">The short version</p>
                <ul className="mt-3 space-y-2.5">
                  {page.tldr.map((line) => (
                    <li key={line} className="flex gap-3 text-sm">
                      <span className="grid size-5 shrink-0 place-items-center rounded-[3px] bg-pass-soft text-[11px] text-pass">✓</span>
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          </div>
        </div>
      </header>

      <main className="gutter grid grid-cols-[minmax(0,1fr)] gap-12 py-16 lg:grid-cols-12 lg:py-24">
        {/* Contents: follows you down the page */}
        <nav aria-label="On this page" className="hidden lg:col-span-3 lg:block">
          <div className="sticky top-28">
            <p className="caps text-ink-3">On this page</p>
            <ol className="mt-4 border-l border-line">
              {page.sections.map((s, i) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      scrollToTarget(document.getElementById(s.id), -96);
                    }}
                    className={clsx("-ml-px flex gap-3 border-l py-1.5 pl-4 text-sm transition-colors duration-300", active === s.id ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink-2")}
                  >
                    <span className={clsx("font-mono text-[11px] leading-5", active === s.id ? "text-accent-ink" : "text-ink-3")}>{String(i + 1).padStart(2, "0")}</span>
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
            <Note className="mt-8">{doc === "privacy" ? "short version: your rows never leave your database." : "short version: be kind to your database."}</Note>
          </div>
        </nav>

        <article className="lg:col-span-8 lg:col-start-5">
          {page.sections.map((s, i) => (
            <Reveal key={`${doc}-${s.id}`} as="div" className="scroll-mt-28 border-t border-line py-10 first:border-t-0 first:pt-0" id={s.id}>
              <p className="font-mono text-xs text-accent-ink">{String(i + 1).padStart(2, "0")}</p>
              <h2 className="heading mt-3 text-[24px] leading-[30px] sm:text-[28px] sm:leading-[34px]">{s.title}</h2>
              {s.body}
            </Reveal>
          ))}
          <div className="mt-6 flex flex-wrap items-center gap-3 rounded-md border border-dashed border-line-2 p-5 text-sm text-ink-2">
            <span>Read the other one too:</span>
            <Link to={doc === "privacy" ? "/terms" : "/privacy"} className="group inline-flex items-center gap-1.5 text-ink transition-colors hover:text-accent-ink">
              {doc === "privacy" ? "Terms of service" : "Privacy policy"} <span className="nudge">→</span>
            </Link>
          </div>
        </article>
      </main>

      <SiteFooter />
    </div>
  );
}
