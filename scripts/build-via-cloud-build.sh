#!/usr/bin/env bash
# Build and push the image using Google Cloud Build (no local Docker install required).
# Requires: gcloud CLI, APIs enabled (cloudbuild.googleapis.com), Artifact Registry repo.
#
# Usage:
#   cd metrics-dashboard && ./scripts/build-via-cloud-build.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "Missing .env with API_KEY and VITE_API_KEY"
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

if [[ -z "${VITE_API_KEY:-}" || -z "${API_KEY:-}" ]]; then
  echo "VITE_API_KEY and API_KEY must be set in .env"
  exit 1
fi
if [[ "${VITE_API_KEY}" != "${API_KEY}" ]]; then
  echo "VITE_API_KEY and API_KEY must match"
  exit 1
fi

PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${GCP_REGION:-us-central1}"
REPO="${ARTIFACT_REPO:-carrier-images}"
SERVICE="${CLOUD_RUN_SERVICE:-sales}"
TAG="${IMAGE_TAG:-$(date +%Y%m%d-%H%M%S)}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE}:${TAG}"

echo "Submitting Cloud Build for: ${IMAGE}"
echo "Enabling APIs if needed..."
gcloud services enable cloudbuild.googleapis.com artifactregistry.googleapis.com --project="${PROJECT_ID}" 2>/dev/null || true

if ! gcloud artifacts repositories describe "${REPO}" --location="${REGION}" --project="${PROJECT_ID}" &>/dev/null; then
  echo "Creating Artifact Registry repository \"${REPO}\" (${REGION})..."
  gcloud artifacts repositories create "${REPO}" \
    --repository-format=docker \
    --location="${REGION}" \
    --project="${PROJECT_ID}" \
    --description="Carrier metrics Docker images"
fi

gcloud builds submit . \
  --project="${PROJECT_ID}" \
  --config=cloudbuild.yaml \
  --substitutions=_VITE_KEY="${VITE_API_KEY}",_IMAGE="${IMAGE}"

echo ""
echo "Done. Deploy:"
echo "  ./scripts/deploy-cloud-run.sh ${IMAGE}"
