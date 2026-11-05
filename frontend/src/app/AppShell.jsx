import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation } from "react-router";
import clsx from "clsx";
import { Button, Dot, Kbd, Logo, LogoMark, Skeleton } from "../ui";
import { Icons } from "../ui/icons";
import { get } from "../lib/api";
import { useSession, useCurrentConnection } from "../store/session";
import { AddConnectionDialog, engineLabel } from "./kit";
import { CommandMenu } from "./CommandMenu";
import { ProfileMenu } from "./account";
import { useGate } from "../store/gate";

const GROUPS = [
  {
    title: "Analyze",
    items: [
      { to: "/app", label: "Overview", icon: "overview", end: true },
      { to: "/app/workspace", label: "Query workspace", icon: "workspace", kbd: "Q" },
      { to: "/app/slow-queries", label: "Slow queries", icon: "slow" },
      { to: "/app/advisor", label: "Index Advisor", icon: "advisor" },
    ],
  },
  {
    title: "Watch",
    items: [
      { to: "/app/monitors", label: "Monitors", icon: "monitors", badge: "failing" },
      { to: "/app/history", label: "History", icon: "history" },
    ],
  },
  {
    title: "Structure",
    items: [{ to: "/app/schema", label: "Schema", icon: "schema" }],
  },
];
const FOOT = [
  { to: "/app/connections", label: "Connections", icon: "connections" },
  { to: "/app/settings", label: "Settings", icon: "settings" },
];
const ALL = [...GROUPS.flatMap((g) => g.items), ...FOOT];

const ENGINE_MONO = { postgres: "PG", mysql: "MY", mongodb: "MG" };
const COLLAPSED_KEY = "quereo:sidebar-collapsed";
const WIDE = 264;
const RAIL = 64;

const remembered = () => {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
};

function EngineGlyph({ type, className }) {
  return <span className={clsx("grid shrink-0 place-items-center rounded-xs border border-line-2 bg-bg font-mono text-[10px] text-accent-ink", className)}>{ENGINE_MONO[type] ?? "DB"}</span>;
}

// A label that slides out from the rail when the sidebar is collapsed.
// One floating element for the whole sidebar, so nothing clips it.
function useRailTip(collapsed) {
  const [tip, setTip] = useState(null);
  useEffect(() => {
    if (!collapsed) setTip(null);
  }, [collapsed]);
  const bind = (label, extra) =>
    collapsed
      ? {
          onPointerEnter: (e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setTip({ label, extra, y: r.top + r.height / 2 });
          },
          onPointerLeave: () => setTip(null),
          onFocus: (e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setTip({ label, extra, y: r.top + r.height / 2 });
          },
          onBlur: () => setTip(null),
          "aria-label": label,
        }
      : {};
  const node = tip && (
    <div key={tip.label} role="tooltip" className="tip-in pointer-events-none fixed z-[60] flex -translate-y-1/2 items-center gap-2 rounded-xs border border-line-2 bg-bg px-2.5 py-1.5 text-xs whitespace-nowrap text-ink shadow-[0_12px_32px_-8px_rgb(0_0_0/0.8)]" style={{ left: RAIL + 6, top: tip.y }}>
      {tip.label}
      {tip.extra}
    </div>
  );
  return { bind, node, hide: () => setTip(null) };
}

// Custom popover so every database is one click away, with its engine and mode
function ConnectionSwitcher({ onAdd, collapsed, tip }) {
  const { connections, select } = useSession();
  const current = useCurrentConnection();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!connections.length) {
    return (
      <button
        type="button"
        onClick={onAdd}
        {...tip.bind("Connect a database")}
        className={clsx("press flex w-full items-center gap-2.5 overflow-hidden rounded-xs border border-dashed border-line-2 text-left text-sm whitespace-nowrap text-ink-2 hover:border-accent hover:text-ink", collapsed ? "p-[5px]" : "px-3 py-2.5")}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-xs bg-fill"><Icons.plus className="size-3.5" /></span>
        <span className="rail-label">Connect a database</span>
      </button>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          tip.hide();
          setOpen((o) => !o);
        }}
        {...tip.bind(current?.name, <span className="font-mono text-[10px] text-ink-3">{engineLabel(current?.type)}</span>)}
        className={clsx("press flex w-full items-center gap-2.5 overflow-hidden rounded-xs border bg-bg py-2 text-left transition-[padding,border-color] duration-300", collapsed ? "px-[3px]" : "px-2.5", open ? "border-line-2" : "border-line hover:border-line-2")}
      >
        <EngineGlyph type={current?.type} className="size-8" />
        <span className="rail-label min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{current?.name}</span>
          <span className="flex items-center gap-1.5 truncate text-[11px] text-ink-3"><Dot tone="ok" live />{engineLabel(current?.type)}{current?.readOnly ? " · read-only" : " · writable"}</span>
        </span>
        <Icons.chevrons className="rail-label size-3.5 shrink-0 text-ink-3" />
      </button>
      {open && (
        <div role="listbox" className={clsx("pop-in absolute z-50 overflow-hidden rounded-xs border border-line-2 bg-bg p-1 shadow-[0_24px_48px_-12px_rgb(0_0_0/0.8)]", collapsed ? "top-0 left-full ml-3 w-60" : "top-full right-0 left-0 mt-1.5")}>
          <p className="caps px-2 pt-1.5 pb-1 text-ink-3">Databases</p>
          {connections.map((c) => (
            <button
              key={c._id}
              type="button"
              role="option"
              aria-selected={c._id === current?._id}
              onClick={() => {
                select(c._id);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2.5 rounded-xs px-2 py-1.5 text-left hover:bg-fill"
            >
              <EngineGlyph type={c.type} className="size-6 text-[9px]" />
              <span className="min-w-0 flex-1 truncate text-[13px]">{c.name}</span>
              {c._id === current?._id && <Icons.check className="size-3.5 text-accent-ink" />}
            </button>
          ))}
          <div className="mt-1 border-t border-line pt-1">
            <button type="button" onClick={() => { setOpen(false); onAdd(); }} className="flex w-full items-center gap-2.5 rounded-xs px-2 py-1.5 text-left text-[13px] text-ink-2 hover:bg-fill hover:text-ink">
              <span className="grid size-6 place-items-center"><Icons.plus className="size-3.5" /></span>Add a connection
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Nav whose active highlight slides between items
function Nav({ failing, onNavigate, collapsed, tip }) {
  const location = useLocation();
  const wrap = useRef(null);
  const [box, setBox] = useState(null);

  useLayoutEffect(() => {
    const el = wrap.current?.querySelector("a[aria-current='page']");
    setBox(el ? { top: el.offsetTop, height: el.offsetHeight } : null);
  }, [location.pathname, collapsed]);

  const item = (it) => {
    const Icon = Icons[it.icon];
    const badge = it.badge === "failing" && failing > 0;
    return (
      <NavLink
        key={it.to}
        to={it.to}
        end={it.end}
        onClick={onNavigate}
        {...tip.bind(it.label, badge && <span className="rounded-xs bg-slow-soft px-1 font-mono text-[10px] text-slow">{failing} failing</span>)}
        className={({ isActive }) => clsx("group relative z-10 flex items-center gap-2.5 overflow-hidden rounded-xs py-[7px] text-[13px] whitespace-nowrap transition-[color,background-color,padding] duration-300", collapsed ? "px-4" : "px-3", isActive ? "text-ink" : "text-ink-2 hover:bg-fill/50 hover:text-ink")}
      >
        <span className="relative shrink-0">
          <Icon className="size-4 transition-transform duration-300 ease-[var(--ease-out)] group-hover:scale-110" />
          {badge && collapsed && <span className="absolute -top-1 -right-1 size-2 rounded-full border border-subtle bg-slow" />}
        </span>
        <span className="rail-label flex-1">{it.label}</span>
        {badge && <span className="rail-label rounded-xs bg-slow-soft px-1.5 font-mono text-[10px] text-slow">{failing}</span>}
      </NavLink>
    );
  };

  return (
    <nav ref={wrap} aria-label="App" className="relative flex flex-col px-2">
      {box && (
        <span
          aria-hidden
          className="absolute right-2 left-2 rounded-xs bg-fill shadow-[inset_2px_0_0_var(--color-accent),0_0_0_1px_var(--color-line)] transition-[transform,height] duration-300 ease-[var(--ease-out)]"
          style={{ top: 0, height: box.height, transform: `translateY(${box.top}px)` }}
        />
      )}
      {GROUPS.map((group) => (
        <div key={group.title} className="mb-3">
          <div className="relative flex h-6 items-center px-3">
            <span className="rail-label caps text-ink-3">{group.title}</span>
            <span className={clsx("absolute inset-x-3 top-1/2 h-px bg-line transition-opacity duration-300", collapsed ? "opacity-100" : "opacity-0")} aria-hidden />
          </div>
          <div className="flex flex-col gap-0.5">{group.items.map(item)}</div>
        </div>
      ))}
      <div className="flex flex-col gap-0.5 border-t border-line pt-3">{FOOT.map(item)}</div>
    </nav>
  );
}

export default function AppShell() {
  const { status, ai } = useSession();
  const leavingApp = useGate((s) => s.gate && s.gate.kind !== "open");
  const current = useCurrentConnection();
  const location = useLocation();
  const [adding, setAdding] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [failing, setFailing] = useState(0);
  const [collapsed, setCollapsed] = useState(remembered);
  const tip = useRailTip(collapsed);

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, c ? "0" : "1");
      } catch {
        // private mode: it just won't be remembered
      }
      return !c;
    });
  }, []);

  // ⌘K / Ctrl+K: command menu. ⌘B / Ctrl+B: collapse the sidebar.
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === "k") {
        e.preventDefault();
        setCommandOpen((o) => !o);
      } else if (key === "b" && !e.target.closest?.("input, textarea, [contenteditable]")) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  // Failing monitors on the open database, for the nav badge
  useEffect(() => {
    if (!current) return;
    get(`/monitors?connectionId=${current._id}`).then((m) => setFailing(m.filter((x) => x.enabled && x.status === "failing").length), () => setFailing(0));
  }, [current, location.pathname]);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  const openAdd = useCallback(() => setAdding(true), []);

  if (status === "loading") {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="flex flex-col items-center gap-5">
          <LogoMark className="size-8 animate-pulse" />
          <Skeleton className="h-1 w-32" />
        </div>
      </div>
    );
  }
  // signing out / deleting: the gate is taking the user home, so don't bounce to /login
  if (status === "guest") return leavingApp ? null : <Navigate to="/login" replace />;

  const page = ALL.find((p) => (p.end ? location.pathname === p.to : location.pathname.startsWith(p.to))) ?? ALL[0];

  // `rail` is true only for the collapsed desktop sidebar; the phone menu is always wide
  const sidebar = (rail, desktop) => {
    const railTip = rail ? tip : { bind: () => ({}), hide: () => {} };
    return (
      <div className={clsx("flex h-full flex-col", rail && "is-rail")}>
        <div className="flex h-14 items-center justify-between gap-2 px-3">
          {rail ? (
            // collapsed: the mark turns into the expand button on hover
            <button type="button" onClick={toggle} {...tip.bind("Expand sidebar", <span className="flex gap-0.5"><Kbd>Ctrl</Kbd><Kbd>B</Kbd></span>)} className="press group relative mx-auto grid size-10 place-items-center rounded-xs hover:bg-fill">
              <LogoMark className="size-6 transition-[opacity,transform] duration-300 ease-[var(--ease-out)] group-hover:scale-75 group-hover:opacity-0" />
              <Icons.sidebar className="absolute size-4 scale-75 text-ink opacity-0 transition-[opacity,transform] duration-300 ease-[var(--ease-out)] group-hover:scale-100 group-hover:opacity-100" />
            </button>
          ) : (
            <>
              <Link to="/" aria-label="Quereo home" className="press pl-1"><Logo /></Link>
              <button
                type="button"
                onClick={toggle}
                title="Collapse sidebar (Ctrl+B)"
                aria-label="Collapse sidebar"
                className="press group hidden size-8 place-items-center rounded-xs text-ink-3 transition-colors hover:bg-fill hover:text-ink lg:grid"
              >
                <Icons.sidebar className="size-4 transition-transform duration-300 ease-[var(--ease-out)] group-hover:-translate-x-0.5" />
              </button>
            </>
          )}
        </div>
        <div className="px-3 pb-2.5"><ConnectionSwitcher onAdd={openAdd} collapsed={rail} tip={railTip} /></div>
        <div className="px-3 pb-4">
          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            {...railTip.bind("Jump to…", <span className="flex gap-0.5"><Kbd>Ctrl</Kbd><Kbd>K</Kbd></span>)}
            className="press flex h-9 w-full items-center gap-2.5 overflow-hidden rounded-xs border border-line bg-bg/60 px-[11px] text-left text-[13px] whitespace-nowrap text-ink-3 hover:border-line-2 hover:text-ink-2"
          >
            <Icons.search className="size-3.5 shrink-0" />
            <span className="rail-label flex-1">Jump to…</span>
            <span className="rail-label flex gap-0.5"><Kbd>Ctrl</Kbd><Kbd>K</Kbd></span>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"><Nav failing={failing} collapsed={rail} tip={railTip} onNavigate={() => setMenuOpen(false)} /></div>
        <div className="border-t border-line p-2">
          <ProfileMenu collapsed={rail} side={desktop} onCommand={() => setCommandOpen(true)} />
        </div>
      </div>
    );
  };

  return (
    <div
      className="min-h-screen bg-bg transition-[grid-template-columns] duration-500 ease-[var(--ease-out)] lg:grid lg:grid-cols-[var(--sidebar)_minmax(0,1fr)]"
      style={{ "--sidebar": `${collapsed ? RAIL : WIDE}px` }}
    >
      <aside className="sticky top-0 z-40 hidden h-screen border-r border-line bg-subtle lg:block">{sidebar(collapsed, true)}</aside>
      {tip.node}

      <div className="min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-line bg-bg/80 px-[var(--gutter)] backdrop-blur-xl">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" aria-label="Menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)} className="press -ml-1 grid size-8 place-items-center rounded-xs hover:bg-fill lg:hidden">
              {menuOpen ? <Icons.close className="size-4" /> : <Icons.menu className="size-4" />}
            </button>
            <span className="lg:hidden"><LogoMark /></span>
            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 font-mono text-xs">
              <span className="hidden truncate text-ink-3 sm:inline">{current?.name ?? "no database"}</span>
              <span className="hidden text-line-2 sm:inline">/</span>
              <span key={page.to} className="swap truncate text-ink">{page.label.toLowerCase()}</span>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <span className={clsx("hidden items-center gap-2 rounded-xs border px-2 py-1 font-mono text-[11px] md:flex", ai.enabled ? "border-accent/30 text-accent-ink" : "border-line text-ink-3")}>
              <Icons.sparkle className="size-3" />{ai.enabled ? "AI on" : "AI off"}
            </span>
            <button type="button" onClick={() => setCommandOpen(true)} className="press grid size-8 place-items-center rounded-xs text-ink-3 hover:bg-fill hover:text-ink lg:hidden" aria-label="Search">
              <Icons.search className="size-4" />
            </button>
            {current && page.to !== "/app/workspace" && <Button as={Link} to="/app/workspace" size="sm"><Icons.play className="size-3" />Run query</Button>}
          </div>
        </header>

        {/* Phone menu */}
        <div className={clsx("fixed inset-x-0 top-14 bottom-0 z-30 bg-subtle transition-[opacity,transform] duration-300 ease-[var(--ease-out)] lg:hidden", menuOpen ? "opacity-100" : "pointer-events-none -translate-y-2 opacity-0")}>{menuOpen && sidebar(false, false)}</div>

        <main className="gutter-app py-8 lg:py-10">
          <div key={location.pathname} className="page">
            <Outlet context={{ openAddConnection: openAdd }} />
          </div>
        </main>
      </div>

      <AddConnectionDialog open={adding} onClose={() => setAdding(false)} />
      <CommandMenu open={commandOpen} onClose={() => setCommandOpen(false)} pages={ALL} onAddConnection={openAdd} />
    </div>
  );
}
