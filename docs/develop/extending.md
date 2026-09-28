# Extending EcoManage

The common changes, and every place each one touches. Whatever you change, run the gates in
[Testing](./testing.md) and update the docs and the changelog ([Contributing](./contributing.md)).

## A new kind of device

Devices are described by **profiles**: JSON files in `packages/profiles/src/profiles/`, checked
against the schema in `packages/profiles/src/schema.ts` when they load. The format is in the
[device profiles reference](../reference/device-profiles.md).

1. **Write the profile** (`<name>@<version>.json`-style id, `version` matching): its protocol,
   device types, the fields it reports, where each comes from (registers or protocol messages),
   its write actions with their limits and longest duration, states, faults and remote fixes.
2. **Register it** in `packages/profiles/src/index.ts`.
3. **Limits are safety:** every numeric parameter needs `min` and `max`, and every action that
   holds a state needs `maxDurationMin`. The gateway, the simulator, the rules and the API all read
   them from here.
4. **The gateway:** Modbus and OCPP devices are driven from the profile alone. A new protocol needs
   a driver in `apps/gateway/src/drivers/` and a case in the scan.
5. **The simulator,** if the demo should have one: a model in `apps/simulator/src/engine/`.
6. **Tests:** `packages/profiles` checks every profile against the schema; add decoding tests in
   `apps/gateway/src/__tests__` with the register values from the device's documentation.

Set `reviewed: true` only once the profile has been checked against a real device.

## A new recommendation rule

1. **Name it** in `RECOMMENDATION_RULES` (title, device type) and give it defaults in
   `RULE_DEFAULTS`, in `packages/shared/src/recommendations.ts`.
2. **Write it** in `packages/recs/src/rules/<name>.ts` as a `Rule`: `evaluate(ctx, params)` returns
   proposals (device, action, params exactly as the device's profile expects, window, inputs and a
   `dedupeKey`); `check(ctx, action, params)` returns the checks; `saving(ctx, action, params)` the
   expected saving in cents with a one-line calculation. All three must be pure functions of the
   context: no clock, no database.
3. **Register it** in `packages/recs/src/registry.ts`.
4. **Settings:** give each parameter a label and unit in
   `apps/web/src/pages/settings/RulesTab.tsx`.
5. **Tests** in `packages/recs/src/__tests__`: a fixture where it triggers, one where it doesn't,
   and one where a check fails.
6. **Docs:** add it to the rule tables in the [Inbox guide](../guide/inbox.md#the-rules) and
   [Rules](./rules.md#the-rules).

The rules service and the API's approval pick it up with nothing else to change. If its action
needs verifying in a new way, add that to `apps/rules/src/commands/verify.ts`.

## A new alert

1. **Name it** in `ALERT_RULES` in `packages/shared/src/alerts.ts`: its title, severity (`info`
   isn't emailed) and kind (`condition` closes itself, `one-off` waits for a person, `event` counts
   occurrences).
2. **Write the check** in `apps/rules/src/checks.ts`: a pure function of the `SiteContext` that adds
   its findings and marks each (rule, device) pair it could judge, so the reconciler knows what
   may close.
3. **Tests** in `apps/rules/src/__tests__`: opening, clearing, and a pair it can't judge.
4. **Docs:** the alert tables in the [Inbox guide](../guide/inbox.md#alerts) and
   [Rules](./rules.md#alerts).

## A new API endpoint

1. **Route, controller, service** in the module's folder (`apps/api/src/modules/<name>/`), with
   `requireRole(...)` on the route and zod parsing in the controller.
2. **Audit it:** a write to site data calls `recordAudit` with before and after, and gets a line in
   `apps/api/src/__tests__/integration/audit.test.ts` (the test fails until it has one).
3. **Types** for the response in `packages/shared/src/api/`, so the web app uses the same shape.
4. **Tests:** the role matrix and the behaviour in `src/__tests__/integration/`.
5. **Docs:** the [REST API reference](../reference/api.md).

## A new email

Add the sending to the `email` queue's pass in `apps/worker/src/` with a unique key, so it's sent
once even across restarts; respect the person's notification settings and quiet hours; link to
`APP_URL`. Test it against Mailpit.

## A new setting

Environment variables are read and checked with zod where each service starts
(`apps/api/src/config/env.ts`, each app's `main.ts`). Add it there with a default, to the compose
files if it needs a value, to `infra/deploy/.env.example` if operators should set it, and to
[Configuration](../deploy/configuration.md).
