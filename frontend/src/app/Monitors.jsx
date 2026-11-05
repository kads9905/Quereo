import { useState } from "react";
import { useLocation } from "react-router";
import clsx from "clsx";
import { toast } from "sonner";
import { Button, Card, Dialog, Dot, Empty, ErrorNote, Field, Input, Loading, Select, Tabs, Textarea } from "../ui";
import { Icons } from "../ui/icons";
import { del, get, patch, post } from "../lib/api";
import { formatMs, formatNumber, timeAgo } from "../lib/format";
import { SAMPLES } from "../lib/samples";
import { NeedsConnection, PageHeader, useLoad } from "./kit";

const CHECKS = { row_count: "Row count", value: "Value", duration: "Duration (ms)" };
const INTERVALS = [[60, "Every minute"], [300, "Every 5 minutes"], [900, "Every 15 minutes"], [3600, "Every hour"], [86400, "Every day"]];
const every = (seconds) => INTERVALS.find(([s]) => s === seconds)?.[1].toLowerCase() ?? `every ${seconds}s`;
const describe = (check) => `${CHECKS[check.type]} ${check.operator} ${formatNumber(check.threshold)}`;
const tone = (m) => (!m.enabled ? "idle" : m.status === "failing" ? "bad" : m.status === "passing" ? "ok" : "idle");

function Strip({ runs, size = 30 }) {
  const shown = runs.slice(0, size).reverse();
  return (
    <div className="flex gap-[2px]" aria-label={`${shown.filter((r) => !r.passed).length} failed of the last ${shown.length} runs`}>
      {Array.from({ length: size }, (_, i) => {
        const run = shown[shown.length - size + i];
        return <span key={i} title={run ? `${run.passed ? "Passed" : "Failed"} · ${run.value ?? run.error ?? ""} · ${timeAgo(run.ranAt)}` : undefined} className={clsx("h-5 flex-1", !run ? "bg-fill" : run.passed ? "bg-pass/45" : "bg-slow")} />;
      })}
    </div>
  );
}

function CreateDialog({ open, onClose, connection, onCreated }) {
  const [form, setForm] = useState({
    name: "",
    sql: SAMPLES[connection.type]?.query ?? "",
    type: "duration",
    operator: "<",
    threshold: "200",
    intervalSeconds: "300",
    alertAfter: "1",
    webhookUrl: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { firstRun } = await post("/monitors", {
        connectionId: connection._id,
        name: form.name,
        sql: form.sql,
        check: { type: form.type, operator: form.operator, threshold: Number(form.threshold) },
        intervalSeconds: Number(form.intervalSeconds),
        alertAfter: Number(form.alertAfter),
        webhookUrl: form.webhookUrl || undefined,
      });
      toast.success(firstRun?.passed === false ? "Monitor created. Its first run failed." : "Monitor created");
      onCreated();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="New monitor">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Name"><Input value={form.name} onChange={set("name")} placeholder="Customer lookup stays fast" required /></Field>
        <Field label="Query"><Textarea value={form.sql} onChange={set("sql")} rows={4} spellCheck={false} required /></Field>
        <div className="grid grid-cols-[1.3fr_80px_1fr] gap-3">
          <Field label="Check">
            <Select value={form.type} onChange={set("type")}>
              {Object.entries(CHECKS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
          <Field label="Must be">
            <Select value={form.operator} onChange={set("operator")}>
              {["<", "<=", ">", ">=", "==", "!="].map((op) => <option key={op}>{op}</option>)}
            </Select>
          </Field>
          <Field label="Threshold"><Input value={form.threshold} onChange={set("threshold")} inputMode="decimal" required /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Runs">
            <Select value={form.intervalSeconds} onChange={set("intervalSeconds")}>
              {INTERVALS.map(([s, label]) => <option key={s} value={s}>{label}</option>)}
            </Select>
          </Field>
          <Field label="Alert after">
            <Select value={form.alertAfter} onChange={set("alertAfter")}>
              {[1, 2, 3, 5].map((n) => <option key={n} value={n}>{n} failed run{n > 1 ? "s" : ""}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Webhook (optional)" hint="Slack or Discord incoming webhook URL."><Input value={form.webhookUrl} onChange={set("webhookUrl")} placeholder="https://hooks.slack.com/services/…" type="url" /></Field>
        <ErrorNote>{error}</ErrorNote>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Running first check…" : "Create monitor"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function Detail({ id, onChanged, onDeleted }) {
  const [range, setRange] = useState("24h");
  const detail = useLoad(() => get(`/monitors/${id}`), [id]);
  const stats = useLoad(() => get(`/monitors/${id}/stats?window=${range}`), [id, range]);

  if (detail.loading && !detail.data) return <Loading className="p-4" />;
  if (detail.error) return <ErrorNote>{detail.error}</ErrorNote>;
  const { monitor, recentRuns, openIncident } = detail.data;

  const action = async (work, done) => {
    try {
      await work();
      if (done) toast.success(done);
      detail.reload();
      stats.reload();
      onChanged();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="flex items-center gap-2 text-md font-medium"><Dot tone={tone(monitor)} />{monitor.name}</p>
        <p className="mt-1 text-sm text-ink-2">{describe(monitor.check)} · {every(monitor.intervalSeconds)}</p>
        <pre className="mt-3 overflow-x-auto rounded-xs border border-line bg-subtle p-3 font-mono text-xs text-ink-2">{monitor.sql}</pre>
      </div>

      {openIncident && (
        <div className="rounded-xs border border-slow/30 bg-slow-soft px-4 py-3 text-sm">
          <p className="text-slow">Incident open since {timeAgo(openIncident.openedAt)}</p>
          <p className="mt-1 text-ink-2">{openIncident.reason}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => action(() => post(`/monitors/${id}/run`), "Ran the check")}>Run now</Button>
        <Button size="sm" variant="secondary" onClick={() => action(() => patch(`/monitors/${id}`, { enabled: !monitor.enabled }), monitor.enabled ? "Paused" : "Resumed")}>{monitor.enabled ? "Pause" : "Resume"}</Button>
        {monitor.webhookUrl && <Button size="sm" variant="secondary" onClick={() => action(() => post(`/monitors/${id}/test-alert`), "Test alert sent")}>Test alert</Button>}
        <Button
          size="sm"
          variant="danger"
          className="ml-auto"
          onClick={async () => {
            if (!window.confirm(`Delete "${monitor.name}"?`)) return;
            try {
              await del(`/monitors/${id}`);
              toast.success("Monitor deleted");
              onDeleted();
            } catch (err) {
              toast.error(err.message);
            }
          }}
        >
          Delete
        </Button>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <p className="caps text-ink-3">Performance</p>
          <Tabs items={[["24h", "24h"], ["7d", "7d"], ["30d", "30d"]]} value={range} onChange={setRange} />
        </div>
        {stats.data && (
          <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-xs border border-line bg-line sm:grid-cols-4">
            {[
              ["Uptime", stats.data.uptimePct == null ? "–" : `${stats.data.uptimePct}%`],
              ["p50", formatMs(stats.data.p50Ms)],
              ["p95", formatMs(stats.data.p95Ms)],
              ["Runs", `${formatNumber(stats.data.totalRuns)}${stats.data.failedRuns ? ` · ${stats.data.failedRuns} failed` : ""}`],
            ].map(([label, value]) => (
              <div key={label} className="bg-bg px-3 py-2.5">
                <p className="caps text-ink-3">{label}</p>
                <p className="tabular mt-1 font-mono text-sm">{value}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="caps text-ink-3">Recent runs</p>
        <div className="mt-3"><Strip runs={recentRuns} /></div>
        <ul className="mt-3 divide-y divide-line text-xs">
          {recentRuns.slice(0, 6).map((run) => (
            <li key={run._id} className="flex items-center gap-3 py-2">
              <span className={run.passed ? "text-pass" : "text-slow"}>{run.passed ? "✓" : "✕"}</span>
              <span className="min-w-0 flex-1 truncate font-mono">{run.error ?? `value ${formatNumber(run.value)}`}</span>
              <span className="font-mono text-ink-3">{formatMs(run.durationMs)}</span>
              <span className="w-20 text-right text-ink-3">{timeAgo(run.ranAt)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function MonitorList({ connection }) {
  const location = useLocation();
  const [creating, setCreating] = useState(Boolean(location.state?.create));
  const [selected, setSelected] = useState(null);
  const { data, error, loading, reload } = useLoad(async () => {
    const monitors = await get(`/monitors?connectionId=${connection._id}`);
    const runs = await Promise.all(monitors.map((m) => get(`/monitors/${m._id}/runs?limit=30`).then((r) => r.items, () => [])));
    return monitors.map((m, i) => ({ ...m, runs: runs[i] }));
  }, [connection._id]);

  const current = selected ?? data?.[0]?._id;

  return (
    <>
      {loading && !data ? (
        <Loading label="Loading monitors…" />
      ) : error ? (
        <ErrorNote>{error}</ErrorNote>
      ) : data.length ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card title="Monitors" meta={`${data.length} on ${connection.name}`} bodyClassName="p-0" className="self-start" action={<Button size="sm" variant="secondary" onClick={() => setCreating(true)}><Icons.plus className="size-3.5" />New</Button>}>
            <ul className="divide-y divide-line">
              {data.map((m) => (
                <li key={m._id}>
                  <button type="button" onClick={() => setSelected(m._id)} className={clsx("w-full px-4 py-3.5 text-left", current === m._id ? "bg-subtle" : "hover:bg-subtle")}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2 text-sm"><Dot tone={tone(m)} /><span className="truncate">{m.name}</span></span>
                      <span className="caps shrink-0 text-ink-3">{m.enabled ? m.status : "paused"}</span>
                    </div>
                    <p className="mt-1 text-xs text-ink-3">{describe(m.check)} · {every(m.intervalSeconds)}{m.lastRunAt && ` · ran ${timeAgo(m.lastRunAt)}`}</p>
                    <div className="mt-2.5"><Strip runs={m.runs} /></div>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          {current && <Card><Detail key={current} id={current} onChanged={reload} onDeleted={() => { setSelected(null); reload(); }} /></Card>}
        </div>
      ) : (
        <Empty title="No monitors yet" action={<Button size="sm" onClick={() => setCreating(true)}>New monitor</Button>}>
          A monitor runs a query on a schedule and checks its row count, a value, or how long it took. When it fails, an incident opens and your webhook hears about it.
        </Empty>
      )}
      <CreateDialog open={creating} onClose={() => setCreating(false)} connection={connection} onCreated={reload} />
    </>
  );
}

export default function Monitors() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Watch" title="Monitors" description="Queries that run on a schedule and must keep passing. Failures open incidents and alert your channel." />
      <NeedsConnection>{(connection) => <MonitorList key={connection._id} connection={connection} />}</NeedsConnection>
    </div>
  );
}
