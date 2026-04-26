#!/usr/bin/env bash
set -euo pipefail

POSTGRES_HOST="${POSTGRES_HOST:-db}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"

echo "[entrypoint] waiting for db at ${POSTGRES_HOST}:${POSTGRES_PORT}"
until nc -z "${POSTGRES_HOST}" "${POSTGRES_PORT}"; do
  sleep 0.5
done
echo "[entrypoint] db reachable"

echo "[entrypoint] running migrations"
python manage.py migrate --noinput

echo "[entrypoint] starting uvicorn (workers=1)"
exec uvicorn config.asgi:application \
  --host 0.0.0.0 \
  --port 8000 \
  --workers 1
