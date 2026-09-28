import { useEffect, useMemo, useState, type KeyboardEvent } from "react"
import { useSearchParams } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { siteDate, type TariffIssue } from "@ecomanage/shared"
import {
  TariffRejected,
  createTariff,
  getCalendar,
  getGateway,
  getNotifications,
  getRules,
  getSiteSettings,
  getTariffs,
  patchApproval,
  patchBattery,
  patchNotifications,
  patchRule,
  patchSite,
  putCalendar,
  putPvArrays,
  putSiteModel,
} from "@/api/settings"
import { getDevices } from "@/api/devices"
import { getSiteModel } from "@/api/home"
import { useMe } from "@/hooks/useMe"
import { useSiteLive } from "@/hooks/useSiteLive"
import { useToast } from "@/hooks/useToast"
import { PageFrame } from "@/shell/AppShell"
import { cn } from "@/lib/utils"
import { SECTION_TAB, changed, same, type Drafts, type Section } from "./settings/model"
import { SiteTab } from "./settings/SiteTab"
import { TariffTab } from "./settings/TariffTab"
import { RulesTab } from "./settings/RulesTab"
import { ExplanationsPanel } from "./settings/ExplanationsPanel"
import { CalendarTab } from "./settings/CalendarTab"
import { ModelTab } from "./settings/ModelTab"
import { PeopleTab } from "./settings/PeopleTab"
import { NotificationsTab } from "./settings/NotificationsTab"

const TABS = [
  ["site", "Site"],
  ["tariff", "Tariff"],
  ["rules", "Rules"],
  ["calendar", "Calendar"],
  ["model", "Site model"],
  ["people", "People"],
  ["notifications", "Notifications"],
] as const
type Tab = (typeof TABS)[number][0]
const ORDER: Section[] = ["site", "pvArrays", "battery", "tariff", "rules", "calendar", "model", "notifications"]

/**
 * App v2 Settings: each tab edits drafts that stay while you switch tabs; the sticky bar saves or
 * discards all of them. People changes apply straight away. The server checks every role again.
 */
export function Settings() {
  const [params, setParams] = useSearchParams()
  const tab: Tab = (TABS.find(([t]) => t === params.get("tab"))?.[0] ?? "site") as Tab
  const { role } = useMe()
  const { data: snap } = useSiteLive()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const money = role === "owner" || role === "manager"

  const settings = useQuery({ queryKey: ["site", "settings"], queryFn: getSiteSettings })
  // Every 5 s while a claimed gateway is on its way (P5-04).
  const gateway = useQuery({ queryKey: ["site", "gateway"], queryFn: getGateway, enabled: tab === "site", refetchInterval: (q) => (q.state.data?.claim?.state === "waiting" ? 5000 : false) })
  const devices = useQuery({ queryKey: ["devices"], queryFn: getDevices, enabled: tab === "site" })
  const tariffs = useQuery({ queryKey: ["tariffs"], queryFn: getTariffs, enabled: money })
  const rules = useQuery({ queryKey: ["rules"], queryFn: getRules })
  const calendar = useQuery({ queryKey: ["calendar"], queryFn: getCalendar })
  const model = useQuery({ queryKey: ["site", "model"], queryFn: getSiteModel })
  const notifications = useQuery({ queryKey: ["notifications"], queryFn: getNotifications })
  const tz = settings.data?.tz ?? snap?.site.tz ?? "UTC"
  const today = siteDate(new Date(), tz)

  // What the server has, in the shape each draft is edited in.
  const server: Partial<Drafts> = useMemo(() => {
    const s = settings.data
    const current = tariffs.data?.items.find((t) => t.version === tariffs.data?.current) ?? tariffs.data?.items[0]
    return {
      ...(s
        ? {
            site: { name: s.name, address: s.address, tz: s.tz, lat: s.lat, lon: s.lon, currency: s.currency as Drafts["site"]["currency"], billDay: s.billDay, demandCapKw: s.demandCapKw },
            pvArrays: s.pvArrays.map((a) => ({ id: a.id, name: a.name, inverterId: a.inverterId, kwp: a.kwp, tiltDeg: a.tiltDeg, azimuthDeg: a.azimuthDeg })),
            ...(s.battery ? { battery: { usableKwh: s.battery.usableKwh ?? 0, maxKw: s.battery.maxKw ?? 0, floorPct: s.battery.floorPct } } : {}),
          }
        : {}),
      ...(current
        ? {
            tariff: {
              name: current.name,
              validFrom: current.validFrom,
              seasons: current.seasons,
              periods: current.periods,
              demandRateCents: current.demandRateCents,
              demandIntervalMin: current.demandIntervalMin,
              exportRateCents: current.exportRateCents,
              fixedCents: current.fixedCents,
              holidays: current.holidays,
            },
          }
        : {}),
      ...(rules.data ? { rules: { approval: rules.data.approval, rules: Object.fromEntries(rules.data.rules.map((r) => [r.id, { on: r.on, params: r.params }])) } } : {}),
      ...(calendar.data ? { calendar: { terms: calendar.data.terms, daysOff: calendar.data.daysOff, open: calendar.data.open, close: calendar.data.close, weekends: calendar.data.weekends } } : {}),
      ...(model.data ? { model: { hub: model.data.hub, anchors: model.data.anchors, buildingLabel: model.data.buildingLabel, camera: model.data.camera, generated: model.data.generated } } : {}),
      ...(notifications.data ? { notifications: notifications.data } : {}),
    }
  }, [settings.data, tariffs.data, rules.data, calendar.data, model.data, notifications.data])

  const [drafts, setDrafts] = useState<Partial<Drafts>>({})
  const [errors, setErrors] = useState<Partial<Record<Section, string>>>({})
  const [tariffIssues, setTariffIssues] = useState<TariffIssue[]>([])
  const [saving, setSaving] = useState(false)
  const value = <S extends Section>(s: S): Drafts[S] | null => (drafts[s] ?? server[s] ?? null) as Drafts[S] | null
  const setter =
    <S extends Section>(s: S) =>
    (v: Drafts[S]) =>
      setDrafts((d) => {
        // A tariff edit is a new version: it can't start before today.
        if (s === "tariff" && !d.tariff) {
          const t = v as Drafts["tariff"]
          if (t.validFrom < today) return { ...d, tariff: { ...t, validFrom: today } }
        }
        return { ...d, [s]: v }
      })
  const dirty = ORDER.filter((s) => drafts[s] !== undefined && !same(drafts[s], server[s]))
  const dirtyTabs = [...new Set(dirty.map((s) => SECTION_TAB[s]))]

  useEffect(() => {
    if (!dirty.length) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [dirty.length])

  const save = async () => {
    setSaving(true)
    setErrors({})
    setTariffIssues([])
    const done: string[] = []
    for (const s of dirty) {
      try {
        const d = drafts[s]!
        if (s === "site") await patchSite(changed(d as Drafts["site"], server.site!))
        if (s === "pvArrays") await putPvArrays(d as Drafts["pvArrays"])
        if (s === "battery") await patchBattery(changed(d as Drafts["battery"], server.battery!))
        if (s === "tariff") {
          const t = await createTariff(d as Drafts["tariff"])
          done.push(`Tariff version ${t.version} saved, valid from ${t.validFrom}. Earlier bills keep the version they were billed on.`)
        }
        if (s === "rules") {
          const r = d as Drafts["rules"]
          if (!same(r.approval, server.rules!.approval)) await patchApproval({ params: changed(r.approval, server.rules!.approval) })
          for (const [id, rule] of Object.entries(r.rules)) {
            const before = server.rules!.rules[id]
            if (same(rule, before)) continue
            await patchRule(id, { ...(rule.on !== before.on ? { on: rule.on } : {}), ...(!same(rule.params, before.params) ? { params: changed(rule.params, before.params) as Record<string, number | boolean> } : {}) })
          }
        }
        if (s === "calendar") await putCalendar(d as Drafts["calendar"])
        if (s === "model") await putSiteModel(d as Drafts["model"])
        if (s === "notifications") {
          const n = d as Drafts["notifications"]
          const diff = changed(n, server.notifications!)
          await patchNotifications("quietFrom" in diff || "quietTo" in diff ? { ...diff, quietFrom: n.quietFrom, quietTo: n.quietTo } : diff)
        }
        setDrafts((x) => {
          const next = { ...x }
          delete next[s]
          return next
        })
      } catch (err) {
        if (err instanceof TariffRejected) setTariffIssues(err.issues)
        setErrors((e) => ({ ...e, [s]: err instanceof Error ? err.message : "Couldn't save" }))
      }
    }
    await queryClient.invalidateQueries({ queryKey: ["site"] })
    for (const k of ["tariffs", "rules", "calendar", "notifications"]) await queryClient.invalidateQueries({ queryKey: [k] })
    setSaving(false)
    if (done.length) toast({ description: done.join(" ") })
    else if (dirty.length) toast({ description: "Saved. The change is in the audit log." })
  }
  const failed = Object.entries(errors) as [Section, string][]
  // Tabs pattern: arrows, Home and End move to a tab and open it.
  const tabKeys = (e: KeyboardEvent) => {
    const i = TABS.findIndex(([t]) => t === tab)
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key]
    if (to === undefined) return
    e.preventDefault()
    const [next] = TABS[(to + TABS.length) % TABS.length]
    setParams({ tab: next }, { replace: true })
    document.getElementById(`settings-tab-${next}`)?.focus()
  }

  return (
    <PageFrame title="Settings">
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Settings" onKeyDown={tabKeys}>
        {TABS.map(([t, label]) => (
          <button
            key={t}
            id={`settings-tab-${t}`}
            type="button"
            role="tab"
            aria-selected={tab === t}
            aria-controls="settings-panel"
            tabIndex={tab === t ? 0 : -1}
            onClick={() => setParams({ tab: t }, { replace: true })}
            className={cn("h-8 rounded-lg px-3 text-[13px]", tab === t ? "bg-app-ch text-app-tx" : "text-app-sb hover:text-app-tx")}
          >
            {label}
            {dirtyTabs.includes(label) ? " •" : ""}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-4 pb-24" id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${tab}`}>
        {tab === "site" && value("site") ? (
          <SiteTab
            site={value("site")!}
            setSite={setter("site")}
            arrays={value("pvArrays") ?? []}
            setArrays={setter("pvArrays")}
            battery={value("battery")}
            setBattery={setter("battery")}
            canSite={role === "owner"}
            canHardware={role === "owner" || role === "installer"}
            inverters={(devices.data?.items ?? []).filter((d) => d.type === "pv").map((d) => ({ id: d.id, name: d.name }))}
            gateway={gateway.data}
          />
        ) : null}
        {tab === "tariff" ? (
          <TariffTab tariff={value("tariff")} setTariff={setter("tariff")} version={tariffs.data?.current ?? null} canEdit={role === "owner"} canView={money} serverIssues={tariffIssues} />
        ) : null}
        {tab === "rules" ? <RulesTab draft={value("rules")} set={setter("rules")} rules={rules.data?.rules ?? []} canEdit={money} /> : null}
        {tab === "rules" && role === "owner" ? <ExplanationsPanel /> : null}
        {tab === "calendar" ? <CalendarTab cal={value("calendar")} set={setter("calendar")} canEdit={money} today={today} /> : null}
        {tab === "model" ? <ModelTab draft={value("model")} set={setter("model")} saved={model.data} snap={snap} canEdit={role === "owner" || role === "installer"} /> : null}
        {tab === "people" ? <PeopleTab canEdit={role === "owner"} today={today} /> : null}
        {tab === "notifications" ? <NotificationsTab prefs={value("notifications")} set={setter("notifications")} role={role} /> : null}
      </div>

      {dirty.length || failed.length ? (
        <div role="region" aria-label="Unsaved changes" className="sticky bottom-4 z-10 flex flex-col gap-2 rounded-xl border border-app-ln bg-app-ps px-4 py-3 shadow-lg">
          <div className="flex items-center justify-between gap-4">
            <span className="text-[13px]">{dirty.length ? `Unsaved changes: ${dirtyTabs.join(", ")}` : "Some changes weren't saved."}</span>
            <span className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setDrafts({})
                  setErrors({})
                  setTariffIssues([])
                }}
                className="h-[34px] rounded-lg px-3 text-[13px] text-app-sb"
              >
                Discard
              </button>
              <button type="button" disabled={saving || !dirty.length} onClick={() => void save()} className="h-[34px] rounded-lg bg-flow-bat px-4 text-[13px] font-semibold text-[#06140d] disabled:opacity-60">
                {saving ? "Saving…" : "Save changes"}
              </button>
            </span>
          </div>
          {failed.map(([s, message]) => (
            <p key={s} role="alert" className="m-0 text-xs text-tag-hp">
              {SECTION_TAB[s]}: {message}
            </p>
          ))}
        </div>
      ) : null}
    </PageFrame>
  )
}
