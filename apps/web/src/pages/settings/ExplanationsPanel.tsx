import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { LLM_PRESETS, type ExplanationSettingsInput, type ExplanationSettingsView, type ExplanationTestResult } from "@ecomanage/shared"
import { getExplanationSettings, removeExplanationSettings, saveExplanationSettings, testExplanationSettings } from "@/api/settings"
import { cn } from "@/lib/utils"
import { inputClass } from "./styles"
import { Field, Fields, Group, NumberInput } from "./ui"

// Settings → Rules → Explanations (owner, P5-05): plug in a language model with your own key, from
// any OpenAI-compatible provider or Anthropic. Saved straight away (not in the save bar); the key
// is write-only.

type Preset = (typeof LLM_PRESETS)[number]
const presetOf = (v: ExplanationSettingsView | undefined): Preset =>
  LLM_PRESETS.find((p) => v?.source === "site" && p.provider === v.provider && p.baseUrl === v.baseUrl) ?? (v?.source === "site" ? LLM_PRESETS.find((p) => p.id === "custom")! : LLM_PRESETS[0])

export function ExplanationsPanel() {
  const settings = useQuery({ queryKey: ["site", "explanations"], queryFn: getExplanationSettings })
  if (!settings.data) return null
  return <Form key={settings.data.updatedAt ?? "none"} view={settings.data} />
}

function Form({ view }: { view: ExplanationSettingsView }) {
  const qc = useQueryClient()
  const own = view.source === "site"
  const [preset, setPreset] = useState<Preset>(presetOf(view))
  const [baseUrl, setBaseUrl] = useState(own ? (view.baseUrl ?? "") : preset.baseUrl)
  const [model, setModel] = useState(own ? (view.model ?? "") : "")
  const [apiKey, setApiKey] = useState("")
  const [monthlyTokens, setMonthly] = useState<number | null>(own ? view.monthlyTokens : 200_000)
  const [tested, setTested] = useState<ExplanationTestResult | null>(null)
  const input = (): ExplanationSettingsInput => ({ provider: preset.provider, baseUrl: baseUrl.trim(), model: model.trim(), ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}), monthlyTokens: monthlyTokens ?? 0 })
  const done = (v: ExplanationSettingsView) => qc.setQueryData(["site", "explanations"], v)
  const save = useMutation({ mutationFn: () => saveExplanationSettings(input()), onSuccess: done })
  const remove = useMutation({ mutationFn: removeExplanationSettings, onSuccess: done })
  const test = useMutation({ mutationFn: () => testExplanationSettings(input()), onSuccess: setTested })
  const ready = baseUrl.trim() !== "" && model.trim() !== "" && (apiKey.trim() !== "" || own) && (monthlyTokens ?? 0) >= 1000
  const error = save.error ?? remove.error ?? test.error

  const pick = (id: string) => {
    const p = LLM_PRESETS.find((x) => x.id === id)!
    setPreset(p)
    setBaseUrl(p.baseUrl)
    setTested(null)
  }

  const status =
    view.source === "site"
      ? `On: this site’s own ${view.provider === "anthropic" ? "Anthropic" : "OpenAI-compatible"} model ${view.model} (key ${view.keyHint}).`
      : view.source === "server"
        ? `On: the server’s default model (${view.model}). Add your own key to use another.`
        : "Off: add a key to turn on “Explain in plain words” in the Inbox."

  return (
    <Group title="Explanations" note="“Explain in plain words” in the Inbox. The model gets the recommendation’s numbers only; names and anything people typed stay here.">
      <p className="m-0 text-[13px] text-app-sb" data-testid="explanations-status">
        {status} {view.monthlyTokens ? `${view.usedTokens.toLocaleString("en-US")} of ${view.monthlyTokens.toLocaleString("en-US")} tokens used this month.` : ""}
      </p>
      {!view.canStoreKeys ? (
        <p className="m-0 text-xs text-app-dm">This server can’t keep API keys (SECRETS_KEY isn’t set), so only its default model can be used.</p>
      ) : (
        <form
          aria-label="Your language model"
          onSubmit={(e) => {
            e.preventDefault()
            if (ready) save.mutate()
          }}
          className="flex flex-col gap-3"
        >
          <Fields>
            <Field label="Provider">
              <select value={preset.id} onChange={(e) => pick(e.target.value)} className={cn(inputClass, "w-full")}>
                {LLM_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Base URL" hint={preset.provider === "anthropic" ? "Anthropic’s own API" : "OpenAI-compatible: it serves /chat/completions"}>
              <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://…/v1" className={cn(inputClass, "w-full font-mono")} />
            </Field>
            <Field label="Model" hint="As the provider names it">
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={preset.provider === "anthropic" ? "claude-opus-5" : "model name"} className={cn(inputClass, "w-full font-mono")} />
            </Field>
            <Field label="API key" hint={own ? `Saved (${view.keyHint}); leave empty to keep it` : "Kept encrypted; never shown again"}>
              <input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className={cn(inputClass, "w-full font-mono")} />
            </Field>
            <Field label="Monthly budget" suffix="tokens" hint="Input and output together; about 1,000 per explanation">
              <NumberInput label="Monthly budget" value={monthlyTokens} step="1000" set={setMonthly} />
            </Field>
          </Fields>
          <div className="flex flex-wrap items-center gap-2.5">
            <button type="submit" disabled={!ready || save.isPending} className="h-9 rounded-lg border border-app-ln px-3 text-[13px] text-app-tx disabled:text-app-dm">
              {save.isPending ? "Saving…" : "Save"}
            </button>
            <button type="button" disabled={!ready || test.isPending} onClick={() => test.mutate()} className="h-9 rounded-lg border border-app-ln px-3 text-[13px] text-app-tx disabled:text-app-dm">
              {test.isPending ? "Trying…" : "Test"}
            </button>
            {own ? (
              <button type="button" disabled={remove.isPending} onClick={() => remove.mutate()} className="h-9 p-0 text-xs text-app-sb">
                Remove my key
              </button>
            ) : null}
            {tested ? (
              <span role="status" className={cn("text-xs", tested.ok ? "text-tag-bat" : "text-tag-hp")}>
                {tested.ok ? `Works: ${tested.model} answered in ${(tested.latencyMs / 1000).toFixed(1)} s` : tested.error}
              </span>
            ) : null}
          </div>
          {error ? (
            <p role="alert" className="m-0 text-xs text-tag-hp">
              {error instanceof Error ? error.message : "That didn’t work."}
            </p>
          ) : null}
        </form>
      )}
    </Group>
  )
}
