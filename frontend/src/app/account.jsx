import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import clsx from "clsx";
import { Dot, Kbd, PixelPanel } from "../ui";
import { Icons } from "../ui/icons";
import { CountUp, MicroBars } from "../ui/motion";
import { get } from "../lib/api";
import { useSession, useCurrentConnection } from "../store/session";
import { useGate } from "../store/gate";
import { engineLabel } from "./kit";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Signs out behind the "closing your session" gate, then lands on the site
export function useSignOut() {
  const navigate = useNavigate();
  return useCallback(() => {
    const { user, logout } = useSession.getState();
    useGate.getState().run("close", { name: user?.fullName, email: user?.email }, async () => {
      await wait(500);
      navigate("/", { replace: true });
      // let the route change land before the session clears
      await wait(250);
      await logout();
    });
  }, [navigate]);
}

// After the account is deleted: the "account dropped" gate, then the site
export function useAccountDropped() {
  const navigate = useNavigate();
  return useCallback(
    (counts) => {
      const { user, clear } = useSession.getState();
      useGate.getState().run("drop", { name: user?.fullName, email: user?.email, counts }, async () => {
        await wait(600);
        navigate("/", { replace: true });
        await wait(250);
        clear();
      });
    },
    [navigate]
  );
}

// ── A 5×5 mirrored pixel avatar from the email, so every account has its own
// mark on the same grid as the logo. Google photos win when there is one.
const hash = (text) => {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
};

export function Avatar({ user, size = 32, animate = false, className }) {
  const [broken, setBroken] = useState(false);
  if (user?.avatarUrl && !broken) {
    return <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} className={clsx("shrink-0 rounded-xs object-cover", className)} style={{ width: size, height: size }} />;
  }
  const h = hash(user?.email ?? "?");
  const cells = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      if ((h >>> (y * 3 + x)) & 1) {
        cells.push([x, y]);
        if (x < 2) cells.push([4 - x, y]);
      }
    }
  }
  const hue = h % 3; // three tints of the accent so neighbours differ
  return (
    <span className={clsx("grid shrink-0 place-items-center rounded-xs bg-accent-soft", className)} style={{ width: size, height: size }} aria-hidden>
      <svg viewBox="0 0 5 5" className="size-[62%]" shapeRendering="crispEdges">
        {cells.map(([x, y], i) => (
          <rect
            key={`${x}-${y}`}
            x={x}
            y={y}
            width="0.86"
            height="0.86"
            fill={["var(--color-accent)", "var(--color-accent-ink)", "var(--color-ink)"][(hue + (y % 2)) % 3]}
            className={animate ? "gate-cell" : undefined}
            style={animate ? { "--i": i * 0.6 } : undefined}
          />
        ))}
      </svg>
    </span>
  );
}

const since = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "today");
const DAY = 86_400_000;
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Runs per day for the last 7 days, oldest first, from recent history
function useWeek(enabled) {
  const [week, setWeek] = useState(null);
  useEffect(() => {
    if (!enabled || week) return;
    get("/history?limit=100").then(
      ({ items }) => {
        const today = new Date().setHours(0, 0, 0, 0);
        const days = Array.from({ length: 7 }, (_, i) => ({ start: today - (6 - i) * DAY, n: 0 }));
        items.forEach((r) => {
          const t = new Date(r.createdAt).getTime();
          const d = days.find((x) => t >= x.start && t < x.start + DAY);
          if (d) d.n++;
        });
        setWeek(days);
      },
      () => setWeek([])
    );
  }, [enabled, week]);
  return week;
}

// ── Sidebar footer: the account row, and a card that opens on hover
// (or click / Enter for keyboards and touch) with details and sign out.
// In the collapsed rail the row is just the avatar and the card opens sideways.
export function ProfileMenu({ onCommand, collapsed = false, side = false }) {
  const user = useSession((s) => s.user);
  const ai = useSession((s) => s.ai);
  const connections = useSession((s) => s.connections);
  const current = useCurrentConnection();
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const wrap = useRef(null);
  const timer = useRef(null);
  const week = useWeek(open);

  const show = useCallback(() => {
    clearTimeout(timer.current);
    setLeaving(false);
    setOpen(true);
  }, []);
  const hide = useCallback((delay = 180) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setLeaving(true);
      timer.current = setTimeout(() => {
        setOpen(false);
        setLeaving(false);
      }, 170);
    }, delay);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => !wrap.current?.contains(e.target) && hide(0);
    const esc = (e) => e.key === "Escape" && hide(0);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open, hide]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => hide(0), [collapsed, hide]);

  const engines = new Set(connections.map((c) => c.type)).size;
  const weekTotal = week?.reduce((n, d) => n + d.n, 0) ?? 0;
  const busiest = week?.length ? week.reduce((a, b) => (b.n > a.n ? b : a)) : null;
  const status = `${connections.length} database${connections.length === 1 ? "" : "s"} · AI ${ai.enabled ? "on" : "off"}`;
  const items = [
    { label: "Account settings", icon: "settings", to: "/app/settings" },
    { label: "Command menu", icon: "command", kbd: ["Ctrl", "K"], run: onCommand },
    { label: "Back to the site", icon: "arrow", to: "/" },
  ];
  const seed = (user?.email ?? "q").split("").reduce((n, c) => n + c.charCodeAt(0), 0);

  return (
    <div
      ref={wrap}
      className="relative"
      onPointerEnter={(e) => e.pointerType === "mouse" && show()}
      onPointerLeave={(e) => e.pointerType === "mouse" && hide()}
    >
      {open && (
        <div
          role="dialog"
          aria-label="Your account"
          className={clsx(
            "absolute z-50",
            // desktop: out over the page, clear of the sidebar. phone menu: above the row
            side ? "bottom-0 left-full w-[300px] pl-4" : "right-0 bottom-full left-0 pb-2",
            leaving ? "pcard-leave" : side ? "pcard-enter-side" : "pcard-enter"
          )}
        >
          <div className="overflow-hidden rounded-sm border border-line-2 bg-bg shadow-[0_32px_64px_-16px_rgb(0_0_0/0.9)]">
            {/* banner + who */}
            <div className="relative">
              <PixelPanel seed={(seed % 97) + 2} live className="h-16 rounded-none opacity-80" />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent to-bg" aria-hidden />
            </div>
            <div className="relative -mt-7 px-4 pb-4">
              <div className="flex items-end justify-between gap-2">
                <span className="rounded-xs bg-bg p-1"><Avatar user={user} size={48} animate /></span>
                <span className="mb-1 flex items-center gap-1.5 rounded-xs border border-line bg-bg/80 px-1.5 py-0.5 font-mono text-[10px] text-ink-2"><Dot tone="ok" live />online</span>
              </div>
              <p className="heading mt-2.5 truncate text-[18px] leading-6">{user?.fullName}</p>
              <p className="truncate text-xs text-ink-3">{user?.email}</p>
              <div className="mt-2.5 flex flex-wrap gap-1.5 font-mono text-[10px] text-ink-3">
                <span className="rounded-xs border border-line px-1.5 py-0.5">since {since(user?.createdAt).toLowerCase()}</span>
                {user?.avatarUrl && <span className="rounded-xs border border-line px-1.5 py-0.5">google</span>}
                {current && <span className="max-w-full truncate rounded-xs border border-line px-1.5 py-0.5">open: {current.name}</span>}
              </div>
            </div>

            {/* this week */}
            <div className="border-t border-line px-4 py-3">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="caps text-ink-3">This week</p>
                  <p className="mt-1.5 text-sm">
                    {week ? <><CountUp value={weekTotal} duration={700} /> run{weekTotal === 1 ? "" : "s"}</> : <span className="text-ink-3">counting…</span>}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-ink-3">{busiest?.n ? `busiest: ${WEEKDAY[new Date(busiest.start).getDay()].toLowerCase()}` : "nothing run yet"}</p>
                </div>
                {week?.length ? (
                  <MicroBars values={week.map((d) => d.n + 0.4)} highlight={[6]} className="h-9" />
                ) : (
                  <span className="skeleton h-9 w-[46px] rounded-xs" aria-hidden />
                )}
              </div>
            </div>

            {/* numbers */}
            <div className="grid grid-cols-3 divide-x divide-line border-t border-line">
              {[
                ["databases", connections.length],
                ["engines", engines],
                ["ai", ai.enabled ? "on" : "off"],
              ].map(([label, value], i) => (
                <div key={label} className="rise min-w-0 px-3 py-2.5" style={{ "--i": i + 1 }}>
                  <p className="heading text-[18px] leading-none">{typeof value === "number" ? <CountUp value={value} duration={600} /> : <span className={value === "on" ? "text-accent-ink" : "text-ink-3"}>{value}</span>}</p>
                  <p className="mt-1.5 truncate font-mono text-[10px] text-ink-3">{label}</p>
                </div>
              ))}
            </div>

            {/* actions */}
            <div className="border-t border-line p-1">
              {items.map((it, i) => {
                const Icon = Icons[it.icon];
                const body = (
                  <>
                    <Icon className={clsx("size-3.5 text-ink-3 transition-[color,transform] duration-300 ease-[var(--ease-out)] group-hover:text-ink", it.icon === "arrow" ? "-rotate-45 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" : "group-hover:scale-110")} />
                    <span className="flex-1">{it.label}</span>
                    {it.kbd && <span className="flex gap-0.5">{it.kbd.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>}
                  </>
                );
                const cls = "rise group flex w-full items-center gap-2.5 rounded-xs px-2.5 py-2 text-left text-[13px] text-ink-2 transition-colors hover:bg-fill hover:text-ink";
                return it.to ? (
                  <Link key={it.label} to={it.to} onClick={() => hide(0)} className={cls} style={{ "--i": i + 4 }}>{body}</Link>
                ) : (
                  <button key={it.label} type="button" onClick={() => { hide(0); it.run?.(); }} className={cls} style={{ "--i": i + 4 }}>{body}</button>
                );
              })}
              <div className="my-1 h-px bg-line" />
              <button
                type="button"
                onClick={() => { hide(0); signOut(); }}
                className="rise group flex w-full items-center gap-2.5 rounded-xs px-2.5 py-2 text-left text-[13px] text-ink-2 transition-colors hover:bg-slow-soft hover:text-slow"
                style={{ "--i": 8 }}
              >
                <Icons.logout className="size-3.5 transition-transform duration-300 ease-[var(--ease-out)] group-hover:translate-x-0.5" />
                <span className="flex-1">Sign out</span>
                <Icons.arrow className="size-3.5 -translate-x-1 opacity-0 transition-[opacity,transform] duration-300 ease-[var(--ease-out)] group-hover:translate-x-0 group-hover:opacity-100" />
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={collapsed ? `Your account, ${user?.fullName}` : undefined}
        onClick={() => (open && !leaving ? hide(0) : show())}
        className={clsx(
          "press group relative flex w-full items-center gap-2.5 overflow-hidden rounded-xs border text-left whitespace-nowrap transition-[background-color,border-color,padding] duration-300",
          collapsed ? "p-[7px]" : "p-1.5 pr-2",
          open ? "border-line-2 bg-fill" : "border-transparent hover:border-line hover:bg-fill/60"
        )}
      >
        {/* a sliver of accent that rises while the card is open */}
        <span className={clsx("absolute inset-y-1.5 left-0 w-[2px] origin-bottom rounded-full bg-accent transition-transform duration-300 ease-[var(--ease-out)]", open ? "scale-y-100" : "scale-y-0")} aria-hidden />
        <span className="relative shrink-0 transition-transform duration-300 ease-[var(--ease-out)] group-hover:scale-105">
          <Avatar user={user} size={32} />
          <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-subtle bg-pass" aria-hidden />
        </span>
        <span className="rail-label min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{user?.fullName}</span>
          <span className="block truncate font-mono text-[10.5px] text-ink-3">{status}</span>
        </span>
        <span className="rail-label grid size-6 shrink-0 place-items-center rounded-xs text-ink-3 transition-colors group-hover:text-ink">
          <Icons.chevron className={clsx("size-3.5 transition-transform duration-300 ease-[var(--ease-out)]", open ? "-rotate-90" : "rotate-90 group-hover:-rotate-90")} />
        </span>
      </button>
    </div>
  );
}
