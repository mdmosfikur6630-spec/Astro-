#!/usr/bin/env bash
# Astro installer: installs the Astro build of OpenClaw globally and exposes `astro` + `openclaw`.
#
#   curl -fsSL https://raw.githubusercontent.com/mdmosfikur6630-spec/Astro-/main/install.sh | bash
#
# Options (environment variables):
#   ASTRO_REPO=owner/name     GitHub repository to install from (default: mdmosfikur6630-spec/Astro-)
#   ASTRO_VERSION=<tag>       Release tag to install (default: latest release)
#   ASTRO_FROM_SOURCE=1       Skip the prebuilt release and build from a source checkout (~10 min)
#   ASTRO_NO_ONBOARD=1        Do not launch the onboarding wizard after installing
set -euo pipefail

ASTRO_REPO="${ASTRO_REPO:-mdmosfikur6630-spec/Astro-}"
ASTRO_VERSION="${ASTRO_VERSION:-}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/astro-install.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

log() { printf '\033[1;36m[astro]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[astro] %s\033[0m\n' "$*" >&2; exit 1; }

need_node() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -p 'process.versions.node.split(".")[0]')"
    if [ "$major" -ge 24 ]; then
      return 0
    fi
    log "Node $(node -v) found; Astro needs Node 24.16+ or 26.1+."
  else
    log "Node.js not found."
  fi
  if command -v mise >/dev/null 2>&1; then
    log "Installing Node 24 with mise…"
    mise use -g node@24 >/dev/null
    eval "$(mise env -s bash)"
  elif command -v brew >/dev/null 2>&1; then
    log "Installing Node 24 with Homebrew…"
    brew install node@24 >/dev/null
    export PATH="$(brew --prefix node@24)/bin:$PATH"
  else
    die "Install Node.js 24+ first (https://nodejs.org), then rerun this script."
  fi
}

install_tarball() {
  local tgz="$1"
  log "Installing $(basename "$tgz") globally with npm…"
  npm install -g "$tgz" --no-audit --no-fund \
    --allow-scripts=@google/genai,esbuild,protobufjs,openclaw >/dev/null 2>&1 ||
    npm install -g "$tgz" --no-audit --no-fund
}

install_from_release() {
  local api asset url
  if [ -n "$ASTRO_VERSION" ]; then
    api="https://api.github.com/repos/${ASTRO_REPO}/releases/tags/${ASTRO_VERSION}"
  else
    api="https://api.github.com/repos/${ASTRO_REPO}/releases/latest"
  fi
  log "Looking up release ${ASTRO_VERSION:-latest} from ${ASTRO_REPO}…"
  url="$(curl -fsSL "$api" 2>/dev/null | grep -o '"browser_download_url": *"[^"]*\.tgz"' | head -1 | sed 's/.*"\(https[^"]*\)"/\1/')" || true
  if [ -z "$url" ]; then
    return 1
  fi
  asset="$WORK/$(basename "$url")"
  log "Downloading $(basename "$url")…"
  curl -fL --progress-bar "$url" -o "$asset"
  install_tarball "$asset"
}

install_from_source() {
  log "Building from source (this takes about 10 minutes on 4 cores)…"
  command -v git >/dev/null 2>&1 || die "git is required for a source install."
  git clone --depth 1 "https://github.com/${ASTRO_REPO}.git" "$WORK/src" >/dev/null 2>&1
  (
    cd "$WORK/src"
    command -v corepack >/dev/null 2>&1 && corepack enable >/dev/null 2>&1 || true
    export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
    pnpm install --frozen-lockfile >/dev/null 2>&1 || pnpm install >/dev/null
    node scripts/package-openclaw-for-docker.mjs --allow-unreleased-changelog >/dev/null
  )
  install_tarball "$(ls "$WORK"/src/.artifacts/docker-e2e-package/*.tgz | head -1)"
}

main() {
  need_node
  if [ "${ASTRO_FROM_SOURCE:-0}" = "1" ] || ! install_from_release; then
    install_from_source
  fi
  command -v astro >/dev/null 2>&1 || die "astro was installed but is not on PATH; add $(npm prefix -g)/bin to PATH."
  log "Installed: $(astro --version)"
  log "Commands: astro (alias of openclaw). Try: astro gateway status · astro doctor · astro tui"
  if [ "${ASTRO_NO_ONBOARD:-0}" != "1" ] && [ -t 0 ] && [ ! -f "${HOME}/.openclaw/openclaw.json" ]; then
    log "No config found; starting onboarding (Ctrl+C to skip)."
    astro onboard || true
  fi
}

main "$@"
