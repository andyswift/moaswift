#!/usr/bin/env bash
# Deploy www/ to the moaswift.no S3 bucket and clear the CloudFront cache.
#
#   ./deploy.sh --dry-run   show what would change, touch nothing
#   ./deploy.sh             show the plan, ask, then deploy
#   ./deploy.sh --yes       deploy without asking (for scripts)
#
# Needs the AWS CLI and a signed-in session (`aws login`).
set -euo pipefail

BUCKET="moaswift"
REGION="eu-west-1"            # region of the bucket
DISTRIBUTION="E1MUDCSWW05U01" # CloudFront distribution for moaswift.no / www.moaswift.no
SRC="$(cd "$(dirname "$0")" && pwd)/www"

DRY=0
YES=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    --yes) YES=1 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

if ! aws sts get-caller-identity >/dev/null 2>&1; then
  echo "Not signed in to AWS. Run: aws login" >&2
  exit 1
fi
[ -f "$SRC/index.html" ] || { echo "Missing $SRC/index.html" >&2; exit 1; }

IMMUTABLE="public, max-age=31536000, immutable" # fonts and hashed game bundles never change in place
SHORT="public, max-age=300"                     # pages and unhashed files

sync() { aws s3 sync "$SRC" "s3://$BUCKET" --region "$REGION" --delete "$@"; }

run_passes() {
  local extra=("$@")
  # 1. fonts: long cache, correct content type
  sync ${extra[@]+"${extra[@]}"} --exclude "*" --include "*.woff2" --content-type "font/woff2" --cache-control "$IMMUTABLE"
  # 2. hashed game bundles (invaders, monsters, tetris, memes, pipe, lynch, df2, duo, seq, synth, poly, drums, records, reverb, delay, ouroboros, buscomp, granular, smeeze): long cache
  sync ${extra[@]+"${extra[@]}"} --exclude "*" --include "invaders/assets/*" --include "monsters/assets/*" --include "tetris/assets/*" --include "memes/assets/*" --include "pipe/assets/*" --include "lynch/assets/*" --include "df2/assets/*" --include "duo/assets/*" --include "seq/assets/*" --include "synth/assets/*" --include "poly/assets/*" --include "drums/assets/*" --include "records/assets/*" --include "reverb/assets/*" --include "delay/assets/*" --include "ouroboros/assets/*" --include "buscomp/assets/*" --include "granular/assets/*" --include "smeeze/assets/*" --exclude "*.woff2" --cache-control "$IMMUTABLE"
  # 3. everything else: short cache; removes the old 2017 template files.
  #    favicon.ico already lives in the bucket and has no counterpart in the repo, so keep it.
  sync ${extra[@]+"${extra[@]}"} --exclude "*.woff2" --exclude "invaders/assets/*" --exclude "monsters/assets/*" --exclude "tetris/assets/*" --exclude "memes/assets/*" --exclude "pipe/assets/*" --exclude "lynch/assets/*" --exclude "df2/assets/*" --exclude "duo/assets/*" --exclude "seq/assets/*" --exclude "synth/assets/*" --exclude "poly/assets/*" --exclude "drums/assets/*" --exclude "records/assets/*" --exclude "reverb/assets/*" --exclude "delay/assets/*" --exclude "ouroboros/assets/*" --exclude "buscomp/assets/*" --exclude "granular/assets/*" --exclude "smeeze/assets/*" --exclude "favicon.ico" \
       --exclude ".DS_Store" --exclude "Dockerfile" --exclude "invaders-3d/*" --cache-control "$SHORT"
}

echo "== Plan: $SRC -> s3://$BUCKET (distribution $DISTRIBUTION)"
run_passes --dryrun

if [ "$DRY" -eq 1 ]; then
  echo "== Dry run only. Nothing changed."
  exit 0
fi

if [ "$YES" -ne 1 ]; then
  read -r -p "Deploy this to moaswift.no? [y/N] " answer
  [[ "$answer" =~ ^[Yy]$ ]] || { echo "Cancelled."; exit 1; }
fi

run_passes
echo "== Invalidating CloudFront cache"
aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION" --paths "/*" \
  --query 'Invalidation.{Id:Id,Status:Status}' --output table
echo "== Done: https://moaswift.no"
