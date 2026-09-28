# Web app

`apps/web`: a React 19 single-page app built with Vite 8 and Tailwind 4. What each page does for
people is in the [user guide](../guide/index.md); this page is about how it's built.

## Layout

```text
src/
  api/          axios calls per area, api.ts (the token in memory, refresh on 401)
  contexts/     AuthContext: restoring the session, sign-in, invites, sign-out, the saved theme
  shell/        AppShell, Rail, AvatarMenu, ProfileDialog, nav.ts,
                SiteStreamProvider (the one live-stream connection), useThemeToggle
  hooks/        useMe (user, membership, role), useSiteStream, useSiteLive (the snapshot)
  components/   scene/ (SiteScene: the three.js engine and the 2D fallback), ui/ (shadcn/ui)
  pages/        Login and InviteAccept (auth/), Home, Devices, History, Bills, Inbox, Settings,
                each with a folder of its parts
```

## Routes

`/login`, `/invite/:token`, and the signed-in app: `/` (Home), `/devices`, `/history`, `/bills`,
`/inbox` and `/settings`, the same addresses the emails link to. State worth linking is in the
query: `?device=`, `?period=`, `?item=type:id` (and `?alert=`, `?recommendation=` from emails),
`?tab=`, `?export=`. Old `/dashboard/…` addresses redirect.

`ProtectedRoute` waits for the session to be restored, then sends signed-out visitors to `/login`,
which brings them back afterwards. `RequireRole` keeps installers out of Bills (the API refuses
them too).

## Data

- **TanStack Query** holds everything from the API.
- **The live stream:** `SiteStreamProvider` keeps one connection to `/api/site/stream` for the
  whole signed-in app. It writes the snapshot into the query cache, applies each `telemetry`,
  `demand`, `device`, `alert` and `command` event to it with `applySiteEvent` (which uses the same
  shared `siteFlows` and `batteryLive` functions as the API), and turns `inbox` events into fresh
  Inbox counts and invalidated lists. On any drop it waits a moment, reconnects and starts again from a fresh snapshot.
- **The role** comes from `/api/auth/me`: the first active membership, the same rule the API uses.

## Home's scene

`components/scene/sceneEngine.ts` draws the site with three.js, loaded on demand in its own chunk.

- The static scene (building, roof array, a device per anchor, the hub) is built per model and
  theme. The building is either **generated** from the site model's plan (`buildingPlan()` in
  `@ecomanage/shared`, which also draws Settings' top-down plan) or an **uploaded GLB**, loaded
  with GLTFLoader, DRACOLoader and KTX2Loader; the decoders are served from `/decoders/…`, copied
  from three.js into the build. If the upload fails to load, the generated building is drawn.
- **Flows** are particles along a path from each anchor to the hub, faster and denser with more
  kW, towards the hub for sources and away for loads. They and the floating labels update in
  place as data arrives.
- Drag turns the model; it sways slowly unless reduced motion is on. In Settings, a click that
  isn't a drag is raycast onto the model to place an anchor.
- Roofs over 300 panels are one instanced mesh; camera, shadows and fog scale with the model.
- **Without WebGL**, or if three.js fails to load, `SiteFlow2D` draws the same flows flat with
  moving dashes. A visually hidden table always lists the flows.

## Settings' drafts

Each section of Settings is a draft held while you switch tabs. The sticky bar lists the changed
tabs and saves each section to its own endpoint (only changed fields; one PATCH per changed rule),
keeping the drafts that failed with their error. Leaving with unsaved changes asks first. People
changes apply immediately instead.

## Styling and themes

- The colours are CSS variables in `index.css` (`--bg`, `--pn`, `--tx` …) for the dark and light
  themes, exposed to Tailwind as `app-*`, `tag-*`, `price-*` and `flow-*`. The shadcn/ui tokens
  are the same palette, so `ui/` components match.
- Fonts: Geist and Geist Mono for everything, and Audiowide for the "EcoManage" wordmark
  (`font-wordmark`), from Google Fonts.
- The theme toggle sets `dark` or `light` on `<html>`, keeps it in localStorage and saves it on the
  user (`PUT /api/auth/profile {theme}`); a saved theme wins on the next sign-in anywhere.

## Accessibility

- Every control is a native button, link or form field, or follows an ARIA pattern: switches,
  Settings' tabs (arrow keys, Home, End, one tab stop), grids exposed as tables.
- "Skip to content" comes first; `:focus-visible` draws a ring on anything without its own.
- Every chart and the site picture have a table for screen readers; site-model anchors can be
  placed by typing coordinates.
- Text meets 4.5:1 contrast in both themes. The layout works down to 1024 px wide; below 1280 px
  Home's panels and the Devices panel narrow.
- The Playwright suite runs axe (WCAG 2 A and AA) on every page and Settings tab in both themes.

## Build

`pnpm --filter @ecomanage/web build` writes a static site to `apps/web/dist`: hashed files under
`assets/`, the decoders, and `index.html`. The production `web` image serves it with nginx (see
[On a server](../deploy/production.md)). In development Vite proxies `/api` to the API and `/cdn`
to object storage.
