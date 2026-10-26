# Sephiroth deploy probe — prints environment facts, extracts the portable
# Node runtime, and test-runs it. Replaced by the real bootstrap afterwards.
import os
import platform
import subprocess
import sys
import tarfile
import time

BASE = os.path.dirname(os.path.abspath(__file__))


def log(*a):
    print("[probe]", *a, flush=True)


log("python:", sys.version.replace("\n", " "))
log("machine:", platform.machine())
try:
    log("libc_ver:", platform.libc_ver())
except Exception as e:
    log("libc_ver err:", e)
try:
    r = subprocess.run(["ldd", "--version"], capture_output=True, text=True, timeout=10)
    first = (r.stdout or r.stderr or "").strip().splitlines()
    log("ldd:", first[0] if first else "(no output)")
except FileNotFoundError:
    log("ldd: not present (musl image likely)")
except Exception as e:
    log("ldd err:", repr(e))

try:
    with open("/etc/os-release") as f:
        first = "".join(f.readlines()[:3]).strip().replace("\n", " | ")
    log("os-release:", first)
except Exception as e:
    log("os-release err:", e)

NODE_TARBALL = os.path.join(BASE, "runtime", "node.tar.xz")
NODE_DIR = os.path.join(BASE, "runtime", "node")
NODE_BIN = os.path.join(NODE_DIR, "bin", "node")

if os.path.exists(NODE_TARBALL) and not os.path.exists(NODE_BIN):
    log("extracting node runtime ...")
    os.makedirs(os.path.dirname(NODE_DIR), exist_ok=True)
    try:
        with tarfile.open(NODE_TARBALL, "xz") as tar:
            members = []
            prefix = None
            for m in tar.getmembers():
                parts = m.name.split("/", 1)
                if len(parts) == 2:
                    prefix = prefix or parts[0]
                    m.name = parts[1]
                    members.append(m)
            tar.extractall(os.path.dirname(NODE_DIR), members)
        log("extracted ->", NODE_DIR)
    except Exception as e:
        log("extract failed:", repr(e))

if os.path.exists(NODE_BIN):
    try:
        os.chmod(NODE_BIN, 0o755)
        r = subprocess.run([NODE_BIN, "--version"], capture_output=True, text=True, timeout=30)
        log("node --version ->", r.stdout.strip(), r.stderr.strip(), "rc:", r.returncode)
    except Exception as e:
        log("node test failed:", repr(e))
else:
    log("no node tarball/runtime found yet")

log("probe done, sleeping to keep container alive")
while True:
    time.sleep(60)
