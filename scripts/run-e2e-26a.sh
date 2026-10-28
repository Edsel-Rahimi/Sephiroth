#!/bin/bash
# 26-a E2E single-call runner: launch server (dies with this call — sandbox
# reaps our children), wait for sidecars, run the lifecycle E2E.
set -u
cd /home/z/my-project

if curl -s -o /dev/null --max-time 2 http://localhost:3000/; then
  echo "== server already up (foreign owner) =="
else
  setsid nohup bun run dev >> dev.log 2>&1 < /dev/null &
  up=0
  for i in $(seq 1 30); do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://localhost:3000/ 2>/dev/null)
    [ "$code" = "200" ] && { up=1; echo "== server UP (t=$((i*2))s) =="; break; }
    sleep 2
  done
  [ $up = 1 ] || { echo "SERVER FAILED TO START"; tail -5 dev.log; exit 1; }
fi

# wait for sidecars to reconcile (hysteria/mtg engines boot async)
sidecars=0
for i in $(seq 1 45); do
  n=$(ps aux | rg -i "hysteria server|mtg run|sing-box" | rg -v "rg" | wc -l)
  [ "$n" -ge 5 ] && { sidecars=1; echo "== sidecars running: $n (t=$((i*2))s) =="; break; }
  sleep 2
done
[ $sidecars = 1 ] || echo "WARN: sidecars not detected within 90s (n=$n)"

exec node scripts/e2e-26a-onhold-renew.cjs
