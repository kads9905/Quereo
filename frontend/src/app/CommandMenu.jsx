import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import clsx from "clsx";
import { Kbd } from "../ui";
import { Icons } from "../ui/icons";
import { useSignOut } from "./account";
import { useSession } from "../store/session";
import { engineLabel } from "./kit";

// ⌘K / Ctrl+K: jump to a page, switch database, or run an action.
export function CommandMenu({ open, onClose, pages, onAddConnection }) {
  const navigate = useNavigate();
  const { connections, select } = useSession();
  const signOut = useSignOut();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const dialogRef = useRef(null);
  const listRef = useRef(null);

  const items = useMemo(() => {
    const all = [
      ...pages.map((p) => ({ group: "Pages", label: p.label, icon: p.icon, run: () => navigate(p.to) })),
      ...connections.map((c) => ({ group: "Databases", label: `Open ${c.name}`, hint: engineLabel(c.type), icon: "connections", run: () => select(c._id) })),
      { group: "Actions", label: "Add a connection", icon: "plus", run: onAddConnection },
      { group: "Actions", label: "Run a query", icon: "play", run: () => navigate("/app/workspace") },
      { group: "Actions", label: "Create a monitor", icon: "bell", run: () => navigate("/app/monitors", { state: { create: true } }) },
      { group: "Actions", label: "Sign out", icon: "logout", run: signOut },
    ];
    const q = query.trim().toLowerCase();
    return q ? all.filter((item) => `${item.label} ${item.hint ?? ""} ${item.group}`.toLowerCase().includes(q)) : all;
  }, [pages, connections, query, navigate, select, signOut, onAddConnection]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && !dialog.open) {
      setQuery("");
      setActive(0);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (item) => {
    onClose();
    item?.run();
  };

  const onKeyDown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((a) => Math.min(items.length - 1, a + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(items[active]);
    }
  };

  let lastGroup = null;
  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => e.target === dialogRef.current && onClose()}
      className="mx-auto mt-[12vh] w-[min(600px,calc(100vw-24px))] rounded-md border border-line-2 bg-bg p-0 text-ink shadow-[0_40px_100px_-20px_rgb(0_0_0/0.8)] backdrop:bg-black/60 backdrop:backdrop-blur-[3px]"
    >
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Icons.search className="size-4 text-ink-3" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search pages, databases and actions…"
          aria-label="Search"
          className="h-14 flex-1 bg-transparent text-md placeholder:text-ink-3 focus:outline-none"
        />
        <Kbd>Esc</Kbd>
      </div>
      <ul ref={listRef} className="max-h-[380px] overflow-y-auto p-2" role="listbox">
        {items.map((item, i) => {
          const Icon = Icons[item.icon] ?? Icons.arrow;
          const header = item.group !== lastGroup;
          lastGroup = item.group;
          return (
            <li key={`${item.group}-${item.label}`}>
              {header && <p className="caps px-2.5 pt-3 pb-1.5 text-ink-3">{item.group}</p>}
              <button
                type="button"
                data-index={i}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setActive(i)}
                onClick={() => choose(item)}
                className={clsx("flex w-full items-center gap-3 rounded-xs px-2.5 py-2 text-left text-sm transition-colors duration-100", i === active ? "bg-fill text-ink" : "text-ink-2")}
              >
                <span className={clsx("grid size-6 place-items-center rounded-xs border transition-colors", i === active ? "border-accent/50 text-accent-ink" : "border-line text-ink-3")}><Icon className="size-3.5" /></span>
                <span className="flex-1">{item.label}</span>
                {item.hint && <span className="font-mono text-xs text-ink-3">{item.hint}</span>}
                {i === active && <Icons.arrow className="swap size-3.5 text-ink-3" />}
              </button>
            </li>
          );
        })}
        {!items.length && <li className="px-3 py-8 text-center text-sm text-ink-3">Nothing matches "{query}".</li>}
      </ul>
      <div className="flex items-center gap-4 border-t border-line px-4 py-2.5 text-[11px] text-ink-3">
        <span className="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span>
        <span className="flex items-center gap-1.5"><Kbd>↵</Kbd> open</span>
      </div>
    </dialog>
  );
}
