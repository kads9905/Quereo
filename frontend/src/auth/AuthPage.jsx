import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import clsx from "clsx";
import { toast } from "sonner";
import { Button, ErrorNote, Logo, PixelPanel, Verdict } from "../ui";
import { Icons, GoogleG } from "../ui/icons";
import { Reveal } from "../ui/motion";
import { BorderBeam } from "../ui/fx";
import { get } from "../lib/api";
import { useSession } from "../store/session";
import { useGate } from "../store/gate";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Google: Google Identity Services' token popup, loaded on first use
let gisScript;
const loadGoogle = () => {
  gisScript ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve(window.google);
    s.onerror = () => {
      gisScript = null;
      reject(new Error("Couldn't load Google sign-in. Check your connection."));
    };
    document.head.appendChild(s);
  });
  return gisScript;
};

// Resolves to an access token; rejects with an empty message if the popup was closed
const googleAccessToken = async (clientId) => {
  const google = await loadGoogle();
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: "openid email profile",
      callback: (res) => (res.error ? reject(new Error(res.error_description || "Google sign-in was cancelled.")) : resolve(res.access_token)),
      error_callback: (err) => reject(new Error(err?.type === "popup_closed" ? "" : "Google sign-in was cancelled.")),
    });
    client.requestAccessToken();
  });
};

// ── Password strength, scored 0 (too short) to 4
const strength = (pw) => {
  if (pw.length < 8) return 0;
  let score = 1;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  return score;
};
const STRENGTH = [
  ["too short", "bg-slow", "text-slow"],
  ["weak", "bg-slow", "text-slow"],
  ["okay", "bg-warn", "text-warn"],
  ["good", "bg-pass", "text-pass"],
  ["strong", "bg-pass", "text-pass"],
];

// ── Segmented Sign in / Create account switch with a sliding thumb
function ModeSwitch({ isRegister }) {
  return (
    <div className="relative grid grid-cols-2 rounded-sm border border-line bg-subtle p-1 text-[13px]">
      <span
        aria-hidden
        className={clsx("absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-xs bg-fill shadow-[0_0_0_1px_var(--color-line-2)] transition-transform duration-500 ease-[var(--ease-out)]", isRegister && "translate-x-full")}
      />
      <Link to="/login" replace className={clsx("press relative z-10 py-1.5 text-center transition-colors", isRegister ? "text-ink-3 hover:text-ink-2" : "text-ink")}>Sign in</Link>
      <Link to="/register" replace className={clsx("press relative z-10 py-1.5 text-center transition-colors", isRegister ? "text-ink" : "text-ink-3 hover:text-ink-2")}>Create account</Link>
    </div>
  );
}

// ── An input with a leading icon; label and icon tint while it has focus
function TextField({ label, icon: Icon, aside, hint, children }) {
  return (
    <label className="group flex flex-col gap-1.5">
      <span className="flex h-4 items-center justify-between">
        <span className="caps text-ink-3 transition-colors group-focus-within:text-accent-ink">{label}</span>
        {aside}
      </span>
      <span className="relative">
        <Icon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3 transition-colors group-focus-within:text-accent-ink" />
        {children}
      </span>
      {hint}
    </label>
  );
}
const inputClass =
  "h-11 w-full rounded-xs border border-line-2 bg-bg pr-3 pl-9 short:h-10 text-sm text-ink placeholder:text-ink-3 transition-[border-color,box-shadow,background-color] duration-200 hover:border-ink-3 focus:border-accent focus:bg-subtle focus:shadow-[0_0_0_3px_var(--color-accent-soft)] focus:outline-none";

// ── Right panel: the query your sign-in becomes, written as you type
const sqlString = (v) => (v ? `'${v.replace(/'/g, "''")}'` : "'…'");
const Caret = () => <span className="caret ml-0.5 inline-block h-[14px] w-[7px] translate-y-[2px] bg-accent" aria-hidden />;

function LiveQuery({ isRegister, values, phase }) {
  const valid = EMAIL.test(values.email);
  const secret = values.password ? `'${"•".repeat(Math.min(values.password.length, 14))}'` : "'…'";
  const literal = (v) => <span className={v ? "text-pass" : "text-ink-3"}>{sqlString(v)}</span>;

  return (
    <div className="relative overflow-hidden rounded-md border border-line-2 bg-bg/95 font-mono text-[12.5px] leading-[22px] shadow-[0_40px_80px_-30px_rgb(0_0_0/0.9)] backdrop-blur">
      <BorderBeam duration={8} />
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5 text-[11px] text-ink-3">
        <span className="flex items-center gap-2">
          <span className="flex gap-1" aria-hidden>{[0, 1, 2].map((i) => <span key={i} className="size-2 rounded-full bg-line-2" />)}</span>
          quereo / auth
        </span>
        <span>{phase === "busy" ? "running…" : isRegister ? "insert" : "read-only"}</span>
      </div>
      <div key={isRegister ? "r" : "l"} className="swap min-h-[160px] px-4 py-4 short:min-h-[150px] short:py-3">
        {isRegister ? (
          <>
            <p><span className="text-accent-ink">INSERT INTO</span> users (full_name, email, password)</p>
            <p><span className="text-accent-ink">VALUES</span> (</p>
            <p className="truncate pl-4">{literal(values.fullName)},</p>
            <p className="truncate pl-4">{literal(values.email)},</p>
            <p className="truncate pl-4"><span className="text-ink-2">bcrypt</span>(<span className="text-warn">{secret}</span>)</p>
            <p>);<Caret /></p>
          </>
        ) : (
          <>
            <p><span className="text-accent-ink">SELECT</span> id, full_name</p>
            <p><span className="text-accent-ink">FROM</span> users</p>
            <p className="truncate"><span className="text-accent-ink">WHERE</span> email = {literal(values.email)}</p>
            <p className="truncate pl-2"><span className="text-accent-ink">AND</span> <span className="text-ink-2">bcrypt_check</span>(<span className="text-warn">{secret}</span>);<Caret /></p>
          </>
        )}
      </div>
      <div className="flex min-h-[46px] items-center border-t border-line px-4 py-3 text-[11.5px]">
        {phase === "busy" ? (
          <p className="flex items-center gap-2 text-ink-2"><span className="spin size-3 rounded-full border border-line-2 border-t-accent" />executing…</p>
        ) : phase === "error" ? (
          <p className="swap flex items-center gap-2 text-slow"><Verdict value="SLOW" />0 rows · that didn't match</p>
        ) : valid ? (
          <p className="swap flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-2">
            <Verdict value="PASS" />
            <span>{isRegister ? "Insert on users" : "Index Scan using users_email_key"}</span>
            <span className="text-ink-3">· 1 row · 0.04 ms</span>
          </p>
        ) : (
          <p className="text-ink-3">-- type your email to see the plan</p>
        )}
      </div>
    </div>
  );
}

const FACTS = [
  ["Read-only by default.", "Every query runs in a read-only transaction until you say otherwise."],
  ["Prove the fix first.", "Index trials build, measure and remove the index on your own data."],
  ["Your rows stay home.", "The AI sees table names and plans. Never the data inside them."],
];
const FACT_MS = 5200;

function Facts() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setI((n) => (n + 1) % FACTS.length), FACT_MS);
    return () => clearTimeout(t);
  }, [i]);
  return (
    <div className="max-w-[440px] rounded-md border border-line bg-bg/85 p-6 backdrop-blur short:p-5">
      <div key={i} className="swap">
        <p className="heading text-[24px] leading-[30px] short:text-[20px] short:leading-[26px]">{FACTS[i][0]}</p>
        <p className="mt-3 text-sm text-ink-2">{FACTS[i][1]}</p>
      </div>
      <div className="mt-5 flex gap-1.5">
        {FACTS.map(([title], n) => (
          <button key={title} type="button" aria-label={title} onClick={() => setI(n)} className="group h-3 flex-1">
            <span className="block h-1 overflow-hidden rounded-full bg-line transition-colors group-hover:bg-line-2">
              <span key={n === i ? i : "idle"} className={clsx("block h-full bg-accent", n === i ? "gate-bar" : n < i ? "w-full" : "w-0")} style={n === i ? { "--gate-ms": `${FACT_MS}ms` } : undefined} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function AuthPage({ mode }) {
  const isRegister = mode === "register";
  const { status, login, register, loginWithGoogle } = useSession();
  const runGate = useGate((s) => s.run);
  const navigate = useNavigate();
  const [values, setValues] = useState({ fullName: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [phase, setPhase] = useState("idle"); // idle | busy | google | error
  const [showPassword, setShowPassword] = useState(false);
  const [caps, setCaps] = useState(false);
  const [shake, setShake] = useState(0);
  const [googleId, setGoogleId] = useState(undefined);
  const handingOff = useRef(false);

  useEffect(() => {
    get("/users/auth-config").then((c) => setGoogleId(c.googleClientId), () => setGoogleId(null));
  }, []);

  // switching modes clears the error but keeps what was typed
  useLayoutEffect(() => {
    setError("");
    setPhase("idle");
  }, [mode]);

  // already signed in (and not mid hand-off to the gate): straight in
  if (status === "ready" && !handingOff.current) return <Navigate to="/app" replace />;

  const set = (key) => (e) => {
    setValues((v) => ({ ...v, [key]: e.target.value }));
    if (phase === "error") setPhase("idle");
  };

  const openApp = (isNew) => {
    const { user, connections } = useSession.getState();
    runGate("open", { name: user?.fullName, email: user?.email, isNew, connections: connections.length }, async () => navigate("/app", { replace: true }));
  };

  const fail = (message) => {
    handingOff.current = false;
    setError(message);
    setPhase("error");
    setShake((n) => n + 1);
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    if (isRegister && !values.fullName.trim()) return fail("What should we call you?");
    if (!EMAIL.test(values.email)) return fail("That email doesn't look right.");
    if (values.password.length < 8) return fail("Passwords are at least 8 characters.");
    handingOff.current = true;
    setPhase("busy");
    setError("");
    try {
      if (isRegister) await register(values.fullName.trim(), values.email, values.password);
      else await login(values.email, values.password);
      openApp(isRegister);
    } catch (err) {
      fail(err.message);
    }
  };

  const onGoogle = async () => {
    if (!googleId) {
      toast.info("Google sign-in isn't set up yet", { description: "Add GOOGLE_CLIENT_ID to the backend's .env, then restart it." });
      return;
    }
    setPhase("google");
    setError("");
    try {
      const token = await googleAccessToken(googleId);
      handingOff.current = true;
      openApp(await loginWithGoogle(token));
    } catch (err) {
      if (err.message) fail(err.message);
      else setPhase("idle");
    }
  };

  const busy = phase === "busy" || phase === "google";
  const score = strength(values.password);
  const open = isRegister ? "true" : "false";

  return (
    <div className="grid min-h-dvh bg-bg lg:h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:overflow-hidden">
      <div className="gutter flex min-h-dvh flex-col py-5 short:py-4 lg:min-h-0">
        <div className="flex items-center justify-between">
          <Link to="/" aria-label="Quereo home" className="press"><Logo /></Link>
          <Link to="/" className="group flex items-center gap-1.5 text-[13px] text-ink-2 transition-colors hover:text-ink">
            <Icons.arrow className="size-3.5 rotate-180 transition-transform duration-300 ease-[var(--ease-out)] group-hover:-translate-x-1" />Back to site
          </Link>
        </div>

        <div className="flex flex-1 items-center py-8 short:py-5 max-sm:short:py-3">
          <div className="w-full max-w-[400px]">
            <Reveal><ModeSwitch isRegister={isRegister} /></Reveal>

            <div key={mode} className="swap mt-8 short:mt-5 max-sm:short:mt-4">
              <p className="eyebrow short:hidden">{isRegister ? "Start free" : "Welcome back"}</p>
              <h1 className="heading mt-4 text-[36px] leading-[40px] short:mt-0 short:text-[28px] short:leading-[34px]">
                {isRegister ? "Create your" : "Sign in to"}
                <br className="short:hidden" />{" "}
                <span className="text-ink-3">{isRegister ? "account." : "Quereo."}</span>
              </h1>
              <p className="mt-3 text-sm text-ink-2 short:mt-1.5 short:text-[13px] max-sm:short:hidden">
                {isRegister ? "Connect a database and get your first verdict in about a minute." : "Pick up where you left off: your databases, monitors and history."}
              </p>
            </div>

            <Reveal i={3} className="mt-7 short:mt-5">
              <button
                type="button"
                onClick={onGoogle}
                disabled={busy}
                className="press group relative flex h-11 w-full short:h-10 items-center justify-center gap-3 overflow-hidden rounded-xs border border-line-2 bg-subtle text-sm text-ink transition-colors hover:border-ink-3 hover:bg-fill disabled:opacity-60"
              >
                <span aria-hidden className="absolute inset-y-0 -left-1/3 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/[0.07] to-transparent transition-transform duration-700 ease-[var(--ease-out)] group-hover:translate-x-[420%]" />
                {phase === "google" ? <span className="spin size-4 rounded-full border border-line-2 border-t-accent" /> : <GoogleG className="size-4 transition-transform duration-300 ease-[var(--ease-out)] group-hover:scale-110" />}
                {phase === "google" ? "Waiting for Google…" : "Continue with Google"}
              </button>
              <div className="my-5 flex items-center gap-3 font-mono text-[11px] text-ink-3 short:my-3.5">
                <span className="h-px flex-1 bg-line" />or with email<span className="h-px flex-1 bg-line" />
              </div>
            </Reveal>

            <Reveal i={4}>
              <form key={shake} onSubmit={onSubmit} noValidate className={clsx("flex flex-col", shake > 0 && "shake")}>
                {/* the name field folds open for new accounts */}
                <div className="accordion" data-open={open}>
                  <div>
                    <div className="p-[3px] pb-4 short:pb-3">
                      <TextField label="Full name" icon={Icons.user}>
                        <input name="fullName" value={values.fullName} onChange={set("fullName")} autoComplete="name" tabIndex={isRegister ? 0 : -1} placeholder="Ada Lovelace" className={inputClass} />
                      </TextField>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-4 px-[3px] short:gap-3">
                  <TextField label="Email" icon={Icons.mail} aside={EMAIL.test(values.email) && <Icons.check className="swap size-3.5 text-pass" />}>
                    <input name="email" type="email" value={values.email} onChange={set("email")} autoComplete="email" placeholder="you@company.com" className={inputClass} />
                  </TextField>
                  <TextField
                    label="Password"
                    icon={Icons.shield}
                    aside={caps && <span className="swap font-mono text-[10px] text-warn">caps lock is on</span>}
                    hint={isRegister && (
                      <span className="mt-1 flex items-center gap-3">
                        <span className="flex flex-1 gap-1" aria-hidden>
                          {[1, 2, 3, 4].map((n) => (
                            <span key={n} className="h-1 flex-1 overflow-hidden rounded-full bg-line">
                              <span className={clsx("block h-full origin-left transition-transform duration-500 ease-[var(--ease-out)]", STRENGTH[score][1], score >= n ? "scale-x-100" : "scale-x-0")} style={{ transitionDelay: `${(n - 1) * 50}ms` }} />
                            </span>
                          ))}
                        </span>
                        <span className={clsx("w-16 text-right font-mono text-[11px] transition-colors", values.password ? STRENGTH[score][2] : "text-ink-3")}>{values.password ? STRENGTH[score][0] : "8+ chars"}</span>
                      </span>
                    )}
                  >
                    <input
                      name="password"
                      type={showPassword ? "text" : "password"}
                      value={values.password}
                      onChange={set("password")}
                      onKeyUp={(e) => setCaps(e.getModifierState?.("CapsLock") ?? false)}
                      autoComplete={isRegister ? "new-password" : "current-password"}
                      placeholder={isRegister ? "At least 8 characters" : "••••••••"}
                      className={clsx(inputClass, "pr-11")}
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        setShowPassword((s) => !s);
                      }}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="press absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-xs text-ink-3 hover:bg-fill hover:text-ink"
                    >
                      <span key={showPassword ? "on" : "off"} className="swap">{showPassword ? <Icons.eyeOff className="size-4" /> : <Icons.eye className="size-4" />}</span>
                    </button>
                  </TextField>

                  <ErrorNote>{error}</ErrorNote>
                </div>

                <div className="accordion" data-open={open}>
                  <div>
                    <p className="px-[3px] pt-4 text-xs leading-relaxed text-ink-3 short:pt-3">
                      By creating an account you agree to the{" "}
                      <Link to="/terms" tabIndex={isRegister ? 0 : -1} className="text-ink-2 underline decoration-line-2 underline-offset-4 hover:decoration-accent">terms</Link> and{" "}
                      <Link to="/privacy" tabIndex={isRegister ? 0 : -1} className="text-ink-2 underline decoration-line-2 underline-offset-4 hover:decoration-accent">privacy policy</Link>.
                    </p>
                  </div>
                </div>

                <Button type="submit" size="lg" disabled={busy} arrow={!busy} className="mt-5 w-full short:mt-4">
                  {phase === "busy" && <span className="spin size-3.5 rounded-full border border-bg/30 border-t-bg" />}
                  <span key={`${mode}-${phase === "busy"}`} className="swap">{phase === "busy" ? (isRegister ? "Creating your account…" : "Signing you in…") : isRegister ? "Create account" : "Sign in"}</span>
                </Button>
              </form>
            </Reveal>
          </div>
        </div>

        <p className="font-mono text-[11px] text-ink-3 short:hidden">// connections are read-only by default. passwords are encrypted at rest.</p>
      </div>

      <div className="hidden min-h-0 p-3 lg:block">
        <PixelPanel seed={9} live className="h-full rounded-md">
          <div className="flex h-full flex-col justify-between gap-6 p-10 short:p-7 xl:p-14 xl:short:p-8">
            <p className="caps self-start rounded-xs bg-bg/85 px-2 py-1 text-ink-2 backdrop-blur">fig.00 / your sign-in, as a query</p>
            <Reveal i={3} className="mx-auto w-full max-w-[460px]">
              <LiveQuery isRegister={isRegister} values={values} phase={phase === "google" ? "busy" : phase} />
            </Reveal>
            <Facts />
          </div>
        </PixelPanel>
      </div>
    </div>
  );
}
