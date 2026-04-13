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

That satisfies the challenge’s **HTTPS + deployed API** story.

## Trade-offs vs running your own VM

| Topic | Cloud Run |
|--------|-----------|
| **HTTPS** | Automatic on `*.run.app` |
| **Persisted metrics** | Container disk is **ephemeral** — `data/events.csv` can reset when instances recycle. For a durable demo, add Cloud Storage / Firestore later. |
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

From the **`metrics-dashboard/`** directory.

### Option A — Local Docker (Docker Desktop)

Install **[Docker Desktop for Mac](https://docs.docker.com/desktop/install/mac-install/)**, then from **`metrics-dashboard/`**:

```bash
export IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/carrier-images/${SERVICE_NAME}:v1"

docker build \
  --build-arg "VITE_API_KEY=${API_KEY}" \
  -t "$IMAGE" .

gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
docker push "$IMAGE"
```

### Option B — No local Docker (Cloud Build)

Uses **`cloudbuild.yaml`**; only **`gcloud`** is required:

```bash
cd metrics-dashboard
chmod +x scripts/build-via-cloud-build.sh
./scripts/build-via-cloud-build.sh
```

This runs `gcloud builds submit` with **`VITE_API_KEY`** from **`.env`** as a substitution and pushes to Artifact Registry.

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
  -d '{"reference_number":"SMOKE-1","booking_decision":"yes","verified":true}'
```

Open **`RUN_URL`** in a browser for the dashboard (the UI was built with `VITE_API_KEY` matching `API_KEY`).

## Rebuild after editing `.env` (local)

With **`API_KEY`** and **`VITE_API_KEY`** set to the **same** value in **`metrics-dashboard/.env`**:

```bash
cd metrics-dashboard
chmod +x scripts/build-via-cloud-build.sh scripts/deploy-cloud-run.sh
./scripts/build-via-cloud-build.sh
./scripts/deploy-cloud-run.sh REGION-docker.pkg.dev/PROJECT/REPO/SERVICE:TAG
```

**`build-via-cloud-build.sh`** prints the image URI and the exact **`deploy-cloud-run.sh`** line. Override defaults with **`GCP_PROJECT_ID`**, **`GCP_REGION`**, **`CLOUD_RUN_SERVICE`** (e.g. `sales`), **`ARTIFACT_REPO`**.

## Changing the API key later

If you only change **`API_KEY`** at runtime but **not** in the image, the SPA will still send the **old** embedded key. Rebuild the image with the new `VITE_API_KEY`, push, and deploy a new revision.

## Troubleshooting

**`Repository "carrier-images" not found`** — Create the Artifact Registry **Docker** repo once (or re-run **`./scripts/build-via-cloud-build.sh`**, which creates it automatically):

```bash
gcloud artifacts repositories create carrier-images \
  --repository-format=docker \
  --location=us-central1 \
  --project=salescarrier \
  --description="Carrier metrics Docker images"
```

Use your **`--project`** and **`--location`** if they differ.

## Optional: custom domain

In Cloud Run → **Manage custom domains** — you can attach a domain you own later; HTTPS is still managed for you.
