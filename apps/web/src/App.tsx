import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom"
import { ThemeProvider } from "./components/ui/theme-provider"
import { Toaster } from "./components/ui/toaster"
import { AuthProvider } from "./contexts/AuthContext"
import { Login } from "./pages/Login"
import { Register } from "./pages/Register"
import { ProtectedRoute } from "./components/ProtectedRoute"
import { DashboardLayout } from "./components/DashboardLayout"
import { Monitoring } from "./pages/Monitoring"
import { Live } from "./pages/Live"
import { Optimization } from "./pages/Optimization"
import { Alerts } from "./pages/Alerts"
import { Settings } from "./pages/Settings"
import { LandingPage } from "./pages/LandingPage"

function App() {
  return (
    <AuthProvider>
      <ThemeProvider defaultTheme="light" storageKey="ui-theme">
        <Router>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/dashboard" element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
              <Route index element={<Live />} />
              {/* The live view was at /dashboard/live during P1-08 */}
              <Route path="live" element={<Navigate to="/dashboard" replace />} />
              <Route path="monitoring" element={<Monitoring />} />
              <Route path="optimization" element={<Optimization />} />
              <Route path="alerts" element={<Alerts />} />
              <Route path="settings" element={<Settings />} />
            </Route>
          </Routes>
        </Router>
        <Toaster />
      </ThemeProvider>
    </AuthProvider>
  )
}

export default App