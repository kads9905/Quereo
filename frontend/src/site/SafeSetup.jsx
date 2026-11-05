import clsx from "clsx";
import { Icons } from "../ui/icons";
import { LogoMark } from "../ui";
import { Eyebrow, Note, Reveal, Words } from "../ui/motion";
import { AnimatedList } from "../ui/fx";

const GUARDRAILS = [
  { id: 1, ok: true, text: "read-only transaction opened", meta: "pg-shop" },
  { id: 2, ok: false, text: "blocked: DELETE FROM orders", meta: "connection is read-only" },
  { id: 3, ok: false, text: "blocked: SELECT 1; DROP TABLE users", meta: "one statement at a time" },
  { id: 4, ok: true, text: "AI request: 4 tables, 0 rows", meta: "structure only" },
  { id: 5, ok: true, text: "index trial rolled back", meta: "orders (customer_id)" },
];

const FACTS = [
  ["check", "Read-only by default", "Every query runs in a read-only transaction until you say otherwise."],
  ["layers", "Encrypted credentials", "AES-256-GCM at rest, never sent back to the browser."],
  ["sparkle", "Your rows stay yours", "The AI sees table names and plans, never the data."],
  ["connections", "No agent to install", "Quereo connects like any client."],
];

export function SafeSetup() {
  return (
    <section id="safety" className="relative scroll-mt-16 overflow-hidden border-t border-line bg-subtle">
      {/* its own band: dark, dotted, with a violet glow, apart from the paper section above */}
      <div aria-hidden className="dots pointer-events-none absolute inset-0 opacity-40" />
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[60%] -translate-x-1/2 rounded-full bg-accent/10 blur-[120px]" />

      <div className="gutter relative grid grid-cols-[minmax(0,1fr)] gap-12 py-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-center lg:gap-16 lg:py-28">
        <div>
          <Eyebrow text="Safety" />
          <Words lines={["Safe next to", "production."]} dim={[1]} className="heading mt-6 text-[36px] leading-[40px] sm:text-[52px] sm:leading-[56px]" />
          <Reveal i={3} className="mt-5 max-w-[46ch] text-md text-ink-2">Quereo assumes it's pointed at the database your business runs on, and behaves accordingly.</Reveal>

          <ul className="mt-8 divide-y divide-line border-y border-line">
            {FACTS.map(([icon, title, body], i) => {
              const Icon = Icons[icon];
              return (
                <Reveal as="li" key={title} i={i + 4} className="group flex items-center gap-4 py-3.5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-sm border border-line-2 text-ink-2 transition-colors duration-300 group-hover:border-accent group-hover:text-accent-ink"><Icon className="size-4" /></span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{title}</span>
                    <span className="block text-sm text-ink-3">{body}</span>
                  </span>
                </Reveal>
              );
            })}
          </ul>
          <Note className="mt-6">nothing to install on the server. ever.</Note>
        </div>

        <Reveal i={2} className="ink flex flex-col overflow-hidden rounded-md border border-line-2 shadow-[0_40px_90px_-50px_rgb(0_0_0/0.8)]">
          <div className="flex h-10 items-center gap-2.5 border-b border-line px-4">
            <LogoMark className="size-3.5" />
            <span className="caps text-ink-2">Guardrail log</span>
            <span className="ml-auto flex items-center gap-2 font-mono text-[11px] text-ink-3"><span className="live size-1.5 rounded-full bg-pass text-pass" />live</span>
          </div>
          <AnimatedList
            className="min-h-[290px] p-4"
            items={GUARDRAILS}
            interval={1100}
            render={(g) => (
              <div className="flex items-center gap-3 rounded-sm border border-line bg-subtle px-3.5 py-2.5 font-mono text-xs">
                <span className={clsx("grid size-5 shrink-0 place-items-center rounded-[3px]", g.ok ? "bg-pass-soft text-pass" : "bg-slow-soft text-slow")}>{g.ok ? "✓" : "✕"}</span>
                <span className="min-w-0 flex-1 truncate">{g.text}</span>
                <span className="hidden shrink-0 text-ink-3 sm:inline">{g.meta}</span>
              </div>
            )}
          />
          <div className="border-t border-line px-4 py-2.5 font-mono text-[11px] text-ink-3">every query passes the same checks</div>
        </Reveal>
      </div>
    </section>
  );
}
