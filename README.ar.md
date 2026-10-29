[English](README.md) | [فارسی](README.fa.md) | [العربية](README.ar.md) | [中文](README.zh.md) | [Türkçe](README.tr.md) | [Русский](README.ru.md)

<p align="center">
  <img src="public/sephiroth-logo.png" alt="Sephiroth" width="140">
</p>

<h1 align="center">Sephiroth</h1>

<p align="center">
  <strong>لوحة تحكم الجيل الجديد لـ Xray</strong> — واجهة داكنة بزجاج الأوبسيديان، ٦ لغات، ومشغّل نواة Xray حقيقية.
</p>

![إنفوغراف سيفيروث v2.5.0](docs/infographic.png)

<p align="center">
  <a href="https://github.com/Edsel-Rahimi/sephiroth/releases"><img alt="Release" src="https://img.shields.io/github/v/release/edsel-rahimi/sephiroth"></a>&nbsp;
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>&nbsp;
  <a href="https://nodejs.org"><img alt="Node.js 20 or newer" src="https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white"></a>&nbsp;
  <img alt="i18n: 6 languages" src="https://img.shields.io/badge/i18n-6%20languages-blueviolet">&nbsp;
  <img alt="Platform: Linux and Docker" src="https://img.shields.io/badge/platform-Linux%20%7C%20Docker-informational">&nbsp;
  <a href="https://github.com/Edsel-Rahimi/sephiroth/stargazers"><img alt="GitHub Stars" src="https://img.shields.io/github/stars/edsel-rahimi/sephiroth?style=flat&logo=github&color=22d8ee"></a>
</p>

<div dir="rtl">

## ما هو Sephiroth؟

**Sephiroth** لوحة تحكم مفتوحة المصدر من الجيل الجديد لإدارة خوادم [Xray-core](https://github.com/XTLS/Xray-core). كل ما يحتاجه مشغّل VPN — إنشاء نقاط الدخول، إصدار إعدادات العملاء، مراقبة المرور، وتشغيل نواة Xray الحقيقية — يجتمع خلف قمرة قيادة هادئة بزجاج الأوبسيديان، تتحدث ستّ لغات وتتعامل مع الكتابة من اليمين إلى اليسار كمواطن من الدرجة الأولى. لا قاعدة بيانات خارجية تُدار: عملية Node.js واحدة بمخزن JSON محلي ذرّي تقدّم الواجهة وواجهة البرمجة ومقبس القياس الحيّ ومهام الصيانة الدورية على **منفذ واحد**. الإصدار الحالي: **v2.5.0**.

ما الذي يجعله مختلفًا:

- 🪟 **واجهة زجاجية بستّ سمات كونية** — أوبسيديان عميق ونيون سماوي وفضة بلاتينية؛ ست سمات كاملة (Sephiroth Cosmic وJenova Violet وMasamune Crimson وMatrix Terminal وOLED Void Gold وOne-Winged Angel) مع دعم RTL حقيقي.
- 🔨 **ورشة بناء الإعدادات لكل عميل بمعاينة حيّة** — نافذة واحدة تبني أي بروتوكول، ورابط الاشتراك يُحدَّث لحظة تغيير أي إعداد.
- 🩺 **نتيجة فاحص الإعدادات** — ١٦ فحصًا صحيًا آليًا بنتيجة من ١٠٠؛ لا يوجد شيء مشابه في اللوحات الأخرى.
- 📈 **التنبؤ باستهلاك المرور** — شارة «≈ N يومًا حتى السقف» بمعدل الحرق اليومي تحت شريط مرور كل مستخدم.
- 💼 **الموزّعون + قوالب البيع + بوابات الدفع** — مزيج لا تقدّمه أي لوحة مفتوحة المصدر أخرى.
- ⚙️ **مشغّل نواة Xray حقيقية** — نواة إنتاجية اختيارية بإحصاءات حقيقية لكل مستخدم؛ تبقى المحاكاة المدمجة هي الافتراضي بلا أي تعقيد.

## المزايا

### البروتوكولات ووسائل النقل

- **٩ بروتوكولات لنقاط الدخول** — VLESS وVMess وTrojan وShadowsocks وHysteria2 وWireGuard وSOCKS وHTTP وDokodemo-door.
- **الأمان والنقل** — TLS وREALITY عبر TCP وWebSocket وgRPC وHTTPUpgrade وXHTTP.
- **القفزات الاحتياطية وقالب المنفذ الواحد** — تقديم عدة بروتوكولات (مثل VLESS + Trojan + اللوحة نفسها) على منفذ واحد عبر fallbacks في Xray.

### إدارة المستخدمين

- **المستخدمون والحصص والانتهاء** — سقف مرور وتاريخ انتهاء لكل عميل، تفعيل/تعطيل وإجراءات جماعية؛ هوية واحدة قد تمتد إلى عدة نقاط دخول.
- **شارات التنبؤ** — توقّع معدل الحرق («≈ N يومًا حتى السقف») تحت شريط مرور كل مستخدم؛ كهرماني عند ٧ أيام وقرمزي عند ٣.
- **مجموعات الاشتراك والبوابة الموسومة** — صفحة اشتراك عامة واحدة لكل مجموعة، قابلة للحماية بكلمة مرور؛ المخرجات بصيغ **قائمة خام وClash Meta (Mihomo) وSing-Box وXray-JSON** مع ترويسة `Subscription-Userinfo` ورموز QR.

### الموثوقية

- **مشغّل نواة Xray الحقيقية** (اختياري؛ المحاكاة هي الافتراضي) — عملية Xray-core حقيقية مبنية من نقاط دخولك، إحصاءات حقيقية لكل مستخدم ولكل نقطة دخول، إعادة تشغيل تلقائية بعد أي إنهاء قسري، وإعادة تحميل بالمقارنة الهاشية.
- **فاحص الإعدادات** — ١٦ فحصًا بنتيجة من ١٠٠: وسائط SOCKS/HTTP مكشوفة، TLS بدون شهادة، REALITY ناقص، قفزات احتياطية معطوبة، مفاتيح WireGuard مكررة، قواعد ميتة، حسابات شبحية وغيرها.
- **نسخ احتياطية مجدولة** — لقطات يومية للخادم مع الاحتفاظ بآخر N ملف وتنزيل أو استعادة بنقرة واحدة.
- **تحقق بخطوتين TOTP** — مُصادق RFC-6238 بلا أي تبعيات؛ تعطيله يتطلب رمزًا صحيحًا.
- **زر التحديث الذاتي** — فحص ← تطبيق ← إعادة تشغيل، من داخل اللوحة مباشرة.

### الأعمال

- **الموزّعون** — مشغّلون فرعيون بحصص عدد مستخدمين ومرور، لا يرون إلا مستخدميهم.
- **قوالب البيع** — خطط بنقرة واحدة (مرور، انتهاء، حد IP) يفتحها الموزّعون فورًا.
- **بوابات الدفع** — زرين بال وتيثر TRC20 وشبكة TON والبطاقة إلى البطاقة، مع تعريفة لكل غيغابايت وويب هوكات دفع آلية.

### تيليجرام

- **كونسول البوت** — `/status` و`/users` و`/create_trial` و`/backup_now` مع روابط اشتراك فورية.
- **طقم بروكسي SOCKS5** — روابط `t.me/socks` الأصلية لتيليجرام ورموز QR قابلة للمسح.
- **أداة أسرار MTProto** — أسرار dd/بسيطة وروابط `tg://` وأوامر ديمون جاهزة.

### التشغيل

- **اكتشاف تلقائي لعنوان IP الخادم + اقتراح منفذ حر** — قائمة بنقرة واحدة لعنوان الاستماع (العام ← الخاص ← كل الواجهات) ومنفذ حر مقترح في الورشة؛ حتى لا يتسرب `0.0.0.0` إلى روابط العملاء أبدًا.
- **المضيفون · العقد · المخارج · التوجيه** — تجاوزات النطاقات لروابط أنيقة، عقد بعيدة بفحوص حيّة، سلسلة المخارج، وقوالب توجيه جاهزة (حجب الإعلانات، إيران→مباشر، حجب QUIC…).
- **تشغيل حيّ** — قمرة قياس مبنية على المقابس، بث نشاط مباشر مع سجل قابل للبحث وتصدير JSON.
- **٦ سمات · ٦ لغات** — واجهة داكنة زجاجية مع RTL من الدرجة الأولى (فارسي / العربية) ولوحة أوامر ⌘K.

## لقطات الشاشة

<details open>
<summary><b>لقطات الشاشة وملفات GIF</b> — انقر للطي</summary>

<p align="center">
  <img src="docs/gif-tour.gif" alt="جولة في Sephiroth — الدخول، لوحة التحكم، نقاط الدخول، الورشة، الفاحص، إعدادات النواة" width="92%">
</p>

<table>
  <tr>
    <td align="center" width="50%"><img src="docs/shot-dashboard.png" alt="لوحة التحكم"><br><sub>لوحة التحكم — قمرة قياس حيّة</sub></td>
    <td align="center" width="50%"><img src="docs/shot-forge-autofill.png" alt="الورشة مع الاكتشاف التلقائي"><br><sub>الورشة — اكتشاف تلقائي لعنوان IP</sub></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="docs/shot-doctor.png" alt="فاحص الإعدادات"><br><sub>فاحص الإعدادات — ١٦ فحصًا ونتيجة من ١٠٠</sub></td>
    <td align="center" width="50%"><img src="docs/shot-sub-portal.png" alt="بوابة الاشتراك"><br><sub>بوابة اشتراك موسومة بالعلامة</sub></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="docs/shot-settings-core.png" alt="إعدادات مشغّل النواة"><br><sub>الإعدادات ← النواة — مشغّل Xray الحقيقي</sub></td>
    <td align="center" width="50%"><img src="docs/shot-users.png" alt="المستخدمون"><br><sub>المستخدمون — حصص وانتهاء وشارات تنبؤ</sub></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="docs/shot-fa-dashboard.png" alt="لوحة التحكم بالفارسية"><br><sub>فارسي — لوحة التحكم، RTL أصلي</sub></td>
    <td align="center" width="50%"><img src="docs/shot-fa-inbounds.png" alt="نقاط الدخول بالفارسية"><br><sub>فارسي — نقاط الدخول</sub></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="docs/shot-mobile-dashboard.png" alt="لوحة التحكم على الهاتف"><br><sub>الهاتف — لوحة التحكم</sub></td>
    <td align="center" width="50%"><img src="docs/shot-mobile-forge.png" alt="الورشة على الهاتف"><br><sub>الهاتف — الورشة</sub></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="docs/gif-forge.gif" alt="التعبئة التلقائية في الحركة"><br><sub>التعبئة التلقائية في الحركة</sub></td>
    <td align="center" width="50%"><img src="docs/gif-mobile.gif" alt="تجربة الهاتف في الحركة"><br><sub>تجربة الهاتف في الحركة</sub></td>
  </tr>
</table>

</details>

## البدء السريع

### تثبيت بنقرة واحدة

```bash
bash <(curl -Ls https://raw.githubusercontent.com/Edsel-Rahimi/sephiroth/main/install.sh)
```

يكتشف المثبِّت توزيعتك ومعمارية خادمك، ويثبّت التبعيات النظامية مع **Node 22**، ويستنسخ المستودع، ويبني التطبيق، وينشئ خدمة **systemd** مقيّدة (مع حماية عند غياب systemd). في النهاية يطبع رابط اللوحة و**كلمة مرور مدير مولّدة عشوائيًا**، ويحفظ كليهما في `/etc/sephiroth/install-result.env` (بصلاحية `0600`).

لتثبيت إصدار محدد مرّر الوسم كوسيطة (يجب أن يكون الوسم موجودًا في وسوم git لهذا المستودع، وإلا خرج المثبِّت برسالة إرشادية):

```bash
bash <(curl -Ls https://raw.githubusercontent.com/Edsel-Rahimi/sephiroth/main/install.sh) v2.5.0
```

تثبيت غير تفاعلي / cloud-init — بلا أي أسئلة؛ تُكتب كلمة المرور في ملف النتيجة كالمعتاد:

```bash
SEPH_NONINTERACTIVE=1 bash <(curl -Ls https://raw.githubusercontent.com/Edsel-Rahimi/sephiroth/main/install.sh)
```

> [!IMPORTANT]
> كلمة مرور المدير تُطبع **مرة واحدة** أثناء التثبيت وتُحفظ في `/etc/sephiroth/install-result.env` (بصلاحية `0600`). **غيّرها فور أول تسجيل دخول** — وفعّل التحقق بخطوتين TOTP المدمج في اللوحة.

### دوكر

```bash
docker run -d --name sephiroth -p 3000:3000 -v sephiroth_data:/app/db \
  -e SEPHIROTH_ADMIN_USER=admin -e SEPHIROTH_ADMIN_PASS=change-me \
  --restart unless-stopped ghcr.io/edsel-rahimi/sephiroth:latest
```

أو مع Compose (بناء متعدد المراحل، وحدة تخزين مسماة، فحص صحة مدمج):

```bash
git clone https://github.com/Edsel-Rahimi/sephiroth.git && cd Sephiroth
export SEPH_PORT=3000 SEPHIROTH_ADMIN_USER=admin SEPHIROTH_ADMIN_PASS='S3cure-Pass!'
docker compose up -d
```

- منفذ المضيف الافتراضي هو `${SEPH_PORT:-3000}` — تستمع اللوحة دائمًا على 3000 داخل الحاوية.
- مخزن JSON والنسخ الاحتياطية التلقائية تسكن في وحدة التخزين `sephiroth_data`.
- فحص الصحة المدمج يراقب `/api/auth/session`؛ وتُنشر الصورة الجاهزة إلى `ghcr.io/edsel-rahimi/sephiroth` مع كل دفعة.

### واجهة الأوامر `sephiroth`

<details>
<summary><b>قائمة الإدارة</b> — أمر <code>sephiroth</code> (البنود ٠–١٤)</summary>

```text
sephiroth                  # open the interactive menu
  0) exit                  8)  change password
  1) start                 9)  change port
  2) stop                 10)  backup now
  3) restart              11)  restore backup
  4) force restart        12)  check update
  5) status               13)  update panel
  6) logs (follow)        14)  uninstall
  7) logs (last 100 lines)
```

اختصارات: `sephiroth start | stop | restart | status | logs | update | backup`

</details>

## مشغّل النواة

تأتي Sephiroth بخلفتين قابلتين للتبديل للنواة. بدّلهما وقتما شئت من **الإعدادات ← النواة**:

| | **المحاكي** (الافتراضي) | **نواة Xray الحقيقية** |
|---|---|---|
| ما الذي يعمل | محاكاة قياس مدمجة | عملية **Xray-core** حقيقية |
| الإعدادات | حالة اللوحة بمعاينة | مولّدة من نقاط دخولك ومتحقق منها بـ `run -test` |
| الإحصاءات | رسوم محاكاة | عدّادات حقيقية لكل مستخدم ولكل نقطة دخول (واجهة إحصاءات Xray) |
| الصمود | — | إعادة تشغيل تلقائية بعد kill (تأخير ٣/١٠/٣٠ ثانية) + إعادة تحميل بالمقارنة الهاشية |
| الأفضل لـ | تجربة اللوحة، التجهيز | تقديم مرور حقيقي |

عند التحويل إلى **نواة Xray الحقيقية** تنزّل اللوحة ملف Xray-core الثنائي تلقائيًا من إصدارات XTLS/Xray-core (بسلسلة استخراج بديلة unzip ← 7z ← python3) إلى `db/bin/xray`. يمكنك تثبيت إصدار نواة محدد، وضبط فترة الإحصاءات (٥–١٢٠ ثانية)، ومشاهدة سجل النواة الحيّ من الإعدادات مباشرة. وإذا فشلت النواة الحقيقية في الإقلاع، تعود اللوحة تلقائيًا إلى المحاكي.

## الوثائق

- 📕 **[الدليل الكامل — بالفارسية (PDF)](docs/sephiroth-catalog-fa.pdf)** — الدليل البصري الشامل لكل الشاشات والحقول والإعدادات.
- 🗒 سجلات التغييرات (PDF بالفارسية): [v2.2](public/sephiroth-v2.2-changelog-fa.pdf) · [v2.3](public/sephiroth-v2.3-changelog-fa.pdf)
- 🧭 شاشة **الدليل** داخل اللوحة — ١٣ فصلًا تشرح كل حقل بلغة بسيطة، بلا مصطلحات ثقيلة.

## خارطة الطريق

**مُنجز**

- [x] التحديث الذاتي من اللوحة (فحص ← تطبيق ← إعادة تشغيل)
- [x] نسخ احتياطية مجدولة مع سياسة احتفاظ
- [x] تسجيل دخول بخطوتين TOTP
- [x] أداة بروكسي MTProto لتيليجرام
- [x] فاحص الإعدادات — ١٦ فحصًا + نتيجة
- [x] شارات التنبؤ بالمرور
- [x] مشغّل نواة Xray الحقيقية
- [x] طقم النشر — مثبِّت بنقرة واحدة · واجهة `sephiroth` · دوكر / GHCR

**التالي**

- [ ] بوت بيع تيليجرام (البحث مكتمل — `docs/telegram-bot-research.md`)
- [ ] محرك مزامنة متعدد العقد
- [ ] إدارة شهادات ACME
- [ ] فرض حد عناوين IP

## المساهمة

الإبلاغات والطلبات مرحّب بها — تقارير الأخطاء وإصلاحات الترجمة واقتراحات الميزات على حد سواء. وعند تعديل الترجمات حافظ على توافق المصطلحات مع ملفات اللغة داخل اللوحة حتى يتكلم README والواجهة بلغة واحدة.

## دعم Sephiroth

إذا سهّل Sephiroth يومك، فنجمة ⭐ واحدة تُبقي المدار حيًا. نافذة **الدعم** داخل اللوحة تعرض عناوين المحافظ وروابط الدعم.

## الترخيص

[MIT](LICENSE) © Edsel-Rahimi

## إخلاء المسؤولية

هذا المشروع مخصص **للأغراض التعليمية والاستخدام الشخصي المشروع**. الالتزام بقوانين بلدك مسؤوليتك، ولا يتحمّل المؤلفون أي مسؤولية عن سوء الاستخدام.

---

<p align="center"><sub><b>Sephiroth</b> · crafted by <a href="https://github.com/Edsel-Rahimi">Edsel-Rahimi</a></sub></p>

</div>
