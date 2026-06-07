#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${XIAOJIBIKE_BACKEND_DIR:-${XUANJIBAO_BACKEND_DIR:-${ROOT_DIR}/backend}}"
FRONTEND_DIR="${XIAOJIBIKE_FRONTEND_DIR:-${XUANJIBAO_FRONTEND_DIR:-${ROOT_DIR}/frontend}}"
DATA_DIR="${XIAOJIBIKE_APP_DATA_DIR:-${XUANJIBAO_APP_DATA_DIR:-${ROOT_DIR}/runtime-data}}"
BACKEND_VENV_DIR="${BACKEND_DIR}/.venv"

find_free_port() {
  python3 - "$1" <<'PY'
import socket
import sys

port = int(sys.argv[1])
while True:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind(("127.0.0.1", port))
        except OSError:
            port += 1
            continue
        print(port)
        break
PY
}

BACKEND_PORT="${XIAOJIBIKE_BACKEND_PORT:-${XUANJIBAO_BACKEND_PORT:-$(find_free_port 8765)}}"
FRONTEND_PORT="${XIAOJIBIKE_FRONTEND_PORT:-${XUANJIBAO_FRONTEND_PORT:-$(find_free_port 5173)}}"

if [[ ! -x "${BACKEND_VENV_DIR}/bin/python" || ! -f "${BACKEND_VENV_DIR}/bin/activate" ]]; then
  if [[ -d "${BACKEND_VENV_DIR}" ]]; then
    echo "Backend virtualenv is incomplete, recreating: ${BACKEND_VENV_DIR}" >&2
    rm -rf "${BACKEND_VENV_DIR}"
  fi
  python3 -m venv "${BACKEND_VENV_DIR}"
fi

source "${BACKEND_VENV_DIR}/bin/activate"

if [[ ! -x "${FRONTEND_DIR}/node_modules/.bin/vite" ]]; then
  echo "Frontend dependencies are missing or incomplete, installing: ${FRONTEND_DIR}" >&2
  npm --prefix "${FRONTEND_DIR}" install
fi

if [[ "${XIAOJIBIKE_DEV_LOCAL_SETUP_ONLY:-${XUANJIBAO_DEV_LOCAL_SETUP_ONLY:-0}}" == "1" ]]; then
  exit 0
fi

PIP_DISABLE_PIP_VERSION_CHECK=1 pip install -q -e "${BACKEND_DIR}[dev]"

mkdir -p "${DATA_DIR}"

cleanup() {
  if [[ -n "${BACKEND_PID:-}" ]]; then
    kill "${BACKEND_PID}" 2>/dev/null || true
  fi
  if [[ -n "${FRONTEND_PID:-}" ]]; then
    kill "${FRONTEND_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

(
  cd "${BACKEND_DIR}"
  XIAOJIBIKE_APP_DATA_DIR="${DATA_DIR}" uvicorn app.main:app --reload --host 127.0.0.1 --port "${BACKEND_PORT}"
) &
BACKEND_PID=$!

XIAOJIBIKE_BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}" \
  npm --prefix "${FRONTEND_DIR}" run dev -- --host 127.0.0.1 --port "${FRONTEND_PORT}" --strictPort &
FRONTEND_PID=$!

cat <<EOF
Backend:  http://127.0.0.1:${BACKEND_PORT}
Frontend: http://127.0.0.1:${FRONTEND_PORT}
Data:     ${DATA_DIR}
EOF

wait
