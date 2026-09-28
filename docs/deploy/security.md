# Security

EcoManage can change how real equipment behaves, so its design starts from two rules: **nothing
reaches a device until a person approves it**, and **the gateway enforces the device's safety
limits itself**, whatever the cloud sends. This page covers what protects what, and what you must
look after when you run it.

## People and sessions

- **Invite-only.** There is no sign-up. Invite links hold 32 random bytes, work once, expire after
  7 days, and only their SHA-256 hash is stored; the plain token exists only in the email.
- **Passwords** are hashed with bcrypt and never returned by the API.
- **Sessions:** a short access token (1 day) kept in the browser's memory only, and a refresh token
  (30 days) in an `HttpOnly`, `SameSite=Strict` cookie limited to `/api/auth`, `Secure` in
  production. Each refresh rotates it; an old one is refused; signing out revokes it.
- **Roles** are checked by the server on every request, for the site named in the request. Expired
  access counts as none. See [Roles and access](../guide/roles.md).
- **Rate limits** per visitor: 300 requests a minute on the API, and 10 a minute on sign-in,
  refresh and invite links. Counters live in Redis, so they hold across API instances.
- **Headers:** helmet's defaults on the API; `nosniff` and a strict referrer policy on the web app.
  CORS allows credentials only for the origins in `CORS_ORIGINS`.
- **Provisioning** from the command line or a directory export never handles passwords: new people
  get an invite and choose their own. Its changes are audited as system changes.
- **Audit log:** every change to a site records who, when, and the values before and after. Tests
  fail if a new write endpoint isn't audited.
- **Logs** never contain passwords, tokens, cookies or request bodies.

## Devices and gateways

- **MQTT over TLS only,** with a client certificate for every service and every gateway. The
  certificate's name is the MQTT user, and the broker's access list gives each exactly the topics
  it needs: ingest reads readings, the rules service may only send commands, a gateway may only use
  its own site's topics (`site/<its site>/#`).
- **Claiming:** a new gateway connects with a shared bootstrap certificate that only lets it ask
  for its own certificate. The request carries a proof (an HMAC keyed by its claim code), so
  another box can't ask in its name, and the answer is useless without the private key that never
  leaves the gateway. Claim codes are stored only as hashes and work once.
- **Commands** carry an expiry and an end time. The gateway refuses expired commands and values
  outside the profile's limits, never takes the battery below the site's floor, ends every command
  on time on its own, and undoes everything the cloud set after 15 minutes without a connection.
- **Approval:** the checks run again at the moment of approval, against the site as it is then;
  the rules service only proposes.

## Data the server keeps secret

- **A site's own language-model key** is sealed with AES-256-GCM under `SECRETS_KEY`, shown only as
  its last four characters, and never logged or audited.
- **Report links** work without signing in for 30 days; only a hash of their token is stored, and
  request logs leave the token out.

## Untrusted input

- **3D uploads** are checked by type and signature, then converted in a separate container with no
  database, Redis, storage or internet access: a read-only file system, a non-root user, no
  capabilities, capped memory, CPU and processes, and a network shared only with the worker. Each
  conversion runs in its own thread with a time limit.
- **Report PDFs** are printed by Chromium (Gotenberg) with JavaScript off and only its own
  temporary files readable.
- **Utility bills** are read as text (PDF or CSV); nothing in them is run.
- **Language models:** only the recommendation's numbers are sent; names and anything people typed
  are left out or replaced. Because the server calls the URL an owner gives, it must be `https://`
  to a public address (no localhost, private or link-local addresses, bare service names or
  credentials in the URL), and redirects aren't followed, unless `LLM_ALLOW_PRIVATE_URLS` is on.

## What you must look after

| Secret | Why it matters | Where |
| ------ | -------------- | ----- |
| `JWT_SECRET`, `REFRESH_TOKEN_SECRET` | Anyone with them can sign in as anyone | `.env` |
| `SECRETS_KEY` | Unseals site owners' model keys. Changing it forgets them | `.env` |
| **The broker's CA key** (`ca.key`) | Signs gateway certificates: anyone with it can pose as any site's gateway | `mqtt_certs` volume, or `MQTT_CA_KEY` |
| `S3_SECRET_KEY` | Access to uploaded models | `.env` |
| `TUNNEL_TOKEN` | Runs your tunnel | `.env` |

- Keep `.env` readable by root only (`chmod 600`, as `setup.sh` does), and back it up with the CA.
- The CA key is needed only by the API. In a larger installation, keep it on the API's host alone
  and point `MQTT_CA_KEY` at it.
- The development certificates in `infra/mosquitto/certs` are for development only, and are never
  copied into images; a deployment makes its own on first start.
- Put HTTPS in front of the web service, with `NODE_ENV=production` (the deploy stack sets it).
- Open the broker's port only if real gateways connect, and only port 8883.

## Known gaps

- Certificates of gateways that are lost or replaced can't be revoked yet (the broker has no
  revocation list). Until then, a lost gateway's site certificate stays valid until it expires.
- The demo's accounts have a published password. Never run the demo seed on an installation with
  real people or sites.
