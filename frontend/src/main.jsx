import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { Toaster } from "sonner";
import "./index.css";
import { useSession } from "./store/session";
import { Gate } from "./ui/Gate.jsx";
import { Icons } from "./ui/icons";
import Landing from "./site/Landing.jsx";
import AuthPage from "./auth/AuthPage.jsx";
import Legal from "./site/Legal.jsx";
import AppShell from "./app/AppShell.jsx";
import Overview from "./app/Overview.jsx";
import Workspace from "./app/Workspace.jsx";
import SlowQueries from "./app/SlowQueries.jsx";
import Advisor from "./app/Advisor.jsx";
import Monitors from "./app/Monitors.jsx";
import Schema from "./app/Schema.jsx";
import History from "./app/History.jsx";
import Connections from "./app/Connections.jsx";
import Settings from "./app/Settings.jsx";

function App() {
  const load = useSession((s) => s.load);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route path="/terms" element={<Legal doc="terms" />} />
      <Route path="/privacy" element={<Legal doc="privacy" />} />
      <Route path="/app" element={<AppShell />}>
        <Route index element={<Overview />} />
        <Route path="workspace" element={<Workspace />} />
        <Route path="slow-queries" element={<SlowQueries />} />
        <Route path="advisor" element={<Advisor />} />
        <Route path="monitors" element={<Monitors />} />
        <Route path="schema" element={<Schema />} />
        <Route path="history" element={<History />} />
        <Route path="connections" element={<Connections />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// Toast icons: a small tinted tile per tone, like the app's verdict chips
const ToastIcon = ({ tone, children }) => <span className={`grid size-6 shrink-0 place-items-center rounded-xs ${tone}`}>{children}</span>;
const TOAST_ICONS = {
  success: <ToastIcon tone="bg-pass-soft text-pass"><Icons.check className="size-3.5" /></ToastIcon>,
  error: <ToastIcon tone="bg-slow-soft text-slow"><Icons.alert className="size-3.5" /></ToastIcon>,
  warning: <ToastIcon tone="bg-warn-soft text-warn"><Icons.alert className="size-3.5" /></ToastIcon>,
  info: <ToastIcon tone="bg-accent-soft text-accent-ink"><Icons.bell className="size-3.5" /></ToastIcon>,
  loading: <ToastIcon tone="bg-fill text-ink-2"><span className="spin size-3 rounded-full border border-line-2 border-t-accent" /></ToastIcon>,
};

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <App />
      <Gate />
      <Toaster
        position="bottom-right"
        gap={10}
        offset={20}
        closeButton
        icons={TOAST_ICONS}
        toastOptions={{
          unstyled: true,
          classNames: {
            toast: "q-toast",
            content: "flex min-w-0 flex-1 flex-col gap-0.5 pt-[3px]",
            title: "text-[13px] leading-[18px] text-ink",
            description: "text-xs leading-[17px] text-ink-3",
            actionButton: "press ml-2 shrink-0 self-center rounded-xs bg-ink px-2 py-1 text-xs text-bg hover:bg-accent hover:text-white",
          },
        }}
      />
    </BrowserRouter>
  </StrictMode>
);
