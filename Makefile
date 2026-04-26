.PHONY: build up stop clean test seed seed-bench ci

# Bootstrap: copy .env from .env.example if missing.
.env:
	@cp -n .env.example .env
	@echo "Created .env from .env.example"

# Build all images.
build: | .env
	docker compose build

# Bring the stack up in the background (db + backend + frontend).
up: | .env build
	@mkdir -p logs
	docker compose up -d db backend frontend
	@echo ""
	@echo "Waiting for services to become healthy…"
	@docker compose exec -T backend sh -c 'until curl -fsS http://localhost:8000/api/health/ >/dev/null 2>&1; do sleep 1; done'
	@echo ""
	@echo "========================================="
	@echo "  App running: http://localhost:8080"
	@echo "  API running: http://localhost:8000/api/"
	@echo "  API docs:    http://localhost:8000/api/docs/"
	@echo "========================================="

# Stop running containers (preserves volumes).
stop:
	docker compose down

# Full reset: containers, volumes, network, and the .env file.
clean:
	docker compose down -v --remove-orphans
	rm -f .env
	rm -rf logs

# Cold-machine evaluation entrypoint. Chains:
#   1. backend pytest (97% coverage gate at 80%)
#   2. frontend Vitest (70% coverage gate on src/features/jobs + src/lib)
#   3. db flush (ensures Playwright starts clean)
#   4. Playwright per-flow specs across mobile + desktop projects
# Tears down on success OR failure so the next run starts clean.
test: export SERVICE_NAME = test-api
test: | .env
	docker compose --profile test down -v --remove-orphans 2>/dev/null || true
	docker compose --profile test build
	@mkdir -p logs
	docker compose up -d db backend
	@set -e; \
	  docker compose exec -T -e COVERAGE_FILE=/tmp/.coverage backend \
	    pytest -q \
	      --cov=jobs.services --cov=jobs.api \
	      --cov=config.api --cov=config.logging \
	      --cov-fail-under=80 \
	      -p no:cacheprovider \
	    || { docker compose --profile test down -v --remove-orphans; exit 1; }; \
	  docker compose --profile test run --rm vitest \
	    || { docker compose --profile test down -v --remove-orphans; exit 1; }; \
	  docker compose up -d frontend; \
	  docker compose exec -T backend python manage.py flush --no-input \
	    || { docker compose --profile test down -v --remove-orphans; exit 1; }; \
	  docker compose --profile test run --rm playwright; \
	  EXIT_CODE=$$?; \
	  docker compose --profile test down -v --remove-orphans; \
	  exit $$EXIT_CODE

# Bulk-seed the running stack for performance benchmarking. Default 100k jobs.
# Usage: `make up && make seed-bench`.
seed-bench:
	docker compose exec -T backend python manage.py shell -c "from jobs.bench import run; run()"

# Heavy seed: 1,000,000 jobs with realistic status distribution. Mirrors the
# `millions of jobs` design target. Takes ~1–2 min on a laptop. Requires the
# stack to be running (`make up`).
seed:
	docker compose exec -T backend python manage.py shell -c "from jobs.bench import run; run(1_000_000)"

# Run everything the GitHub Actions CI pipeline runs, locally. Mirrors
# `.github/workflows/ci.yml`: lint (backend ruff + format + compile, frontend
# tsc + eslint + prettier) followed by tests (BE pytest + FE Vitest +
# Playwright E2E on mobile + desktop via `make test`).
ci:
	./scripts/pre-commit.sh
