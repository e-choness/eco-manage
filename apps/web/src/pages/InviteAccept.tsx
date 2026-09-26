import { useState, type FormEvent } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { MIN_PASSWORD, type InvitePreview } from "@ecomanage/shared"
import { useAuth } from "@/contexts/AuthContext"
import { getInvite } from "@/api/invites"
import { AuthLayout, Field } from "./auth/AuthLayout"
import { authButton, authInput } from "./auth/styles"

const ROLE = { owner: "owner", manager: "manager", installer: "installer" } as const

const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso))

/** /invite/:token, from the invite email (P4-02). */
export function InviteAccept() {
  const { token = "" } = useParams()
  const invite = useQuery({ queryKey: ["invite", token], queryFn: () => getInvite(token), retry: false, staleTime: Infinity })

  return (
    <AuthLayout footer="EcoManage is invite-only. Each invite link works once.">
      {invite.isLoading ? (
        <p className="m-0 text-app-sb" aria-busy="true">
          Checking your invite…
        </p>
      ) : invite.error ? (
        <Unusable message={invite.error.message} />
      ) : invite.data ? (
        <AcceptForm token={token} invite={invite.data} />
      ) : null}
    </AuthLayout>
  )
}

function Unusable({ message }: { message: string }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="m-0 text-3xl font-semibold tracking-[-0.02em]">This invite can't be used</h1>
      <p className="m-0 text-[15px] leading-normal text-app-sb">{message}</p>
      <Link to="/login" className="text-[15px] font-medium text-[#5b9dff] hover:text-[#8fb4ff]">
        Go to sign in
      </Link>
    </div>
  )
}

function AcceptForm({ token, invite }: { token: string; invite: InvitePreview }) {
  const { acceptInvite } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [gone, setGone] = useState("")
  const [busy, setBusy] = useState(false)

  if (gone) return <Unusable message={gone} />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!invite.hasAccount && !name.trim()) return setError("Enter your name.")
    if (!invite.hasAccount && password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters for your password.`)
    if (!password) return setError("Enter your password.")
    setBusy(true)
    setError("")
    try {
      await acceptInvite(token, invite.hasAccount ? { password } : { name: name.trim(), password })
      // The new membership decides what the shell shows.
      queryClient.removeQueries({ queryKey: ["me"] })
      navigate("/", { replace: true })
    } catch (err) {
      const status = (err as { status?: number }).status
      const message = err instanceof Error ? err.message : "Couldn't accept the invite."
      if (status === 404 || status === 410) setGone(message)
      else setError(message)
      setBusy(false)
    }
  }

  const who = invite.invitedBy ?? "The site owner"
  return (
    <>
      <div className="flex flex-col gap-2.5">
        <h1 className="m-0 text-4xl font-semibold leading-tight tracking-[-0.02em]">Join {invite.siteName}</h1>
        <p className="m-0 text-[15px] leading-normal text-app-sb">
          {who} invited {invite.email} as {ROLE[invite.role]}
          {invite.until ? `, with access until ${day(invite.until)}` : ""}.
        </p>
      </div>
      <form onSubmit={submit} noValidate className="flex flex-col gap-3.5">
        {invite.hasAccount ? (
          <p className="m-0 text-sm text-app-sb">You already have an EcoManage account. Enter its password to add this site.</p>
        ) : (
          <Field label="Your name">
            <input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className={authInput} />
          </Field>
        )}
        <Field label="Email">
          <input type="email" value={invite.email} readOnly className={`${authInput} text-app-sb`} />
        </Field>
        <Field
          label={invite.hasAccount ? "Password" : "Choose a password"}
          hint={invite.hasAccount ? undefined : `At least ${MIN_PASSWORD} characters.`}
          hintId="password-hint"
        >
          <input
            type="password"
            autoComplete={invite.hasAccount ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby={invite.hasAccount ? undefined : "password-hint"}
            className={authInput}
          />
        </Field>
        {error ? (
          <p role="alert" className="m-0 text-sm text-[#ff7a59]">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={busy} className={authButton}>
          {busy ? "Joining…" : invite.hasAccount ? "Sign in and join" : "Create account and join"}
        </button>
      </form>
    </>
  )
}
