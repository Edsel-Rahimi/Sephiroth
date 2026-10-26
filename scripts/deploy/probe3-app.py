# Sephiroth deploy probe v2 — writes findings to /probe.json so they can be
# read back over SFTP (panel terminal is canvas-rendered, not DOM-readable).
import json
import os
import platform
import subprocess
import sys
import tarfile
import time

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "probe.json")
result = {"steps": []}


def log(*a):
    line = " ".join(str(x) for x in a)
    print("[probe]", line, flush=True)
    result["steps"].append(line)
    dump()


def dump():
    try:
        with open(OUT, "w") as f:
            json.dump(result, f, indent=1)
    except Exception as e:
        print("[probe] dump failed:", e, flush=True)


log("python", sys.version.replace("\n", " "))
log("machine", platform.machine())
try:
    log("libc_ver", platform.libc_ver())
except Exception as e:
    log("libc_ver err", repr(e))
try:
    r = subprocess.run(["ldd", "--version"], capture_output=True, text=True, timeout=10)
    first = (r.stdout or r.stderr or "").strip().splitlines()
    log("ldd", first[0] if first else "(no output)")
except FileNotFoundError:
    log("ldd absent (musl likely)")
except Exception as e:
    log("ldd err", repr(e))
try:
    with open("/etc/os-release") as f:
        log("os-release", " | ".join(f.readlines()[:3]).strip().replace("\n", " "))
except Exception as e:
    log("os-release err", e)

NODE_TARBALL = os.path.join(BASE, "runtime", "node.tar.xz")
NODE_DIR = os.path.join(BASE, "runtime", "node")
NODE_BIN = os.path.join(NODE_DIR, "bin", "node")

if os.path.exists(NODE_TARBALL) and not os.path.exists(NODE_BIN):
    log("extracting node runtime")
    try:
        os.makedirs(os.path.dirname(NODE_DIR), exist_ok=True)
        import lzma
        with tarfile.open(fileobj=lzma.LZMAFile(NODE_TARBALL, mode="rb"), mode="r") as tar:
            members = []
            for m in tar.getmembers():
                parts = m.name.split("/", 1)
                if len(parts) == 2:
                    m.name = parts[1]
                    members.append(m)
            tar.extractall(os.path.dirname(NODE_DIR), members)
        log("extracted", NODE_DIR)
    except Exception as e:
        log("extract failed", repr(e))
    dump()

if os.path.exists(NODE_BIN):
    try:
        os.chmod(NODE_BIN, 0o755)
        r = subprocess.run([NODE_BIN, "--version"], capture_output=True, text=True, timeout=30)
        log("node --version", r.stdout.strip(), r.stderr.strip(), "rc", r.returncode)
        if r.returncode == 0:
            r2 = subprocess.run([NODE_BIN, "-e", "console.log(process.arch, process.platform)"], capture_output=True, text=True, timeout=30)
            log("node arch", r2.stdout.strip(), r2.stderr.strip())
    except Exception as e:
        log("node test failed", repr(e))
else:
    log("no node runtime present", os.listdir(os.path.join(BASE, "runtime")) if os.path.exists(os.path.join(BASE, "runtime")) else "no runtime dir")

log("probe complete")
dump()
while True:
    time.sleep(60)
