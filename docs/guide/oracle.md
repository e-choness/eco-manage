# Hosting the demo on Oracle Cloud

The whole stack runs on one of Oracle Cloud's Always Free Arm instances, with the simulated Maple
Grove School feeding it, and a Cloudflare Tunnel giving it an HTTPS address without opening any
ports. Everything is in [`infra/deploy/`](https://github.com/e-choness/eco-manage/tree/main/infra/deploy):
a compose file with production images, the server's settings, and a setup script. Expect about
half an hour, most of it in Oracle's console.

Checked against Oracle's documentation on 28 September 2026. Oracle changes the free tier without
much notice (see the A1 change below), so check the [Always Free resources][free] page before you
rely on a number here.

## What Oracle gives you

| Resource | Always Free |
| -------- | ----------- |
| **Ampere A1** (`VM.Standard.A1.Flex`, Arm) | 1,500 OCPU hours and 9,000 GB hours a month: **2 OCPUs and 12 GB of memory** in total, as one instance or two of 1 OCPU each |
| AMD micro (`VM.Standard.E2.1.Micro`) | Up to two, each 1/8 OCPU and 1 GB of memory: too small for this stack |
| Block storage | 200 GB in total for boot and block volumes (a boot volume is at least 47 GB, 50 GB by default), five backups |
| Outbound data | 10 TB a month |
| Where | Your **home region** only, chosen at sign-up and not changeable |

The A1 allowance was **halved on 15 June 2026**, from 4 OCPUs and 24 GB. Oracle updated the
documentation without an announcement and emailed Always Free users that A1 instances above the
new limit **on or after 18 August 2026 would be terminated** ([InfoQ][infoq]). Oracle's Free Tier
page says the same for trials: with more A1 capacity than an Always Free tenancy allows, "all
existing OCI Ampere A1 Compute instances are disabled and then deleted after 30 days, unless you
upgrade to a paid account" ([Free Tier][freetier]).

On the [shape][shapes], an A1 OCPU is one core of an Ampere Altra, with 1 Gbps of network
bandwidth per OCPU. Everything in the stack has arm64 images, including the model converter's
tools (KTX-Software and IfcOpenShell ship arm64 builds), so every feature works.

Sign-up needs a card for verification. Popular regions often answer
"out of host capacity" when you create an A1 instance. Oracle's advice is to try another
availability domain or try again later ([Always Free resources][free]).

## Idle instances are reclaimed

This is the rule that matters for a demo. From Oracle's [Always Free resources][free] page:

> Idle Always Free compute instances may be reclaimed by Oracle. Oracle will deem virtual machine
> and bare metal compute instances as idle if, during a 7-day period, the following are true:
>
> - CPU utilization for the 95th percentile is less than 20%
> - Network utilization is less than 20%
> - Memory utilization is less than 20% (applies to A1 shapes only)

An instance counts as idle only when **all three** are below 20% for the week. A demo nobody
visits is nearly idle. Measured on the production stack at rest, all services together use about
**0.9 GB of memory and 2% of one core**, and the network carries only the simulator's readings
inside the machine. Plus the operating system (roughly 0.4 GB), that is:

| Instance | Memory at rest | Idle by Oracle's rule? |
| -------- | -------------- | ---------------------- |
| 2 OCPUs, 12 GB (the whole allowance) | about 11% | **Yes**, in a quiet week |
| 1 OCPU, 6 GB | about 22% | Borderline |
| 1 OCPU, 4 GB (plus the 2 GB swap setup.sh adds) | about 33% | No, memory stays above 20% |

The documentation doesn't say whether the rule applies to paid tenancies, and it gives no
notice period. Two ways to stay safe:

- **Upgrade the tenancy to Pay As You Go** (Oracle's own suggestion on that page). Always Free
  resources stay free: "all tenancies get the first 1,500 OCPU hours and 9,000 GB hours per month
  for free" on A1 ([Always Free resources][free]), and "there is no interruption to the
  availability of the Always Free Resources you have provisioned" ([Free Tier][freetier]). You then
  pay only for anything beyond the free amounts, so set a budget alert at a few dollars
  (Billing & Cost Management → Budgets). This is the choice for a demo you want to leave running.
- **Stay on Always Free with a 1 OCPU / 4 GB instance**, sized so the stack itself keeps memory
  above 20%. Watch the instance's **Metrics** (CPU, memory and network charts on its page in the
  console) during the first week: Oracle doesn't say how it measures memory, so the table above is
  an estimate. The other 1 OCPU and 8 GB stay free for something else.

## What runs

| Service | Image | Notes |
| ------- | ----- | ----- |
| web | `ghcr.io/e-choness/eco-manage/web` | nginx: the built web app, `/api` and `/cdn/models` behind it, live stream unbuffered |
| api, ingest, rules, worker, simulator | `ghcr.io/e-choness/eco-manage/app` | One image, a service per container, all non-root |
| modelconv | `ghcr.io/e-choness/eco-manage/modelconv` | The same read-only sandbox as in development, on an internal network |
| MongoDB 8, Redis 8, Mosquitto, RustFS, Gotenberg, Mailpit | Upstream images | MongoDB's cache capped at 1 GB |
| tunnel | `cloudflare/cloudflared` | Outbound only; the only way in |

Nothing listens on the server's public address. The web app (port 8080) and Mailpit (8025) are
bound to `127.0.0.1` for checks over SSH, and the broker stays local unless you open it for real
gateways. Emails stay in Mailpit unless `SMTP_URL` points at a real server. The demo data is reset
every night at 04:15 (server time, UTC on Oracle's images), so visitors' changes don't pile up.

## 1. Create the instance

1. Sign up at [oracle.com/cloud/free](https://www.oracle.com/cloud/free/) and pick your **home
   region** with care. Always Free compute exists only there.
2. **Compute → Instances → Create instance.**
3. **Image:** Canonical Ubuntu 24.04 (the Arm build is picked for an A1 shape).
4. **Shape:** Change shape → Ampere → `VM.Standard.A1.Flex`, then 2 OCPUs and 12 GB (on Pay As
   You Go), or 1 OCPU and 4 GB (staying on Always Free, as above).
5. **Networking:** the default new VCN with a public subnet and a public IPv4 address (for SSH).
6. **SSH keys:** paste your public key.
7. **Boot volume:** the default 50 GB is plenty.
8. Create. If you get "out of host capacity", try another availability domain or try again later.

## 2. Make a Cloudflare Tunnel

The tunnel gives the demo an HTTPS address and needs no open ports. Pick one:

- **Your own hostname (stable).** Needs a domain on Cloudflare (free plan is fine). In the
  Cloudflare dashboard, **Networking → Tunnels → Create a tunnel** ([Cloudflare][tunnel]), choose
  cloudflared, and copy the **token** from the install command. Then **Routes → Add route →
  Published application**: your subdomain and domain, service URL **`http://web:80`**.
- **A quick tunnel (for trying it out).** No account or domain. You get a random
  `https://….trycloudflare.com` address that changes whenever the tunnel restarts.

## 3. Run the setup script

SSH in (`ssh ubuntu@<public IP>`) and run:

```bash
curl -fsSL https://raw.githubusercontent.com/e-choness/eco-manage/main/infra/deploy/setup.sh \
  | sudo PUBLIC_URL=https://demo.example.com TUNNEL_TOKEN=<token> sh
```

Leave out `TUNNEL_TOKEN` for a quick tunnel; the script prints its address at the end. It:

1. adds 2 GB of swap on an instance under 8 GB;
2. installs Docker;
3. clones the repository into `/opt/ecomanage`;
4. writes `infra/deploy/.env` with new secrets (from `.env.example`; mode 600);
5. pulls the images, or builds them on the server if it can't;
6. starts everything, loads the demo site and accounts, and schedules the nightly reset.

Run it again to update: it keeps `.env` and the data.

## 4. Check it

Open your address and sign in as `manager@ecomanage.io` with `Demo1234!`. The sign-in page of a
demo build shows the demo account. Home should show power moving within a few seconds.

```bash
cd /opt/ecomanage/infra/deploy
sudo docker compose -f compose.yml ps               # everything Up, the api and web healthy
sudo docker compose -f compose.yml logs -f api      # or any other service
```

Emails the demo sends (invitations, alerts, reports) are in Mailpit. Reach it through SSH:
`ssh -L 8025:localhost:8025 ubuntu@<public IP>`, then open http://localhost:8025.

## Images

`.github/workflows/images.yml` builds the three images for amd64 and arm64 on every push to
`main` that touches the code, and pushes them to GitHub Container Registry, tagged `main` and
`sha-<commit>`. GHCR makes new packages private. Either make the three packages public (the
package's settings → Change visibility), or run `sudo docker login ghcr.io` on the server with a
token that can read packages. To pin a version, set `IMAGE_TAG=sha-<commit>` in `.env`.

Without the registry, setup.sh builds the images on the server (`docker compose … up -d
--build`). That takes a while on 1–2 OCPUs.

## Real gateways (optional)

The demo runs on the simulator, but a real [gateway](../GATEWAY.md) can connect too. It needs the
broker on the internet:

1. In `.env`: `MQTT_PORT=8883` and `MQTT_SERVER_SAN=DNS:<the name gateways use>` (or
   `IP:<public IP>`).
2. In Oracle's console, add an ingress rule for TCP 8883 to the subnet's security list.
3. The broker certificate was made before the name was set, so remove it, let the stack make a
   new one, and restart the broker:

   ```bash
   cd /opt/ecomanage/infra/deploy
   sudo docker compose -f compose.yml run --rm --entrypoint sh mqtt-certs -c 'rm /certs/server.*'
   sudo docker compose -f compose.yml up -d && sudo docker compose -f compose.yml restart mosquitto
   ```

4. Register and claim the gateway as in [Gateway agent](../GATEWAY.md). The CA the server made is
   in the `mqtt_certs` volume.

## Upkeep

- **Security updates:** Ubuntu installs them automatically (unattended-upgrades). Reboot now and
  then (`sudo reboot`); the stack starts again on its own.
- **Updates to EcoManage:** run setup.sh again, or `sudo docker compose -f compose.yml pull &&
  sudo docker compose -f compose.yml up -d`.
- **Backups:** the nightly reset makes them unnecessary for the demo. To keep real data instead,
  remove `/etc/cron.d/ecomanage-demo` and back up the `mongo_data` volume (`mongodump`) and
  `infra/deploy/.env`.

## Sources

- [Always Free resources (Oracle)][free]: A1 and micro allowances, storage, data transfer,
  idle reclamation, out-of-capacity advice
- [Free Tier (Oracle)][freetier]: upgrading, the end of the trial, A1 capacity above the limit,
  home region
- [Compute shapes (Oracle)][shapes]: `VM.Standard.A1.Flex` and `VM.Standard.E2.1.Micro`
- [Oracle halves the Always Free Ampere A1 limits (InfoQ, July 2026)][infoq]
- [Create a tunnel (Cloudflare)][tunnel] · [Tunnel run parameters][tunnel-run]

[free]: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
[freetier]: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm
[shapes]: https://docs.oracle.com/en-us/iaas/Content/Compute/References/computeshapes.htm
[infoq]: https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/
[tunnel]: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/
[tunnel-run]: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/
