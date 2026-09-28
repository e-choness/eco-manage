# On a server

Everything needed to run EcoManage on one Linux server is in
[`infra/deploy/`](https://github.com/e-choness/eco-manage/tree/main/infra/deploy):

| File | What it is |
| ---- | ---------- |
| `compose.yml` | The stack with production images: nothing listens on the server's public address except, optionally, the MQTT broker for gateways |
| `.env.example` | The settings to copy to `.env` and fill in |
| `nginx.conf` | The web image's configuration: the app, `/api` (with the live stream unbuffered) and `/cdn/models` on one origin |
| `setup.sh` | Sets up an Ubuntu server from scratch (used by the [Oracle guide](./oracle.md), and works on any Ubuntu host) |

As shipped it runs the demo (the simulated school, reset nightly by `setup.sh`). For a real site,
see [From demo to real sites](#from-demo-to-real-sites) below.

## Images

Three images, for amd64 and arm64, published to GitHub Container Registry by
`.github/workflows/images.yml` on every change to `main`:

| Image | Built from | Runs |
| ----- | ---------- | ---- |
| `ghcr.io/e-choness/eco-manage/app` | `Dockerfile`, target `app` | api, ingest, rules, worker, simulator, the seed and the bucket setup: one image, a service per container, as a non-root user |
| `ghcr.io/e-choness/eco-manage/web` | `Dockerfile`, target `web` | nginx with the built web app |
| `ghcr.io/e-choness/eco-manage/modelconv` | `apps/modelconv/Dockerfile` | The 3D model converter sandbox |

They're tagged `main` and `sha-<commit>`. Set `IMAGE_TAG=sha-<commit>` in `.env` to pin a version,
or `IMAGE_PREFIX` to use your own registry. `docker compose … up -d --build` builds them on the
server instead. New GHCR packages are private: make them public in the package settings, or
`docker login ghcr.io` on the server.

## Step by step

With Docker installed and the repository cloned:

```bash
cd infra/deploy
cp .env.example .env
# fill in PUBLIC_URL and the secrets: openssl rand -hex 32 for each
chmod 600 .env
docker compose -f compose.yml pull           # or: up -d --build to build here
docker compose -f compose.yml up -d
docker compose -f compose.yml run --rm seed  # the demo site and accounts
```

Then put HTTPS in front of the web service (next section) and open `PUBLIC_URL`.

`setup.sh` does all of this on Ubuntu, including installing Docker, generating the secrets, adding
swap on small machines and scheduling the nightly reset:

```bash
curl -fsSL https://raw.githubusercontent.com/e-choness/eco-manage/main/infra/deploy/setup.sh \
  | sudo PUBLIC_URL=https://demo.example.com TUNNEL_TOKEN=<token> sh
```

## HTTPS

The web service listens on port 80 inside the stack, and on `127.0.0.1:8080` on the server for
checks. Put one of these in front:

- **Cloudflare Tunnel** (built in). Profile `tunnel` with `TUNNEL_TOKEN` for a named tunnel on your
  own hostname; its public hostname points at `http://web:80`. Profile `quick-tunnel` for a
  throwaway `trycloudflare.com` address. No ports are opened.
- **Your own reverse proxy** (Caddy, nginx, Traefik, a load balancer) proxying to
  `127.0.0.1:8080` or to `web:80` on the compose network. Disable response buffering for
  `/api/site/stream` (a long-lived server-sent events stream) and allow uploads of 32 MB.

Either way:

- `PUBLIC_URL` must be the address people type: it's used for CORS and for links in emails.
- The API is served under the same origin as the app. The refresh cookie is `Secure` in
  production, so the site must be on HTTPS for sessions to survive a reload.
- nginx takes the visitor's address from `CF-Connecting-IP` when the request comes through a
  trusted proxy on the Docker network, and passes it on, so rate limits apply per visitor. With
  your own proxy in front, have it set `CF-Connecting-IP` too, or adjust `real_ip_header` in
  `nginx.conf` to the header it sets.

## From demo to real sites

The deploy stack runs the demo. For real sites:

1. **Drop the demo:** stop the simulator (`docker compose -f compose.yml stop simulator`, and
   remove it from `compose.yml`), don't run the seed, and remove `/etc/cron.d/ecomanage-demo` if
   `setup.sh` made it. Create the first owner account and site with the
   [migration script](./operations.md#the-first-site-and-owner).
2. **Send real email:** set `SMTP_URL` and `MAIL_FROM`.
3. **Open the broker to gateways:** set `MQTT_PORT=8883` and `MQTT_SERVER_SAN` to the name
   gateways use, open TCP 8883 in the firewall, and follow
   [Installing a gateway](./gateway.md).
4. **Use real weather:** `WEATHER_PROVIDER=open-meteo`.
5. **Back up** MongoDB, the broker's CA and `.env` ([Operations](./operations.md#backups)).
6. **Read [Security](./security.md)**, in particular the CA key and `SECRETS_KEY`.
