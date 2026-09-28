# Configuration

Every service reads its settings from environment variables and checks them at start. The API
exits with `Invalid environment: <fields>` if one is missing or malformed.

- **Development:** the compose file sets the services' variables; the API also reads
  `apps/api/.env.example` and then `apps/api/.env` (gitignored) for your own values and secrets.
- **Deployment:** `infra/deploy/.env` (from `.env.example`) holds everything you set; the compose
  file passes it to the services and fills in the addresses between them.

## The deployment's `.env`

| Variable | Needed | What it is |
| -------- | ------ | ---------- |
| `PUBLIC_URL` | yes | The address people type, without a trailing slash, e.g. `https://demo.example.com`. Used for CORS and for links in emails |
| `JWT_SECRET`, `REFRESH_TOKEN_SECRET` | yes | Signing keys for access and refresh tokens. Different, long and random (`openssl rand -hex 32`) |
| `SECRETS_KEY` | yes | Seals secrets the API keeps (a site's own language-model key). Changing it forgets them |
| `S3_SECRET_KEY` | yes | The object store's secret key |
| `TUNNEL_TOKEN` | for a named tunnel | The Cloudflare Tunnel token (profile `tunnel`) |
| `IMAGE_PREFIX`, `IMAGE_TAG` | no | Images to run; default `ghcr.io/e-choness/eco-manage` and `main` |
| `SMTP_URL`, `MAIL_FROM` | no | Real email; without them every email stays in Mailpit |
| `WEATHER_PROVIDER` | no | `simulated` (default) or `open-meteo` |
| `SIM_SPEED`, `SIM_SEED` | no | The simulated site (demo) |
| `MQTT_PORT` | no | `8883` opens the broker to gateways; by default it's local only |
| `MQTT_SERVER_SAN` | no | Extra names on the broker's certificate, e.g. `DNS:mqtt.example.com` or `IP:203.0.113.7` |
| `LLM_*`, `LLM_SITE_MONTHLY_TOKENS` | no | A default language model for [explanations](#language-models) |
| `LOG_LEVEL` | no | `info` by default |

## API

| Variable | Default | Notes |
| -------- | ------- | ----- |
| `DATABASE_URL` | required | MongoDB connection string |
| `JWT_SECRET` | required | Access-token signing key |
| `REFRESH_TOKEN_SECRET` | required | Refresh-token signing key, different from the above |
| `NODE_ENV` | `development` | `production` makes the refresh cookie `Secure` |
| `PORT` | `3000` | |
| `CORS_ORIGINS` | empty | Comma-separated browser origins allowed to call the API with credentials. Same-origin requests don't need it |
| `REDIS_URL` | — | Rate limits, the live stream and the job queues. Without it rate limits are per process, and the live view, exports, reports and invitations are unavailable |
| `RATE_LIMIT_WINDOW_MS` | `60000` | |
| `RATE_LIMIT_MAX` | `300` | Requests per visitor per window on `/api` |
| `AUTH_RATE_LIMIT_MAX` | `10` | Per visitor per window on sign-in, refresh and invite links |
| `MQTT_URL` | — | The broker (`mqtts://…`). Without it, gateway settings wait and gateways can't be claimed |
| `MQTT_CERT_DIR` | `/repo/infra/mosquitto/certs` | `ca.crt`, `svc-api.crt` and `svc-api.key` |
| `MQTT_CA_KEY` | `MQTT_CERT_DIR/ca.key` | The CA's private key, which signs claimed gateways' certificates. Without it a claim waits |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | — | Object storage for 3D uploads (any S3-compatible store; region `us-east-1` by default). Without them uploads are off |
| `ASSET_PUBLIC_URL` | `/cdn` | Where browsers load processed models from: a CDN, or `/cdn` served by the web service |
| `OVERPASS_URL` | `https://overpass-api.de/api/interpreter` | Building outlines from OpenStreetMap; empty turns the lookup off. Heavy use needs your own Overpass instance |
| `SECRETS_KEY` | — | At least 16 characters. Without it owners can't save their own model key |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent` |

### Language models

Explanations are optional. A site's owner can plug in their own model in Settings; these set the
server's default for every site without one.

| Variable | Default | Notes |
| -------- | ------- | ----- |
| `LLM_PROVIDER` | from the keys | `openai-compatible` or `anthropic` |
| `LLM_BASE_URL` | — | For an OpenAI-compatible API: its base URL, e.g. `https://api.openai.com/v1` or `https://openrouter.ai/api/v1` |
| `LLM_API_KEY` | — | The key. For Anthropic, `ANTHROPIC_API_KEY` works too |
| `LLM_MODEL` | `claude-opus-5` for Anthropic | Required for OpenAI-compatible APIs |
| `LLM_SITE_MONTHLY_TOKENS` | `200000` | Tokens each site may use per month on the server's default |
| `LLM_ALLOW_PRIVATE_URLS` | `false` | Let owners use `http://` or private addresses (a model on their own network). Only where site owners are trusted |

## Ingest

| Variable | Default | Notes |
| -------- | ------- | ----- |
| `DATABASE_URL`, `REDIS_URL` | required | |
| `MQTT_URL` | `mqtts://mosquitto:8883` | |
| `MQTT_CERT_DIR` | `/repo/infra/mosquitto/certs` | `ca.crt`, `svc-ingest.crt`, `svc-ingest.key` |
| `LOG_LEVEL` | `info` | |

## Rules

| Variable | Default | Notes |
| -------- | ------- | ----- |
| `DATABASE_URL`, `REDIS_URL` | required | |
| `MQTT_URL` | — | Needed to send commands |
| `MQTT_CERT_DIR` | `/repo/infra/mosquitto/certs` | `ca.crt`, `svc-rules.crt`, `svc-rules.key` |
| `RULES_TICK_MS` | `2000` | Shortest gap between two evaluations of one site after new readings |
| `RULES_SWEEP_MS` | `15000` | How often every site is evaluated regardless |
| `LOG_LEVEL` | `info` | |

## Worker

| Variable | Default | Notes |
| -------- | ------- | ----- |
| `DATABASE_URL`, `REDIS_URL` | required | |
| `APP_URL` | `http://localhost:5173` | The web app's address, for links in emails |
| `SMTP_URL` | `smtp://mailpit:1025` | e.g. `smtps://user:password@smtp.example.com:465` |
| `MAIL_FROM` | `EcoManage <alerts@ecomanage.local>` | |
| `GOTENBERG_URL` | `http://gotenberg:3000` | Prints report PDFs |
| `MODELCONV_URL` | `http://modelconv:3100` | The 3D model converter |
| `S3_*`, `ASSET_PUBLIC_URL` | — | As for the API |
| `WEATHER_PROVIDER` | `simulated` | `open-meteo` for real weather |
| `WEATHER_SEED` | `42` | The simulated weather's seed: the simulator's `SIM_SEED`, so the demo site is forecast from its own weather |
| `COST_EVERY_MS` | `60000` | How often new intervals are priced |
| `EMAIL_EVERY_MS` | `30000` | How often alert, summary and proposal emails are sent |
| `FORECAST_EVERY_MS` | `3600000` | How often forecasts are issued |
| `REPORT_SWEEP_MS` | `300000` | How often report schedules are checked |
| `LOG_LEVEL` | `info` | |

## Simulator

| Variable | Default | Notes |
| -------- | ------- | ----- |
| `SITE_ID` | the demo site | |
| `SIM_SPEED` | `1` | 1 is real time; up to 60 |
| `SIM_SEED` | `42` | The same seed gives the same weather, loads and sessions |
| `SIM_START` | now | Simulated start time (ISO) |
| `SIM_HTTP_PORT` | `4100` | The control API |
| `SIM_STATE_FILE` | none | Where counters and the battery's charge survive restarts |
| `MQTT_URL`, `MQTT_CERT_DIR` | `mqtts://mosquitto:8883`, `/repo/infra/mosquitto/certs` | Uses the site's gateway certificate `gw-<siteId>` |

## 3D model converter

| Variable | Default | Notes |
| -------- | ------- | ----- |
| `PORT` | `3100` | |
| `CONVERT_TIMEOUT_MS` | `240000` | Longest time for one conversion |
| `TOOL_TIMEOUT_MS` | `120000` | Longest time for one tool (assimp, IfcOpenShell, toktx) |
| `KTX2` | on | `off` skips texture compression |

## Gateway agent

The gateway reads a JSON file rather than environment variables; see
[Installing a gateway](./gateway.md#configuration). `GATEWAY_CONFIG` (default
`/etc/ecomanage/gateway.json`) and `GATEWAY_FACTORY` point at its files, and `LOG_LEVEL` sets its
logging.

## Web app

The web app has no runtime settings: it calls `/api` on its own origin. One build-time switch:
`VITE_DEMO=true` (the default in the production image) shows the demo account on the sign-in page.
