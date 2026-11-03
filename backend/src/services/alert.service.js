import { Incident } from "../models/incident.model.js";

const ALERT_TIMEOUT_MS = 5_000;

const formatDuration = (ms) => {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};

const buildMessage = (monitor, incident, event) => {
  if (event === "opened") return `🔴 ${monitor.name} is failing: ${incident.reason}`;
  if (event === "resolved") {
    return `✅ ${monitor.name} recovered after ${formatDuration(incident.resolvedAt - incident.openedAt)}`;
  }
  return `🔔 Test alert from Quereo for ${monitor.name}`;
};

// Posts to the monitor's webhook. "text" is what Slack reads and "content"
// is what Discord reads; the rest is for anyone consuming the JSON.
// Never throws: a broken webhook must not break the monitor run.
const sendAlert = async (monitor, incident, event) => {
  if (!monitor.webhookUrl) return null;

  const text = buildMessage(monitor, incident, event);
  let result;

  try {
    const response = await fetch(monitor.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        content: text,
        event,
        monitor: { id: String(monitor._id), name: monitor.name },
        incident: incident && {
          id: String(incident._id),
          reason: incident.reason,
          openedAt: incident.openedAt,
          resolvedAt: incident.resolvedAt,
        },
      }),
      signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
    });
    result = { event, ok: response.ok, error: response.ok ? undefined : `Webhook returned HTTP ${response.status}` };
  } catch (error) {
    result = { event, ok: false, error: error.name === "TimeoutError" ? "Webhook timed out" : error.message };
  }

  result.sentAt = new Date();
  if (incident?._id) {
    await Incident.updateOne({ _id: incident._id }, { $set: { lastAlert: result } });
  }
  return result;
};

export { sendAlert };
