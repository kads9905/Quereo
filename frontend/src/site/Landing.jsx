import { Link } from "react-router";
import clsx from "clsx";
import { Button, Dot } from "../ui";
import { Icons } from "../ui/icons";
import { CountUp, Eyebrow, MicroBars, Note, Reveal, Words } from "../ui/motion";
import { BorderBeam, Spotlight } from "../ui/fx";
import { SiteNav, SiteFooter } from "./Chrome";
import { QueryDemo } from "./QueryDemo";
import { Story } from "./Story";
import { BeforeAfter } from "./BeforeAfter";
import { SafeSetup } from "./SafeSetup";
import { Stack } from "./Stack";
import { useSmoothScroll } from "./smooth";
import { Faq } from "./Faq";
import { SignalColumns } from "./Signal";
import { Signature } from "./Signature";
import { LiveTicker, Swoosh } from "./Hero";

// ── Hero product window: the live demo inside Quereo's own chrome

function AppWindow() {
  const nav = [["overview", "Overview"], ["workspace", "Query workspace"], ["slow", "Slow queries"], ["advisor", "Index Advisor"], ["monitors", "Monitors"], ["schema", "Schema"]];
  return (
    <div className="relative rounded-md border border-line-2 bg-bg shadow-[0_60px_120px_-40px_rgb(0_0_0/0.9),0_0_0_1px_rgb(255_255_255/0.02)]">
      <BorderBeam duration={9} />
      <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="flex gap-1.5" aria-hidden>{[0, 1, 2].map((i) => <span key={i} className="size-2.5 rounded-full bg-line-2" />)}</span>
          <span className="hidden font-mono text-xs text-ink-3 sm:inline"><span className="text-ink">quereo</span> / shop / production</span>
        </div>
        <span className="flex items-center gap-2 font-mono text-[11px] text-ink-3"><Dot tone="ok" live /> 3 monitors passing</span>
      </div>
      <div className="grid lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden border-r border-line bg-subtle/60 p-3 lg:block">
          <div className="rounded-xs border border-line bg-bg px-3 py-2">
            <p className="font-mono text-xs">shop</p>
            <p className="text-[11px] text-ink-3">PostgreSQL 16 · read-only</p>
          </div>
          <ul className="mt-3 space-y-0.5">
            {nav.map(([icon, label]) => {
              const Icon = Icons[icon];
              return (
                <li key={label} className={clsx("flex items-center gap-2.5 rounded-xs px-2.5 py-1.5 text-[13px]", label === "Query workspace" ? "bg-fill text-ink shadow-[inset_2px_0_0_var(--color-accent)]" : "text-ink-3")}>
                  <Icon className="size-3.5" />{label}
                </li>
              );
            })}
          </ul>
        </aside>
        <QueryDemo bare />
      </div>
      <div className="flex items-center gap-4 border-t border-line px-4 py-2.5 font-mono text-[11px] text-ink-3">
        <span className="flex shrink-0 items-center gap-2"><Icons.monitors className="size-3.5" /><span className="hidden sm:inline">customer lookup · every 1m</span></span>
        <span className="flex min-w-0 flex-1 gap-[2px]" aria-hidden>
          {Array.from({ length: 64 }, (_, i) => <span key={i} className={clsx("grow-y h-3 flex-1", i === 41 ? "bg-slow" : "bg-pass/50")} style={{ "--i": i }} />)}
        </span>
        <span className="shrink-0 text-ink-2">99.9%</span>
      </div>
    </div>
  );
}

// ── Numbers band

const NUMBERS = [
  { key: "index.trial", value: 287, unit: "×", note: "faster after one index, measured on 400,000 orders.", bars: [9, 8, 9, 10, 9, 8, 9, 10, 9, 1, 1, 1, 1, 1, 1, 1], hi: [9, 10, 11, 12, 13, 14, 15] },
  { key: "rows.read", value: 20, unit: "", note: "rows read after the fix. It was 400,000 before.", bars: [10, 10, 10, 10, 10, 10, 10, 10, 2, 1, 1, 1, 1, 1, 1, 1], hi: [8, 9, 10, 11, 12, 13, 14, 15] },
  { key: "engines", value: 3, unit: "", note: "PostgreSQL, MySQL and MongoDB, one interface.", bars: [6, 6, 6, 6, 6, 9, 9, 9, 9, 9, 7, 7, 7, 7, 7, 7], hi: [5, 6, 7, 8, 9] },
  { key: "rows.sent_to_ai", value: 0, unit: "", note: "The model sees structure and plans. Never your data.", bars: [3, 5, 4, 6, 5, 3, 4, 6, 5, 4, 3, 5, 6, 4, 5, 3], hi: [] },
];

// ── Guardrail feed for the safety bento



const STACK = [
  ["PostgreSQL", "PG", "engine"],
  ["MySQL", "MY", "engine"],
  ["MongoDB", "MG", "engine"],
  ["Amazon RDS", "RDS", "host"],
  ["Supabase", "SB", "host"],
  ["Neon", "NE", "host"],
  ["MongoDB Atlas", "AT", "host"],
  ["Google Cloud SQL", "GC", "host"],
];



function SectionHead({ eyebrow, lines, aside, className }) {
  return (
    <div className={clsx("flex flex-wrap items-end justify-between gap-8", className)}>
      <div>
        <Eyebrow text={eyebrow} />
        <Words lines={lines} dim={lines.length > 1 ? [lines.length - 1] : []} className="heading mt-5 text-h2 sm:text-2xl" />
      </div>
      {aside && <Reveal i={2} className={typeof aside === "string" ? "max-w-[40ch] text-sm text-ink-2" : "w-full max-w-[360px]"}>{aside}</Reveal>}
    </div>
  );
}

export default function Landing() {
  useSmoothScroll();

  return (
    <div className="min-h-screen overflow-x-clip bg-bg">
      <SiteNav />

      {/* Hero */}
      <section className="relative -mt-16 pt-16">
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          <div className="dots absolute inset-0 opacity-50" />
          {/* Query stream: full bleed on the right, fading toward the copy */}
          <div className="absolute top-0 right-0 hidden h-[760px] w-[62%] opacity-60 [mask-image:linear-gradient(to_right,transparent,black_45%),linear-gradient(to_bottom,black_60%,transparent)] [mask-composite:intersect] md:block">
            <SignalColumns align="right" columns={26} className="absolute top-0 right-0 h-full" />
          </div>
        </div>

        <div className="gutter relative pt-20 pb-16 sm:pt-28 lg:pt-32">
          <Reveal><LiveTicker /></Reveal>
          <Words as="h1" lines={["Every query, explained.", "Every fix, proven."]} dim={[1]} gap="0.26em" className="heading mt-10 text-[36px] leading-[36px] font-medium tracking-[-0.09em] sm:text-[58px] sm:leading-[56px] xl:text-[80px] xl:leading-[76px]" />
          <div className="mt-12 grid items-end gap-10 lg:grid-cols-[minmax(0,1fr)_auto]">
            <Reveal i={6} className="max-w-[46ch] text-md text-ink-2 sm:text-lg sm:leading-[30px]">
              Quereo reads the plan behind every query, tells you in plain words why it's slow, and tests the fix on your own data before you ship it.
            </Reveal>
            <Reveal i={8} className="flex flex-col gap-3 lg:items-end">
              <div className="flex flex-wrap gap-2">
                <Button as={Link} to="/register" size="lg" arrow>Start free</Button>
                <Button as="a" href="#demo" size="lg" variant="secondary" className="bg-bg">Try the demo</Button>
              </div>
              <span className="font-mono text-[11px] text-ink-3">no credit card · read-only by default</span>
            </Reveal>
          </div>
        </div>

        <div id="demo" className="gutter relative scroll-mt-24 pb-24">
          <Swoosh><AppWindow /></Swoosh>
          <p className="mt-5 text-center font-mono text-[11px] text-ink-3">// real plans and timings from Quereo's sample database. press run, then try the fix.</p>
        </div>
      </section>

      {/* Works with — marquee */}
      <section className="border-y border-line py-6" aria-label="Works with">
        <div className="relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
          <div className="marquee gap-14 pr-14">
            {[...STACK, ...STACK, ...STACK, ...STACK].map(([name], i) => (
              <span key={i} className="flex items-center gap-3 text-[18px] tracking-[-0.01em] whitespace-nowrap text-ink-3"><span className="size-1.5 bg-line-2" />{name}</span>
            ))}
          </div>
        </div>
      </section>

      {/* Numbers */}
      <section className="gutter py-20 lg:py-24">
        <SectionHead eyebrow="quereo status --summary" lines={["The short version,", "in four numbers."]} />
        <div className="mt-12 grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
          {NUMBERS.map((n, i) => (
            <Reveal key={n.key} i={i} className="h-full">
              <Spotlight className="flex h-full flex-col bg-bg p-6 sm:p-7">
                <p className="font-mono text-xs text-ink-3">{n.key}</p>
                <p className="heading mt-6 text-[64px] leading-none sm:text-[76px]">
                  <CountUp value={n.value} duration={n.value > 100 ? 1600 : 900} />
                  {n.unit && <span className="text-accent">{n.unit}</span>}
                </p>
                <MicroBars values={n.bars} highlight={n.hi} className="mt-8" />
                <p className="mt-4 text-sm text-ink-2">{n.note}</p>
              </Spotlight>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Product story */}
      <Story />

      {/* Before / after */}
      <BeforeAfter />

      {/* Safety & setup (part of "Why Quereo") */}
      <SafeSetup />

      {/* Databases */}
      <Stack />

      {/* FAQ */}
      <Faq />

      {/* Final call to action */}
      <section id="start" className="relative overflow-hidden border-t border-line">
        <div className="gutter relative pt-24 lg:pt-32">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-12">
            <div className="lg:col-span-8">
              <Eyebrow text="Get started" />
              <Words
                lines={["Your database has been", "trying to tell you something."]}
                dim={[1]}
                className="heading mt-8 text-[clamp(2rem,3.7vw,3.5rem)] leading-[1.05]"
              />
            </div>
            <Reveal i={6} className="self-end lg:col-span-4">
              <p className="max-w-[38ch] text-md text-ink-2">Quereo listens. Point it at any PostgreSQL, MySQL or MongoDB database and get your first verdict in about a minute.</p>
              <div className="mt-6 flex flex-wrap gap-2">
                <Button as={Link} to="/register" size="lg" arrow>Start free</Button>
                <Button as={Link} to="/login" size="lg" variant="secondary">Sign in</Button>
              </div>
              <Note className="mt-6">quereo speaks fluent EXPLAIN. so you don't have to.</Note>
            </Reveal>
          </div>
          {/* sign-off: just the name and its cursor */}
          <div className="mt-24 overflow-hidden pb-10 md:mt-32">
            <Signature />
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
