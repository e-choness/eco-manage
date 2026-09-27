import type { ReactNode } from "react"
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from "react-router-dom"
import { ThemeProvider } from "./components/ui/theme-provider"
import { Toaster } from "./components/ui/toaster"
import { AuthProvider } from "./contexts/AuthContext"
import { Login } from "./pages/Login"
import { InviteAccept } from "./pages/InviteAccept"
import { ProtectedRoute } from "./components/ProtectedRoute"
import { AppShell, RequireRole } from "./shell/AppShell"
import { Home } from "./pages/Home"
import { Devices } from "./pages/Devices"
import { History } from "./pages/History"
import { Bills } from "./pages/Bills"
import { Inbox } from "./pages/Inbox"
import { Settings } from "./pages/Settings"

// Pages from before App v2, shown in the new shell until their screens are rebuilt (P4-03..P4-08).
const Interim = ({ children }: { children: ReactNode }) => <main className="mx-auto max-w-7xl p-6">{children}</main>

// Addresses from before P4-02: /dashboard/<page> is now /<page>.
const OLD_PATHS: Record<string, string> = { "": "/", live: "/", monitoring: "/devices", alerts: "/inbox", optimization: "/inbox" }
export function FromDashboard() {
  const { pathname, search } = useLocation()
  const rest = pathname.replace(/^\/dashboard\/?/, "")
  return <Navigate to={`${OLD_PATHS[rest] ?? `/${rest}`}${search}`} replace />
}

function App() {
  return (
    <AuthProvider>
      <ThemeProvider defaultTheme="dark" storageKey="ui-theme">
        <Router>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/invite/:token" element={<InviteAccept />} />
            <Route path="/dashboard/*" element={<FromDashboard />} />
            <Route path="/" element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
              <Route index element={<Home />} />
              <Route path="devices" element={<Devices />} />
              <Route path="history" element={<History />} />
              <Route
                path="bills"
                element={
                  <RequireRole roles={["owner", "manager"]}>
                    <Bills />
                  </RequireRole>
                }
              />
              <Route path="inbox" element={<Inbox />} />
              <Route path="settings" element={<Interim><Settings /></Interim>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </Router>
        <Toaster />
      </ThemeProvider>
    </AuthProvider>
  )
}

export default App
