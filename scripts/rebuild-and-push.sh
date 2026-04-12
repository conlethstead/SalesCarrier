#!/usr/bin/env bash
# Build metrics-dashboard with VITE_API_KEY from .env and push to Artifact Registry.
# Usage (from anywhere):
#   cd metrics-dashboard && ./scripts/rebuild-and-push.sh
#
# Optional env overrides:
#   GCP_REGION=us-central1 GCP_PROJECT_ID=my-proj CLOUD_RUN_SERVICE=sales ARTIFACT_REPO=carrier-images

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "Create $ROOT/.env with API_KEY and VITE_API_KEY (same value)."
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

if [[ -z "${VITE_API_KEY:-}" ]]; then
  echo "VITE_API_KEY is missing in .env"
  exit 1
fi

if [[ -z "${API_KEY:-}" ]]; then
  echo "API_KEY is missing in .env (should match VITE_API_KEY for Cloud Run)"
  exit 1
fi

if [[ "${VITE_API_KEY}" != "${API_KEY}" ]]; then
  echo "Error: VITE_API_KEY and API_KEY must be the same in .env for this app." >&2
  exit 1
fi

PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
if [[ -z "${PROJECT_ID}" || "${PROJECT_ID}" == "(unset)" ]]; then
  echo "Set GCP project: gcloud config set project YOUR_PROJECT_ID or export GCP_PROJECT_ID="
  exit 1
fi

REGION="${GCP_REGION:-us-central1}"
REPO="${ARTIFACT_REPO:-carrier-images}"
SERVICE="${CLOUD_RUN_SERVICE:-sales}"
TAG="${IMAGE_TAG:-$(date +%Y%m%d-%H%M%S)}"

IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE}:${TAG}"

echo "Project: ${PROJECT_ID}  Region: ${REGION}  Service: ${SERVICE}"
echo "Building ${IMAGE}"

if ! command -v docker >/dev/null 2>&1; then
  echo ""
  echo "docker: command not found."
  echo "  • Install Docker Desktop for Mac: https://docs.docker.com/desktop/install/mac-install/"
  echo "  • Or build in GCP without local Docker:"
  echo "      ./scripts/build-via-cloud-build.sh"
  echo ""
  exit 1
fi

docker build \
  --build-arg "VITE_API_KEY=${VITE_API_KEY}" \
  -t "${IMAGE}" \
  .

echo "Configuring Docker auth for Artifact Registry..."
gcloud services enable artifactregistry.googleapis.com --project="${PROJECT_ID}" 2>/dev/null || true
if ! gcloud artifacts repositories describe "${REPO}" --location="${REGION}" --project="${PROJECT_ID}" &>/dev/null; then
  echo "Creating Artifact Registry repository \"${REPO}\" (${REGION})..."
  gcloud artifacts repositories create "${REPO}" \
    --repository-format=docker \
    --location="${REGION}" \
    --project="${PROJECT_ID}" \
    --description="Carrier metrics Docker images"
fi
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

echo "Pushing ${IMAGE}..."
docker push "${IMAGE}"

echo ""
echo "Done. Deploy (reads API_KEY from .env — does not print it):"
echo "  ./scripts/deploy-cloud-run.sh ${IMAGE}"
echo ""
