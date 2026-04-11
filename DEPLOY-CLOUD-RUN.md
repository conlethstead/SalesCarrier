# Deploy on Google Cloud Run

Cloud Run runs your **Docker image**, gives you a **stable HTTPS URL** (`https://….run.app`) with **Google-managed TLS** — no custom domain or Let’s Encrypt setup required for the demo.

### After it’s live (your “base URL”)

Use your Cloud Run **URL** (from the console or `gcloud run services describe --format='value(status.url)'`) as the **HTTPS** base — no trailing slash required.

| Use | URL |
|-----|-----|
| Dashboard | `https://<your-service>.run.app/` |
| Ingest (HappyRobot) | `POST https://<your-service>.run.app/api/events` |
| Metrics JSON | `GET https://<your-service>.run.app/api/summary` |
| Health | `GET https://<your-service>.run.app/api/health` |

That satisfies the challenge’s **HTTPS + deployed API** story. You **skip** **[DEPLOY-GCP.md](./DEPLOY-GCP.md)** (VM + Caddy) unless you explicitly want a separate VM deployment.

## Trade-offs vs the VM + Caddy guide

| Topic | Cloud Run |
|--------|-----------|
| **HTTPS** | Automatic on `*.run.app` |
| **Persisted metrics** | Container disk is **ephemeral** — `data/events.json` can reset when instances recycle. For a durable demo, add Cloud Storage / Firestore later. |
| **Cost** | Scales to zero when idle; pay per request (often cheap for demos). |

## Prerequisites

- `gcloud` CLI installed and logged in (`gcloud auth login`).
- Docker installed (for local image build), **or** use Cloud Build (see below).
- This repo’s `metrics-dashboard/` folder (with `Dockerfile`).

## 1. Set project and enable APIs

```bash
export PROJECT_ID=$(gcloud config get-value project)
export REGION=us-central1
export SERVICE_NAME=carrier-metrics

gcloud services enable run.googleapis.com artifactregistry.googleapis.com
```

## 2. Docker repository (Artifact Registry)

```bash
gcloud artifacts repositories create carrier-images \
  --repository-format=docker \
  --location="$REGION" \
  --description="Carrier metrics images" \
  2>/dev/null || true

gcloud auth configure-docker "${REGION}-docker.pkg.dev"
```

## 3. API key (runtime + baked into the UI)

Use **one** secret for both server **`API_KEY`** and build-time **`VITE_API_KEY`** (same value as in `.env.example`).

```bash
export API_KEY="$(openssl rand -hex 24)"
echo "Save this API_KEY for HappyRobot and your notes: $API_KEY"
```

## 4. Build and push the image

From the **`metrics-dashboard/`** directory:

```bash
cd metrics-dashboard

export IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/carrier-images/${SERVICE_NAME}:v1"

docker build \
  --build-arg "VITE_API_KEY=${API_KEY}" \
  -t "$IMAGE" .

docker push "$IMAGE"
```

## 5. Deploy to Cloud Run

Cloud Run injects **`PORT`** (usually **8080**). The app already reads `process.env.PORT`.

```bash
gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "API_KEY=${API_KEY}" \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 3 \
  --timeout 60
```

`--allow-unauthenticated` makes the **URL** public; **`POST /api/events`** and **`GET /api/summary`** still require **`X-API-Key`**. (`GET /api/health` stays open for probes.)

## 6. Get the URL

```bash
gcloud run services describe "$SERVICE_NAME" --region "$REGION" \
  --format='value(status.url)'
```

Example: `https://carrier-metrics-xxxxx-uc.a.run.app`

Use **`https://<that-host>/api/events`** in HappyRobot (same path as before).

### Verify

```bash
export RUN_URL="$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(status.url)')"

curl -sS "${RUN_URL}/api/health"

curl -sS -X POST "${RUN_URL}/api/events" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_KEY}" \
  -d '{"call_id":"smoke-1","outcome":"booked","sentiment":"positive"}'
```

Open **`RUN_URL`** in a browser for the dashboard (the UI was built with `VITE_API_KEY` matching `API_KEY`).

## Changing the API key later

If you only change **`API_KEY`** at runtime but **not** in the image, the SPA will still send the **old** embedded key. Rebuild the image with the new `VITE_API_KEY`, push, and deploy a new revision.

## Optional: build in Cloud Build (no local Docker)

You can add a `cloudbuild.yaml` that builds with `--build-arg VITE_API_KEY=$$API_KEY` from Secret Manager; omitted here to keep the first deploy minimal.

## Optional: custom domain

In Cloud Run → **Manage custom domains** — you can attach a domain you own later; HTTPS is still managed for you.
