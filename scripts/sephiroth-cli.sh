#!/usr/bin/env bash
# =============================================================================
#  Sephiroth — panel management CLI  (installed as /usr/bin/sephiroth)
#  3x-ui `x-ui` command parity: service control, logs, credentials, port,
#  backup/restore, update and uninstall.
#
#  Usage:
#    sephiroth              → interactive menu
#    sephiroth <command>    → start | stop | restart | status | logs | update | backup
# =============================================================================
set -o pipefail

SELF="$(readlink -f "${BASH_SOURCE[0]:-$0}")"
SEPH_ROOT="$(dirname "$(dirname "$SELF")")"
SEPH_SCRIPTS="$SEPH_ROOT/scripts"
SEPH_MAINT="$SEPH_SCRIPTS/sephiroth-maint.cjs"
ENV_FILE="${SEPH_ENV_FILE:-/etc/sephiroth/sephiroth.env}"
SERVICE_NAME="sephiroth"
LOG_FILE="$SEPH_ROOT/sephiroth.log"
PID_FILE="$SEPH_ROOT/sephiroth.pid"
INSTALLER="$SEPH_ROOT/install.sh"
BACKUP_DIR="$SEPH_ROOT/backups"
RAW_PKG_URL="https://raw.githubusercontent.com/Edsel-Rahimi/Sephiroth/main/package.json"

if [[ -t 1 ]]; then
  C_RESET='\033[0m'; C_GREEN='\033[0;32m'; C_YELLOW='\033[1;33m'; C_RED='\033[0;31m'
  C_CYAN='\033[0;36m'; C_BOLD='\033[1m'
else
  C_RESET=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_CYAN=''; C_BOLD=''
fi
info() { printf "${C_GREEN}[INFO]${C_RESET}  %s\n" "$*"; }
warn() { printf "${C_YELLOW}[WARN]${C_RESET}  %s\n" "$*"; }
err()  { printf "${C_RED}[ERROR]${C_RESET} %s\n" "$*"; }

HAVE_SYSTEMD=0
if command -v systemctl >/dev/null 2>&1 && [[ -d /run/systemd/system ]]; then
  HAVE_SYSTEMD=1
fi

NODE_BIN="$(command -v node || echo /usr/bin/node)"

get_port() {
  local p=""
  if [[ -r "$ENV_FILE" ]]; then
    p="$(sed -n 's/^PORT=//p' "$ENV_FILE" | head -n1 | tr -d '[:space:]')"
  fi
  printf '%s' "${p:-3000}"
}

maint() { # run maintenance helper with resolved node
  "$NODE_BIN" "$SEPH_MAINT" "$@"
}

svc_running() {
  if (( HAVE_SYSTEMD )); then
    systemctl is-active --quiet "$SERVICE_NAME"
  else
    [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null
  fi
}

svc_start() {
  if svc_running; then warn "already running"; return 0; fi
  if (( HAVE_SYSTEMD )); then
    systemctl start "$SERVICE_NAME" && info "service started"
  else
    if [[ ! -f "$ENV_FILE" ]]; then warn "missing $ENV_FILE — using NODE_ENV=production defaults"; fi
    # backgrounded subshell exec()s node → $! is the real node pid (reliable kill)
    ( set -a
      [[ -r "$ENV_FILE" ]] && . "$ENV_FILE"
      set +a
      cd "$SEPH_ROOT" && exec "$NODE_BIN" --max-old-space-size=512 server.cjs >> "$LOG_FILE" 2>&1
    ) >/dev/null 2>&1 &
    echo $! > "$PID_FILE"
    sleep 1
    if svc_running; then info "started (pid $(cat "$PID_FILE"), port $(get_port), log $LOG_FILE)"; else err "failed to start — see $LOG_FILE"; return 1; fi
  fi
}

svc_stop() {
  if (( HAVE_SYSTEMD )); then
    systemctl stop "$SERVICE_NAME" && info "service stopped"
  else
    local pid=""
    [[ -f "$PID_FILE" ]] && pid="$(cat "$PID_FILE" 2>/dev/null)"
    if [[ -z "$pid" ]]; then pid="$(pgrep -f "node .*server\.cjs" | head -n1)"; fi
    if [[ -z "$pid" ]]; then warn "not running"; return 0; fi
    kill "$pid" 2>/dev/null
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    kill -9 "$pid" 2>/dev/null || true
    rm -f "$PID_FILE"
    info "stopped (pid $pid)"
  fi
}

svc_restart() { svc_stop; sleep 1; svc_start; }

svc_force_restart() {
  if (( HAVE_SYSTEMD )); then
    systemctl stop "$SERVICE_NAME" 2>/dev/null
    sleep 1
    systemctl start "$SERVICE_NAME" && info "service force-restarted"
  else
    pkill -9 -f "node .*server\.cjs" 2>/dev/null || true
    rm -f "$PID_FILE"; sleep 1
    svc_start
  fi
}

svc_status() {
  if (( HAVE_SYSTEMD )); then
    systemctl status "$SERVICE_NAME" --no-pager -l
  else
    if svc_running; then
      info "running (pid $(cat "$PID_FILE"), port $(get_port))"
    else
      warn "not running"
      return 1
    fi
  fi
}

svc_logs_follow() {
  if (( HAVE_SYSTEMD )); then journalctl -u "$SERVICE_NAME" -f --no-pager; else tail -f "$LOG_FILE"; fi
}

svc_logs_100() {
  if (( HAVE_SYSTEMD )); then journalctl -u "$SERVICE_NAME" -n 100 --no-pager; else tail -n 100 "$LOG_FILE"; fi
}

change_password() {
  local p1 p2
  read -r -p "New admin password (min 6 chars): " -s p1; printf "\n"
  read -r -p "Confirm password: " -s p2; printf "\n"
  if [[ "$p1" != "$p2" ]]; then err "passwords do not match"; return 1; fi
  if (( ${#p1} < 6 )); then err "password too short (min 6 chars)"; return 1; fi
  info "stopping the panel to edit the store safely…"
  local was_running=0; svc_running && { was_running=1; svc_stop; }
  if maint set-password "$p1"; then
    info "admin password updated"
  else
    err "failed to update password"; (( was_running )) && svc_start; return 1
  fi
  (( was_running )) && svc_start
  info "done — log in with the new password"
}

change_port() {
  local port
  read -r -p "New panel port [1-65535]: " port
  if ! [[ "$port" =~ ^[0-9]+$ ]] || (( port < 1 || port > 65535 )); then
    err "invalid port"; return 1
  fi
  if ! (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then :; else
    err "port $port is already in use"; return 1
  fi
  if maint set-port "$port"; then
    info "port updated in $ENV_FILE"
    if (( HAVE_SYSTEMD )); then systemctl daemon-reload; fi
    svc_restart
    info "panel now listening on port $port"
  fi
}

backup_now() {
  maint backup || return 1
}

restore_backup() {
  mkdir -p "$BACKUP_DIR"
  if ! ls -t "$BACKUP_DIR"/sephiroth-backup-*.tar.gz >/dev/null 2>&1; then
    warn "no backups found in $BACKUP_DIR"; return 1
  fi
  info "available backups (newest first):"
  ls -1t "$BACKUP_DIR"/sephiroth-backup-*.tar.gz | nl -w2 -s'.  ' | sed 's|.*/||'
  local f
  read -r -p "Backup filename to restore (empty = newest): " f
  if [[ -z "$f" ]]; then f="$(ls -1t "$BACKUP_DIR"/sephiroth-backup-*.tar.gz | head -n1 | xargs basename)"; fi
  local path="$BACKUP_DIR/$f"
  [[ -f "$path" ]] || { err "no such backup: $path"; return 1; }
  local was_running=0; svc_running && { was_running=1; svc_stop; }
  if maint restore "$path"; then
    info "backup restored"
  else
    err "restore failed"; (( was_running )) && svc_start; return 1
  fi
  (( was_running )) && svc_start
}

check_update() {
  local current latest
  current="$(maint version 2>/dev/null | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
  [[ -z "$current" ]] && current="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$SEPH_ROOT/package.json" 2>/dev/null | head -n1)"
  latest="$(curl -fsSL -m 9 "$RAW_PKG_URL" 2>/dev/null | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
  if [[ -z "$latest" ]]; then err "could not reach GitHub to check the latest version"; return 1; fi
  info "current version: ${current:-unknown}"
  info "latest version : ${latest}"
  if [[ "${latest#v}" != "${current#v}" ]]; then
    info "an update may be available → menu item 13 (Update Panel)"
  else
    info "panel is up to date"
  fi
}

update_panel() {
  local tag=""
  read -r -p "Version/tag to install (empty = latest main): " tag
  [[ -n "$tag" ]] && case "$tag" in v[0-9]*|[0-9]*) [[ "$tag" == v* ]] || tag="v$tag" ;; *) tag="" ;; esac
  if [[ ! -f "$INSTALLER" ]]; then err "installer not found at $INSTALLER"; return 1; fi
  info "running the installer (db/ and /etc/sephiroth/* are preserved)…"
  SEPH_NONINTERACTIVE=1 bash "$INSTALLER" $tag
}

uninstall_panel() {
  warn "this will remove the Sephiroth panel from this machine"
  read -r -p "Type 'yes' to continue: " yn
  [[ "$yn" == "yes" ]] || { info "uninstall cancelled"; return 0; }
  if (( HAVE_SYSTEMD )); then
    systemctl stop "$SERVICE_NAME" 2>/dev/null
    systemctl disable "$SERVICE_NAME" 2>/dev/null
    rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
    systemctl daemon-reload 2>/dev/null
  else
    pkill -9 -f "node .*server\.cjs" 2>/dev/null || true
    rm -f "$PID_FILE"
  fi
  rm -f /usr/bin/sephiroth
  read -r -p "Also delete all data ($SEPH_ROOT incl. db/, and $ENV_FILE)? [y/N]: " yn2
  if [[ "$yn2" =~ ^[Yy] ]]; then
    rm -rf "$SEPH_ROOT" "$ENV_FILE" /etc/sephiroth
    info "panel + data removed"
  else
    rm -rf "$ENV_FILE"
    info "panel removed — data kept at $SEPH_ROOT (delete manually if needed)"
  fi
  info "uninstall complete"
}

menu() {
  local port
  while true; do
    port="$(get_port)"
    printf "\n${C_CYAN}${C_BOLD}──────── Sephiroth Panel Management ────────${C_RESET}\n"
    printf "  1.  Start                6.  Logs (follow)\n"
    printf "  2.  Stop                 7.  Logs (last 100)\n"
    printf "  3.  Restart              8.  Change Admin Password\n"
    printf "  4.  Force Restart        9.  Change Panel Port\n"
    printf "  5.  Status              10.  Backup Now\n"
    printf "  ${C_BOLD}0.  Exit${C_RESET}\n"
    printf "  11. Restore Backup      13. Update Panel\n"
    printf "  12. Check for Update    14. Uninstall\n"
    printf "${C_DIM}  panel: http://127.0.0.1:%s   root: %s${C_RESET}\n" "$port" "$SEPH_ROOT"
    local choice
    read -r -p "Choose an option [0-14]: " choice
    case "$choice" in
      0)  exit 0 ;;
      1)  svc_start ;;
      2)  svc_stop ;;
      3)  svc_restart ;;
      4)  svc_force_restart ;;
      5)  svc_status ;;
      6)  svc_logs_follow ;;
      7)  svc_logs_100 ;;
      8)  change_password ;;
      9)  change_port ;;
      10) backup_now ;;
      11) restore_backup ;;
      12) check_update ;;
      13) update_panel ;;
      14) uninstall_panel ;;
      *)  warn "unknown option: $choice" ;;
    esac
  done
}

case "${1:-}" in
  start)          svc_start ;;
  stop)           svc_stop ;;
  restart)        svc_restart ;;
  force-restart)  svc_force_restart ;;
  status)         svc_status ;;
  logs)           svc_logs_follow ;;
  update)         update_panel ;;
  backup)         backup_now ;;
  menu|"")        menu ;;
  -h|--help)      sed -n '2,12p' "$SELF" | sed 's/^# \{0,1\}//' ;;
  *)              err "unknown command: $1 (try: sephiroth)"; exit 1 ;;
esac
