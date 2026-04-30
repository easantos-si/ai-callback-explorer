#!/usr/bin/env bash
# =============================================================================
# build.sh — npm operations without installing npm on the host.
#
# Spins up a one-shot helper container (always --rm), bind-mounts this
# project at /workspace, and runs npm as the invoking host UID/GID so
# generated files (package-lock.json, node_modules/, dist/) land on the
# host with the right ownership.
#
# Usage:
#   ./build.sh              # alias for ./build.sh install
#   ./build.sh install      # fresh deps + lockfiles in backend + frontend
#   ./build.sh build        # install + npm run build on both
#   ./build.sh lockfile     # regenerate package-lock.json only (no install)
#   ./build.sh shell        # drop into the helper container
#   ./build.sh clean        # remove node_modules/ and dist/ from both
# =============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE_TAG="ai-callback-build:latest"
DOCKERFILE="$ROOT_DIR/Dockerfile.build"
# Host-side cache dir, pre-created with the invoking user's UID so the
# container (run with --user $(id -u):$(id -g)) always has write access.
# A named docker volume here would inherit root ownership on first
# creation and break --user runs forever after.
CACHE_DIR="$ROOT_DIR/.build-cache/npm"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required but not found in PATH." >&2
  exit 127
fi

# (Re)build the helper image. Docker's layer cache makes this a no-op
# when Dockerfile.build hasn't changed.
#
# We pick whichever build method actually works on this host:
#   1. `docker buildx build --load`  → silences the deprecation notice;
#                                      requires the buildx CLI plugin
#                                      (`pacman -S docker-buildx` /
#                                      `apt install docker-buildx-plugin`).
#   2. plain `docker build`          → legacy builder; emits a one-line
#                                      DEPRECATED warning that we surface
#                                      with a hint to install buildx.
#
# Note: setting DOCKER_BUILDKIT=1 *without* the buildx plugin breaks
# outright on recent docker CLIs ("buildx component missing"), so we
# don't try that path.
build_helper_image() {
  echo ">> Ensuring helper image is up to date..."
  if docker buildx version >/dev/null 2>&1; then
    docker buildx build \
      --quiet --load \
      -f "$DOCKERFILE" -t "$IMAGE_TAG" "$ROOT_DIR" >/dev/null
  else
    # Explicitly UN-set DOCKER_BUILDKIT in case it leaked in from the
    # caller's shell — otherwise the legacy build would error with
    # "buildx component missing" instead of just warning.
    DOCKER_BUILDKIT="" docker build \
      --quiet \
      -f "$DOCKERFILE" -t "$IMAGE_TAG" "$ROOT_DIR" >/dev/null
    echo "   (tip: install the buildx plugin to silence the legacy-builder warning:"
    echo "         Arch/Manjaro:  sudo pacman -S docker-buildx"
    echo "         Debian/Ubuntu: sudo apt install docker-buildx-plugin)"
  fi
}

# Single entry point that runs a shell snippet inside the helper.
# All file writes go to the bind-mount at /workspace.
#
# `set -eu` is prepended to the inline script so any failed command
# aborts immediately — without this, npm install failing was silently
# followed by a "rebuilt dependencies successfully" line that masked
# the real error.
run_in_container() {
  local workdir="$1"
  local script="$2"
  mkdir -p "$CACHE_DIR"
  docker run --rm \
    --user "$(id -u):$(id -g)" \
    -v "$ROOT_DIR:/workspace" \
    -v "$CACHE_DIR:/tmp/build-home/.npm" \
    -w "/workspace/$workdir" \
    -e HOME=/tmp/build-home \
    "$IMAGE_TAG" \
    sh -c "set -eu; $script"
}

install_backend() {
  echo ">> backend: regenerating lockfile + installing deps..."
  run_in_container "backend" '
    rm -f package-lock.json
    npm install --ignore-scripts
    npm rebuild better-sqlite3
  '
}

install_frontend() {
  echo ">> frontend: regenerating lockfile + installing deps..."
  run_in_container "frontend" '
    rm -f package-lock.json
    npm install --ignore-scripts
    npm rebuild esbuild
  '
}

lockfile_only_backend() {
  echo ">> backend: regenerating package-lock.json (no install)..."
  run_in_container "backend" '
    rm -f package-lock.json
    npm install --package-lock-only --ignore-scripts
  '
}

lockfile_only_frontend() {
  echo ">> frontend: regenerating package-lock.json (no install)..."
  run_in_container "frontend" '
    rm -f package-lock.json
    npm install --package-lock-only --ignore-scripts
  '
}

build_backend() {
  install_backend
  echo ">> backend: building dist/..."
  run_in_container "backend" "npm run build"
}

build_frontend() {
  install_frontend
  echo ">> frontend: building dist/..."
  run_in_container "frontend" "npm run build"
}

cmd="${1:-install}"

case "$cmd" in
  install)
    build_helper_image
    install_backend
    install_frontend
    echo ">> Done. Lockfiles + node_modules ready in backend/ and frontend/."
    ;;
  build)
    build_helper_image
    build_backend
    build_frontend
    echo ">> Done. Build artefacts in backend/dist/ and frontend/dist/."
    ;;
  lockfile)
    build_helper_image
    lockfile_only_backend
    lockfile_only_frontend
    echo ">> Done. package-lock.json regenerated in both projects."
    ;;
  shell)
    build_helper_image
    mkdir -p "$CACHE_DIR"
    docker run --rm -it \
      --user "$(id -u):$(id -g)" \
      -v "$ROOT_DIR:/workspace" \
      -v "$CACHE_DIR:/tmp/build-home/.npm" \
      -w "/workspace" \
      -e HOME=/tmp/build-home \
      "$IMAGE_TAG" sh
    ;;
  clean)
    echo ">> Removing node_modules/ and dist/ from backend + frontend..."
    rm -rf "$ROOT_DIR/backend/node_modules"  "$ROOT_DIR/backend/dist"
    rm -rf "$ROOT_DIR/frontend/node_modules" "$ROOT_DIR/frontend/dist"
    rm -rf "$ROOT_DIR/.build-cache"
    # Best-effort: remove a leftover named cache volume from the
    # initial release of build.sh. Silent if it doesn't exist.
    docker volume rm ai-callback-npm-cache >/dev/null 2>&1 || true
    echo ">> Done."
    ;;
  help|-h|--help)
    sed -n '2,18p' "$0"
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    echo "Try: $0 help" >&2
    exit 2
    ;;
esac
