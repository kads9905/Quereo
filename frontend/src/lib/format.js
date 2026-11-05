const numberFormat = new Intl.NumberFormat("en-US");
const plural = new Intl.PluralRules("en-US");
const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export const formatNumber = (value) => (value == null || Number.isNaN(Number(value)) ? "–" : numberFormat.format(value));

export const formatMs = (ms) => {
  if (ms == null || Number.isNaN(Number(ms))) return "–";
  if (ms === 0) return "<1 ms";
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 100) return `${ms.toFixed(1)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
};

export const pluralize = (count, one, many = `${one}s`) =>
  `${formatNumber(count)} ${plural.select(count) === "one" ? one : many}`;

export const formatBytes = (bytes) => {
  if (bytes == null) return "–";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
};

export const timeAgo = (date) => {
  if (!date) return "never";
  const seconds = Math.round((new Date(date).getTime() - Date.now()) / 1000);
  for (const [unit, size] of [["day", 86400], ["hour", 3600], ["minute", 60]]) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return "just now";
};

export const compactRows = (n) => {
  if (n == null) return "–";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
};

// Cell values from any database: null, objects (MongoDB), long strings
export const formatCell = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

export const ENGINES = { postgres: "PostgreSQL", mysql: "MySQL", mongodb: "MongoDB" };
