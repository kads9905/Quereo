// Plain test UI for the Quereo API: fetch + DOM, no framework or build step.
// Everything that comes from the server or a database is inserted as text
// (never as HTML), so data can't inject markup into the page.

const $ = (selector) => document.querySelector(selector);

// el("div", { class: "x", onclick: fn }, "text", child) - strings become text nodes
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
};

const fill = (target, ...children) => target.replaceChildren(...children.flat().filter(Boolean));

// The demo databases from docker-compose.yml
const SAMPLES = {
  postgres: {
    host: "localhost", port: 5433, database: "shop", username: "postgres", password: "postgres",
    query: "SELECT id, total_cents, created_at\nFROM orders\nWHERE customer_id = 42",
  },
  mysql: {
    host: "127.0.0.1", port: 3307, database: "shop", username: "root", password: "mysql",
    query: "SELECT id, total_cents, created_at\nFROM orders\nWHERE customer_id = 42",
  },
  mongodb: {
    host: "127.0.0.1", port: 27018, database: "shop", username: "mongo", password: "mongo",
    query: '{"find": "orders", "filter": {"customerId": 42}}',
  },
};

const state = { types: [], connections: [], current: null };

// ---- API ----

const api = async (method, path, body) => {
  const response = await fetch(`/api${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(json.message || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return json.data;
};

// Disables the button while the action runs and shows any error
const busy = async (button, errorTarget, action) => {
  button.disabled = true;
  if (errorTarget) errorTarget.textContent = "";
  try {
    await action();
  } catch (error) {
    if (errorTarget) errorTarget.textContent = error.message;
    else alert(error.message);
  } finally {
    button.disabled = false;
  }
};

const formatMs = (ms) => (ms == null ? "-" : `${Number(ms).toFixed(ms < 10 ? 2 : 0)} ms`);
const formatCell = (value) => {
  if (value === null || value === undefined) return el("span", { class: "muted" }, "NULL");
  return typeof value === "object" ? JSON.stringify(value) : String(value);
};

const renderTable = (target, columns, rows) => {
  if (!columns.length) return fill(target);
  fill(target, el("table", {},
    el("thead", {}, el("tr", {}, columns.map((column) => el("th", {}, column)))),
    el("tbody", {}, rows.map((row) =>
      el("tr", {}, row.map((value) => {
        const shown = formatCell(value);
        return el("td", { title: typeof shown === "string" ? shown : "" }, shown);
      }))
    ))
  ));
};

// ---- Auth ----

let registering = false;

const showAuth = () => {
  $("#app-view").hidden = true;
  $("#auth-view").hidden = false;
};

$("#auth-toggle").addEventListener("click", () => {
  registering = !registering;
  $("#name-field").hidden = !registering;
  $("#auth-submit").textContent = registering ? "Create account" : "Log in";
  $("#auth-toggle").textContent = registering ? "Have an account? Log in" : "No account? Register";
});

$("#auth-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const credentials = { email: form.get("email"), password: form.get("password") };

  busy($("#auth-submit"), $("#auth-error"), async () => {
    if (registering) await api("POST", "/users/register", { ...credentials, fullName: form.get("fullName") });
    const { user } = await api("POST", "/users/login", credentials);
    await showApp(user);
  });
});

$("#logout").addEventListener("click", async () => {
  await api("POST", "/users/logout");
  state.current = null;
  showAuth();
});

const showApp = async (user) => {
  $("#auth-view").hidden = true;
  $("#app-view").hidden = false;
  $("#user-email").textContent = user.email;

  state.types = await api("GET", "/connections/types");
  fill($("#add-form [name=type]"), state.types.map((t) => el("option", { value: t.type }, t.label)));
  $("#add-form [name=port]").value = state.types[0].defaultPort;

  const ai = await api("GET", "/ai/status");
  $("#ai-status").textContent = ai.enabled ? `AI: ${ai.model}` : "AI off (no GROQ_API_KEY)";

  await loadConnections();
};

// ---- Connections ----

const loadConnections = async () => {
  state.connections = await api("GET", "/connections");
  const typeLabel = (type) => state.types.find((t) => t.type === type)?.label || type;

  fill($("#connection-list"), state.connections.map((connection) =>
    el("li", {
      class: connection._id === state.current?._id ? "active" : "",
      onclick: () => selectConnection(connection),
    },
      el("div", {}, el("div", {}, connection.name), el("div", { class: "sub" }, `${typeLabel(connection.type)} · ${connection.database}`)),
      el("span", { class: "sub" }, connection.readOnly ? "read-only" : "writable")
    )
  ));
  if (!state.connections.length) fill($("#connection-list"), el("li", { class: "muted" }, "No connections yet"));
};

$("#show-add").addEventListener("click", () => { $("#add-form").hidden = false; });
$("#cancel-add").addEventListener("click", () => { $("#add-form").hidden = true; });

$("#add-form [name=type]").addEventListener("change", (event) => {
  $("#add-form [name=port]").value = state.types.find((t) => t.type === event.target.value).defaultPort;
});

$("#fill-sample").addEventListener("click", () => {
  const form = $("#add-form");
  const type = form.type.value;
  const { query, ...sample } = SAMPLES[type];
  for (const [key, value] of Object.entries(sample)) form[key].value = value;
  form.name.value = `Sample ${state.types.find((t) => t.type === type).label}`;
});

$("#add-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  const body = {
    type: form.type.value,
    name: form.name.value,
    host: form.host.value,
    port: Number(form.port.value),
    database: form.database.value,
    username: form.username.value,
    password: form.password.value,
    readOnly: form.readOnly.checked,
  };

  busy(form.querySelector("[type=submit]"), $("#add-error"), async () => {
    const { connection } = await api("POST", "/connections", body);
    form.reset();
    form.hidden = true;
    await loadConnections();
    selectConnection(state.connections.find((c) => c._id === connection._id));
  });
});

$("#delete-connection").addEventListener("click", async () => {
  if (!confirm(`Delete "${state.current.name}" with its history, saved queries and monitors?`)) return;
  await api("DELETE", `/connections/${state.current._id}`);
  state.current = null;
  $("#connection-view").hidden = true;
  $("#no-connection").hidden = false;
  await loadConnections();
});

const selectConnection = (connection) => {
  const previousType = state.current?.type;
  state.current = connection;

  $("#no-connection").hidden = true;
  $("#connection-view").hidden = false;
  $("#connection-title").textContent = `${connection.name} (${connection.readOnly ? "read-only" : "writable"})`;

  if (!$("#sql").value || previousType !== connection.type) $("#sql").value = SAMPLES[connection.type].query;
  for (const id of ["#verdict", "#results", "#ai-explanation", "#run-meta", "#query-error", "#ai-note",
    "#slow-results", "#advisor-results", "#schema-results"]) fill($(id));

  fill($("#diff-target"), state.connections
    .filter((c) => c._id !== connection._id)
    .map((c) => el("option", { value: c._id }, `${c.name} (${c.type})`)));

  loadConnections();
  loadSaved();
  loadHistory();
  if (activeTab() === "monitors") loadMonitors();
};

// ---- Tabs ----

const activeTab = () => $(".tabs button.active").dataset.tab;

document.querySelectorAll(".tabs button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b === button));
    document.querySelectorAll("[data-panel]").forEach((panel) => { panel.hidden = panel.dataset.panel !== button.dataset.tab; });
    if (button.dataset.tab === "monitors") loadMonitors();
  });
});

// ---- Query ----

const connectionPath = (suffix) => `/connections/${state.current._id}${suffix}`;

const renderVerdict = (verdict) => {
  if (!verdict) return fill($("#verdict"));
  fill($("#verdict"), el("div", { class: "card verdict" },
    el("div", {}, el("span", { class: `badge ${verdict.verdict}` }, verdict.verdict), " ", verdict.summary),
    el("ul", {}, verdict.checks.map((check) => el("li", {}, `${check.passed ? "✔" : "✖"} ${check.name}`))),
    verdict.issues.length > 0 && el("ul", {}, verdict.issues.map((issue) =>
      el("li", {}, el("strong", {}, issue.message), el("div", { class: "suggestion" }, issue.suggestion))
    )),
    verdict.tips.length > 0 && el("ul", {}, verdict.tips.map((tip) =>
      el("li", { class: "muted" }, `Tip: ${tip.message}. ${tip.suggestion}`)
    ))
  ));
};

$("#run").addEventListener("click", (event) => busy(event.target, $("#query-error"), async () => {
  fill($("#ai-explanation"));
  const result = await api("POST", connectionPath("/query"), { sql: $("#sql").value });
  $("#run-meta").textContent = `${result.rowCount} rows · ${formatMs(result.durationMs)}${result.truncated ? ` · showing first ${result.rows.length}` : ""}`;
  renderVerdict(result.verdict);
  renderTable($("#results"), result.columns, result.rows);
  loadHistory();
}));

$("#explain").addEventListener("click", (event) => busy(event.target, $("#query-error"), async () => {
  fill($("#ai-explanation"));
  const { plan, verdict } = await api("POST", connectionPath("/explain"), { sql: $("#sql").value });
  $("#run-meta").textContent = plan.analyzed ? `plan measured: ${formatMs(plan.totalTimeMs)}` : "plan estimated (not run)";
  renderVerdict(verdict);
  renderTable($("#results"),
    ["step", "table", "index", "rows read", "rows kept", "filter"],
    plan.nodes.map((n) => [n.operation, n.table, n.indexName, n.rowsExamined, n.rowsReturned, n.filter]));
}));

$("#ai-explain").addEventListener("click", (event) => busy(event.target, $("#query-error"), async () => {
  const { explanation, verdict } = await api("POST", connectionPath("/ai/explain"), { sql: $("#sql").value });
  renderVerdict(verdict);
  fill($("#ai-explanation"), el("div", { class: "card verdict" },
    el("strong", {}, "AI explanation"),
    el("p", {}, explanation.summary),
    explanation.problems.length > 0 && el("ul", {}, explanation.problems.map((p) => el("li", {}, el("strong", {}, p.title), ": ", p.explanation))),
    explanation.fixes.map((fix) => el("div", {}, el("strong", {}, fix.title), el("div", {}, fix.explanation), fix.sql && el("pre", {}, fix.sql)))
  ));
}));

$("#ai-generate").addEventListener("click", (event) => busy(event.target, $("#query-error"), async () => {
  const result = await api("POST", connectionPath("/ai/sql"), { question: $("#ai-question").value });
  if (result.cannotAnswer) {
    $("#ai-note").textContent = `Can't answer from this database: ${result.explanation}`;
    return;
  }
  // Pretty-print MongoDB commands
  let text = result.sql;
  try { if (state.current.type === "mongodb") text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep as is */ }
  $("#sql").value = text;
  $("#ai-note").textContent = [
    result.valid ? "✔ Checked against the database. Review it, then press Run." : `✖ Didn't pass validation: ${result.error}`,
    result.explanation,
    result.assumptions.length ? `Assumptions: ${result.assumptions.join(" ")}` : "",
  ].filter(Boolean).join(" ");
  renderVerdict(result.verdict);
  fill($("#results"));
}));

$("#save-query").addEventListener("click", (event) => {
  const name = prompt("Name for this query");
  if (!name) return;
  busy(event.target, $("#query-error"), async () => {
    await api("POST", "/saved-queries", { connectionId: state.current._id, name, sql: $("#sql").value });
    loadSaved();
  });
});

const loadSaved = async () => {
  const saved = await api("GET", `/saved-queries?connectionId=${state.current._id}`);
  fill($("#saved-list"), saved.length ? saved.map((item) =>
    el("li", { onclick: () => { $("#sql").value = item.sql; } },
      el("span", {}, item.name),
      el("button", {
        class: "link",
        onclick: async (event) => {
          event.stopPropagation();
          await api("DELETE", `/saved-queries/${item._id}`);
          loadSaved();
        },
      }, "delete")
    )
  ) : el("li", { class: "muted" }, "Nothing saved yet"));
};

const loadHistory = async () => {
  const { items } = await api("GET", `/history?connectionId=${state.current._id}&limit=15`);
  fill($("#history-list"), items.length ? items.map((item) =>
    el("li", { onclick: () => { $("#sql").value = item.sql; }, title: item.error || "" },
      el("span", {}, item.sql.replace(/\s+/g, " ").slice(0, 90)),
      el("span", { class: "sub" }, item.status === "error" ? "error" : `${item.verdict || "ok"} · ${formatMs(item.durationMs)}`)
    )
  ) : el("li", { class: "muted" }, "No queries run yet"));
};

// ---- Slow queries ----

$("#slow-load").addEventListener("click", (event) => busy(event.target, $("#slow-error"), async () => {
  const { items } = await api("GET", connectionPath(`/slow-queries?sortBy=${$("#slow-sort").value}&limit=25`));
  renderTable($("#slow-results"),
    ["query", "calls", "total", "mean", "max", "rows", "slow?"],
    items.map((q) => [q.query.replace(/\s+/g, " "), q.calls, formatMs(q.totalMs), formatMs(q.meanMs), formatMs(q.maxMs), q.rows, q.slow ? "yes" : ""]));
  if (!items.length) fill($("#slow-results"), el("p", { class: "muted" }, "No queries recorded yet"));
}));

// ---- Index Advisor ----

$("#advisor-suggest").addEventListener("click", (event) => busy(event.target, $("#advisor-error"), async () => {
  const sql = $("#sql").value;
  const { suggestions, message } = await api("POST", connectionPath("/advisor/suggest"), { sql });

  fill($("#advisor-results"), el("p", { class: "muted" }, message), suggestions.map((s) => {
    const trialResult = el("div");
    return el("div", { class: "card stack" },
      el("strong", {}, s.reason),
      el("div", { class: "muted" }, `Rows read: ${s.rowsExamined ?? "?"} · rows kept: ${s.rowsReturned ?? "?"}`),
      s.statement ? el("pre", {}, s.statement) : el("p", {}, s.note),
      s.statement && el("div", {},
        el("button", {
          class: "secondary",
          onclick: (e) => busy(e.target, $("#advisor-error"), async () => {
            const trial = await api("POST", connectionPath("/advisor/try"), { sql, table: s.table, columns: s.columns });
            fill(trialResult,
              el("span", { class: `badge ${trial.verdict}` }, trial.verdict.replace("_", " ")), " ", trial.message,
              el("div", { class: "muted" }, `Rows read: ${trial.before.rowsExamined} → ${trial.after.rowsExamined} · the trial index was removed`));
          }),
        }, "Try it (before/after)")
      ),
      trialResult
    );
  }));
}));

$("#advisor-unused").addEventListener("click", (event) => busy(event.target, $("#advisor-error"), async () => {
  const result = await api("GET", connectionPath("/advisor/unused-indexes"));
  const table = el("div", { class: "table-wrap" });
  renderTable(table, ["table", "index", "size", "drop with"],
    result.unused.map((i) => [i.table, i.index, i.sizeBytes == null ? "?" : `${Math.round(i.sizeBytes / 1024)} KB`, i.dropStatement]));
  fill($("#advisor-results"),
    el("p", {}, `${result.unused.length} unused of ${result.totalIndexes} indexes (counting since ${new Date(result.statsSince).toLocaleString()})`),
    result.unused.length ? table : null,
    el("p", { class: "muted" }, result.note));
}));

// ---- Monitors ----

const loadMonitors = async () => {
  if (!state.current) return;
  $("#monitor-form [name=sql]").placeholder = SAMPLES[state.current.type].query;

  const [monitors, incidents] = await Promise.all([
    api("GET", `/monitors?connectionId=${state.current._id}`),
    api("GET", "/incidents?status=open"),
  ]);

  const action = (label, fn) => el("button", {
    class: "link",
    onclick: (event) => busy(event.target, $("#monitor-error"), async () => { await fn(); await loadMonitors(); }),
  }, label);

  fill($("#monitor-list"), monitors.length ? el("table", {},
    el("thead", {}, el("tr", {}, ["name", "status", "rule", "last value", "last run", "problem", ""].map((h) => el("th", {}, h)))),
    el("tbody", {}, monitors.map((m) => el("tr", {},
      el("td", {}, m.name),
      el("td", {}, el("span", { class: `badge ${m.enabled ? m.status : "pending"}` }, m.enabled ? m.status : "paused")),
      el("td", {}, `${m.check.type} ${m.check.operator} ${m.check.threshold} · every ${m.intervalSeconds}s`),
      el("td", {}, m.lastValue ?? "-"),
      el("td", {}, m.lastRunAt ? new Date(m.lastRunAt).toLocaleTimeString() : "-"),
      el("td", { title: m.lastError || "" }, m.lastError || ""),
      el("td", {},
        action("run now", () => api("POST", `/monitors/${m._id}/run`)), " · ",
        action(m.enabled ? "pause" : "resume", () => api("PATCH", `/monitors/${m._id}`, { enabled: !m.enabled })), " · ",
        action("delete", () => api("DELETE", `/monitors/${m._id}`)))
    )))
  ) : el("p", { class: "muted" }, "No monitors for this connection"));

  const mine = incidents.filter((incident) => incident.monitor?.connection === state.current._id);
  fill($("#incident-list"), mine.length
    ? mine.map((i) => el("li", {}, el("span", {}, `🔴 ${i.monitor.name}: ${i.reason}`), el("span", { class: "sub" }, new Date(i.openedAt).toLocaleString())))
    : el("li", { class: "muted" }, "None"));
};

$("#monitors-refresh").addEventListener("click", loadMonitors);

$("#monitor-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  const body = {
    connectionId: state.current._id,
    name: form.name.value,
    sql: form.sql.value,
    check: { type: form.checkType.value, operator: form.operator.value, threshold: Number(form.threshold.value) },
    intervalSeconds: Number(form.intervalSeconds.value),
  };
  if (form.webhookUrl.value) body.webhookUrl = form.webhookUrl.value;

  busy(form.querySelector("[type=submit]"), $("#monitor-error"), async () => {
    const { firstRun } = await api("POST", "/monitors", body);
    $("#monitor-error").textContent = firstRun.passed ? "" : `Created, but the first run failed: ${firstRun.error}`;
    form.reset();
    form.intervalSeconds.value = 60;
    await loadMonitors();
  });
});

// ---- Schema ----

$("#schema-load").addEventListener("click", (event) => busy(event.target, $("#schema-error"), async () => {
  const schema = await api("GET", connectionPath("/schema"));
  fill($("#schema-results"),
    schema.inferred && el("p", { class: "muted" }, "MongoDB has no fixed schema: fields are inferred from the newest documents."),
    Object.entries(schema.tables).map(([name, table]) => {
      const columns = el("div", { class: "table-wrap" });
      renderTable(columns, ["column", "type", "nullable"],
        Object.entries(table.columns).map(([column, info]) => [column, info.type, info.nullable ? "yes" : "no"]));
      return el("details", { class: "card" },
        el("summary", {}, `${name} (~${table.rowEstimate.toLocaleString()} rows)`),
        columns,
        el("p", { class: "muted" }, `Indexes: ${Object.entries(table.indexes).map(([n, i]) => `${n} (${i.columns.join(", ")})`).join(", ") || "none"}`));
    }));
}));

$("#schema-diff").addEventListener("click", (event) => busy(event.target, $("#schema-error"), async () => {
  const targetId = $("#diff-target").value;
  if (!targetId) throw new Error("Add another connection to compare with");
  const diff = await api("POST", "/schema/diff", { source: { connectionId: state.current._id }, target: { connectionId: targetId } });

  fill($("#schema-results"),
    el("p", {}, diff.identical
      ? "The schemas are identical."
      : `${diff.source.name} → ${diff.target.name}: ${diff.summary.breaking} breaking, ${diff.summary.warnings} warnings, ${diff.summary.info} info`),
    el("ul", { class: "list" }, diff.changes.map((change) =>
      el("li", {}, el("span", {}, el("span", { class: `badge ${change.severity}` }, change.severity), " ", change.message))
    )));
}));

// ---- Start ----

api("GET", "/users/me").then(showApp).catch(showAuth);
