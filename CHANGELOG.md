# Changelog

Notable changes to EcoManage, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- A documentation site (VitePress) covering every feature, setup, the API and operations,
  published to GitHub Pages.
- **Open in GitHub Codespaces:** the full stack, seeded with the demo site, in the browser.
- A guide to hosting a demo for free.
- **Hosting on Oracle Cloud:** production images for amd64 and arm64, published to GitHub
  Container Registry, and a one-command setup that runs the demo on an Always Free Arm server
  behind a Cloudflare Tunnel, reset every night.
- A new app icon: the switchboard with the site's flows, animated at large sizes (the sign-in
  page), with icons for phones and a web app manifest.
- A media kit: a 16:9 banner (animated SVG and PNG, light and dark) beside the wide banner, and an
  animated walkthrough of the app.

### Changed

- The README has a live-flow banner in the app's font, an animated walkthrough, current
  screenshots and status badges.

### Removed

- Unused code, files and dependencies found by an audit; knip now keeps them out in CI.

### Fixed

- `docs/GATEWAY.md` was missing from the repository, so links to it were broken.

## [2.0.0] - 2026-09-28

A rebuild of EcoManage around real devices: live site data, bills from tariffs, safe automated
control with approvals, and an edge gateway.

### Added

- **Live site:** Home shows the site as a 3D scene with power flowing between solar, battery, grid,
  EV chargers, heat pump and the building, with demand against the cap, the bill so far and
  today's prices. A 2D flow diagram replaces the scene on devices without WebGL.
- **Devices:** every device with its status, readings and a 24-hour chart; scan the site's network,
  commission new devices with checks (live read, sign, energy balance), and log maintenance.
- **History:** energy by hour, day or month for any range, totals, and CSV exports by email.
- **Bills:** bills computed from time-of-use and demand tariffs with versions over time, spending
  for any range, savings from solar and the battery, PDF statements, and uploaded utility bills
  compared with the estimate.
- **Recommendations:** rules that propose battery peak shaving, EV off-peak charging, EV limits
  near the demand cap, heat-pump pre-conditioning, storm reserve and export caps at low prices;
  each with inputs, safety checks and the expected saving, approved or declined in the Inbox, then
  carried out, verified and measured the next day.
- **Explanations:** an optional "in plain words" explanation of any recommendation from a
  language model. Owners plug in their own key for any OpenAI-compatible provider (OpenAI,
  OpenRouter, Groq, Mistral, DeepSeek, Together AI, others) or Anthropic, with a monthly token
  budget; only the recommendation's numbers are sent, never names or anything people typed.
- **Alerts:** devices going silent, solar under expectation, battery below reserve, demand near
  the cap, failed or slow commands and gateway backlogs; acknowledged, snoozed, resolved or muted,
  with remote fixes from the device profile and email notifications with escalation.
- **Inbox:** decisions, alerts and active commands in one place, with the full history.
- **Forecasts:** solar and site load for the next 48 hours from the weather.
- **Reports:** scheduled or one-off PDF, CSV and Excel reports, emailed as links.
- **Settings:** site details, solar arrays, battery, tariffs, rules and approvals, the school
  calendar, notification preferences, people and invitations with roles (owner, manager,
  installer) and expiry.
- **Site model:** generate the 3D site from the building's width and depth or its OpenStreetMap
  outline, storeys and roof array; or upload a glTF, GLB, OBJ, FBX or IFC model, converted and
  compressed in a sandbox. Place each device and the switchboard on the model.
- **Gateway:** a reference edge agent for a Raspberry Pi 5 that reads devices over Modbus TCP/RTU
  and OCPP 1.6J, keeps 7 days of readings offline, enforces safety limits on every command, and
  is claimed with the QR code on its label.
- **Audit log** of every change, with who made it and when.
- **Accessibility:** keyboard use throughout, screen-reader labels and a data table beside every
  chart; light and dark themes.
- A simulated site (Maple Grove School) and demo accounts for trying everything without hardware.

### Changed

- EcoManage now runs as a set of services with Docker Compose: API, web app, ingest, rules,
  worker, simulator and model converter, with MongoDB, Redis, an MQTT broker and object storage.
- Sign-in uses short-lived access tokens with refresh cookies; roles are per site.
- The license is now proprietary.

### Removed

- The v1 dashboards and their demo data, replaced by the pages above.

### Security

- Device connections use TLS with a client certificate per gateway, limited to its own site.
- Rate limits on the API and sign-in; secrets are no longer in the repository.

## [1.1.0] - 2026-05-08

### Added

- Detailed energy insights on demand.
- Container files for running the app with Docker.
- Demo seed data, a backend test suite, frontend tests and an end-to-end suite.

### Fixed

- Blank dashboards, alert badge counts, alert filters and the favicon.
- Production data and financial board updates.
- Changing a password, and the settings page's information button.
- Deprecated server packages updated; legacy code removed.

## [1.0.0] - 2025-07-28

### Added

- The first EcoManage: energy monitoring, analytics, optimization and financial overview
  dashboards, with sign-in and settings.

[Unreleased]: https://github.com/e-choness/eco-manage/compare/7e90daa...main
[2.0.0]: https://github.com/e-choness/eco-manage/pull/70
[1.1.0]: https://github.com/e-choness/eco-manage/pull/13
[1.0.0]: https://github.com/e-choness/eco-manage/pull/1
