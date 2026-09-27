import { useState, type FormEvent } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ROLES, type MemberView, type Role } from "@ecomanage/shared"
import { getPeople, inviteSomeone, patchMember, removeMember, revokeInvite } from "@/api/settings"
import { useToast } from "@/hooks/useToast"
import { cn } from "@/lib/utils"
import { rangeText } from "../history/dates"
import { inputClass } from "./styles"
import { Field, Fields, Group, ReadOnly } from "./ui"

const ROLE_LABEL: Record<Role, string> = { owner: "Owner", manager: "Manager", installer: "Installer" }
const PEOPLE_KEY = ["people"]

/**
 * Settings → People (App v2, owner only): who has access, their role and until when, and invites.
 * Changes here apply straight away (each is audited).
 */
export function PeopleTab({ canEdit, today }: { canEdit: boolean; today: string }) {
  const people = useQuery({ queryKey: PEOPLE_KEY, queryFn: getPeople, enabled: canEdit })
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [error, setError] = useState("")
  const [invite, setInvite] = useState({ email: "", role: "manager" as Role, until: "" })
  if (!canEdit) return <ReadOnly text="Only the owner manages people." />

  const run = async (fn: () => Promise<unknown>, message: string) => {
    setError("")
    try {
      await fn()
      toast({ description: message })
      void queryClient.invalidateQueries({ queryKey: PEOPLE_KEY })
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work.")
      return false
    }
  }
  const send = async (e: FormEvent) => {
    e.preventDefault()
    if (!invite.email.trim()) return setError("Enter an email address first.")
    if (await run(() => inviteSomeone({ email: invite.email.trim(), role: invite.role, until: invite.until || null }), `Invite sent to ${invite.email.trim()}.`))
      setInvite({ email: "", role: "manager", until: "" })
  }
  const update = (m: MemberView, patch: { role?: Role; until?: string | null }) =>
    void run(() => patchMember(m.id, patch), `${m.name}: ${patch.role ? `now ${ROLE_LABEL[patch.role].toLowerCase()}` : patch.until ? `access until ${rangeText(patch.until, patch.until)}` : "access with no end date"}.`)

  return (
    <>
      <Group title="People" note="Owner: everything. Manager: approvals, alerts, calendar, view bills. Installer: devices, diagnostics, alerts, no bills.">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_150px_170px_70px] items-center gap-x-3 gap-y-2 text-[13px]" role="table" aria-label="People">
          {["Name", "Email", "Role", "Access until", ""].map((h, i) => (
            <span key={i} role="columnheader" className="text-xs text-app-dm">
              {h}
            </span>
          ))}
          {people.data?.members.map((m) => (
            <div key={m.id} role="row" className="contents">
              <span role="cell">
                {m.name}
                {m.you ? <span className="text-app-dm"> (you)</span> : null}
              </span>
              <span role="cell" className="truncate text-app-sb">
                {m.email}
              </span>
              <select aria-label={`Role of ${m.name}`} value={m.role} onChange={(e) => update(m, { role: e.target.value as Role })} className={inputClass}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
              <input
                type="date"
                aria-label={`Access until for ${m.name}`}
                min={today}
                value={m.until ?? ""}
                onChange={(e) => update(m, { until: e.target.value || null })}
                className={inputClass}
              />
              <button type="button" aria-label={`Remove ${m.name}`} onClick={() => void run(() => removeMember(m.id), `${m.name} no longer has access.`)} className="p-0 text-xs text-app-sb hover:text-app-tx">
                Remove
              </button>
            </div>
          ))}
        </div>
        {people.data?.invites.length ? (
          <div className="flex flex-col gap-2 border-t border-app-l2 pt-3.5">
            <h3 className="m-0 text-[13px] font-semibold">Invited, not joined yet</h3>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label="Pending invites">
              {people.data.invites.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 text-[13px]">
                  <span>
                    {i.email} · {ROLE_LABEL[i.role]}
                    {i.until ? ` until ${rangeText(i.until, i.until)}` : ""}
                    <span className="text-app-dm"> · link expires {rangeText(i.expiresAt.slice(0, 10), i.expiresAt.slice(0, 10))}</span>
                  </span>
                  <button type="button" aria-label={`Revoke the invite for ${i.email}`} onClick={() => void run(() => revokeInvite(i.id), `The invite for ${i.email} no longer works.`)} className="p-0 text-xs text-app-sb hover:text-app-tx">
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="m-0 text-xs text-[#ff7a59]">
            {error}
          </p>
        ) : null}
      </Group>

      <Group title="Invite someone">
        <form onSubmit={send} aria-label="Invite someone" className="flex flex-col gap-3.5">
          <Fields>
            <Field label="Email">
              <input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} className={cn(inputClass, "w-full")} />
            </Field>
            <Field label="Role">
              <select value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value as Role })} className={cn(inputClass, "w-full")}>
                {(["manager", "installer", "owner"] as Role[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Access until" hint="Optional. Recommended for installers.">
              <input type="date" min={today} value={invite.until} onChange={(e) => setInvite({ ...invite, until: e.target.value })} className={cn(inputClass, "w-full")} />
            </Field>
          </Fields>
          <button type="submit" className="h-[34px] self-end rounded-lg border border-app-ln px-3.5 text-[13px] font-medium text-app-tx">
            Send invite
          </button>
        </form>
      </Group>
    </>
  )
}
