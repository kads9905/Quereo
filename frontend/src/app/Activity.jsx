import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { Card, ErrorNote, Skeleton, Tabs } from "../ui";
import { Icons } from "../ui/icons";
import { CountUp } from "../ui/motion";
import { get } from "../lib/api";
import { formatNumber } from "../lib/format";
import { useLoad } from "./kit";

const WEEKS = 26;
const DAY = 86_400_000;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MODES = [["runs", "Runs"], ["flagged", "Flagged"]];
// five steps from empty to busiest, per mode
const SHADES = {
  runs: ["bg-fill", "bg-accent/25", "bg-accent/50", "bg-accent/75", "bg-accent"],
  flagged: ["bg-fill", "bg-warn/25", "bg-warn/50", "bg-warn/75", "bg-warn"],
};

// local yyyy-mm-dd, matching what the server buckets by
const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hourLabel = (h) => `${h % 12 || 12}${h < 12 ? "am" : "pm"}`;

// Monday-first weeks, oldest column first, ending with this week
function buildGrid(byDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) - (WEEKS - 1) * 7);
  return Array.from({ length: WEEKS }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = new Date(monday.getTime() + (w * 7 + d) * DAY + 3_600_000); // +1h dodges DST edges
      date.setHours(0, 0, 0, 0);
      const k = key(date);
      const { runs = 0, flagged = 0, errors = 0 } = byDate.get(k) ?? {};
      return { date, key: k, future: date > today, runs, flagged, errors };
    })
  );
}

function streaks(cells) {
  let longest = 0;
  let run = 0;
  for (const c of cells) {
    run = c.runs ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  // current streak may start yesterday if nothing has run yet today
  let current = 0;
  for (let i = cells.length - 1; i >= 0; i--) {
    if (cells[i].runs) current++;
    else if (i === cells.length - 1) continue;
    else break;
  }
  return { longest, current };
}

export function ActivityCard() {
  const [mode, setMode] = useState("runs");
  const [focus, setFocus] = useState(null);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { data, error, loading } = useLoad(() => get(`/users/me/activity?tz=${encodeURIComponent(tz)}`), [tz]);

  const view = useMemo(() => {
    if (!data) return null;
    const grid = buildGrid(new Map(data.days.map((d) => [d.date, d])));
    const cells = grid.flat().filter((c) => !c.future);
    const max = Math.max(1, ...cells.map((c) => c[mode]));
    const weekday = Array(7).fill(0);
    grid.forEach((week) => week.forEach((c, d) => (weekday[d] += c.runs)));
    const busiestDay = weekday.indexOf(Math.max(...weekday));
    const peakHour = data.hours.indexOf(Math.max(...data.hours));
    // month labels where a new month starts in a column
    const months = grid.map((week, w) => {
      const first = week[0].date;
      const prev = w > 0 ? grid[w - 1][0].date : null;
      return !prev || prev.getMonth() !== first.getMonth() ? first.toLocaleDateString(undefined, { month: "short" }) : "";
    });
    return {
      grid,
      months,
      max,
      total: cells.reduce((n, c) => n + c.runs, 0),
      flagged: cells.reduce((n, c) => n + c.flagged, 0),
      active: cells.filter((c) => c.runs).length,
      ...streaks(cells),
      busiestDay: weekday[busiestDay] ? WEEKDAYS[busiestDay] : "–",
      peakHour: data.hours[peakHour] ? hourLabel(peakHour) : "–",
      hourMax: Math.max(1, ...data.hours),
    };
  }, [data, mode]);

  // on narrow screens, start scrolled to the newest week (once, not on every hover)
  const scroller = useRef(null);
  const ready = Boolean(view);
  useEffect(() => {
    if (ready && scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth;
  }, [ready]);

  const level = (n) => (n <= 0 ? 0 : Math.min(4, Math.ceil((n / view.max) * 4)));
  const shown = focus && view?.grid.flat().find((c) => c.key === focus);

  return (
    <Card
      title="Activity"
      icon={<Icons.calendar className="size-3.5" />}
      meta="the last 26 weeks of queries"
      className="rise"
      action={<Tabs items={MODES} value={mode} onChange={setMode} />}
    >
      {error ? (
        <ErrorNote>{error}</ErrorNote>
      ) : loading && !view ? (
        <Skeleton className="h-[180px]" />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_260px]">
          <div className="min-w-0">
            {/* the heatmap: cells stretch to the card, newest week at the right */}
            <div className="-m-1 overflow-x-auto p-1" ref={scroller}>
              <div className="min-w-[440px] max-w-[820px] pr-1" onPointerLeave={() => setFocus(null)}>
                <div className="grid h-4 gap-[3px] font-mono text-[10px] text-ink-3" style={{ gridTemplateColumns: `28px repeat(${WEEKS}, minmax(0, 1fr))` }}>
                  <span />
                  {view.months.map((m, w) => <span key={w} className="whitespace-nowrap">{m}</span>)}
                </div>
                <div className="mt-1 grid grid-flow-col grid-rows-7 gap-[3px]" style={{ gridTemplateColumns: `28px repeat(${WEEKS}, minmax(0, 1fr))` }}>
                  {WEEKDAYS.map((d, i) => <span key={d} className={clsx("self-center font-mono text-[10px] leading-none text-ink-3", i % 2 && "invisible")}>{d}</span>)}
                  {view.grid.flatMap((week, w) =>
                    week.map((c) =>
                      c.future ? (
                        <span key={c.key} className="aspect-square" />
                      ) : (
                        <button
                          key={c.key}
                          type="button"
                          aria-label={`${c.date.toDateString()}: ${c.runs} runs, ${c.flagged} flagged`}
                          onPointerEnter={() => setFocus(c.key)}
                          onFocus={() => setFocus(c.key)}
                          className={clsx(
                            "heat-cell aspect-square w-full rounded-[3px] transition-[background-color,transform,box-shadow] duration-300 hover:scale-125",
                            SHADES[mode][level(c[mode])],
                            focus === c.key && "z-10 scale-125 shadow-[0_0_0_1.5px_var(--color-ink)]"
                          )}
                          style={{ animationDelay: `${w * 22}ms` }}
                        />
                      )
                    )
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4 flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line pt-3 font-mono text-[11px] text-ink-3">
              {shown ? (
                <span key={shown.key} className="swap flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-ink">{shown.date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</span>
                  <span>{formatNumber(shown.runs)} run{shown.runs === 1 ? "" : "s"}</span>
                  {shown.flagged > 0 && <span className="text-warn">{shown.flagged} flagged</span>}
                  {shown.errors > 0 && <span className="text-slow">{shown.errors} failed</span>}
                  {!shown.runs && <span>a quiet day</span>}
                </span>
              ) : (
                <span>hover a day · history is kept for 90 days</span>
              )}
              <span className="flex items-center gap-1.5">
                less
                {SHADES[mode].map((s) => <span key={s} className={clsx("size-[10px] rounded-[2px] transition-colors duration-300", s)} />)}
                more
              </span>
            </div>
          </div>

          {/* numbers + when you work */}
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xs border border-line bg-line">
              {[
                [mode === "runs" ? "runs" : "flagged", mode === "runs" ? view.total : view.flagged, mode === "flagged" && view.flagged ? "text-warn" : ""],
                ["active days", view.active, ""],
                ["day streak", view.current, view.current ? "text-accent-ink" : ""],
                ["best streak", view.longest, ""],
              ].map(([label, value, tone], i) => (
                <div key={label} className="rise bg-bg px-3 py-2.5" style={{ "--i": i }}>
                  <p className={clsx("heading text-[22px] leading-none", tone)}><CountUp value={value} duration={700} /></p>
                  <p className="mt-1.5 truncate font-mono text-[10px] text-ink-3">{label}</p>
                </div>
              ))}
            </div>
            <div>
              <div className="flex items-baseline justify-between font-mono text-[10px] text-ink-3">
                <span>when you query</span>
                <span>peak <span className="text-ink">{view.peakHour}</span> · busiest <span className="text-ink">{view.busiestDay}</span></span>
              </div>
              <div className="mt-2 flex h-10 items-end gap-[2px]" aria-hidden>
                {data.hours.map((n, h) => (
                  <span key={h} title={`${hourLabel(h)}: ${n} runs`} className={clsx("grow-y flex-1 rounded-t-[1px]", n ? (n === view.hourMax ? "bg-accent" : "bg-ink-3") : "bg-fill")} style={{ height: `${Math.max(8, (n / view.hourMax) * 100)}%`, "--i": h }} />
                ))}
              </div>
              <div className="mt-1 flex justify-between font-mono text-[9px] text-ink-3"><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span></div>
            </div>
            <p className="font-mono text-[10px] text-ink-3">
              {data.totals.monitors} monitor{data.totals.monitors === 1 ? "" : "s"} · {data.totals.savedQueries} saved quer{data.totals.savedQueries === 1 ? "y" : "ies"} · {data.totals.snapshots} snapshot{data.totals.snapshots === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}
