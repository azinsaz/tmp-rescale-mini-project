<!--
Thanks for the PR. Keep this short — the goal is to give a reviewer enough
context to load the change in their head, and a checklist they can sanity-check
without running the code.
-->

## Summary

<!-- 1–3 sentences: what changed and why. Link any relevant issue / ticket. -->

## Type of change

<!-- Tick all that apply. -->

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that changes existing behaviour)
- [ ] Refactor / chore (no behaviour change)
- [ ] Documentation only

## How to verify

<!-- The exact commands a reviewer should run, in order. Skip steps that
don't apply. Replace placeholders. -->

```bash
make build
make up
# manual smoke: <what to click / what URL to hit>
make test
```

## Checklist

- [ ] `make test` passes locally (BE pytest + FE Vitest + Playwright E2E)
- [ ] `scripts/pre-commit.sh` passes locally (lint + tests)
- [ ] No new TypeScript `any` casts; backend has no new `# type: ignore`
- [ ] Updated `CHANGELOG.md` under `## [Unreleased]` if this is user-visible
- [ ] Updated `README.md` / `CLAUDE.md` if behaviour or workflow changed
- [ ] Considered accessibility (keyboard, focus, ARIA) for any UI change

## Screenshots / clips

<!-- For UI changes only. Drop a before/after if helpful. -->
