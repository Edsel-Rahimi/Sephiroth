#!/bin/bash
# 26-a UI E2E (single call — sandbox reaps our server at call end):
# relaunch server → create on-hold probe via API → assert KPI/chip/filter/pill
# in the live UI (FA locale) → cleanup.
set -u
cd /home/z/my-project

if ! curl -s -o /dev/null --max-time 2 http://localhost:3000/; then
  setsid nohup bun run dev >> dev.log 2>&1 < /dev/null &
  up=0
  for i in $(seq 1 30); do
    [ "$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://localhost:3000/ 2>/dev/null)" = "200" ] && { up=1; break; }
    sleep 2
  done
  [ $up = 1 ] || { echo "SERVER FAILED"; tail -3 dev.log; exit 1; }
fi
echo "== server up =="

COOKIE=$(curl -s -i -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"sephiroth"}' | tr -d '\r' | awk 'tolower($0) ~ /^set-cookie:/{print $2}' | cut -d';' -f1)
[ -n "$COOKIE" ] || { echo "LOGIN FAILED"; exit 1; }

IID=$(curl -s -H "Cookie: $COOKIE" http://localhost:3000/api/inbounds | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.inbounds[0].id)})")
# remove leftovers from previous runs, then create the probe
OLD=$(curl -s -H "Cookie: $COOKIE" http://localhost:3000/api/users | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log((j.users||[]).filter(u=>u.username.startsWith('e2e-ui-hold')).map(u=>u.id).join(' '))})")
[ -n "$OLD" ] && curl -s -X POST -H "Cookie: $COOKIE" -H 'Content-Type: application/json' -d "{\"action\":\"delete\",\"ids\":[\"${OLD// /\",\"}\"]}" http://localhost:3000/api/users/bulk > /dev/null

CREATE=$(curl -s -X POST -H "Cookie: $COOKIE" -H 'Content-Type: application/json' \
  -d "{\"username\":\"e2e-ui-hold\",\"note\":\"26-a UI probe\",\"expiryDays\":30,\"onHold\":true,\"inboundIds\":[\"$IID\"]}" \
  http://localhost:3000/api/users)
echo "$CREATE" | rg -q '"status":"onhold"' && echo "✅ API create → status onhold" || { echo "❌ create: $CREATE"; exit 1; }

agent-browser reload > /dev/null 2>&1
agent-browser wait --load networkidle > /dev/null 2>&1
sleep 1

echo "== KPI buttons mentioning on-hold label =="
agent-browser eval "[...document.querySelectorAll('button')].filter(b=>b.textContent.includes('در انتظار')).map(b=>(b.className.includes('rounded-full')?'CHIP':'KPI')+'|'+b.textContent.trim().replace(/\s+/g,' ')).join(' ;; ')"

echo "== click onhold chip =="
agent-browser eval "(()=>{const b=[...document.querySelectorAll('button.rounded-full')].find(x=>x.textContent.includes('در انتظار'));if(!b)return 'NO_CHIP';b.click();return 'CLICKED:'+b.textContent.trim().replace(/\s+/g,' ')})()"

sleep 1
echo "== filtered table state =="
agent-browser eval "(()=>{const rows=[...document.querySelectorAll('tbody tr')];const hit=rows.filter(r=>r.textContent.includes('e2e-ui-hold'));const pill=hit.map(r=>{const s=r.querySelector('span');return [...r.querySelectorAll('span')].map(x=>x.textContent.trim()).find(t=>t.includes('در انتظار اولین'))||'NO_PILL'});return JSON.stringify({totalRows:rows.length,probeRows:hit.length,pill})})()"

agent-browser screenshot /home/z/my-project/download/e2e-26a-onhold-filter.png > /dev/null 2>&1 && echo "== screenshot saved =="

OLD=$(curl -s -H "Cookie: $COOKIE" http://localhost:3000/api/users | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log((j.users||[]).filter(u=>u.username.startsWith('e2e-ui-hold')).map(u=>u.id).join(' '))})")
[ -n "$OLD" ] && curl -s -X POST -H "Cookie: $COOKIE" -H 'Content-Type: application/json' -d "{\"action\":\"delete\",\"ids\":[\"${OLD// /\",\"}\"]}" http://localhost:3000/api/users/bulk | rg -q '"ok":true' && echo "✅ cleanup"
