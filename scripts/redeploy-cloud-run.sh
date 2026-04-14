#!/usr/bin/env bash
# Full redeploy: Google Cloud Build (image push) → Cloud Run deploy → print HTTPS URL.
# Run from repo:  cd metrics-dashboard && ./scripts/redeploy-cloud-run.sh
#
# Requires: gcloud CLI, authenticated account, .env with API_KEY, VITE_API_KEY (matching),
#           SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Optional env overrides:
#   GCP_PROJECT_ID  GCP_REGION  ARTIFACT_REPO  CLOUD_RUN_SERVICE  IMAGE_TAG
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

echo "=== 1/2 Cloud Build (build + push image) ==="
./scripts/build-via-cloud-build.sh

if [[ ! -f .last-cloud-image ]]; then
  echo "Error: .last-cloud-image missing after build."
  exit 1
fi
IMAGE="$(tr -d '\n' < .last-cloud-image)"

echo ""
echo "=== 2/2 Cloud Run deploy ==="
./scripts/deploy-cloud-run.sh "${IMAGE}"

echo ""
echo "=== Dashboard (open in browser) ==="
SERVICE="${CLOUD_RUN_SERVICE:-sales}"
REGION="${GCP_REGION:-us-central1}"
URL="$(gcloud run services describe "${SERVICE}" \
  --region "${REGION}" \
  --format='value(status.url)' 2>/dev/null || true)"
if [[ -n "${URL}" ]]; then
  echo "${URL}"
  echo ""
  echo "Health (no key):  curl -sS '${URL}/api/health'"
  echo "Summary (API key): curl -sS -H \"X-API-Key: \$API_KEY\" '${URL}/api/summary'"
else
  echo "(Run gcloud run services list to find the service URL.)"
fi
