#!/usr/bin/env bash
# Deploy a pushed image to Cloud Run with API_KEY from .env
# Usage:
#   ./scripts/deploy-cloud-run.sh [IMAGE_URI]
# If IMAGE_URI is omitted, uses the most recently printed image from rebuild-and-push (you must paste).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "Missing .env"
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

if [[ -z "${API_KEY:-}" ]]; then
  echo "API_KEY missing in .env"
  exit 1
fi

IMAGE="${1:-}"
if [[ -z "${IMAGE}" ]]; then
  echo "Usage: $0 REGION-docker.pkg.dev/PROJECT/REPO/SERVICE:tag"
  exit 1
fi

PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${GCP_REGION:-us-central1}"
REPO="${ARTIFACT_REPO:-carrier-images}"
SERVICE="${CLOUD_RUN_SERVICE:-sales}"

# Require a full image URI — a bare tag (e.g. 20260411-122157) makes gcloud look up the wrong registry.
if [[ "${IMAGE}" != *docker.pkg.dev* ]] && [[ "${IMAGE}" != *gcr.io* ]]; then
  echo "Error: pass the full image URI from the build output, not only the tag."
  echo "You gave: ${IMAGE}"
  echo "Example:"
  echo "  ${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE}:${IMAGE}"
  exit 1
fi

gcloud run deploy "${SERVICE}" \
  --image "${IMAGE}" \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "API_KEY=${API_KEY}" \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 3 \
  --timeout 60

echo ""
gcloud run services describe "${SERVICE}" --region "${REGION}" --format='value(status.url)'
