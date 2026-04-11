# Inbound carrier sales — metrics dashboard

React + TypeScript UI and a small **Express** API that **ingests** call outcome events (from your HappyRobot workflow or any HTTP client) and serves **aggregated metrics** for the FDE technical challenge dashboard requirement.

## API

**Production:** Use **HTTPS only** (`https://…`) for the dashboard and for workflow calls to **`POST /api/events`**. The reverse proxy (e.g. Caddy in `docker-compose.prod.yml`) terminates TLS, redirects HTTP→HTTPS, and sends `Strict-Transport-Security`. Plain HTTP to port **3001** is for local/dev only when you run the Node process without a proxy.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/health` | none | Liveness |
| `POST` | `/api/events` | `X-API-Key` | Append one call record |
| `GET` | `/api/summary` | `X-API-Key` | Aggregated KPIs + recent rows |

### Ingest body (`POST /api/events`)

```json
{
  "call_id": "call_01HZ…",
  "occurred_at": "2026-04-10T18:00:00.000Z",
  "outcome": "booked",
  "sentiment": "positive",
  "load_id": "LD-48291",
  "agreed_rate": 1850,
  "listed_rate": 1800,
  "negotiation_rounds": 2,
  "notes": "optional"
}
```

`outcome`: `booked` | `declined` | `no_match` | `failed_verification` | `abandoned` | `negotiated_no_deal`  
`sentiment`: `positive` | `neutral` | `negative`

Events are appended to `data/events.json` (configurable via `DATA_DIR`).

### Example: send an event (local HTTP)

```bash
curl -sS -X POST http://127.0.0.1:3001/api/events \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"call_id":"demo-1","outcome":"booked","sentiment":"positive","load_id":"LD-1","agreed_rate":1900,"negotiation_rounds":1}'
```

**Deployed (HTTPS):** same request with `https://<your-domain>/api/events` (Let’s Encrypt or other TLS).

## Local development

```bash
cd metrics-dashboard
cp .env.example .env
# Set API_KEY and VITE_API_KEY to the same secret
npm install
npm run dev
```

- UI: http://127.0.0.1:5173 (proxies `/api` → `3001`)
- API: http://127.0.0.1:3001

## Production build

Set `VITE_API_KEY` to the same value you will use for `API_KEY` at runtime (the UI embeds it at build time).

```bash
export VITE_API_KEY=your-secret
npm run build
export API_KEY=your-secret
NODE_ENV=production node dist-server/server/index.js
```

Open http://127.0.0.1:3001 — one process serves `dist/` and the API.

## Docker

### Single container (HTTP on 3001)

```bash
docker build -t carrier-metrics --build-arg VITE_API_KEY=your-secret .
docker run --rm -p 3001:3001 -e API_KEY=your-secret carrier-metrics
```

Use the same value for `VITE_API_KEY` at **build** time and `API_KEY` at **run** time so the baked UI can authenticate.

### Production: Docker Compose + Caddy + Let’s Encrypt

Use **`docker-compose.prod.yml`** with **`Caddyfile`**: Caddy terminates TLS and obtains certificates automatically. Set `METRICS_DOMAIN`, `ACME_EMAIL`, `API_KEY`, and `VITE_API_KEY` in `.env` (see `.env.example`).

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

**Google Cloud (Compute Engine VM + Caddy + Let’s Encrypt):** [DEPLOY-GCP.md](./DEPLOY-GCP.md).

**Google Cloud Run (HTTPS `*.run.app`, no domain required):** [DEPLOY-CLOUD-RUN.md](./DEPLOY-CLOUD-RUN.md).

## HTTPS

- **Compose + Caddy:** Let’s Encrypt is handled by Caddy (see above).
- **Other:** Terminate TLS at your load balancer or reverse proxy. The Node app speaks HTTP behind that layer.
