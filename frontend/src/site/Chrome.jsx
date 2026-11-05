import { useEffect, useState } from "react";
import { Link } from "react-router";
import clsx from "clsx";
import { Button, Dot, Logo } from "../ui";
import { Icons } from "../ui/icons";
import { useSession } from "../store/session";
import { onHashLink } from "./smooth";

const LINKS = [
  { href: "/#product", label: "Product" },
  { href: "/#why", label: "Why Quereo" },
  { href: "/#safety", label: "Safety" },
  { href: "/#stack", label: "Databases" },
  { href: "/#faq", label: "FAQ" },
];

export function SiteNav() {
  const signedIn = useSession((s) => s.status === "ready");
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={clsx("sticky top-0 z-40 border-b transition-[background-color,border-color] duration-300", scrolled || open ? "border-line bg-bg/80 backdrop-blur-xl" : "border-transparent bg-transparent")}>
      <div className="gutter flex h-16 items-center justify-between gap-6">
        <div className="flex items-center gap-10">
          <Link to="/" aria-label="Quereo home" className="press"><Logo /></Link>
          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {LINKS.map((link) => (
              <a key={link.label} href={link.href} onClick={(e) => onHashLink(e, link.href)} className="rounded-sm px-2.5 py-1.5 text-[13px] text-ink-2 transition-colors hover:bg-white/5 hover:text-ink">{link.label}</a>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <span className="mr-3 hidden items-center gap-2 font-mono text-[11px] text-ink-3 lg:flex">
            <Dot tone="ok" live /> postgres · mysql · mongodb
          </span>
          {signedIn ? (
            <Button as={Link} to="/app" size="sm" arrow>Open app</Button>
          ) : (
            <>
              <Link to="/login" className="draw hidden px-2 text-[13px] text-ink-2 hover:text-ink sm:block">Sign in</Link>
              <Button as={Link} to="/register" size="sm" arrow>Start free</Button>
            </>
          )}
          <button type="button" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="press grid size-8 place-items-center rounded-xs text-ink-2 hover:bg-fill md:hidden">
            {open ? <Icons.close className="size-4" /> : <Icons.menu className="size-4" />}
          </button>
        </div>
      </div>
      <div className="accordion md:hidden" data-open={open}>
        <nav aria-label="Mobile" className="gutter flex flex-col border-t border-line py-2">
          {LINKS.map((link, i) => (
            <a key={link.label} href={link.href} onClick={(e) => { setOpen(false); onHashLink(e, link.href); }} className={clsx("flex items-center justify-between py-3 text-md text-ink-2 hover:text-ink", open && "rise")} style={{ "--i": i }}>
              {link.label}<Icons.arrow className="size-4 text-ink-3" />
            </a>
          ))}
          {!signedIn && <Link to="/login" className="py-3 text-md text-ink-2">Sign in</Link>}
        </nav>
      </div>
    </header>
  );
}

const FOOTER_COLUMNS = [
  ["Product", [["Features", "/#product"], ["Why Quereo", "/#why"], ["Safety", "/#safety"], ["Databases", "/#stack"], ["FAQ", "/#faq"]]],
  ["Engines", [["PostgreSQL", "/#stack"], ["MySQL", "/#stack"], ["MongoDB", "/#stack"]]],
  ["Account", [["Start free", "/register"], ["Sign in", "/login"], ["Dashboard", "/app"]]],
  ["Legal", [["Terms", "/terms"], ["Privacy", "/privacy"]]],
];

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-black">
      {/* A tiny receipt: even the footer gets a verdict */}
      <div className="gutter border-b border-line py-4">
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-ink-3">
          <span><span className="text-accent-ink">SELECT</span> * <span className="text-accent-ink">FROM</span> footer;</span>
          <span className="text-line-2">→</span>
          <span>1 row · 0.02 ms · index scan</span>
          <span className="caps rounded-[3px] bg-pass-soft px-1.5 py-0.5 text-pass">pass</span>
        </p>
      </div>

      <div className="gutter grid grid-cols-[minmax(0,1fr)] gap-12 py-16 md:grid-cols-12">
        <div className="md:col-span-4">
          <Logo />
          <p className="mt-4 max-w-[38ch] text-sm leading-relaxed text-ink-2">Reads the plan behind every query, so you can stop reading the logs.</p>
          <Link to="/register" className="group mt-6 inline-flex items-center gap-2 text-sm text-ink transition-colors hover:text-accent-ink">
            Start free <Icons.arrow className="nudge size-3.5" />
          </Link>
        </div>
        {FOOTER_COLUMNS.map(([title, links]) => (
          <nav key={title} aria-label={title} className="md:col-span-2">
            <p className="caps text-ink-3">{title}</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              {links.map(([label, href]) => (
                <li key={label}>
                  {href.startsWith("/#") ? (
                    <a href={href} onClick={(e) => onHashLink(e, href)} className="text-ink-2 transition-colors hover:text-accent-ink">{label}</a>
                  ) : (
                    <Link to={href} className="text-ink-2 transition-colors hover:text-accent-ink">{label}</Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="gutter flex flex-col gap-3 border-t border-line py-6 font-mono text-[11px] text-ink-3 md:flex-row md:items-center md:gap-6">
        <span>© 2026 Quereo</span>
        <span className="leading-relaxed">built by <span className="text-ink">Kadambari</span>, who sees a Seq Scan and takes it personally</span>
        <span className="flex items-center gap-4 md:ml-auto">
          <Link to="/terms" className="transition-colors hover:text-accent-ink">terms</Link>
          <Link to="/privacy" className="transition-colors hover:text-accent-ink">privacy</Link>
          <span className="flex items-center gap-2"><Dot tone="ok" live />every query read-only by default</span>
        </span>
      </div>
    </footer>
  );
}
