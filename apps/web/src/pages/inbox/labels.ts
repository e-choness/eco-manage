import { ALERT_RULES, type AlertRuleId, type InboxItem } from "@ecomanage/shared"

// Inbox words and colours (App v2 Inbox).

export const KIND: Record<InboxItem["kind"], string> = {
  Decision: "bg-[rgba(62,207,142,.15)] text-tag-bat",
  Alert: "bg-[rgba(255,122,89,.15)] text-tag-hp",
  Info: "bg-[rgba(91,157,255,.15)] text-tag-grid",
  Active: "bg-[rgba(242,179,61,.15)] text-tag-pv",
  Closed: "bg-app-ch text-app-sb",
}

/** Quick reasons for declining (App v2); any other text works too. */
export const DECLINE_REASONS = ["Not needed today", "Bad timing for the building", "Doing it manually", "Data looks wrong"]

/** How an alert of this kind closes, for "How it closes". */
export const howItCloses = (ruleId: AlertRuleId): string =>
  ALERT_RULES[ruleId].kind === "condition"
    ? "It closes by itself once the condition has cleared (for example the device reports again). Close it as a false alarm if the check is wrong."
    : "It doesn't clear by itself: resolve it with a cause once it has been looked at."

export const INBOX_FOOT =
  "Decisions come from rules that run every 15 minutes on live data, forecasts, the tariff and your limits (Settings → Rules), or from manual requests on the Devices page. Alerts come from checks that run on every reading. Nothing is sent to a device until someone approves it."
