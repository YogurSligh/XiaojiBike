#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
FRONTEND_DIR="${ROOT_DIR}/frontend"
DATA_DIR="${XUANJIBAO_APP_DATA_DIR:-${ROOT_DIR}/runtime-data}"

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

BACKEND_PORT="${XUANJIBAO_BACKEND_PORT:-$(find_free_port 8765)}"
FRONTEND_PORT="${XUANJIBAO_FRONTEND_PORT:-$(find_free_port 5173)}"

if [[ ! -d "${BACKEND_DIR}/.venv" ]]; then
  python3 -m venv "${BACKEND_DIR}/.venv"
fi

source "${BACKEND_DIR}/.venv/bin/activate"
PIP_DISABLE_PIP_VERSION_CHECK=1 pip install -q -e "${BACKEND_DIR}[dev]"

if [[ ! -d "${FRONTEND_DIR}/node_modules" ]]; then
  npm --prefix "${FRONTEND_DIR}" install
fi

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
  XUANJIBAO_APP_DATA_DIR="${DATA_DIR}" uvicorn app.main:app --reload --host 127.0.0.1 --port "${BACKEND_PORT}"
) &
BACKEND_PID=$!

XUANJIBAO_BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}" \
  npm --prefix "${FRONTEND_DIR}" run dev -- --host 127.0.0.1 --port "${FRONTEND_PORT}" --strictPort &
FRONTEND_PID=$!

cat <<EOF
Backend:  http://127.0.0.1:${BACKEND_PORT}
Frontend: http://127.0.0.1:${FRONTEND_PORT}
Data:     ${DATA_DIR}
EOF

wait
