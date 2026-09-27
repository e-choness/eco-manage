import type { ApprovalConfig, RuleView } from "@ecomanage/shared"
import { cn } from "@/lib/utils"
import type { RulesDraft } from "./model"
import { inputClass } from "./styles"
import { Field, Fields, Group, NumberInput, ReadOnly, Toggle } from "./ui"

// Settings → Rules wording (App v2): what each rule does and what its settings mean.
const RULE_TEXT: Record<string, { note: string; params: Record<string, [string, string, string?]> }> = {
  "peak-shaving": {
    note: "Discharge the battery when forecast demand goes over the cap.",
    params: {
      socSchoolPct: ["Minimum battery on school days", "%"],
      socOtherPct: ["Minimum battery on other days", "%"],
      maxKw: ["Maximum discharge", "kW"],
      marginKw: ["Forecast margin", "kW", "Added to the forecast peak to allow for error."],
    },
  },
  "ev-offpeak": { note: "Move fleet charging to off-peak when the departure time allows.", params: { bufferPct: ["Energy buffer", "%"], fleetOnly: ["Fleet vehicles only", ""] } },
  "ev-limit-near-cap": { note: "Lower the charging current when demand gets close to the cap.", params: { withinPct: ["Trigger within", "% of cap"], minA: ["Minimum current", "A per charger"] } },
  "hp-precondition": { note: "Boost before the peak, block during it.", params: { boostMin: ["Longest boost", "min"], blockMin: ["Longest block", "min"] } },
  "storm-reserve": { note: "Raise the battery reserve before a weather warning.", params: { reservePct: ["Reserve", "%"], leadH: ["Start before warning", "h"] } },
  "zero-export-low-price": { note: "Cap export and charge the battery when the export rate is too low.", params: { belowCents: ["When export rate is at or below", "¢/kWh"] } },
}

interface Props {
  draft: RulesDraft | null
  set: (d: RulesDraft) => void
  rules: RuleView[]
  canEdit: boolean
}

/** Settings → Rules (App v2): who approves, and each rule on or off with its limits. */
export function RulesTab({ draft, set, rules, canEdit }: Props) {
  if (!draft) return <ReadOnly text="Loading the rules…" />
  const a = draft.approval
  const setApproval = (patch: Partial<ApprovalConfig>) => set({ ...draft, approval: { ...a, ...patch } })
  const setRule = (id: string, patch: Partial<RulesDraft["rules"][string]>) => set({ ...draft, rules: { ...draft.rules, [id]: { ...draft.rules[id], ...patch } } })
  return (
    <>
      {!canEdit ? <ReadOnly text="View only. Owners and managers can change rules." /> : null}
      <Group title="Approval" note="Rules only propose. Nothing is sent to a device until someone approves it.">
        <Fields>
          <Field label="Who can approve">
            <select value={a.who} disabled={!canEdit} onChange={(e) => setApproval({ who: e.target.value as ApprovalConfig["who"] })} className={cn(inputClass, "w-full")}>
              <option value="owner-or-manager">Owner or manager</option>
              <option value="owner">Owner only</option>
            </select>
          </Field>
          <Field label="Decide at least" suffix="min before start" hint="Proposals expire after this and nothing is sent.">
            <NumberInput value={a.expireMin} required step="1" disabled={!canEdit} set={(v) => setApproval({ expireMin: v ?? 0 })} />
          </Field>
          <Field label="Email new proposals to">
            <select value={a.email} disabled={!canEdit} onChange={(e) => setApproval({ email: e.target.value as ApprovalConfig["email"] })} className={cn(inputClass, "w-full")}>
              <option value="approvers">Everyone who can approve</option>
              <option value="owner">The owner only</option>
              <option value="nobody">Nobody</option>
            </select>
          </Field>
        </Fields>
      </Group>
      {rules.map((r) => {
        const d = draft.rules[r.id]
        const text = RULE_TEXT[r.id]
        return (
          <Group key={r.id} title={r.title} note={text?.note} toggle={{ on: d.on, set: (on) => setRule(r.id, { on }), disabled: !canEdit }}>
            <Fields>
              {Object.entries(d.params).map(([k, v]) => {
                const [label, suffix, hint] = text?.params[k] ?? [k, ""]
                return typeof v === "boolean" ? (
                  <div key={k} className="flex items-center justify-between gap-3 text-[13px] text-app-sb">
                    {label}
                    <Toggle label={label} on={v} disabled={!canEdit} set={(on) => setRule(r.id, { params: { ...d.params, [k]: on } })} />
                  </div>
                ) : (
                  <Field key={k} label={label} suffix={suffix} hint={hint}>
                    <NumberInput label={label} value={v} required disabled={!canEdit} set={(x) => setRule(r.id, { params: { ...d.params, [k]: x ?? 0 } })} />
                  </Field>
                )
              })}
            </Fields>
            {r.declines30d.count ? (
              <p className="m-0 text-xs text-app-dm" data-testid={`declines-${r.id}`}>
                Declined {r.declines30d.count} time{r.declines30d.count > 1 ? "s" : ""} in 30 days: {r.declines30d.reasons.map((x) => `${x.reason} (${x.count})`).join(", ")}.
              </p>
            ) : null}
          </Group>
        )
      })}
    </>
  )
}
