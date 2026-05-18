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

echo "[vercel-build] Restoring charts from origin/data..."
mkdir -p data/charts
if git fetch origin data --depth=1 2>/dev/null; then
  for f in charts/zkp2p.json \
           charts/zkp2p_active_liquidity.json \
           charts/binance_p2p_active_liquidity.json \
           charts/ramp_network_active_liquidity.json; do
    if git show "origin/data:$f" > "data/$f" 2>/dev/null; then
      echo "[vercel-build]   restored $f"
    else
      # If the file doesn't exist on data branch, clean up the empty file that
      # > creates so we don't ship a zero-byte JSON.
      rm -f "data/$f"
    fi
  done
else
  echo "[vercel-build]   data branch not available — sparklines will be empty for now"
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
