#!/usr/bin/env bash
set -euo pipefail
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
cd apps/server
uv sync
uv run ruff check .
uv run ruff format --check .
uv run mypy .
uv run pytest
