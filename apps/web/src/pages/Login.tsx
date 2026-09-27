import { useState, type FormEvent } from "react"
import { Navigate, useLocation, useNavigate } from "react-router-dom"
import { useAuth } from "@/contexts/AuthContext"
import { AuthLayout, Field } from "./auth/AuthLayout"
import { authButton, authInput } from "./auth/styles"

// App v2 Login. Signing in lands on the page the person was sent away from, or Home.
export function Login() {
  const { login, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: { pathname: string; search?: string } } | null)?.from
  const next = from ? `${from.pathname}${from.search ?? ""}` : "/"
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  if (isAuthenticated && !busy) return <Navigate to={next} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) return setError("Enter your email and password.")
    setBusy(true)
    setError("")
    try {
      await login(email.trim(), password)
      navigate(next, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.")
      setBusy(false)
    }
  }

  return (
    <AuthLayout footer="EcoManage is invite-only. To join a site, open the link in your invite email.">
      <div className="flex flex-col gap-2.5">
        <h1 className="m-0 text-4xl font-semibold leading-tight tracking-[-0.02em]">Sign in to your site</h1>
        <p className="m-0 text-[15px] leading-normal text-app-sb">Live power, cost and approvals for one site.</p>
      </div>
      <form onSubmit={submit} noValidate className="flex flex-col gap-3.5">
        <Field label="Email">
          <input type="email" autoComplete="email" placeholder="demo@ecomanage.io" value={email} onChange={(e) => setEmail(e.target.value)} className={authInput} />
        </Field>
        <Field label="Password">
          <input type="password" autoComplete="current-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} className={authInput} />
        </Field>
        {error ? (
          <p role="alert" className="m-0 text-sm text-tag-hp">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={busy} className={authButton}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        {import.meta.env.DEV ? <div className="text-[13px] text-app-dm">Demo account: demo@ecomanage.io · Demo1234!</div> : null}
      </form>
    </AuthLayout>
  )
}
