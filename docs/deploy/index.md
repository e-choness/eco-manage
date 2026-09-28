# Running EcoManage

EcoManage is a set of long-running services around MongoDB, Redis, an MQTT broker and object
storage, all in containers. There are three ways to run it:

| | For | Where | Guide |
| --- | --- | --- | --- |
| **Development stack** | Trying it, developing | Your computer, with Docker | [Try the demo](../guide/getting-started.md), [Development setup](../develop/index.md) |
| **One server** | A demo or a small installation | Any Linux server with Docker, behind HTTPS | [On a server](./production.md) |
| **Oracle Cloud Always Free** | A demo that costs nothing | One Arm instance, behind a Cloudflare Tunnel | [On Oracle Cloud](./oracle.md) |

Other free hosts, and why most don't fit, are compared in
[Hosting a demo for free](./demo-hosting.md).

## What runs

| Service | Does | Talks to |
| ------- | ---- | -------- |
| **web** | Serves the web app, and passes `/api` and `/cdn/models` through | api, object storage |
| **api** | The REST API and the live stream; claims gateways | MongoDB, Redis, broker, object storage, language models (optional) |
| **ingest** | Stores every reading, keeps device status, builds the 15-minute intervals | broker, MongoDB, Redis |
| **rules** | Opens and closes alerts, proposes recommendations, sends and undoes commands | MongoDB, Redis, broker |
| **worker** | Prices intervals, computes bills and savings, sends email, renders reports and statements, converts 3D uploads, issues forecasts | MongoDB, Redis, SMTP, Gotenberg, model converter, object storage, weather (optional) |
| **simulator** | A simulated site that behaves exactly like a gateway (demo only) | broker |
| **modelconv** | Converts uploaded 3D models, in a sandbox | the worker only |
| **gotenberg** | Prints report PDFs from HTML | the worker only |
| **mongodb, redis** | Data, and the live-data cache, events and job queues | |
| **mosquitto** | The MQTT broker: TLS with a client certificate per service and per gateway | gateways, services |
| **objects** | S3-compatible storage for 3D models (any S3 store works) | |
| **mailpit** | Catches email instead of sending it (development and demos) | |

How they fit together is in [Architecture](../develop/architecture.md).

## Requirements

- **Docker** with Compose v2.
- **Memory:** about 1 GB for the whole stack at rest, plus up to 2 GB while a 3D model is being
  converted. 4 GB of RAM (with some swap) is enough for a demo; give real sites more for MongoDB.
- **CPU:** amd64 or arm64. Every image is built for both.
- **Disk:** a few GB. Readings are kept for 13 months; the 15-minute intervals, bills and the rest
  are kept for good.
- **Network:** HTTPS in front of the web service. Gateways connect to the broker on port 8883
  (TLS), so it must be reachable from sites with real gateways; a demo on the simulator needs no
  open ports at all.
- **Email:** an SMTP server to send invitations, alerts and reports (or Mailpit to keep them).

## Next

1. [On a server](./production.md) or [On Oracle Cloud](./oracle.md) to get it running.
2. [Configuration](./configuration.md) for every setting.
3. [Security](./security.md) before real sites and people use it.
4. [Installing a gateway](./gateway.md) for a real site.
5. [Operations](./operations.md): backups, updates and monitoring.
