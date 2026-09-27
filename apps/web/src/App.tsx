import type { ReactNode } from "react"
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from "react-router-dom"
import { ThemeProvider } from "./components/ui/theme-provider"
import { Toaster } from "./components/ui/toaster"
import { AuthProvider } from "./contexts/AuthContext"
import { Login } from "./pages/Login"
import { InviteAccept } from "./pages/InviteAccept"
import { ProtectedRoute } from "./components/ProtectedRoute"
import { AppShell, PageFrame, RequireRole, ScreenPlaceholder } from "./shell/AppShell"
import { Home } from "./pages/Home"
import { Devices } from "./pages/Devices"
import { Alerts } from "./pages/Alerts"
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
              <Route path="history" element={<PageFrame title="History"><ScreenPlaceholder text="Energy history for any period, with compare and CSV export, will be shown here." /></PageFrame>} />
              <Route
                path="bills"
                element={
                  <RequireRole roles={["owner", "manager"]}>
                    <PageFrame title="Bills"><ScreenPlaceholder text="Monthly bills, statements and utility bill checks will be shown here." /></PageFrame>
                  </RequireRole>
                }
              />
              <Route path="inbox" element={<Interim><Alerts /></Interim>} />
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
