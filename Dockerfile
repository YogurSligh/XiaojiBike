# syntax=docker/dockerfile:1.7

FROM --platform=$BUILDPLATFORM node:20-bookworm-slim AS frontend-build
WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    XUANJIBAO_APP_DATA_DIR=/data
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential curl \
    && rm -rf /var/lib/apt/lists/*
COPY backend/ ./backend/
RUN pip install --no-cache-dir ./backend
COPY data/ ./data/
COPY --from=frontend-build /src/frontend/dist ./frontend/dist
WORKDIR /app/backend
EXPOSE 8000
VOLUME ["/data"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
