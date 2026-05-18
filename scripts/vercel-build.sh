#!/usr/bin/env bash
# Vercel build orchestrator. Vercel's Root Directory is `web/`; this script lives at
# the repo root in `scripts/`, so the build command in Vercel is:
#   bash ../scripts/vercel-build.sh
#
# Steps:
#   1. Restore historical chart files from the `data` branch (GitHub Actions cron
#      commits the self-accumulated liquidity logs + zkp2p 90d TVL there every 30 min).
#      Without this step, every Vercel build starts with empty sparklines.
#   2. Install root deps with --include=dev (tsx, typescript, ajv-cli all in devDeps).
#   3. Run snapshot — populates data/snapshots/*.json AND appends today's entry to the
#      restored active_liquidity logs (dedupes by UTC day).
#   4. Install web deps with --include=dev (@types/react, typescript in devDeps).
#   5. Build the Next.js app.

set -e

cd ..

echo "[vercel-build] Restoring charts from data branch..."
mkdir -p data/charts
# Vercel's build sandbox doesn't have a usable git remote (observed: 'fatal: origin
# does not appear to be a git repository'), so we can't use `git fetch origin data`.
# Instead, pull each file via raw.githubusercontent.com with a fine-scoped PAT that
# the user adds to Vercel env vars as GITHUB_DATA_TOKEN. The repo is private so the
# token is required; without it we ship empty sparklines (graceful degrade).
if [ -n "${GITHUB_DATA_TOKEN:-}" ]; then
  REPO="${VERCEL_GIT_REPO_OWNER:-MontaguSandwich}/${VERCEL_GIT_REPO_SLUG:-ramp-analytics}"
  for f in charts/zkp2p.json \
           charts/zkp2p_active_liquidity.json \
           charts/binance_p2p_active_liquidity.json \
           charts/ramp_network_active_liquidity.json; do
    url="https://raw.githubusercontent.com/$REPO/data/$f"
    if curl -fsSL -H "Authorization: token $GITHUB_DATA_TOKEN" "$url" -o "data/$f"; then
      echo "[vercel-build]   restored $f"
    else
      # File missing on data branch (e.g. ramp_network's active_liquidity isn't
      # populated by appendLiquidityLog) — clean up partial file so we don't ship junk.
      rm -f "data/$f"
    fi
  done
else
  echo "[vercel-build]   GITHUB_DATA_TOKEN not set — sparklines will be empty"
  echo "[vercel-build]   Set a fine-scoped PAT (Contents: read-only) in Vercel env vars to restore historical charts"
fi

echo "[vercel-build] Installing root deps (with devDeps for tsx)..."
npm install --include=dev

echo "[vercel-build] Running snapshot..."
npm run snapshot

echo "[vercel-build] Installing web deps (with devDeps for @types/react)..."
cd web
npm install --include=dev

echo "[vercel-build] Building Next.js..."
npm run build
