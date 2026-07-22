#!/usr/bin/env bash
# Vercel build orchestrator. Vercel's Root Directory is `web/`; this script lives at
# the repo root in `scripts/`, so the build command in Vercel is:
#   bash ../scripts/vercel-build.sh
#
# Decoupled from live probing: the GitHub Actions cron runs the (heavy, multi-page)
# snapshot every 30 min and commits the results — snapshots/ AND charts/ — to the `data`
# branch. This build just RESTORES those, so it does no Binance/Peerlytics probing of its
# own — faster builds, and no build-time API-failure or rate-limit exposure.
#
# On restore failure this build FAILS (exit 1) instead of live-probing. Vercel then keeps
# the last successful deployment serving, so the site shows stale-but-correct data rather
# than the degraded numbers a cloud-IP probe produces. The single exception is bootstrap:
# if the `data` branch doesn't exist yet, we live-probe so a fresh repo can deploy at all.
#
# Steps:
#   1. Restore charts/ and snapshots/ from the `data` branch via the GitHub Contents API.
#   2. Install root deps with --include=dev (tsx for the bootstrap probe; root lib/* imports).
#   3. Snapshot: skipped on a complete restore; runs live only during bootstrap.
#   4. Install web deps with --include=dev (@types/react, typescript in devDeps).
#   5. Build the Next.js app.

set -e

cd ..

mkdir -p data/charts data/snapshots

# Vercel's build sandbox doesn't have a usable git remote (observed: 'fatal: origin does
# not appear to be a git repository'), so we pull each file over HTTP.
#
# We use the GitHub **Contents API**, NOT raw.githubusercontent.com. raw serves from a
# Fastly edge with `cache-control: max-age=300`, and the cron fires the Vercel deploy
# hook ~4s after pushing to the data branch — so every build landed inside the cache
# window and restored the PREVIOUS cycle's data. Diagnosed 2026-07-21: prod was serving
# a snapshot 90 minutes stale (70 markets/$29.18M) while the data branch already had the
# current one (84 markets/$36.49M). The API is not edge-cached and returns fresh content.
# `Accept: application/vnd.github.raw` returns file bytes instead of JSON metadata.
#
# GITHUB_DATA_TOKEN is an OPTIMIZATION, NOT A REQUIREMENT. The repo is public (verified
# 2026-07-21), so every one of these fetches works unauthenticated. The token only buys
# the 5000/hr authenticated rate limit instead of 60/hr-per-IP shared across Vercel's
# build IPs. Historically the token was treated as mandatory, which made its expiry
# (which WILL happen — fine-grained PATs are time-boxed) silently degrade production.
# Now: an expired token logs a warning and we continue unauthenticated.
GH_API="https://api.github.com"
REPO="${VERCEL_GIT_REPO_OWNER:-MontaguSandwich}/${VERCEL_GIT_REPO_SLUG:-ramp-analytics}"
echo "[vercel-build] repo: $REPO (owner env='${VERCEL_GIT_REPO_OWNER:-unset}' slug env='${VERCEL_GIT_REPO_SLUG:-unset}')"

AUTH=()
if [ -n "${GITHUB_DATA_TOKEN:-}" ]; then
  AUTH=(-H "Authorization: token $GITHUB_DATA_TOKEN")
  echo "[vercel-build] token: set, ${#GITHUB_DATA_TOKEN} chars, prefix '$(printf '%.11s' "$GITHUB_DATA_TOKEN")'"
  case "$GITHUB_DATA_TOKEN" in
    *[[:space:]]*) echo "[vercel-build]   WARNING: token contains whitespace — likely a paste artifact" ;;
  esac
else
  echo "[vercel-build] token: not set — proceeding unauthenticated (repo is public)"
fi

# Preflight: prove we can reach the repo, and surface token expiry BEFORE it bites.
# 401 means the token is expired/invalid — drop it and continue unauthenticated rather
# than failing, since the repo is public.
HDRS=$(curl -sS -D - -o /dev/null "${AUTH[@]}" "$GH_API/repos/$REPO" 2>/dev/null || true)
CODE=$(printf '%s' "$HDRS" | awk 'NR==1{print $2}')
if [ "$CODE" = "401" ] && [ ${#AUTH[@]} -gt 0 ]; then
  echo "[vercel-build]   WARNING: GITHUB_DATA_TOKEN rejected (HTTP 401 — expired or invalid)."
  echo "[vercel-build]            Continuing UNAUTHENTICATED. Rotate the token in the Vercel"
  echo "[vercel-build]            project env to restore the 5000/hr rate limit."
  AUTH=()
  HDRS=$(curl -sS -D - -o /dev/null "$GH_API/repos/$REPO" 2>/dev/null || true)
  CODE=$(printf '%s' "$HDRS" | awk 'NR==1{print $2}')
fi
EXPIRY=$(printf '%s' "$HDRS" | tr -d '\r' \
  | awk -F': ' 'tolower($1)=="github-authentication-token-expiration"{print $2}')
if [ -n "$EXPIRY" ]; then
  DAYS_LEFT=$(( ( $(date -d "$EXPIRY" +%s 2>/dev/null || echo 0) - $(date +%s) ) / 86400 ))
  if [ "$DAYS_LEFT" -gt 0 ] && [ "$DAYS_LEFT" -lt 21 ]; then
    echo "[vercel-build]   WARNING: GITHUB_DATA_TOKEN expires in $DAYS_LEFT days ($EXPIRY) — rotate it soon."
  else
    echo "[vercel-build] token expires: $EXPIRY"
  fi
fi
[ "$CODE" = "200" ] || echo "[vercel-build]   WARNING: repo preflight returned HTTP ${CODE:-no-response}"

# Bootstrap escape hatch: on a brand-new repo the data branch doesn't exist yet, so there
# is nothing to restore and a hard failure would make the site undeployable forever. That
# ONE case still falls back to a live snapshot.
BRANCH_CODE=$(curl -sS -o /dev/null -w '%{http_code}' "${AUTH[@]}" "$GH_API/repos/$REPO/branches/data" 2>/dev/null || echo 000)
RESTORE_OK=1
if [ "$BRANCH_CODE" = "404" ]; then
  echo "[vercel-build] data branch does not exist yet (bootstrap) — will run live snapshot."
  RESTORE_OK=0
else
  fetch() { # fetch <remote-path> <local-path> -> 0 ok, else prints HTTP status
    local url="$GH_API/repos/$REPO/contents/$1?ref=data"
    # stderr suppressed on the attempt: an expected-absent file (ramp's liquidity log)
    # would otherwise print a scary 'curl: (56) ... 404'. Real failures are reported by
    # the caller using the status code captured below.
    if curl -fsSL "${AUTH[@]}" -H "Accept: application/vnd.github.raw" "$url" -o "$2" 2>/dev/null; then
      return 0
    fi
    rm -f "$2"
    curl -sS -o /dev/null -w '%{http_code}' "${AUTH[@]}" \
      -H "Accept: application/vnd.github.raw" "$url" 2>/dev/null || echo 'no-response'
    return 1
  }

  echo "[vercel-build] Restoring charts from data branch..."
  # ramp_network has no liquidity log (it reports max-single-trade, not pooled depth), so
  # its 404 is expected and tolerated. Any OTHER chart failure is real: since the repo is
  # public, a 404 here genuinely means "absent", not "no access".
  for f in charts/zkp2p.json \
           charts/zkp2p_active_liquidity.json \
           charts/binance_p2p_active_liquidity.json \
           charts/ramp_network_active_liquidity.json; do
    if code=$(fetch "$f" "data/$f"); then
      echo "[vercel-build]   restored $f"
    elif [ "$f" = "charts/ramp_network_active_liquidity.json" ] && [ "$code" = "404" ]; then
      echo "[vercel-build]   absent (expected): $f"
    else
      echo "[vercel-build]   FAILED $f (HTTP $code)"
      RESTORE_OK=0
    fi
  done

  echo "[vercel-build] Restoring snapshots from data branch (cron-generated)..."
  # Established venues: a missing snapshot here is a real failure and fails the build.
  for id in zkp2p binance_p2p ramp_network; do
    if code=$(fetch "snapshots/$id.json" "data/snapshots/$id.json"); then
      echo "[vercel-build]   restored snapshots/$id.json"
    else
      echo "[vercel-build]   FAILED snapshots/$id.json (HTTP $code)"
      RESTORE_OK=0
    fi
  done

  # TRANSITIONAL (added 2026-07-22 with the two Revolut venues): these adapters ship in
  # the same commit that first deploys them, so on the FIRST build their snapshots don't
  # exist on the data branch yet — the cron hasn't run since the adapters landed. Treating
  # that 404 as fatal would make the venues undeployable (build fails → old deployment
  # without them keeps serving → cron never gets a chance to matter). So a 404 is tolerated
  # here and the venue simply renders without live data until the next cron cycle
  # (~2-2.5h). ANY OTHER status is still fatal.
  #
  # TIGHTEN THIS: once the cron has committed snapshots/revolut.json and
  # snapshots/revolut_ramp.json to the data branch (verify with
  # `git show origin/data:snapshots/revolut.json`), move these two ids into the loop above
  # so a later disappearance is caught instead of silently degrading.
  for id in revolut_ramp revolut; do
    if code=$(fetch "snapshots/$id.json" "data/snapshots/$id.json"); then
      echo "[vercel-build]   restored snapshots/$id.json"
    elif [ "$code" = "404" ]; then
      echo "[vercel-build]   absent (new venue, tolerated until first cron): snapshots/$id.json"
    else
      echo "[vercel-build]   FAILED snapshots/$id.json (HTTP $code)"
      RESTORE_OK=0
    fi
  done
fi

# Fail the build rather than shipping degraded data. A live probe from a Vercel IP is NOT
# a graceful degradation: Binance sheds hard from cloud IPs, so the fallback produced
# materially worse numbers than the cron's (observed 70 markets/$29.18M vs 84/$36.49M,
# with a blank Spread KPI). Failing here leaves the previous successful deployment serving
# — stale-but-correct beats fresh-but-wrong.
if [ "$RESTORE_OK" = "0" ] && [ "$BRANCH_CODE" != "404" ]; then
  echo "[vercel-build] ERROR: data restore incomplete — failing the build on purpose."
  echo "[vercel-build]        Vercel keeps the last successful deployment live, so the site"
  echo "[vercel-build]        serves the previous (correct) data instead of a degraded probe."
  echo "[vercel-build]        Check the HTTP codes above: 404 = file absent on the data branch"
  echo "[vercel-build]        (is the cron green?); 401/403 = auth; 5xx = GitHub transient."
  exit 1
fi
SNAPSHOTS_OK=$RESTORE_OK

echo "[vercel-build] Installing root deps (with devDeps for tsx + root lib imports)..."
npm install --include=dev

# Normal path: the cron already probed and committed fresh snapshots, so we skip live
# probing entirely. The only way to reach the else-branch is bootstrap (no data branch);
# every other restore failure already exited above.
if [ "$SNAPSHOTS_OK" = "1" ]; then
  echo "[vercel-build] Using cron snapshots from data branch — skipping live snapshot."
else
  echo "[vercel-build] Bootstrap (no data branch yet) — running live snapshot to seed the build..."
  npm run snapshot
fi

echo "[vercel-build] Installing web deps (with devDeps for @types/react)..."
cd web
npm install --include=dev

echo "[vercel-build] Building Next.js..."
npm run build
