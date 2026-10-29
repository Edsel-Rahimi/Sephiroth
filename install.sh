#!/usr/bin/env bash
# =============================================================================
#  Sephiroth — Next-Gen Xray Panel · one-click installer (3x-ui style)
#
#  Usage:
#    bash <(curl -Ls https://raw.githubusercontent.com/Edsel-Rahimi/sephiroth/main/install.sh)
#    bash <(curl -Ls https://raw.githubusercontent.com/Edsel-Rahimi/sephiroth/main/install.sh) v2.4.0   # pin a version/tag
#    SEPH_NONINTERACTIVE=1 bash install.sh                 # unattended (writes /etc/sephiroth/install-result.env)
#    SEPH_LOCAL_DIR=/path/to/repo bash install.sh          # offline install from a local directory
#
#  What it does:
#    1. installs base deps (curl, git, tar, openssl) via the detected package manager
#    2. installs Node.js 22 if node < 20 is present
#    3. clones Edsel-Rahimi/sephiroth into /opt/sephiroth (git fetch + tag checkout on re-run)
#    4. builds the SPA (vite) and bundles a single-file server.cjs (esbuild, zero node_modules runtime)
#    5. writes /etc/sephiroth/sephiroth.env, a hardened systemd unit, and the `sephiroth` CLI
#    6. starts the service, waits for readiness and prints the credentials
#
#  Re-running this script = update (db/, /etc/sephiroth/* and installed credentials are preserved).
# =============================================================================
set -o pipefail

# ------------------------------------------------------------------ constants
REPO_URL="https://github.com/Edsel-Rahimi/sephiroth"
RAW_PKG_URL="https://raw.githubusercontent.com/Edsel-Rahimi/sephiroth/main/package.json"
INSTALL_DIR="/opt/sephiroth"
ENV_DIR="/etc/sephiroth"
ENV_FILE="$ENV_DIR/sephiroth.env"
RESULT_FILE="$ENV_DIR/install-result.env"
SERVICE_NAME="sephiroth"
CLI_LINK="/usr/bin/sephiroth"
NODE_MIN_MAJOR=20
NODE_INSTALL_MAJOR=22
NODE_INSTALL_VERSION="v22.14.0" # pinned binary-tarball release for non-apt distros
PORT_RANGE_LOW=20580
PORT_RANGE_HIGH=21000

# ------------------------------------------------------------------ ui helpers
if [[ -t 1 ]]; then
  C_RESET='\033[0m'; C_GREEN='\033[0;32m'; C_YELLOW='\033[1;33m'; C_RED='\033[0;31m'
  C_CYAN='\033[0;36m'; C_BOLD='\033[1m'; C_DIM='\033[2m'
else
  C_RESET=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_CYAN=''; C_BOLD=''; C_DIM=''
fi
info()  { printf "${C_GREEN}[INFO]${C_RESET}  %s\n" "$*"; }
warn()  { printf "${C_YELLOW}[WARN]${C_RESET}  %s\n" "$*"; }
err()   { printf "${C_RED}[ERROR]${C_RESET} %s\n" "$*"; }
dim()   { printf "${C_DIM}%s${C_RESET}\n" "$*"; }
banner() {
  printf "${C_CYAN}${C_BOLD}\n"
  cat <<'EOF'
   ███████ ███████ ██ ███████ ██████  ██╗  ██╗
   ██      ██      ██ ██      ██   ██ ██  ██╔╝
   ███████ ███████ ██ █████   ██████  █████╔╝
        ██ ██      ██ ██      ██   ██ ██╔═██╗
   ███████ ██      ██ ███████ ██   ██ ██║  ██╗
   ── Next-Gen Xray Panel · one-click installer ──
EOF
  printf "${C_RESET}\n"
}

# ------------------------------------------------------- re-exec under bash
# `curl -Ls ... | sh` and `sh install.sh` must both work (Alpine ships sh only).
if [[ -z "${BASH_VERSION:-}" ]]; then
  if command -v bash >/dev/null 2>&1; then
    exec bash "$0" "$@"
  fi
  printf 'ERROR: this installer requires bash (apk add bash / apt-get install bash)\n' >&2
  exit 1
fi

VERSION_ARG="${1:-}"
case "$VERSION_ARG" in
  -h|--help)
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
    exit 0 ;;
  v[0-9]*|[0-9]*)
    [[ "$VERSION_ARG" == v* ]] || VERSION_ARG="v$VERSION_ARG" ;;
  "")
    VERSION_ARG="" ;;
  *)
    err "unknown argument: $VERSION_ARG (expected a tag like v2.4.0)"; exit 1 ;;
esac

# ------------------------------------------------------------------ root check
is_container() {
  [[ -f /.dockerenv ]] && return 0
  [[ -f /run/.containerenv ]] && return 0
  if grep -Eaq 'docker|containerd|kubepods|lxc|podman' /proc/1/cgroup 2>/dev/null; then return 0; fi
  return 1
}
if [[ "$(id -u)" -ne 0 ]]; then
  if is_container; then
    warn "not running as root inside a container — continuing (files may be owned by the container user)"
  else
    err "please run as root:  sudo bash install.sh"
    exit 1
  fi
fi

NONINTERACTIVE=0
if [[ "${SEPH_NONINTERACTIVE:-0}" == "1" || ! -t 0 ]]; then
  NONINTERACTIVE=1
fi

# ------------------------------------------------------------------ os / arch
OS_ID="unknown"; OS_FAMILY="unknown"; OS_PRETTY="unknown OS"
if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  OS_ID="${ID:-unknown}"
  OS_PRETTY="${PRETTY_NAME:-$OS_ID}"
  case "${ID_LIKE:-}" in *debian*) OS_FAMILY=debian ;; *rhel*|*fedora*|*suse*) OS_FAMILY=rhel ;; esac
fi
case "$OS_ID" in
  ubuntu|debian|linuxmint|raspbian)   OS_FAMILY=debian ;;
  centos|rhel|rocky|almalinux|fedora|ol|amzn|sles|opensuse*|suse) OS_FAMILY=rhel ;;
  alpine)                             OS_FAMILY=alpine ;;
  arch|manjaro|endeavouros|cachyos)   OS_FAMILY=arch ;;
esac

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64)          NODE_ARCH="x64";   DEB_ARCH="amd64" ;;
  aarch64|arm64)         NODE_ARCH="arm64"; DEB_ARCH="arm64" ;;
  *)
    err "unsupported architecture: $ARCH (supported: x86_64, aarch64)"
    exit 1 ;;
esac

info "detected: ${OS_PRETTY} (${OS_FAMILY}) · ${ARCH}"

# ------------------------------------------------------------ package manager
PKG=""
if command -v apt-get >/dev/null 2>&1; then PKG="apt-get"
elif command -v dnf >/dev/null 2>&1; then PKG="dnf"
elif command -v yum >/dev/null 2>&1; then PKG="yum"
elif command -v apk >/dev/null 2>&1; then PKG="apk"
elif command -v pacman >/dev/null 2>&1; then PKG="pacman"
fi

pkg_install() {
  info "installing packages: $*"
  case "$PKG" in
    apt-get) DEBIAN_FRONTEND=noninteractive apt-get install -y "$@" >/dev/null ;;
    dnf)     dnf install -y -q "$@" >/dev/null ;;
    yum)     yum install -y -q "$@" >/dev/null ;;
    apk)     apk add --no-cache -q "$@" >/dev/null ;;
    pacman)  pacman -Sy --noconfirm --needed "$@" >/dev/null ;;
    *) return 1 ;;
  esac
}

install_base_deps() {
  if [[ -z "$PKG" ]]; then
    warn "no supported package manager found — assuming curl/git/tar/openssl are already present"
    return 0
  fi
  # refresh indexes lazily (apt only)
  if [[ "$PKG" == "apt-get" ]]; then apt-get update -qq >/dev/null 2>&1 || true; fi
  local missing=()
  local c
  for c in curl git tar openssl; do
    command -v "$c" >/dev/null 2>&1 || missing+=("$c")
  done
  # `ip` is useful for LAN-IP detection but optional
  if [[ ${#missing[@]} -gt 0 ]]; then
    pkg_install "${missing[@]}" ca-certificates || { err "failed to install base dependencies"; exit 1; }
  fi
  if [[ "$OS_FAMILY" == "alpine" && ! -x /bin/bash ]]; then
    pkg_install bash
  fi
}

# ------------------------------------------------------------------ node.js
node_major() { node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1; }

install_node() {
  if command -v node >/dev/null 2>&1; then
    local major; major="$(node_major)"
    if [[ -n "$major" && "$major" -ge "$NODE_MIN_MAJOR" ]] 2>/dev/null; then
      info "node $(node -v) already installed (>= ${NODE_MIN_MAJOR}) — skipping"
      return 0
    fi
    warn "node $(node -v 2>/dev/null || echo 'missing') is too old (need >= ${NODE_MIN_MAJOR}) — installing Node ${NODE_INSTALL_MAJOR}.x"
  else
    info "node not found — installing Node ${NODE_INSTALL_MAJOR}.x"
  fi

  case "$OS_FAMILY" in
    debian)
      if curl -fsSL "https://deb.nodesource.com/setup_${NODE_INSTALL_MAJOR}.x" | bash - >/dev/null 2>&1 \
         && pkg_install nodejs; then
        info "NodeSource Node.js installed: $(node -v)"
        return 0
      fi
      warn "NodeSource install failed — falling back to official binary tarball"
      ;;
    alpine)
      if pkg_install nodejs npm && [[ "$(node_major)" -ge "$NODE_MIN_MAJOR" ]] 2>/dev/null; then
        info "alpine nodejs installed: $(node -v)"
        return 0
      fi
      warn "alpine nodejs too old or unavailable — trying official binary tarball (glibc; on musl prefer 'apk add nodejs npm' from a newer repo)"
      ;;
    rhel|arch)
      if pkg_install nodejs && [[ "$(node_major)" -ge "$NODE_MIN_MAJOR" ]] 2>/dev/null; then
        info "distro nodejs installed: $(node -v)"
        return 0
      fi
      ;;
    *) : ;;
  esac

  # -------- official binary tarball fallback (works everywhere with glibc)
  local node_dir="/usr/local/lib/nodejs/node-${NODE_INSTALL_VERSION}-linux-${NODE_ARCH}"
  local url="https://nodejs.org/dist/${NODE_INSTALL_VERSION}/node-${NODE_INSTALL_VERSION}-linux-${NODE_ARCH}.tar.gz"
  info "downloading Node.js ${NODE_INSTALL_VERSION} (${NODE_ARCH}) from nodejs.org"
  curl -fsSL "$url" -o /tmp/seph-node.tar.gz || { err "node tarball download failed"; exit 1; }
  mkdir -p /usr/local/lib/nodejs
  rm -rf "$node_dir" /tmp/seph-node-extract
  mkdir -p /tmp/seph-node-extract
  tar -xzf /tmp/seph-node.tar.gz -C /tmp/seph-node-extract
  mv "/tmp/seph-node-extract/node-${NODE_INSTALL_VERSION}-linux-${NODE_ARCH}" "$node_dir"
  rm -f /tmp/seph-node.tar.gz
  rm -rf /tmp/seph-node-extract
  ln -sf "$node_dir/bin/node" /usr/local/bin/node
  ln -sf "$node_dir/bin/npm"  /usr/local/bin/npm
  ln -sf "$node_dir/bin/npx"  /usr/local/bin/npx
  hash -r
  command -v node >/dev/null 2>&1 || { err "node installation failed"; exit 1; }
  info "node installed: $(node -v)"
}

# ------------------------------------------------------------------ helpers
pick_free_port() {
  local candidate i
  for i in $(seq 1 300); do
    if command -v shuf >/dev/null 2>&1; then
      candidate="$(shuf -i ${PORT_RANGE_LOW}-${PORT_RANGE_HIGH} -n 1)"
    else
      candidate=$(( PORT_RANGE_LOW + (RANDOM * 32768 + RANDOM) % (PORT_RANGE_HIGH - PORT_RANGE_LOW + 1) ))
    fi
    if port_free "$candidate"; then
      printf '%s' "$candidate"; return 0
    fi
  done
  printf '%s' "$PORT_RANGE_LOW"
}

port_free() {
  ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

gen_password() {
  # random 16-char alphanumeric (openssl preferred, /dev/urandom fallback)
  local pw=""
  if command -v openssl >/dev/null 2>&1; then
    pw="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 16)"
  fi
  while [[ ${#pw} -lt 16 ]]; do
    pw="${pw}$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 16)"
  done
  printf '%s' "${pw:0:16}"
}

detect_public_ip() {
  local ip=""
  for src in "https://api.ipify.org" "https://ifconfig.me" "https://icanhazip.com"; do
    ip="$(curl -4 -m 5 -s "$src" 2>/dev/null | tr -d '[:space:]')"
    [[ "$ip" =~ ^[0-9a-fA-F.:]+$ ]] && { printf '%s' "$ip"; return 0; }
  done
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  [[ -n "$ip" ]] && { printf '%s' "$ip"; return 0; }
  printf '127.0.0.1'
}

# --------------------------------------------------------- fetch source tree
fetch_source() {
  local ref="" mode="main"
  if [[ -n "$VERSION_ARG" ]]; then ref="$VERSION_ARG"; mode="tag"; fi

  if [[ -n "${SEPH_LOCAL_DIR:-}" ]]; then
    info "installing from local directory: $SEPH_LOCAL_DIR"
    [[ -d "$SEPH_LOCAL_DIR" ]] || { err "SEPH_LOCAL_DIR does not exist: $SEPH_LOCAL_DIR"; exit 1; }
    mkdir -p "$INSTALL_DIR"
    tar -C "$SEPH_LOCAL_DIR" \
      --exclude='./node_modules' --exclude='./.git' --exclude='./db' \
      --exclude='./dist' --exclude='./.env' --exclude='./server.cjs' \
      -cf - . | tar -C "$INSTALL_DIR" -xf -
    dim "local source copied"
    return 0
  fi

  if [[ -d "$INSTALL_DIR/.git" ]]; then
    info "existing install found — updating source tree"
    git -C "$INSTALL_DIR" fetch --tags --force --prune origin >/dev/null 2>&1 || \
      warn "git fetch failed (offline?) — rebuilding from the currently checked-out tree"
    if [[ "$mode" == "tag" ]]; then
      git -C "$INSTALL_DIR" checkout -q -f "refs/tags/${ref}" 2>/dev/null \
        || { err "tag not found: ${ref} (does it exist on ${REPO_URL}? releases must be tagged for version pinning)"; exit 1; }
      info "checked out ${ref}"
    else
      git -C "$INSTALL_DIR" reset --hard -q origin/HEAD 2>/dev/null \
        || git -C "$INSTALL_DIR" reset --hard -q origin/main \
        || git -C "$INSTALL_DIR" reset --hard -q
      info "source tree updated to origin/main"
    fi
    return 0
  fi

  info "cloning ${REPO_URL} → ${INSTALL_DIR}"
  rm -rf "$INSTALL_DIR"
  if [[ "$mode" == "tag" ]]; then
    git clone -q --depth 1 --branch "$ref" "$REPO_URL" "$INSTALL_DIR" 2>/dev/null \
      || { err "tag not found: ${ref} (releases must be tagged on ${REPO_URL} for version pinning)"; exit 1; }
    info "cloned at tag ${ref}"
  else
    git clone -q --depth 1 "$REPO_URL" "$INSTALL_DIR" || { err "git clone failed — check network connectivity"; exit 1; }
    info "cloned default branch"
  fi
}

# ------------------------------------------------------------------ build
build_panel() {
  cd "$INSTALL_DIR" || { err "cannot cd $INSTALL_DIR"; exit 1; }
  info "installing node dependencies (this can take a minute)…"
  # --legacy-peer-deps: devDep esbuild 0.25 (used for server bundling) sits
  # outside vite 8's peerOptional range; bun accepts it, strict npm needs the flag
  npm install --no-audit --no-fund --legacy-peer-deps >/dev/null 2>&1 \
    || { err "npm install failed — retrying with full output"; npm install --no-audit --no-fund --legacy-peer-deps; exit 1; }

  info "building the SPA (vite)…"
  npm run build >/dev/null 2>&1 \
    || { err "vite build failed"; exit 1; }
  [[ -d "$INSTALL_DIR/dist" ]] || { err "vite produced no dist/ directory"; exit 1; }

  info "bundling single-file server (esbuild → server.cjs, zero node_modules runtime)…"
  ./node_modules/.bin/esbuild server.ts \
    --bundle --platform=node --format=cjs \
    --alias:@="$INSTALL_DIR/src" \
    --alias:next/server="$INSTALL_DIR/src/lib/shims/next-server.ts" \
    --alias:next/image="$INSTALL_DIR/src/lib/shims/next-image.tsx" \
    --alias:next/navigation="$INSTALL_DIR/src/lib/shims/next-navigation.ts" \
    --external:vite \
    --outfile="$INSTALL_DIR/server.cjs" \
    --log-level=warning \
    || { err "esbuild bundle failed"; exit 1; }
  [[ -f "$INSTALL_DIR/server.cjs" ]] || { err "server.cjs was not produced"; exit 1; }

  # production runtime needs neither node_modules nor the build toolchain
  rm -rf "$INSTALL_DIR/node_modules"
  dim "build complete: dist/ + server.cjs ($(du -h "$INSTALL_DIR/server.cjs" | cut -f1))"
}

# ------------------------------------------------------------------ env file
write_env_file() {
  mkdir -p "$ENV_DIR"
  if [[ -f "$ENV_FILE" ]]; then
    info "existing config found: $ENV_FILE (preserved)"
    # keep shell-agnostic: load PORT / creds for reporting
    # shellcheck disable=SC1090
    set -a; . "$ENV_FILE"; set +a
    ADMIN_USER="${SEPHIROTH_ADMIN_USER:-admin}"
    ADMIN_PASS="${SEPHIROTH_ADMIN_PASS:-}"
    PANEL_PORT="${PORT:-$(pick_free_port)}"
    return 0
  fi

  local port user pass
  if (( NONINTERACTIVE )); then
    port="$(pick_free_port)"
    user="admin"
    pass="$(gen_password)"
  else
    local default_port; default_port="$(pick_free_port)"
    printf "\n"
    read -r -p "Panel port [${default_port}]: " port
    port="${port:-$default_port}"
    while ! [[ "$port" =~ ^[0-9]+$ ]] || (( port < 1 || port > 65535 )); do
      read -r -p "Invalid port. Panel port [${default_port}]: " port; port="${port:-$default_port}"
    done
    read -r -p "Admin username [admin]: " user; user="${user:-admin}"
    local default_pass; default_pass="$(gen_password)"
    read -r -p "Admin password [${default_pass}]: " pass; pass="${pass:-$default_pass}"
    printf "\n"
    warn "write these credentials down — the panel password is stored hashed and ${C_BOLD}cannot${C_RESET}${C_YELLOW} be recovered"
    printf "  URL:      ${C_BOLD}http://<server-ip>:%s${C_RESET}\n" "$port"
    printf "  User:     ${C_BOLD}%s${C_RESET}\n" "$user"
    printf "  Password: ${C_BOLD}%s${C_RESET}\n" "$pass"
    if (( ! NONINTERACTIVE )); then
      local yn=""
      read -r -p "Continue with these settings? [Y/n]: " yn
      case "$yn" in n*|N*) err "aborted by user"; exit 1 ;; esac
    fi
  fi

  cat > "$ENV_FILE" <<EOF
# /etc/sephiroth/sephiroth.env — generated by install.sh ($(date -u '+%Y-%m-%dT%H:%M:%SZ'))
# Panel listens on this port (systemd EnvironmentFile)
PORT=${port}
NODE_ENV=production
# Seeds the FIRST admin only — ignored once an admin exists in db/sephiroth-store.json
SEPHIROTH_ADMIN_USER=${user}
SEPHIROTH_ADMIN_PASS=${pass}
# auto = session cookie Secure flag derived from the request (HTTPS behind proxy → secure)
SEPH_COOKIE_SECURE=auto
EOF
  chmod 600 "$ENV_FILE"
  ADMIN_USER="$user"
  ADMIN_PASS="$pass"
  PANEL_PORT="$port"
}

# ------------------------------------------------------- install-result.env
write_result_file() {
  local public_ip url
  public_ip="$(detect_public_ip)"
  url="http://${public_ip}:${PANEL_PORT}"
  local old_umask; old_umask="$(umask)"
  umask 077
  cat > "$RESULT_FILE" <<EOF
# Sephiroth installer result — generated $(date -u '+%Y-%m-%dT%H:%M:%SZ')
SEPHIROTH_VERSION=${PANEL_VERSION:-unknown}
SEPHIROTH_INSTALL_DIR=${INSTALL_DIR}
PORT=${PANEL_PORT}
PANEL_URL=${url}
SEPHIROTH_ADMIN_USER=${ADMIN_USER}
SEPHIROTH_ADMIN_PASS=${ADMIN_PASS}
SEPHIROTH_SERVICE=${SERVICE_NAME}
EOF
  umask "$old_umask"
  chmod 600 "$RESULT_FILE"
  info "credentials written to ${RESULT_FILE} (0600)"
}

# -------------------------------------------------------------- systemd unit
SYSTEMD_AVAILABLE=0
SYSTEMD_HARDENING=0
if command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; then
  SYSTEMD_AVAILABLE=1
  sd_ver="$(systemctl --version 2>/dev/null | head -n1 | awk '{print $2}')"
  if [[ -n "$sd_ver" && "$sd_ver" -ge 239 ]] 2>/dev/null; then
    SYSTEMD_HARDENING=1
  fi
fi

write_systemd_unit() {
  if (( ! SYSTEMD_AVAILABLE )); then
    warn "systemd not detected (Alpine/containers) — skipping service unit"
    return 0
  fi
  local node_bin hardening=""
  node_bin="$(command -v node || echo /usr/bin/node)"
  if (( SYSTEMD_HARDENING )); then
    hardening=$'\n# sandboxing (requires systemd >= 239)\nNoNewPrivileges=yes\nProtectSystem=full\nPrivateTmp=yes\nProtectHome=yes'
  else
    warn "systemd < 239 detected — writing unit without sandboxing directives"
  fi
  cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Sephiroth Panel (Next-Gen Xray Panel)
Documentation=${REPO_URL}
After=network.target
Wants=network.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=${node_bin} --max-old-space-size=512 ${INSTALL_DIR}/server.cjs
Restart=on-failure
RestartSec=5
LimitNOFILE=65535${hardening}

[Install]
WantedBy=multi-user.target
EOF
  info "systemd unit installed: /etc/systemd/system/${SERVICE_NAME}.service"
}

install_cli() {
  mkdir -p "$(dirname "$CLI_LINK")"
  # prefer a symlink; fall back to a tiny exec-wrapper when symlinks are denied
  if ! ln -sf "$INSTALL_DIR/scripts/sephiroth-cli.sh" "$CLI_LINK" 2>/dev/null; then
    printf '#!/bin/sh\nexec "%s/scripts/sephiroth-cli.sh" "$@"\n' "$INSTALL_DIR" > "$CLI_LINK"
    chmod +x "$CLI_LINK"
  fi
  chmod +x "$INSTALL_DIR/scripts/sephiroth-cli.sh" 2>/dev/null || true
  chmod +x "$INSTALL_DIR/install.sh" 2>/dev/null || true
  info "management CLI installed: ${CLI_LINK}  (run: ${C_BOLD}sephiroth${C_RESET})"
}

wait_ready() {
  local port="$1" i code=""
  for i in $(seq 1 45); do
    code="$(curl -s -o /dev/null -w '%{http_code}' -m 2 "http://127.0.0.1:${port}/api/auth/session" 2>/dev/null || true)"
    if [[ "$code" == "200" ]]; then return 0; fi
    sleep 1
  done
  return 1
}

start_service() {
  if (( SYSTEMD_AVAILABLE )); then
    systemctl daemon-reload
    systemctl enable "${SERVICE_NAME}" >/dev/null 2>&1
    systemctl restart "${SERVICE_NAME}"
    info "service ${SERVICE_NAME} enabled + started"
  else
    warn "no systemd — managing the panel via the sephiroth CLI"
    if "$CLI_LINK" status >/dev/null 2>&1; then
      "$CLI_LINK" restart
    else
      "$CLI_LINK" start
    fi
  fi
}

print_summary() {
  local public_ip url service_cmds
  public_ip="$(detect_public_ip)"
  url="http://${public_ip}:${PANEL_PORT}"
  if (( SYSTEMD_AVAILABLE )); then
    service_cmds="systemctl {start|stop|restart|status} ${SERVICE_NAME}"
  else
    service_cmds="${CLI_LINK} {start|stop|restart|status}"
  fi
  printf "\n"
  printf "${C_GREEN}${C_BOLD}╔══════════════════════════════════════════════════════════════╗${C_RESET}\n"
  printf "${C_GREEN}${C_BOLD}║              Sephiroth Panel installed successfully           ║${C_RESET}\n"
  printf "${C_GREEN}${C_BOLD}╠══════════════════════════════════════════════════════════════╣${C_RESET}\n"
  printf "${C_GREEN}${C_BOLD}║${C_RESET}  Version : ${C_BOLD}%-52s${C_GREEN}${C_BOLD}║${C_RESET}\n" "${PANEL_VERSION:-unknown}"
  printf "${C_GREEN}${C_BOLD}║${C_RESET}  URL     : ${C_BOLD}%-52s${C_GREEN}${C_BOLD}║${C_RESET}\n" "$url"
  printf "${C_GREEN}${C_BOLD}║${C_RESET}  User    : ${C_BOLD}%-52s${C_GREEN}${C_BOLD}║${C_RESET}\n" "$ADMIN_USER"
  printf "${C_GREEN}${C_BOLD}║${C_RESET}  Password: ${C_BOLD}%-52s${C_GREEN}${C_BOLD}║${C_RESET}\n" "${ADMIN_PASS:-(unchanged — see ${RESULT_FILE})}"
  printf "${C_GREEN}${C_BOLD}║${C_RESET}  Port    : ${C_BOLD}%-52s${C_GREEN}${C_BOLD}║${C_RESET}\n" "$PANEL_PORT"
  printf "${C_GREEN}${C_BOLD}╠══════════════════════════════════════════════════════════════╣${C_RESET}\n"
  printf "${C_GREEN}${C_BOLD}║${C_RESET}  Service : ${C_BOLD}%-52s${C_GREEN}${C_BOLD}║${C_RESET}\n" "$service_cmds"
  printf "${C_GREEN}${C_BOLD}║${C_RESET}  Menu    : ${C_BOLD}%-52s${C_GREEN}${C_BOLD}║${C_RESET}\n" "sephiroth"
  printf "${C_GREEN}${C_BOLD}║${C_RESET}  Config  : ${C_BOLD}%-52s${C_GREEN}${C_BOLD}║${C_RESET}\n" "$ENV_FILE"
  printf "${C_GREEN}${C_BOLD}║${C_RESET}  Data    : ${C_BOLD}%-52s${C_GREEN}${C_BOLD}║${C_RESET}\n" "${INSTALL_DIR}/db/"
  printf "${C_GREEN}${C_BOLD}╚══════════════════════════════════════════════════════════════╝${C_RESET}\n"
  printf "\n"
}

# ------------------------------------------------------------------ main
main() {
  banner
  install_base_deps
  install_node
  fetch_source
  build_panel
  PANEL_VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$INSTALL_DIR/package.json" 2>/dev/null || true)"
  write_env_file
  write_result_file
  write_systemd_unit
  install_cli
  start_service

  info "waiting for the panel to answer on port ${PANEL_PORT}…"
  if wait_ready "$PANEL_PORT"; then
    info "panel is up and answering on http://127.0.0.1:${PANEL_PORT}"
  else
    warn "panel did not answer within 45s — check: journalctl -u ${SERVICE_NAME} -e  (or ${INSTALL_DIR}/sephiroth.log without systemd)"
    warn "the service may simply need more time on first boot — try again with: sephiroth status"
  fi
  print_summary
  info "done."
}

main
