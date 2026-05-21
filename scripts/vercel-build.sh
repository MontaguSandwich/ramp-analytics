#!/usr/bin/env bash
# Vercel build orchestrator. Vercel's Root Directory is `web/`; this script lives at
# the repo root in `scripts/`, so the build command in Vercel is:
#   bash ../scripts/vercel-build.sh
#
# Decoupled from live probing: the GitHub Actions cron runs the (heavy, multi-page)
# snapshot every 30 min and commits the results — snapshots/ AND charts/ — to the `data`
# branch. This build just RESTORES those, so it does no Binance/Peerlytics probing of its
# own — faster builds, and no build-time API-failure or rate-limit exposure. If the
# restore is incomplete (token unset or a file missing) it falls back to a live snapshot.
#
# Steps:
#   1. Restore charts/ and snapshots/ from the `data` branch via raw.githubusercontent.com.
#   2. Install root deps with --include=dev (tsx for the fallback; root lib/* imports).
#   3. Snapshot: skip when the restore is complete; otherwise run it live as a fallback.
#   4. Install web deps with --include=dev (@types/react, typescript in devDeps).
#   5. Build the Next.js app.

set -e

cd ..

mkdir -p data/charts data/snapshots

# Vercel's build sandbox doesn't have a usable git remote (observed: 'fatal: origin does
# not appear to be a git repository'), so we pull each file via raw.githubusercontent.com
# with a fine-scoped PAT the user sets as GITHUB_DATA_TOKEN. The repo is private, so the
# token is required; without it we fall back to a live snapshot below.
SNAPSHOTS_OK=0
if [ -n "${GITHUB_DATA_TOKEN:-}" ]; then
  REPO="${VERCEL_GIT_REPO_OWNER:-MontaguSandwich}/${VERCEL_GIT_REPO_SLUG:-ramp-analytics}"

  echo "[vercel-build] Restoring charts from data branch..."
  for f in charts/zkp2p.json \
           charts/zkp2p_active_liquidity.json \
           charts/binance_p2p_active_liquidity.json \
           charts/ramp_network_active_liquidity.json; do
    url="https://raw.githubusercontent.com/$REPO/data/$f"
    if curl -fsSL -H "Authorization: token $GITHUB_DATA_TOKEN" "$url" -o "data/$f"; then
      echo "[vercel-build]   restored $f"
    else
      # Missing on data branch (e.g. ramp_network has no active_liquidity log) — drop the
      # partial file so we don't ship junk. Charts degrade gracefully to empty sparklines.
      rm -f "data/$f"
    fi
  done

  echo "[vercel-build] Restoring snapshots from data branch (cron-generated)..."
  SNAPSHOTS_OK=1
  for id in zkp2p binance_p2p ramp_network; do
    url="https://raw.githubusercontent.com/$REPO/data/snapshots/$id.json"
    if curl -fsSL -H "Authorization: token $GITHUB_DATA_TOKEN" "$url" -o "data/snapshots/$id.json"; then
      echo "[vercel-build]   restored snapshots/$id.json"
    else
      echo "[vercel-build]   MISSING snapshots/$id.json — will run live snapshot as fallback"
      rm -f "data/snapshots/$id.json"
      SNAPSHOTS_OK=0
    fi
  done
else
  echo "[vercel-build]   GITHUB_DATA_TOKEN not set — will run live snapshot as fallback"
fi

echo "[vercel-build] Installing root deps (with devDeps for tsx + root lib imports)..."
npm install --include=dev

# Normal path: the cron already probed and committed fresh snapshots, so we skip live
# probing entirely. Only fall back to running it when the restore came up short (no token,
# missing file, or first-ever run before the data branch is seeded).
if [ "$SNAPSHOTS_OK" = "1" ]; then
  echo "[vercel-build] Using cron snapshots from data branch — skipping live snapshot."
else
  echo "[vercel-build] Snapshot restore incomplete — running live snapshot as fallback..."
  npm run snapshot
fi

echo "[vercel-build] Installing web deps (with devDeps for @types/react)..."
cd web
npm install --include=dev

echo "[vercel-build] Building Next.js..."
npm run build
