import { useEffect, useState } from "react";
import { Link } from "react-router";
import clsx from "clsx";
import { Button, LogoMark } from "../ui";
import { Icons } from "../ui/icons";
import { Eyebrow, Note, Reveal, Words, useInView } from "../ui/motion";

// What Quereo actually reads from each engine (see backend/src/adapters)
const ENGINES = [
  {
    key: "postgres",
    mono: "PG",
    name: "PostgreSQL",
    port: "5432",
    reads: [
      ["Slow queries", "pg_stat_statements"],
      ["Plans", "EXPLAIN (ANALYZE, FORMAT JSON)"],
      ["Index usage", "pg_stat_user_indexes"],
      ["Table sizes", "pg_stat_user_tables"],
    ],
    user: "CREATE ROLE quereo LOGIN PASSWORD '…';\nGRANT pg_read_all_data,\n      pg_read_all_stats TO quereo;",
  },
  {
    key: "mysql",
    mono: "MY",
    name: "MySQL",
    port: "3306",
    reads: [
      ["Slow queries", "statement digests"],
      ["Plans", "EXPLAIN ANALYZE"],
      ["Index usage", "table_io_waits_by_index"],
      ["Server status", "performance_schema"],
    ],
    user: "CREATE USER 'quereo'@'%' IDENTIFIED BY '…';\nGRANT SELECT, PROCESS ON *.*\n      TO 'quereo'@'%';",
  },
  {
    key: "mongodb",
    mono: "MG",
    name: "MongoDB",
    port: "27017",
    reads: [
      ["Slow operations", "system.profile"],
      ["Plans", "explain · executionStats"],
      ["Index usage", "$indexStats"],
      ["Schema", "inferred from samples"],
    ],
    user: 'db.createUser({\n  user: "quereo", pwd: "…",\n  roles: ["readAnyDatabase", "clusterMonitor"]\n})',
  },
];

const HOSTS = ["Amazon RDS", "Aurora", "Supabase", "Neon", "Google Cloud SQL", "Azure Database", "MongoDB Atlas", "DigitalOcean", "Railway", "Render", "Self-hosted"];
const CYCLE_MS = 5000;

function Copy({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy to clipboard"
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        })
      }
      className="grid size-7 shrink-0 place-items-center rounded-sm bg-white/5 text-ink-2 transition-colors hover:bg-white/10 hover:text-ink"
    >
      <span key={copied ? "y" : "n"} className="pop-in">{copied ? <Icons.check className="size-3.5 text-accent-ink" /> : <Icons.copy className="size-3.5" />}</span>
    </button>
  );
}

export function Stack() {
  const [ref, inView] = useInView();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [cycle, setCycle] = useState(0); // restarts the progress bar

  // Rotate through the engines while the section is visible and not hovered
  useEffect(() => {
    if (!inView || paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    const id = setTimeout(() => {
      setActive((a) => (a + 1) % ENGINES.length);
      setCycle((c) => c + 1);
    }, CYCLE_MS);
    return () => clearTimeout(id);
  }, [inView, paused, active, cycle]);

  const engine = ENGINES[active];
  const pick = (i) => {
    setActive(i);
    setCycle((c) => c + 1);
  };

  return (
    <section id="stack" className="scroll-mt-16 border-t border-line bg-black">
      <div ref={ref} className="gutter py-24 lg:py-32">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-end">
          <div>
            <Eyebrow text="Databases" />
            <Words lines={["Your stack,", "exactly as it is."]} dim={[1]} className="heading mt-6 text-[36px] leading-[40px] sm:text-[56px] sm:leading-[60px]" />
          </div>
          <Reveal i={3} className="max-w-[44ch] lg:justify-self-end">
            <p className="text-md text-ink-2 sm:text-lg sm:leading-[30px]">Three engines behind one interface. Quereo connects as an ordinary client and reads the statistics your database already keeps.</p>
            <Note className="mt-6">no agents, no sidecars, no new infrastructure.</Note>
          </Reveal>
        </div>

        <div className="mt-14 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]" onPointerEnter={() => setPaused(true)} onPointerLeave={() => { setPaused(false); setCycle((c) => c + 1); }}>
          {/* Engine picker */}
          <Reveal className="flex flex-col gap-2" role="tablist" aria-label="Database engines">
            {ENGINES.map((e, i) => (
              <button
                key={e.key}
                type="button"
                role="tab"
                aria-selected={i === active}
                onClick={() => pick(i)}
                className={clsx("group relative overflow-hidden rounded-md border px-4 py-4 text-left transition-colors duration-300", i === active ? "border-line-2 bg-subtle" : "border-line hover:border-line-2 hover:bg-subtle/60")}
              >
                <span className="flex items-center gap-4">
                  <span className={clsx("grid size-11 shrink-0 place-items-center rounded-sm border font-mono text-xs transition-colors duration-300", i === active ? "border-accent bg-accent text-white" : "border-line-2 text-ink-2 group-hover:text-ink")}>{e.mono}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-md">{e.name}</span>
                    <span className="block truncate font-mono text-[11px] text-ink-3">{e.reads[0][1]} · port {e.port}</span>
                  </span>
                  <Icons.arrow className={clsx("size-4 transition-[transform,color] duration-300", i === active ? "translate-x-0 text-ink" : "-translate-x-1 text-ink-3 group-hover:translate-x-0")} />
                </span>
                {/* time left on this engine before it moves on */}
                {i === active && (
                  <span key={cycle} aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] origin-left bg-accent" style={{ animation: `grow-x ${CYCLE_MS}ms linear both`, animationPlayState: paused ? "paused" : "running" }} />
                )}
              </button>
            ))}
            <div className="mt-2 hidden rounded-md border border-dashed border-line-2 p-4 lg:block">
              <p className="text-sm text-ink-2">Every engine gets every feature: verdicts, index trials, monitors, schema diffs and plain-English queries.</p>
              <Button as={Link} to="/register" size="sm" className="mt-4" arrow>Connect yours</Button>
            </div>
          </Reveal>

          {/* The selected engine */}
          <Reveal i={1}>
            <div className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-md border border-line-2 bg-subtle shadow-[0_40px_90px_-50px_rgb(0_0_0/0.8)]">
              <div className="flex h-10 items-center gap-2.5 border-b border-line px-4">
                <LogoMark className="size-3.5" />
                <span className="caps text-ink-2">Connection</span>
                <span key={engine.key} className="swap ml-auto font-mono text-[11px] text-ink-3">{engine.key} · read-only · tls</span>
              </div>
              <div key={engine.key} className="grid flex-1 grid-cols-[minmax(0,1fr)] gap-6 p-6 md:grid-cols-2 lg:p-8">
                <div>
                  <p className="heading swap text-[40px] leading-none sm:text-[56px]">{engine.name}</p>
                  <p className="caps mt-8 text-ink-3">What Quereo reads</p>
                  <ul className="mt-3 divide-y divide-line border-y border-line">
                    {engine.reads.map(([what, source], i) => (
                      <li key={what} className="rise flex items-center gap-3 py-2.5" style={{ "--i": i + 1 }}>
                        <span className="grid size-5 shrink-0 place-items-center rounded-[3px] bg-pass-soft text-[11px] text-pass">✓</span>
                        <span className="text-sm">{what}</span>
                        <span className="ml-auto truncate font-mono text-[11px] text-ink-3">{source}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex flex-col">
                  <p className="caps text-ink-3">Read-only user</p>
                  <div className="swap mt-3 flex items-start justify-between gap-4 rounded-sm border border-line bg-bg px-4 py-3.5" style={{ animationDelay: "120ms" }}>
                    <pre className="overflow-x-auto font-mono text-xs leading-6 text-ink-2">{engine.user}</pre>
                    <Copy text={engine.user} />
                  </div>
                  <div className="mt-auto grid grid-cols-3 gap-px overflow-hidden rounded-sm border border-line bg-line pt-px">
                    {[["Verdicts", "✓"], ["Index trials", "✓"], ["Monitors", "✓"]].map(([label, mark], i) => (
                      <div key={label} className="rise bg-subtle px-3 py-3" style={{ "--i": i + 5 }}>
                        <p className="text-[11px] text-ink-3">{label}</p>
                        <p className="mt-1 font-mono text-sm text-pass">{mark}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>

        {/* Hosts */}
        <div className="mt-16 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-center">
          <p className="caps text-ink-3">Runs against</p>
          <div className="relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
            <div className="marquee gap-3 pr-3">
              {[...HOSTS, ...HOSTS].map((h, i) => (
                <span key={i} className="rounded-full border border-line-2 px-4 py-2 text-sm whitespace-nowrap text-ink-2 transition-colors duration-300 hover:border-accent hover:text-ink">{h}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
