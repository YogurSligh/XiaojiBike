#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

mkdir -p "${TMP_DIR}/backend/.venv/bin"
mkdir -p "${TMP_DIR}/frontend/node_modules"
mkdir -p "${TMP_DIR}/bin"

cat >"${TMP_DIR}/bin/npm" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

prefix=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix)
      prefix="$2"
      shift 2
      ;;
    install)
      shift
      ;;
    *)
      shift
      ;;
  esac
done

if [[ -z "${prefix}" ]]; then
  echo "Expected npm --prefix <dir> install" >&2
  exit 1
fi

mkdir -p "${prefix}/node_modules/.bin"
cat >"${prefix}/node_modules/.bin/vite" <<'VITE'
#!/usr/bin/env sh
exit 0
VITE
chmod +x "${prefix}/node_modules/.bin/vite"
SH
chmod +x "${TMP_DIR}/bin/npm"

PATH="${TMP_DIR}/bin:${PATH}" \
  XIAOJIBIKE_BACKEND_DIR="${TMP_DIR}/backend" \
  XIAOJIBIKE_FRONTEND_DIR="${TMP_DIR}/frontend" \
  XIAOJIBIKE_APP_DATA_DIR="${TMP_DIR}/data" \
  XIAOJIBIKE_DEV_LOCAL_SETUP_ONLY=1 \
  bash "${ROOT_DIR}/scripts/dev-local.sh" >/dev/null

if [[ ! -f "${TMP_DIR}/backend/.venv/bin/activate" ]]; then
  echo "Expected repaired virtualenv to contain bin/activate" >&2
  exit 1
fi

if [[ ! -x "${TMP_DIR}/backend/.venv/bin/python" ]]; then
  echo "Expected repaired virtualenv to contain executable bin/python" >&2
  exit 1
fi

if [[ ! -x "${TMP_DIR}/frontend/node_modules/.bin/vite" ]]; then
  echo "Expected repaired frontend dependencies to contain executable node_modules/.bin/vite" >&2
  exit 1
fi

echo "dev-local setup repair test passed"
