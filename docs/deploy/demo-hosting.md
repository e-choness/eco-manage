# Hosting a demo for free

EcoManage is a set of long-running services (API, web, ingest, rules, worker, simulator, the
model converter) around MongoDB, Redis, an MQTT broker and object storage. The simulator, ingest
and rules service keep MQTT connections open all the time, and Home streams live values. That
rules out hosts that sleep when idle or bill per request. These are the free routes that work,
as of September 2026.

## At a glance

| Option | What people get | Always on | Cost to you | Effort |
| ------ | --------------- | --------- | ----------- | ------ |
| **GitHub Codespaces** (set up) | The real stack, seeded, in their own browser tab | While they use it | Nothing (their free hours) | Done: `.devcontainer/` |
| **Oracle Cloud Always Free VM + Cloudflare Tunnel** | The real stack at a public HTTPS address | Yes | Nothing (a card is needed to sign up) | Ready: [the guide](./oracle.md) and `infra/deploy/` |
| **Static demo on GitHub Pages** | The web app with an in-browser simulated site | Yes | Nothing | Several days: a browser-side stand-in for the API |
| Render, Cloud Run, Koyeb, Fly.io, Hugging Face Spaces | — | — | — | Not a fit (below) |

## GitHub Codespaces (ready)

The repository has a dev container (`.devcontainer/devcontainer.json`) that builds the compose
stack, seeds the demo site and opens the app. Anyone with a GitHub account opens it from the
**Open in GitHub Codespaces** button in the README, and it runs on *their* free allowance:
120 core-hours a month on a personal account, so about 30 hours on the 4-core machine the stack
needs. The first start builds the images and takes a few minutes; later starts resume. Sign in as
`manager@ecomanage.io` / `Demo1234!`. Emails the demo sends are in Mailpit on port 8025.

Good for reviewers and anyone who wants to try every feature, including the gateway profile. Not
a link you can paste into a slide: each visitor gets their own copy.

## Oracle Cloud Always Free + Cloudflare Tunnel (ready)

One Always Free Arm instance runs the whole stack from production images (`infra/deploy/`), and a
Cloudflare Tunnel gives it an HTTPS address without opening ports. **[Hosting the demo on Oracle
Cloud](./oracle.md)** walks through it; a setup script does the server side.

- **Oracle Cloud Always Free:** Ampere A1 capacity was halved in June 2026 to **2 OCPUs and
  12 GB** in total, enforced from 18 August 2026. The stack uses about 0.9 GB at rest, so it fits
  easily, and every feature works on Arm, 3D model conversion included. Sign-up needs a card;
  popular regions often report "out of host capacity" when creating A1 instances.
- **Idle reclamation:** Oracle may reclaim an Always Free instance whose CPU, network and memory
  all stay under 20% for a week, which a quiet demo on the full 12 GB would. Upgrade the tenancy
  to Pay As You Go (Always Free resources stay free) or use a smaller instance; the guide has the
  numbers.
- **Cloudflare Tunnel** is free with unmetered bandwidth. A named tunnel on a domain you have on
  Cloudflare gives a stable address; a quick tunnel gives a random `trycloudflare.com` address
  that changes on restart and is meant for testing (200 concurrent requests).
- **Upkeep:** Ubuntu's security updates install themselves, the demo data resets every night, and
  email stays in Mailpit on the server.

## A static demo on GitHub Pages

The web app is a static build; what it needs is an API. The simulator's site engine is plain
TypeScript, so it can run in the browser: a service worker (Mock Service Worker, which the web
tests already use) would answer the API's routes from an in-browser simulated site, with live
values moving on Home. It would sit next to this documentation on GitHub Pages, always on, with no
server, sign-up or waiting. It costs development time: every page's endpoints need a stand-in, and
writes (approving a recommendation, editing settings) would only change the browser's copy.

## Why not the usual free hosts

- **Render (free web services):** sleeps after 15 minutes without HTTP traffic and takes about a
  minute to wake; 512 MB and 0.1 CPU per service; free Postgres expires, and there is no MQTT
  (TCP) ingress. The simulator and ingest would stop whenever the API sleeps.
- **Google Cloud Run:** the always-free tier (2 million requests, 180,000 vCPU-seconds a month)
  suits request-driven services; always-on MQTT consumers would use it up within days.
- **Koyeb:** one free 512 MB instance, and since February 2026 a card with a $29 hold.
- **Fly.io:** no free allowance for new accounts since 2026 (a short trial, then from $5/month).
- **Hugging Face Spaces:** the free CPU hardware (2 vCPU, 16 GB) still exists, but creating a
  Docker Space now needs a paid plan.
- **Managed free tiers for the pieces** don't add up: MongoDB Atlas M0 (512 MB, 100 operations/s)
  would hold the demo, but Upstash Redis's 500,000 commands a month is less than a week of the
  simulator, and HiveMQ Cloud's free MQTT has 100 sessions without the client-certificate setup
  the gateway and services use.

## Recommendation

Keep **Codespaces** for "try the real thing", and add one always-on option for links and slides:
the **static demo on GitHub Pages** if the demo should never need looking after, or the **Oracle
VM** if it should be the real backend (email, reports, gateway, uploads) and someone can keep the
server patched.

## Sources

- [Oracle halves the Always Free Ampere A1 limits (InfoQ, July 2026)](https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/)
- [Cloudflare Tunnel is free, unmetered (July 2026)](https://bex.co/blog/2026/07/28/cloudflare-tunnel-free-zero-open-ports-ingress) · [Cloudflare Tunnel docs](https://developers.cloudflare.com/tunnel/)
- [GitHub Codespaces billing](https://docs.github.com/billing/managing-billing-for-github-codespaces/about-billing-for-github-codespaces)
- [Render: deploy for free](https://render.com/docs/free)
- [Cloud Run pricing](https://cloud.google.com/run/pricing)
- [Koyeb free tier 2026](https://www.srvrlss.io/provider/koyeb/) · [Fly.io after the free tier](https://expresstech.io/7-fly-io-alternatives-in-2026-real-pricing-after-the-free-tier-died/)
- [Hugging Face Spaces overview](https://huggingface.co/docs/hub/en/spaces-overview)
- [MongoDB Atlas free cluster limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/) · [Upstash pricing](https://upstash.com/pricing)
