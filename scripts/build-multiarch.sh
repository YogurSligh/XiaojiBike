#!/usr/bin/env bash
set -euo pipefail

IMAGE="${IMAGE:-chajibao}"
TAG="${TAG:-latest}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
PUSH="${PUSH:-0}"

OUTPUT=(--load)
if [[ "${PUSH}" == "1" ]]; then
  OUTPUT=(--push)
elif [[ "${PLATFORMS}" == *,* ]]; then
  mkdir -p dist
  SAFE_IMAGE="${IMAGE//\//_}"
  SAFE_IMAGE="${SAFE_IMAGE//:/_}"
  OUTPUT=(--output "type=oci,dest=dist/${SAFE_IMAGE}-${TAG}.oci.tar")
fi

docker buildx build \
  --platform "${PLATFORMS}" \
  -t "${IMAGE}:${TAG}" \
  "${OUTPUT[@]}" \
  .
