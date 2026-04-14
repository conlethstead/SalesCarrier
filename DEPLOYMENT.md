# Deployment: access & reproduction (Google Cloud Run)

The metrics dashboard is built as a **single Docker image** (static UI + Express API) and deployed to **Google Cloud Run** with **HTTPS** on `https://*.run.app`.

## Accessing the deployment

1. **Service URL** — After a successful deploy, the script prints the Cloud Run **`status.url`** (HTTPS). You can always fetch it with:

   ```bash
   gcloud run services describe "${CLOUD_RUN_SERVICE:-sales}" \
     --region "${GCP_REGION:-us-central1}" \
     --format='value(status.url)'
   ```

2. **Dashboard UI** — Open that URL in a browser. The UI uses `VITE_API_KEY` baked in at **build** time; it must match runtime **`API_KEY`** on the service.

3. **API authentication** — Protected routes require the same secret:

   | Route | Header |
   |-------|--------|
   | `GET /api/summary` | `X-API-Key: <API_KEY>` |
   | `POST /api/events` | `X-API-Key: <API_KEY>` |
   | `GET /api/export/calls.csv` | `X-API-Key: <API_KEY>` |
   | `GET /api/health` | none |

   Example:

   ```bash
   URL="https://YOUR-SERVICE-xxxxx-uc.a.run.app"
   curl -sS -H "X-API-Key: $API_KEY" "$URL/api/summary"
   ```

4. **Secrets** — `API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` are set on the Cloud Run service via `deploy-cloud-run.sh` (from `.env`). Do not commit `.env`.

---

## Reproducing the deployment

### Prerequisites

- [Google Cloud SDK](https://cloud.google.com/sdk) (`gcloud`) installed and authenticated: `gcloud auth login` and `gcloud config set project YOUR_PROJECT_ID`
- Billing enabled on the project (Cloud Run + Artifact Registry + Cloud Build)
- APIs enabled (the build script enables these if missing): `cloudbuild.googleapis.com`, `artifactregistry.googleapis.com`

### One-command redeploy (recommended)

From the **`metrics-dashboard`** directory:

```bash
# Ensure .env exists (API_KEY, VITE_API_KEY matching, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, …)
./scripts/redeploy-cloud-run.sh
```

This runs **Cloud Build** (`cloudbuild.yaml`) to build and push the image, then **deploys** to Cloud Run and prints the **HTTPS dashboard URL** plus example `curl` commands.

Optional environment variables (same as split scripts):

| Variable | Default | Purpose |
|----------|---------|---------|
| `GCP_PROJECT_ID` | `gcloud config get-value project` | GCP project |
| `GCP_REGION` | `us-central1` | Region for Artifact Registry + Cloud Run |
| `ARTIFACT_REPO` | `carrier-images` | Docker repository name |
| `CLOUD_RUN_SERVICE` | `sales` | Cloud Run service name |
| `IMAGE_TAG` | `YYYYMMDD-HHMMSS` | Image tag (optional fixed tag) |

### Manual two-step deploy

Equivalent to the redeploy script:

```bash
./scripts/build-via-cloud-build.sh    # prints image URI; also writes .last-cloud-image
./scripts/deploy-cloud-run.sh REGION-docker.pkg.dev/PROJECT/REPO/SERVICE:tag
```

### Local Docker (no GCP)

See [README.md](./README.md) — `docker build` / `docker compose` for local HTTP on port **3001**.

---

## Files involved

| File | Role |
|------|------|
| [`Dockerfile`](./Dockerfile) | Multi-stage build; bakes `VITE_API_KEY` into the UI |
| [`cloudbuild.yaml`](./cloudbuild.yaml) | Cloud Build: `docker build` + push to Artifact Registry |
| [`scripts/build-via-cloud-build.sh`](./scripts/build-via-cloud-build.sh) | Submit Cloud Build; writes `.last-cloud-image` |
| [`scripts/deploy-cloud-run.sh`](./scripts/deploy-cloud-run.sh) | Deploy image to Cloud Run with env vars |
| [`scripts/redeploy-cloud-run.sh`](./scripts/redeploy-cloud-run.sh) | Build + deploy + print URL |

---

## Notes

- **Ephemeral metrics storage:** Events append to `data/events.csv` inside the container filesystem. If the service scales to zero or revisions roll, **local file state may reset** unless you mount a volume or move storage to a database — plan accordingly for production persistence.
- **HTTPS:** Cloud Run terminates TLS; the Node app listens on HTTP inside the container.
