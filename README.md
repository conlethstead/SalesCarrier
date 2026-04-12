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

**Required**

| Field | Type | Description |
|-------|------|-------------|
| `reference_number` | string | Load the caller asked about (e.g. `AAA11111`) |

**Optional**

| Field | Type | Description |
|-------|------|-------------|
| `mc_number` | string | Carrier MC number |
| `booking_decision` | `"yes"` \| `"no"` | Whether they agreed to book |
| `decline_reason` | string | If `booking_decision` is `no`, why (e.g. `rate too high`); omit or empty when `yes` |
| `call_duration` | number | Length of call in **seconds** |
| `number_of_counteroffers` | integer | How many times the assistant sent a counteroffer (aliases: `counter_offers`, `numberOfCounterOffers`) |
| `verified` | boolean | Whether MC verification succeeded |
| `carrier_name` | string | Legal name from MC verification (e.g. `B MARRON LOGISTICS LLC`) |
| `sentiment_classification` | string | Assistant label (e.g. `Not interested`) |
| `sentiment_reasoning` | string | Short explanation (stored up to 4000 chars) |
| `occurred_at` | string | ISO 8601 time (defaults to server time) |

`booking_decision` is case-insensitive (`Yes` / `no` OK). `call_duration` and **`number_of_counteroffers`** may be sent as strings from some workflows.

**Counteroffers:** send **`number_of_counteroffers`** (snake_case). If your HTTP builder only allows camelCase, use **`numberOfCounterOffers`**; if it uses another snake name, **`counter_offers`** is accepted too. All map to the same field.

**All-string JSON:** Many workflow tools send **every value as a string** (e.g. `"420"`, `"true"`, `"no"`). That is supported: numbers are parsed, **`verified`** accepts `"true"` / `"false"` / `"yes"` / `"no"` / `"1"` / `"0"`, and **`booking_decision`** accepts `"yes"` / `"no"` case-insensitively.

Example:

```json
{
  "reference_number": "AAA11111",
  "mc_number": "123456",
  "booking_decision": "no",
  "decline_reason": "not interested",
  "call_duration": 420,
  "number_of_counteroffers": 2,
  "verified": true,
  "carrier_name": "B MARRON LOGISTICS LLC",
  "sentiment_classification": "Not interested",
  "sentiment_reasoning": "No transcript by default."
}
```

Older **legacy** rows (with `call_id`, `outcome`, `sentiment`) already stored in `events.json` are still summarized for charts.

Events are appended to `data/events.json` (configurable via `DATA_DIR`).

### Example: send an event (local HTTP)

```bash
curl -sS -X POST http://127.0.0.1:3001/api/events \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"reference_number":"AAA11111","mc_number":"123456","booking_decision":"yes","call_duration":120,"number_of_counteroffers":1,"verified":true}'
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
