#!/usr/bin/env bash
# Run the same gates the CI pipeline runs — locally, in one command.
# Mirrors `.github/workflows/ci.yml`. Stages: lint → test.
#
# Usage:
#   ./scripts/pre-commit.sh           # everything
#   ./scripts/pre-commit.sh --lint    # lint only
#   ./scripts/pre-commit.sh --test    # tests only (incl. e2e via `make test`)
#   ./scripts/pre-commit.sh --skip-e2e
#
# Requirements: docker + docker compose + make (the same prerequisites the
# project README lists). Backend lint uses the project's own uv + ruff; FE
# lint uses the project's own npm scripts.
#
# Exit code is non-zero if any stage fails. Designed to be safe to wire up as
# a git hook (`ln -s ../../scripts/pre-commit.sh .git/hooks/pre-commit`).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WANT_LINT=1
WANT_TEST=1
SKIP_E2E=0

for arg in "$@"; do
  case "$arg" in
    --lint)     WANT_LINT=1; WANT_TEST=0 ;;
    --test)     WANT_LINT=0; WANT_TEST=1 ;;
    --skip-e2e) SKIP_E2E=1 ;;
    -h|--help)
      sed -n '2,15p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

step() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()   { printf "\033[1;32m  ✓ %s\033[0m\n" "$*"; }

# ─── Lint stage ────────────────────────────────────────────────────────────

if [[ "$WANT_LINT" == "1" ]]; then
  step "Backend lint (ruff + format check + compile check)"
  (
    cd backend
    uv sync --frozen --group dev >/dev/null
    uv run --group dev ruff check .
    uv run --group dev ruff format --check .
    # Always go through `uv run` for python — the host may not have a global
    # python on PATH, and we want the project's pinned interpreter anyway.
    uv run --group dev python -m compileall -q .
  )
  ok "backend lint"

  step "Frontend lint (tsc + eslint + prettier)"
  (
    cd frontend
    if [[ ! -d node_modules ]]; then npm ci; fi
    npx tsc --noEmit
    npm run lint
    npx prettier --check .
  )
  ok "frontend lint"
fi

# ─── Test stage ────────────────────────────────────────────────────────────

if [[ "$WANT_TEST" == "1" ]]; then
  if [[ "$SKIP_E2E" == "1" ]]; then
    step "Backend pytest"
    docker compose up -d db >/dev/null
    docker compose build backend >/dev/null
    docker compose up -d backend >/dev/null
    docker compose exec -T -e COVERAGE_FILE=/tmp/.coverage backend \
      pytest -q --cov=jobs --cov=config --cov-fail-under=80 -p no:cacheprovider
    ok "backend pytest"

    step "Frontend Vitest"
    (cd frontend && npm run test:unit -- --coverage)
    ok "frontend vitest"
  else
    step "Full test chain (BE pytest → FE Vitest → Playwright E2E)"
    make test
    ok "make test"
  fi
fi

printf "\n\033[1;32m✔ Pre-commit checks passed.\033[0m\n"
