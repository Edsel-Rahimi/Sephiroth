[English](README.md) | [فارسی](README.fa.md) | [العربية](README.ar.md) | [中文](README.zh.md) | [Türkçe](README.tr.md) | [Русский](README.ru.md)

<p align="center">
  <img src="public/sephiroth-logo.png" alt="Sephiroth" width="140">
</p>

<h1 align="center">Sephiroth</h1>

<p align="center">
  <strong>پنل نسل بعدی مدیریت Xray</strong> — رابط تیره‌ی اُبسیدینی با شیشه‌ی مات، ۶ زبان و درایور هسته‌ی واقعی Xray.
</p>

![اینفوگرافیک سِفیروث v2.5.0](docs/infographic.png)

<p align="center">
  <a href="https://github.com/Edsel-Rahimi/sephiroth/releases"><img alt="Release" src="https://img.shields.io/github/v/release/edsel-rahimi/sephiroth"></a>&nbsp;
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>&nbsp;
  <a href="https://nodejs.org"><img alt="Node.js 20 or newer" src="https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white"></a>&nbsp;
  <img alt="i18n: 6 languages" src="https://img.shields.io/badge/i18n-6%20languages-blueviolet">&nbsp;
  <img alt="Platform: Linux and Docker" src="https://img.shields.io/badge/platform-Linux%20%7C%20Docker-informational">&nbsp;
  <a href="https://github.com/Edsel-Rahimi/sephiroth/stargazers"><img alt="GitHub Stars" src="https://img.shields.io/github/stars/edsel-rahimi/sephiroth?style=flat&logo=github&color=22d8ee"></a>
</p>

<div dir="rtl">

## Sephiroth چیست؟

**Sephiroth** یک پنل مدیریت متن‌باز نسل بعدی برای سرورهای [Xray-core](https://github.com/XTLS/Xray-core) است. هرچه یک مدیر VPN لازم دارد — ساخت اینباند، صدور کانفیگ برای کاربران، پایش ترافیک و راه‌اندازی هسته‌ی واقعی Xray — پشت یک اتاق فرمان آرام با شیشه‌ی اُبسیدینی جمع شده؛ همان اتاق شش زبان حرف می‌زند و راست‌چین را از جنس اول بلد است. نیازی به دیتابیس بیرونی نیست: یک فرایند Node.js با فروشگاه JSON اتمیِ محلی، رابط کاربری و API و سوکت تله‌متری زنده و نگهدارنده‌ی دوره‌ای را روی **یک پورت** سرو می‌کند. نسخه‌ی فعلی: **v2.5.0**.

چه چیزی آن را متفاوت می‌کند:

- 🪟 **رابط شیشه‌ای با ۶ تم کهکشانی** — اُبسیدین عمیق، نئون سایان و نقره‌ی پلاتینیوم؛ شش تم کامل (Sephiroth Cosmic، Jenova Violet، Masamune Crimson، Matrix Terminal، OLED Void Gold، One-Winged Angel) با RTL درست‌وحسابی.
- 🔨 **کارگاه ساخت کانفیگِ هر کاربر با پیش‌نمایش زنده** — یک دیالوگ هر پروتکلی را می‌سازد و لینک اشتراک همان لحظه که تنظیمات را می‌چرخانید به‌روز می‌شود.
- 🩺 **امتیاز صحت‌سنج کانفیگ** — ۱۶ سناریوی سلامت خودکار با امتیاز ۱۰۰؛ چیزی شبیه آن در هیچ پنل دیگری نیست.
- 📈 **پیش‌بینی اتمام ترافیک** — چیپ «≈N روز تا سقف» با نرخ سوخت روزانه زیر نوار مصرف هر کاربر.
- 💼 **نماینده‌ها + قالب‌های فروش + درگاه‌های پرداخت** — ترکیبی که هیچ پنل متن‌باز دیگری ندارد.
- ⚙️ **درایور هسته‌ی واقعی Xray** — هسته‌ی عملیاتی اختیاری با آمار واقعی هر کاربر؛ شبیه‌ساز داخلی همچنان حالت پیش‌فرضِ بدون‌دردسر است.

## توانایی‌ها

### پروتکل‌ها و ترنسپورت‌ها

- **۹ پروتکل اینباند** — VLESS، VMess، Trojan، Shadowsocks، Hysteria2، WireGuard، SOCKS، HTTP و Dokodemo-door.
- **امنیت و ترنسپورت** — TLS و REALITY روی TCP، WebSocket، gRPC، HTTPUpgrade و XHTTP.
- **فال‌بک و پریست کمبوی تک‌پورت** — سروِ چند پروتکل (مثلاً VLESS + Trojan + خود پنل) روی یک پورت با فال‌بک Xray.

### مدیریت کاربران

- **کاربران، سهمیه و انقضا** — سقف ترافیک و تاریخ انقضای هر کلاینت، فعال/غیرفعال‌سازی و کارهای گروهی؛ یک هویت می‌تواند روی چند اینباند سوار شود.
- **چیپ‌های پیش‌بینی** — پیش‌بینی نرخ سوخت («≈N روز تا سقف») زیر نوار ترافیک هر کاربر؛ کهربایی از ۷ روز، سرخ از ۳ روز.
- **گروه‌های ساب و پورتال برند‌شده** — یک صفحه‌ی اشتراک عمومی برای هر گروه، با قفل رمز؛ خروجی به شکل **لیست خام، Clash Meta (Mihomo)، Sing-Box و Xray-JSON** همراه هدر `Subscription-Userinfo` و QR.

### پایداری

- **درایور هسته‌ی واقعی Xray** (اختیاری؛ پیش‌فرض شبیه‌ساز) — فرایند واقعی Xray-core ساخته‌شده از اینباندهای شما، آمار واقعی هر کاربر و هر اینباند، ری‌استارت خودکار پس از کشته‌شدن و ری‌لود با مقایسه‌ی هش.
- **صحت‌سنج کانفیگ** — ۱۶ بررسی با امتیاز ۱۰۰: پراکسی باز SOCKS/HTTP، TLS بدون گواهی، REALITY ناقص، فال‌بک خراب، کلید تکراری WireGuard، رول مرده، کاربر شبح و… .
- **بکاپ خودکار روزانه** — اسنپ‌شات روزانه‌ی سرور با نگهداری N فایل آخر و دانلود/بازگردانی یک‌کلیکی.
- **ورود دومرحله‌ای TOTP** — احرازکننده‌ی RFC-6238 بدون هیچ وابستگی؛ غیرفعال‌کردنش کد معتبر می‌خواهد.
- **دکمه‌ی به‌روزرسانی خود پنل** — بررسی ← اعمال ← ری‌استارت، مستقیم از داخل پنل.

### کسب‌وکار

- **نماینده‌ها** — اپراتورهای زیرمجموعه با سقف تعداد کاربر و ترافیک که فقط کاربران خودشان را می‌بینند.
- **قالب‌های فروش** — پلن‌های یک‌کلیکی (ترافیک، انقضا، سقف آی‌پی) که نماینده‌ها همان لحظه می‌فروشند.
- **درگاه‌های پرداخت** — زرین‌پال، تتر TRC20، شبکه‌ی TON و کارت‌به‌کارت، با تعرفه‌ی هر گیگابایت و وب‌هوک‌های پرداخت خودکار.

### تلگرام

- **کنسول ربات** — `/status`، `/users`، `/create_trial` و `/backup_now` با صدور آنی لینک اشتراک.
- **مجموعه‌ی پروکسی SOCKS5** — دیپ‌لینک بومی `t.me/socks` و QR قابل‌اسکن.
- **ابزار سکرت MTProto** — سکرت dd/ساده، لینک‌های `tg://` و دستورات آماده‌ی دیمن.

### عملیات

- **تشخیص خودکار آی‌پی سرور + پیشنهاد پورت آزاد** — منوی یک‌کلیکی آی‌پی گوش‌دهی (عمومی ← خصوصی ← همه‌ی اینترفیس‌ها) و پورت آزاد پیشنهادی در کارگاه؛ تا `0.0.0.0` هرگز به لینک کاربران نشت نکند.
- **هاست‌ها · نودها · خروجی‌ها · روتینگ** — بازنویسی دامنه برای لینک‌های شیک، نودهای دوری با Probe زنده، زنجیره‌ی خروجی‌ها و پریست‌های آماده‌ی روتینگ (بلاک تبلیغات، ایران→مستقیم، بلاک QUIC و…).
- **عملیات زنده** — اتاق فرمان تله‌متری سوکت‌محور، فید فعالیت زنده به‌علاوه‌ی تاریخچه‌ی قابل جست‌وجو با خروجی JSON.
- **۶ تم · ۶ زبان** — رابط تیره‌ی شیشه‌ای با RTL درجه‌یک (فارسی / العربية) و پالت فرمان ⌘K.

## نگاهی به پنل

<details open>
<summary><b>اسکرین‌شات‌ها و GIFها</b> — برای بستن کلیک کنید</summary>

<p align="center">
  <img src="docs/gif-tour.gif" alt="تور Sephiroth — ورود، داشبورد، کانفیگ‌ها، کارگاه، صحت‌سنج، تنظیمات هسته" width="92%">
</p>

<table>
  <tr>
    <td align="center" width="50%"><img src="docs/shot-dashboard.png" alt="داشبورد"><br><sub>داشبورد — اتاق فرمان تله‌متری زنده</sub></td>
    <td align="center" width="50%"><img src="docs/shot-forge-autofill.png" alt="کارگاه با تشخیص خودکار آی‌پی"><br><sub>کارگاه — تشخیص خودکار آی‌پی سرور</sub></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="docs/shot-doctor.png" alt="صحت‌سنج کانفیگ"><br><sub>صحت‌سنج کانفیگ — ۱۶ بررسی، امتیاز ۱۰۰</sub></td>
    <td align="center" width="50%"><img src="docs/shot-sub-portal.png" alt="پورتال اشتراک"><br><sub>پورتال اشتراک برند‌شده</sub></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="docs/shot-settings-core.png" alt="تنظیمات درایور هسته"><br><sub>تنظیمات ← هسته — درایور واقعی Xray</sub></td>
    <td align="center" width="50%"><img src="docs/shot-users.png" alt="کاربران"><br><sub>کاربران — سهمیه، انقضا و چیپ‌های پیش‌بینی</sub></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="docs/shot-fa-dashboard.png" alt="داشبورد فارسی"><br><sub>فارسی — داشبورد، راست‌چین بومی</sub></td>
    <td align="center" width="50%"><img src="docs/shot-fa-inbounds.png" alt="کانفیگ‌های فارسی"><br><sub>فارسی — کانفیگ‌ها</sub></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="docs/shot-mobile-dashboard.png" alt="داشبورد موبایل"><br><sub>موبایل — داشبورد</sub></td>
    <td align="center" width="50%"><img src="docs/shot-mobile-forge.png" alt="کارگاه در موبایل"><br><sub>موبایل — کارگاه</sub></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="docs/gif-forge.gif" alt="تشخیص خودکار در حرکت"><br><sub>پرکردن خودکار کارگاه در حرکت</sub></td>
    <td align="center" width="50%"><img src="docs/gif-mobile.gif" alt="تجربه‌ی موبایل در حرکت"><br><sub>تجربه‌ی موبایل در حرکت</sub></td>
  </tr>
</table>

</details>

## شروع سریع

### نصب یک‌کلیکی

```bash
bash <(curl -Ls https://raw.githubusercontent.com/Edsel-Rahimi/sephiroth/main/install.sh)
```

نصب‌کننده توزیع و معماری سرور را تشخیص می‌دهد، وابستگی‌های سیستمی را به‌همراه **Node 22** نصب می‌کند، مخزن را کلون می‌کند، اپ را می‌سازد و یک سرویس **systemd** سخت‌گیرانه (با گاردِ نبودِ systemd) می‌سازد. در پایان آدرس پنل و یک **رمز عبور تصادفیِ مدیر** را چاپ می‌کند و هر دو را در `/etc/sephiroth/install-result.env` (با دسترسی `0600`) ذخیره می‌کند.

برای نصب نسخه‌ی مشخص، تگ را به‌عنوان آرگومان بدهید (تگ باید در گیت این مخزن وجود داشته باشد؛ وگرنه نصب‌کننده با پیام راهنما خارج می‌شود):

```bash
bash <(curl -Ls https://raw.githubusercontent.com/Edsel-Rahimi/sephiroth/main/install.sh) v2.5.0
```

نصب بی‌پرس‌وجو / cloud-init — بدون هیچ پرامپتی؛ رمز باز هم در فایل نتیجه نوشته می‌شود:

```bash
SEPH_NONINTERACTIVE=1 bash <(curl -Ls https://raw.githubusercontent.com/Edsel-Rahimi/sephiroth/main/install.sh)
```

> [!IMPORTANT]
> رمز مدیر فقط **یک‌بار** هنگام نصب چاپ می‌شود و در `/etc/sephiroth/install-result.env` (دسترسی `0600`) ذخیره می‌شود. **بعد از اولین ورود آن را عوض کنید** — و ورود دومرحله‌ای TOTP پنل را روشن کنید.

### داکر

```bash
docker run -d --name sephiroth -p 3000:3000 -v sephiroth_data:/app/db \
  -e SEPHIROTH_ADMIN_USER=admin -e SEPHIROTH_ADMIN_PASS=change-me \
  --restart unless-stopped ghcr.io/edsel-rahimi/sephiroth:latest
```

یا با کامپوز (بیلد چندمرحله‌ای، والیوم نام‌دار، هلث‌چک):

```bash
git clone https://github.com/Edsel-Rahimi/sephiroth.git && cd Sephiroth
export SEPH_PORT=3000 SEPHIROTH_ADMIN_USER=admin SEPHIROTH_ADMIN_PASS='S3cure-Pass!'
docker compose up -d
```

- پورت میزبان پیش‌فرض `${SEPH_PORT:-3000}` است — پنل همیشه داخل کانتینر روی 3000 گوش می‌دهد.
- فروشگاه JSON و بکاپ‌های خودکار در والیوم `sephiroth_data` زندگی می‌کنند.
- هلث‌چک داخلی `/api/auth/session` را چک می‌کند؛ ایمیج آماده با هر پوش به `ghcr.io/edsel-rahimi/sephiroth` منتشر می‌شود.

### خط فرمان `sephiroth`

<details>
<summary><b>منوی مدیریت</b> — دستور <code>sephiroth</code> (گزینه‌های ۰ تا ۱۴)</summary>

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

میان‌برها: `sephiroth start | stop | restart | status | logs | update | backup`

</details>

## درایور هسته

Sephiroth دو بک‌اند هسته‌ی جابه‌جاشدنی دارد. هر وقت خواستید از **تنظیمات ← هسته** عوضش کنید:

| | **شبیه‌ساز** (پیش‌فرض) | **هسته واقعی Xray** |
|---|---|---|
| چه‌چیز اجرا می‌شود | شبیه‌ساز داخلی تله‌متری | فرایند واقعی **Xray-core** |
| کانفیگ | وضعیت پنل، پیش‌نمایش | ساخته‌شده از اینباندهای شما و اعتبارسنجی‌شده با `run -test` |
| آمار | نمودارهای شبیه‌سازی‌شده | شمارنده‌ی واقعی هر کاربر و هر اینباند (API آمار Xray) |
| تاب‌آوری | — | ری‌استارت خودکار پس از kill (تأخیر ۳/۱۰/۳۰ ثانیه) + ری‌لود با مقایسه‌ی هش |
| مناسب برای | امتحان پنل، تست | سرو ترافیک واقعی |

با سوییچ به **هسته واقعی Xray**، پنل به‌طور خودکار باینری Xray-core را از انتشارهای XTLS/Xray-core دانلود می‌کند (با زنجیره‌ی جایگزین unzip ← 7z ← python3) و در `db/bin/xray` می‌گذارد. می‌توانید نسخه‌ی خاصی از هسته را پین کنید، بازه‌ی آمار را تنظیم کنید (۵ تا ۱۲۰ ثانیه) و لاگ زنده‌ی هسته را همین‌جا در تنظیمات ببینید. اگر هسته‌ی واقعی بوت نشد، پنل خودش به شبیه‌ساز برمی‌گردد.

## مستندات

- 📕 **[کاتالوگ کامل — فارسی (PDF)](docs/sephiroth-catalog-fa.pdf)** — راهنمای تصویری کاملِ همه‌ی نماها، فیلدها و تنظیمات.
- 🗒 تغییرات نسخه‌ها (PDF فارسی): [v2.2](public/sephiroth-v2.2-changelog-fa.pdf) · [v2.3](public/sephiroth-v2.3-changelog-fa.pdf)
- 🧭 نمای **راهنما** در خود پنل — ۱۳ فصل که تک‌تک فیلدها را با زبان ساده توضیح می‌دهند؛ بدون اصطلاح سنگین.

## نقشه‌ی راه

**ارسال‌شده**

- [x] به‌روزرسانی خود پنل (بررسی ← اعمال ← ری‌استارت)
- [x] بکاپ خودکار روزانه با نگهداری N فایل
- [x] ورود دومرحله‌ای TOTP
- [x] ابزار پروکسی MTProto تلگرام
- [x] صحت‌سنج کانفیگ — ۱۶ بررسی + امتیاز
- [x] چیپ‌های پیش‌بینی ترافیک
- [x] درایور هسته‌ی واقعی Xray
- [x] مجموعه‌ی استقرار — نصب‌کننده‌ی یک‌کلیکی · خط فرمان `sephiroth` · داکر / GHCR

**بعدی**

- [ ] ربات فروش تلگرامی (تحقیق کامل شده — `docs/telegram-bot-research.md`)
- [ ] موتور همگام‌سازی چندنودی
- [ ] مدیریت گواهی ACME
- [ ] اجرای سقف آی‌پی

## مشارکت

ایسو و پول‌ریکوئست خوش‌آمدند — گزارش باگ، اصلاح ترجمه و پیشنهاد ویژگی. در ترجمه‌ها terminology را با فایل‌های زبان خود پنل هم‌راستا نگه دارید تا README و رابط کاربری یک حرف بزنند.

## حمایت از Sephiroth

اگر Sephiroth کارتان را راه انداخته، یک ⭐ مدار را روشن نگه می‌دارد. دیالوگ **حمایت** داخل پنل آدرس کیف پول‌ها و لینک‌های حمایت را دارد.

## مجوز

[MIT](LICENSE) © Edsel-Rahimi

## سلب مسئولیت

این پروژه فقط برای **مقاصد آموزشی و استفاده‌ی شخصیِ قانونی** ساخته شده است. رعایت قوانین کشور خودتان بر عهده‌ی شماست و نویسندگان مسئولیتی برای سوءاستفاده نمی‌پذیرند.

---

<p align="center"><sub><b>Sephiroth</b> · crafted by <a href="https://github.com/Edsel-Rahimi">Edsel-Rahimi</a></sub></p>

</div>
