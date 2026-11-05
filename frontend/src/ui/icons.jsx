// 16px stroke icons drawn on one grid
const Icon = ({ children, className = "size-4" }) => (
  <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

export const Icons = {
  overview: (p) => <Icon {...p}><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="2.5" y="9" width="4.5" height="4.5" rx="1" /><rect x="9" y="9" width="4.5" height="4.5" rx="1" /></Icon>,
  workspace: (p) => <Icon {...p}><path d="m5 5.5-2.5 2.5L5 10.5M11 5.5l2.5 2.5-2.5 2.5M9.2 3.5l-2.4 9" /></Icon>,
  slow: (p) => <Icon {...p}><circle cx="8" cy="8.5" r="5" /><path d="M8 8.5V6M6.5 2h3" /></Icon>,
  advisor: (p) => <Icon {...p}><path d="M8 2.5 9.4 6.6 13.5 8 9.4 9.4 8 13.5 6.6 9.4 2.5 8l4.1-1.4z" /></Icon>,
  monitors: (p) => <Icon {...p}><path d="M2 8.5h2.5l1.5-4 3 8 1.5-4H14" /></Icon>,
  schema: (p) => <Icon {...p}><ellipse cx="8" cy="4" rx="5" ry="1.8" /><path d="M3 4v8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V4M3 8c0 1 2.2 1.8 5 1.8S13 9 13 8" /></Icon>,
  history: (p) => <Icon {...p}><path d="M2.8 8a5.2 5.2 0 1 0 1.5-3.7M2.5 2.5v2.4h2.4M8 5.3V8l1.8 1.2" /></Icon>,
  connections: (p) => <Icon {...p}><path d="M6 10 10 6M5 7.5 3.8 8.7a2.5 2.5 0 0 0 3.5 3.5L8.5 11M11 8.5l1.2-1.2a2.5 2.5 0 0 0-3.5-3.5L7.5 5" /></Icon>,
  settings: (p) => <Icon {...p}><circle cx="8" cy="8" r="2" /><path d="M8 1.8v1.6M8 12.6v1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M1.8 8h1.6M12.6 8h1.6M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1" /></Icon>,
  plus: (p) => <Icon {...p}><path d="M8 3v10M3 8h10" /></Icon>,
  play: (p) => <Icon {...p}><path d="M4.5 3v10l8-5z" fill="currentColor" stroke="none" /></Icon>,
  sparkle: (p) => <Icon {...p}><path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l1.8 1.8M10.2 10.2 12 12M4 12l1.8-1.8M10.2 5.8 12 4" /></Icon>,
  chevron: (p) => <Icon {...p}><path d="m6 4 4 4-4 4" /></Icon>,
  chevrons: (p) => <Icon {...p}><path d="m5.5 6.5 2.5-2.5 2.5 2.5M5.5 9.5 8 12l2.5-2.5" /></Icon>,
  search: (p) => <Icon {...p}><circle cx="7" cy="7" r="4.2" /><path d="m10.2 10.2 3.3 3.3" /></Icon>,
  logout: (p) => <Icon {...p}><path d="M6.5 3H3.5v10h3M10 5l3 3-3 3M13 8H6.5" /></Icon>,
  trash: (p) => <Icon {...p}><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" /></Icon>,
  copy: (p) => <Icon {...p}><rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1" /><path d="M10.5 5.5V3H3v7.5h2.5" /></Icon>,
  menu: (p) => <Icon {...p}><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" /></Icon>,
  arrow: (p) => <Icon {...p}><path d="M3 8h10M9 4l4 4-4 4" /></Icon>,
  check: (p) => <Icon {...p}><path d="m3.5 8.3 2.8 2.7 6.2-6.5" /></Icon>,
  alert: (p) => <Icon {...p}><path d="M8 2.5 14 13H2z" /><path d="M8 6.5v3M8 11.2v.1" /></Icon>,
  bell: (p) => <Icon {...p}><path d="M4 11V7.5a4 4 0 0 1 8 0V11l1 1.5H3zM6.5 13.5a1.6 1.6 0 0 0 3 0" /></Icon>,
  bolt: (p) => <Icon {...p}><path d="M9 1.8 3.5 9h4l-1 5.2L12.5 7h-4z" /></Icon>,
  command: (p) => <Icon {...p}><path d="M6 6V4.5A1.5 1.5 0 1 0 4.5 6H11.5A1.5 1.5 0 1 0 10 4.5V11.5A1.5 1.5 0 1 0 11.5 10H4.5A1.5 1.5 0 1 0 6 11.5z" /></Icon>,
  close: (p) => <Icon {...p}><path d="m4 4 8 8M12 4l-8 8" /></Icon>,
  camera: (p) => <Icon {...p}><rect x="2" y="4.5" width="12" height="8.5" rx="1" /><circle cx="8" cy="8.7" r="2.2" /><path d="M6 4.5 7 3h2l1 1.5" /></Icon>,
  layers: (p) => <Icon {...p}><path d="M8 2.5 14 5.5 8 8.5 2 5.5zM2 8.5l6 3 6-3M2 11l6 3 6-3" /></Icon>,
  eye: (p) => <Icon {...p}><path d="M1.8 8S4 3.8 8 3.8 14.2 8 14.2 8 12 12.2 8 12.2 1.8 8 1.8 8z" /><circle cx="8" cy="8" r="2" /></Icon>,
  eyeOff: (p) => <Icon {...p}><path d="M6.6 4a6 6 0 0 1 1.4-.2C12 3.8 14.2 8 14.2 8a10 10 0 0 1-1.6 2.2M10.1 10.6A3 3 0 0 1 8 12.2C4 12.2 1.8 8 1.8 8a10.6 10.6 0 0 1 2.7-3.3M2.5 2.5l11 11" /></Icon>,
  user: (p) => <Icon {...p}><circle cx="8" cy="5.5" r="2.7" /><path d="M2.8 13.5a5.2 5.2 0 0 1 10.4 0" /></Icon>,
  mail: (p) => <Icon {...p}><rect x="2" y="3.5" width="12" height="9" rx="1" /><path d="m2.5 4.5 5.5 4.2 5.5-4.2" /></Icon>,
  calendar: (p) => <Icon {...p}><rect x="2.5" y="3.5" width="11" height="10" rx="1" /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" /></Icon>,
  shield: (p) => <Icon {...p}><path d="M8 2 13 4v4c0 3-2.2 5.2-5 6-2.8-.8-5-3-5-6V4z" /><path d="m5.8 8 1.6 1.6 2.9-3" /></Icon>,
  refresh: (p) => <Icon {...p}><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.5h-2.5" /></Icon>,
  sidebar: (p) => <Icon {...p}><rect x="2" y="2.5" width="12" height="11" rx="1.2" /><path d="M6.2 2.5v11M3.8 5.2h.8M3.8 7.2h.8" /></Icon>,
  keyboard: (p) => <Icon {...p}><rect x="1.8" y="4" width="12.4" height="8" rx="1" /><path d="M4.5 6.5h.1M7 6.5h.1M9.5 6.5h.1M12 6.5h.1M5 9.5h6" /></Icon>,
};

// Google's "G", in its own colours (required for a "Continue with Google" button)
export const GoogleG = ({ className = "size-4" }) => (
  <svg viewBox="0 0 48 48" className={className} aria-hidden>
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
);
