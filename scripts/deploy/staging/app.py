# Sephiroth production bootstrap (KataBump Python egg → portable Node).
#
# The egg runs: python /home/container/app.py
# This file execs the portable Node binary with server.js.
import os
import shutil
import subprocess
import sys
import tarfile

BASE = os.path.dirname(os.path.abspath(__file__))
RUNTIME = os.path.join(BASE, "runtime")
NODE_TARBALL = os.path.join(RUNTIME, "node.tar.xz")
NODE = os.path.join(RUNTIME, "bin", "node")
SERVER = os.path.join(BASE, "server.js")
LOG = os.path.join(BASE, "node.log")


def log(*a):
    print("[sephiroth-launcher]", *a, flush=True)


# ── first boot: extract the node tarball if the binary is missing ─────────
if not os.path.exists(NODE) and os.path.exists(NODE_TARBALL):
    log("extracting node runtime ...")
    import lzma

    try:
        with tarfile.open(fileobj=lzma.LZMAFile(NODE_TARBALL, mode="rb"), mode="r") as tar:
            members = []
            for m in tar.getmembers():
                parts = m.name.split("/", 1)
                if len(parts) == 2:
                    m.name = parts[1]
                    members.append(m)
            tar.extractall(RUNTIME, members)
        log("extracted")
    except Exception as e:
        log("extract failed:", repr(e))
        sys.exit(1)

if not os.path.exists(NODE):
    log("FATAL: node runtime missing at", NODE)
    sys.exit(1)

# ── trim node dist extras (npm, headers, docs) — saves ~35MB disk ─────────
for junk in ("lib", "include", "share", "CHANGELOG.md", "README.md", "LICENSE"):
    p = os.path.join(RUNTIME, junk)
    if os.path.isdir(p):
        shutil.rmtree(p, ignore_errors=True)
    elif os.path.exists(p):
        try:
            os.remove(p)
        except OSError:
            pass

# ── environment ────────────────────────────────────────────────────────────
os.environ["NODE_ENV"] = "production"
os.environ["NEXT_TELEMETRY_DISABLED"] = "1"
os.environ["PORT"] = os.environ.get("PORT") or os.environ.get("SERVER_PORT", "3000")
os.environ["HOSTNAME"] = "0.0.0.0"
os.environ.pop("DATABASE_URL", None)  # server.js default: <bundle>/db/custom.db

os.chmod(NODE, 0o755)

log("node", subprocess.run([NODE, "--version"], capture_output=True, text=True).stdout.strip())
log("PORT =", os.environ.get("PORT"), "SERVER_PORT =", os.environ.get("SERVER_PORT"))

# ── run node, tee console output into node.log (readable via SFTP) ────────
with open(LOG, "w", buffering=1) as logf:
    proc = subprocess.Popen(
        [NODE, "--max-old-space-size=224", SERVER],
        cwd=BASE,
        env=os.environ,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    try:
        assert proc.stdout is not None
        for raw in iter(proc.stdout.readline, b""):
            line = raw.decode("utf-8", "replace").rstrip("\n")
            print(line, flush=True)
            logf.write(line + "\n")
        code = proc.wait()
        log("node exited with code", code)
        logf.write(f"[launcher] node exited with code {code}\n")
    except KeyboardInterrupt:
        proc.terminate()
        sys.exit(0)
