import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { LogoMark } from "../ui";
import { Icons } from "../ui/icons";
import { Eyebrow, Note, Reveal, Words } from "../ui/motion";
import { ASK_STARTERS, ASK_TONE, answer } from "./ask";

const FAQ = [
  ["Which databases does Quereo support?", "PostgreSQL, MySQL and MongoDB, wherever they're hosted. Each has its own adapter, and every feature works on all three."],
  ["Can Quereo change my data?", "Not unless you allow it. Connections are read-only by default, queries run one statement at a time, and index trials happen inside a transaction that is rolled back (on MySQL and MongoDB the trial index is dropped right after)."],
  ["Does the AI see my data?", "No. It receives table and column names, the query and its plan. Generated queries are checked with EXPLAIN, which doesn't run them, and are never executed for you."],
  ["What does an index trial cost?", "Building an index briefly locks writes on that table, so run trials on staging or a replica. Quereo only allows them on connections where you turned read-only off."],
  ["Do I need to enable anything on my database?", "Only for the slow-query list: pg_stat_statements on PostgreSQL, performance_schema on MySQL, the profiler on MongoDB. Verdicts, plans, index trials and monitors work without them."],
  ["Where does Quereo run?", "One Node API and a MongoDB for its own data. Deploy it wherever you deploy things; it connects to your databases like any other client."],
];
const ASK = FAQ.length; // the last item in the list switches the console to ask mode

// Types text out quickly; settles instantly under reduced motion.
// Uses a timer so it keeps going even when the tab isn't painting.
function useTyped(text) {
  const [shown, setShown] = useState(text.length);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(text.length);
      return undefined;
    }
    setShown(0);
    let n = 0;
    const id = setInterval(() => {
      n += 2;
      setShown(Math.min(n, text.length));
      if (n >= text.length) clearInterval(id);
    }, 18);
    return () => clearInterval(id);
  }, [text]);
  return text.slice(0, shown);
}

function Shell({ title, meta, status, busy, children }) {
  return (
    <div className="ink flex h-[420px] flex-col overflow-hidden rounded-md border border-line-2 shadow-[0_40px_90px_-50px_rgb(0_0_0/0.55)] lg:absolute lg:inset-0 lg:h-auto">
      <div className="flex h-10 shrink-0 items-center gap-2.5 border-b border-line px-4">
        <LogoMark className="size-3.5" />
        <span className="font-mono text-xs text-ink-2">{title}</span>
        <span className="ml-auto font-mono text-[11px] text-ink-3">{meta}</span>
      </div>
      {children}
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-2.5 font-mono text-[11px] text-ink-3">
        <span className={clsx("size-1.5 rounded-full", busy ? "animate-pulse bg-accent" : "bg-pass")} />
        {status}
      </div>
    </div>
  );
}

// A listed question, answered
function AnswerConsole({ index }) {
  const [q, a] = FAQ[index];
  const typed = useTyped(a);
  const typing = typed.length < a.length;
  return (
    <Shell title="quereo --ask" meta={`${String(index + 1).padStart(2, "0")} / ${String(FAQ.length).padStart(2, "0")}`} busy={typing} status={typing ? "answering…" : "answered · read-only, as always"}>
      <div key={index} className="min-h-0 flex-1 p-6 sm:p-8">
        <p className="swap font-mono text-[13px] leading-6 text-accent-ink"><span className="text-ink-3">$ </span>quereo --ask "{q}"</p>
        <p className="mt-5 text-[17px] leading-[1.7] text-ink sm:text-lg">
          {typed}
          <span className={clsx("ml-0.5 text-accent", typing ? "caret" : "opacity-0")}>▍</span>
        </p>
      </div>
    </Shell>
  );
}

function Reply({ entry, live }) {
  const typed = useTyped(entry.text);
  const text = live ? typed : entry.text;
  return (
    <div className="swap">
      <p className="font-mono text-[13px] leading-6 break-words text-accent-ink"><span className="text-ink-3">$ </span>quereo --ask "{entry.q}"</p>
      <p className="mt-2.5 text-[15px] leading-[1.7] text-ink">
        <span className={clsx("caps mr-2 inline-block -translate-y-px rounded-[3px] px-1.5 py-0.5 text-[10px]", ASK_TONE[entry.tone])}>{entry.tag}</span>
        {text}
        {live && typed.length < entry.text.length && <span className="caret ml-0.5 text-accent">▍</span>}
      </p>
    </div>
  );
}

// Ask mode: a live prompt that answers anything about Quereo. One question at
// a time: asking again clears the screen (the old answer fades out first),
// like typing `clear` before the next command.
function AskConsole() {
  const [value, setValue] = useState("");
  const [current, setCurrent] = useState(null); // the one question on screen
  const [clearing, setClearing] = useState(false);
  const inputRef = useRef(null);
  const count = useRef(0);
  const timer = useRef(0);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    return () => clearTimeout(timer.current);
  }, []);

  const ask = (q) => {
    const question = q.trim();
    if (!question) return;
    count.current += 1;
    const next = { id: count.current, q: question, ...answer(question) };
    setValue("");
    inputRef.current?.focus({ preventScroll: true });
    clearTimeout(timer.current);
    if (!current) {
      setCurrent(next);
      return;
    }
    // wipe the screen, then show the new question
    setClearing(true);
    timer.current = setTimeout(() => {
      setCurrent(next);
      setClearing(false);
    }, 220);
  };

  return (
    <Shell title="quereo --ask" meta="ask mode" busy={false} status="ready · ask anything about quereo">
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6 sm:p-8" onClick={() => inputRef.current?.focus({ preventScroll: true })}>
        {!current && (
          <div className="swap">
            <p className="heading text-[26px] leading-[32px] text-ink sm:text-[30px] sm:leading-[36px]">Go on, interrogate me.</p>
            <div className="mt-5 flex flex-wrap gap-2">
              {ASK_STARTERS.map((s) => (
                <button key={s} type="button" onClick={() => ask(s)} className="press rounded-sm border border-line-2 px-2.5 py-1 font-mono text-[11px] text-ink-2 transition-colors hover:border-accent hover:text-ink">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {current && (
          <div className={clsx("transition-[opacity,transform,filter] duration-200 ease-out", clearing && "-translate-y-1 opacity-0 blur-[2px]")}>
            <Reply key={current.id} entry={current} live />
          </div>
        )}

        {/* the live prompt, inline like a real terminal */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(value);
          }}
          className="flex items-center gap-2 font-mono text-[13px]"
        >
          <span className="text-ink-3">$</span>
          <span className="shrink-0 text-accent-ink">quereo --ask</span>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="type a question…"
            aria-label="Ask Quereo a question"
            maxLength={120}
            className="min-w-0 flex-1 bg-transparent text-ink caret-accent placeholder:text-ink-3 focus:outline-none"
          />
          <span className="hidden shrink-0 text-[11px] text-ink-3 sm:inline">↵</span>
        </form>
      </div>
    </Shell>
  );
}

export function Faq() {
  const [index, setIndex] = useState(0);
  const listRef = useRef(null);
  const total = FAQ.length + 1; // the questions plus "ask quereo"

  const onKeyDown = (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (event.target.tagName === "INPUT") return;
    event.preventDefault();
    const next = (index + (event.key === "ArrowDown" ? 1 : total - 1)) % total;
    setIndex(next);
    listRef.current?.querySelector(`[data-index="${next}"]`)?.focus();
  };

  return (
    <section id="faq" className="light grid-bg scroll-mt-16">
      <div className="gutter py-24 lg:py-32">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-end">
          <div>
            <Eyebrow text="FAQ" />
            <Words lines={["Before you", "connect."]} dim={[1]} className="heading mt-6 text-[36px] leading-[40px] sm:text-[52px] sm:leading-[56px]" />
          </div>
          <Reveal i={3} className="max-w-[42ch] lg:justify-self-end">
            <p className="text-md text-ink-2">Pick a question, or ask your own. Quereo answers in its own console.</p>
            <Note className="mt-5">arrow keys work too. it's that kind of tool.</Note>
          </Reveal>
        </div>

        <div className="mt-14 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-stretch">
          <Reveal>
            <ul ref={listRef} role="tablist" aria-orientation="vertical" aria-label="Questions" onKeyDown={onKeyDown} className="flex flex-col gap-1">
              {FAQ.map(([q], i) => {
                const on = i === index;
                return (
                  <li key={q}>
                    <button
                      type="button"
                      role="tab"
                      data-index={i}
                      aria-selected={on}
                      tabIndex={on ? 0 : -1}
                      onClick={() => setIndex(i)}
                      className={clsx(
                        "group relative flex w-full items-center gap-3.5 overflow-hidden rounded-sm border px-3.5 py-2.5 text-left transition-colors duration-300",
                        on ? "border-ink bg-bg" : "border-line-2 bg-bg/60 hover:border-ink-3 hover:bg-bg"
                      )}
                    >
                      <span aria-hidden className={clsx("absolute inset-y-0 left-0 w-[3px] origin-top bg-accent transition-transform duration-300 ease-[var(--ease-out)]", on ? "scale-y-100" : "scale-y-0")} />
                      <span className={clsx("font-mono text-xs transition-colors duration-300", on ? "text-accent-ink" : "text-ink-3")}>{String(i + 1).padStart(2, "0")}</span>
                      <span className={clsx("flex-1 text-sm transition-colors duration-300", on ? "font-medium text-ink" : "text-ink-2 group-hover:text-ink")}>{q}</span>
                      <span aria-hidden className={clsx("font-mono text-sm transition-[transform,color] duration-300", on ? "translate-x-0 text-accent-ink" : "-translate-x-1 text-ink-3 group-hover:translate-x-0")}>→</span>
                    </button>
                  </li>
                );
              })}

              {/* Ask quereo: turns the console into a live prompt */}
              <li className="mt-2">
                <button
                  type="button"
                  role="tab"
                  data-index={ASK}
                  aria-selected={index === ASK}
                  tabIndex={index === ASK ? 0 : -1}
                  onClick={() => setIndex(ASK)}
                  className={clsx(
                    "group flex w-full items-center gap-3.5 rounded-sm border px-3.5 py-2.5 text-left transition-colors duration-300",
                    index === ASK ? "border-accent bg-accent text-white" : "border-dashed border-accent/60 bg-accent-soft/60 text-ink hover:border-accent hover:bg-accent-soft"
                  )}
                >
                  <span className={clsx("grid size-5 place-items-center rounded-[3px]", index === ASK ? "bg-white/15" : "bg-accent text-white")}><Icons.sparkle className="size-3.5" /></span>
                  <span className="flex-1">
                    <span className="block text-sm font-medium">Ask quereo anything</span>
                    <span className={clsx("block font-mono text-[11px]", index === ASK ? "text-white/70" : "text-ink-3")}>didn't see your question? type your own</span>
                  </span>
                  <span aria-hidden className={clsx("font-mono text-sm transition-transform duration-300", index === ASK ? "translate-x-0" : "-translate-x-1 group-hover:translate-x-0")}>→</span>
                </button>
              </li>
            </ul>
          </Reveal>
          <Reveal i={1} className="relative lg:h-full">
            {index === ASK ? <AskConsole /> : <AnswerConsole index={index} />}
          </Reveal>
        </div>
      </div>
    </section>
  );
}
