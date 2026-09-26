import type { ReactNode } from "react"
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom"
import { ThemeProvider } from "./components/ui/theme-provider"
import { Toaster } from "./components/ui/toaster"
import { AuthProvider } from "./contexts/AuthContext"
import { Login } from "./pages/Login"
import { Register } from "./pages/Register"
import { ProtectedRoute } from "./components/ProtectedRoute"
import { AppShell, PageFrame, RequireRole, ScreenPlaceholder } from "./shell/AppShell"
import { Monitoring } from "./pages/Monitoring"
import { Live } from "./pages/Live"
import { Alerts } from "./pages/Alerts"
import { Settings } from "./pages/Settings"
import { LandingPage } from "./pages/LandingPage"

// Pages from before App v2, shown in the new shell until their screens are rebuilt (P4-03..P4-08).
const Interim = ({ children }: { children: ReactNode }) => <main className="mx-auto max-w-7xl p-6">{children}</main>

function App() {
  return (
    <AuthProvider>
      <ThemeProvider defaultTheme="dark" storageKey="ui-theme">
        <Router>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/dashboard" element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
              <Route index element={<Interim><Live /></Interim>} />
              <Route path="devices" element={<Interim><Monitoring /></Interim>} />
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
              {/* Earlier addresses */}
              <Route path="live" element={<Navigate to="/dashboard" replace />} />
              <Route path="monitoring" element={<Navigate to="/dashboard/devices" replace />} />
              <Route path="alerts" element={<Navigate to="/dashboard/inbox" replace />} />
              <Route path="optimization" element={<Navigate to="/dashboard/inbox" replace />} />
            </Route>
          </Routes>
        </Router>
        <Toaster />
      </ThemeProvider>
    </AuthProvider>
  )
}

export default App
