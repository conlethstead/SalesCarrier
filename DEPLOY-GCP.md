# Deploy on Google Cloud with Docker and Let’s Encrypt

This guide runs the metrics stack on a **Compute Engine VM** with **Docker Compose**, **Caddy** as the reverse proxy, and **automatic HTTPS** via Let’s Encrypt (ACME HTTP-01). The Node app stays on the private Docker network; only **Caddy** listens on **80** and **443**.

## What gets deployed

| Component | Role |
|-----------|------|
| `metrics` | Express API + static React UI (`Dockerfile`) |
| `caddy` | Terminates TLS, obtains/renews Let’s Encrypt certs, proxies to `metrics:3001` |

Your HappyRobot workflow should **`POST https://<METRICS_DOMAIN>/api/events`** with header **`X-API-Key: <API_KEY>`**.

## Prerequisites

- A **domain** you control (e.g. `metrics.yourdomain.com`).
- **GCP project** with billing enabled.
- **gcloud** CLI installed and authenticated (`gcloud auth login`).

## 1. Create the VM

Example: small always-on instance (adjust zone/machine type as needed).

```bash
export PROJECT_ID=your-gcp-project
export ZONE=us-central1-a
export VM_NAME=carrier-metrics

gcloud config set project "$PROJECT_ID"

gcloud compute instances create "$VM_NAME" \
  --zone="$ZONE" \
  --machine-type=e2-small \
  --boot-disk-size=20GB \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --tags=carrier-metrics-http
```

## 2. Firewall: allow HTTP and HTTPS

```bash
gcloud compute firewall-rules create carrier-metrics-allow-http-https \
  --project="$PROJECT_ID" \
  --direction=INGRESS \
  --priority=1000 \
  --network=default \
  --action=ALLOW \
  --rules=tcp:80,tcp:443 \
  --source-ranges=0.0.0.0/0 \
  --target-tags=carrier-metrics-http
```

Re-create the VM **with** `--tags=carrier-metrics-http` if you already created it without tags:

```bash
gcloud compute instances add-tags "$VM_NAME" --zone="$ZONE" --tags=carrier-metrics-http
```

## 3. Install Docker on the VM

SSH in (replace user if not using default Ubuntu user):

```bash
gcloud compute ssh "$VM_NAME" --zone="$ZONE"
```

On the VM:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

Log out and SSH back in so `docker` works without `sudo`.

## 4. DNS → VM IP

```bash
gcloud compute instances describe "$VM_NAME" --zone="$ZONE" --format='get(networkInterfaces[0].accessConfigs[0].natIP)'
```

Create an **A record** for `metrics.yourdomain.com` (your real hostname) pointing to that IP. Wait for propagation (often minutes; use `dig +short metrics.yourdomain.com`).

Let’s Encrypt will **fail** until the name resolves to this VM.

## 5. Configure env and deploy

On the VM, clone or copy the `metrics-dashboard` folder, then:

```bash
cd metrics-dashboard
cp .env.example .env
```

Edit `.env` and set (use one strong random value for both key fields):

- `API_KEY` — shared secret for `POST /api/events` and `GET /api/summary`.
- `VITE_API_KEY` — **same value** as `API_KEY` (required at **image build** time for the UI).
- `METRICS_DOMAIN` — hostname only, e.g. `metrics.yourdomain.com` (no `https://`).
- `ACME_EMAIL` — email for Let’s Encrypt registration and expiry notices.

Build and start:

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

Watch logs the first time (Caddy obtains the certificate):

```bash
docker compose -f docker-compose.prod.yml logs -f caddy
```

## 6. Verify

- `https://<METRICS_DOMAIN>/api/health` should return JSON with `"ok": true`.
- Open `https://<METRICS_DOMAIN>/` — dashboard loads.
- Test ingest:

```bash
curl -sS -X POST "https://<METRICS_DOMAIN>/api/events" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"call_id":"smoke-1","outcome":"booked","sentiment":"positive","load_id":"LD-1","agreed_rate":1900}'
```

## Persistence

- Call events are stored under **`DATA_DIR`** inside the container (`/data` in `docker-compose.prod.yml`), backed by the **`carrier-metrics-data`** Docker volume. Data survives container restarts; **back up the volume** or snapshot the disk for DR.

## Operations

- **Renewal:** Caddy renews certificates automatically; no cron job required.
- **Updates:** `git pull`, then `docker compose -f docker-compose.prod.yml up -d --build`.
- **Secrets:** Prefer **Secret Manager** + startup script for production `API_KEY` instead of plain `.env` on disk; the pattern above is acceptable for a demo.

## Alternative: Google-managed HTTPS (no Let’s Encrypt)

If you use **Cloud Run** or an **HTTPS Load Balancer** with a **Google-managed certificate**, you often **do not** run Let’s Encrypt yourself—the platform terminates TLS. In that case deploy only the `metrics` service (see `Dockerfile` + `README.md`) and point the managed service at port **3001** or the container `PORT`.

This VM + Caddy path is for **explicit Let’s Encrypt** on a single VM, as requested.
