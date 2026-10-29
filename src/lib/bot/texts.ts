/* ============================================================
   Sephiroth · Task 23-c/23-a — Sephiroth bot chat strings ×6

   BOT-facing texts (per Telegram user / admin language), not
   panel UI strings — the panel UI lives in i18n/dictionaries.ts.
   HTML parse mode: <b> emphasis, <code> monospace values.
   {placeholders} are filled by fmt().
   ============================================================ */

export type BotLang = "fa" | "en" | "ar" | "zh" | "tr" | "ru";

export const BOT_LANG_LABELS: Record<BotLang, string> = {
  fa: "🇮🇷 فارسی",
  en: "🇬🇧 English",
  ar: "🇸🇦 العربية",
  zh: "🇨🇳 中文",
  tr: "🇹🇷 Türkçe",
  ru: "🇷🇺 Русский",
};

export interface BotTexts {
  /* menu / sales (23-c) */
  pickLang: string;
  menu: string;
  btnShop: string;
  btnSubs: string;
  btnTrial: string;
  btnSupport: string;
  shopTitle: string;
  shopEmpty: string;
  tplLine: string;
  tplFree: string;
  payPicker: string;
  payZarin: string;
  payCard: string;
  payZarinSent: string;
  payCardInfo: string;
  payCardSendReceipt: string;
  receiptReceived: string;
  noPendingReceipt: string;
  orderPaid: string;
  delivered: string;
  subsTitle: string;
  subsEmpty: string;
  subsLine: string;
  btnSubLink: string;
  noTrial: string;
  trialLimit: string;
  support: string;
  payUnavailable: string;
  checkHint: string;
  rejected: string;
  backMenu: string;
  /* admin commands + authorization (23-a) */
  notAuthorized: string;
  help: string;
  stTitle: string;
  stCore: string;
  stInbounds: string;
  stUsers: string;
  stTraffic: string;
  stUptime: string;
  stVersion: string;
  usersTitle: string;
  usersEmpty: string;
  usersLine: string;
  inbTitle: string;
  inbEmpty: string;
  inbLine: string;
  userCard: string;
  userNotFound: string;
  userQueryHint: string;
  btnEnable: string;
  btnDisable: string;
  btnReset: string;
  doneEnable: string;
  doneDisable: string;
  doneReset: string;
  /* notifications ×9 (23-a) */
  nUserCreated: string;
  nUserDeleted: string;
  nUserUpdated: string;
  nUserExpired: string;
  nQuotaCapped: string;
  nTrafficReset: string;
  nBackupDone: string;
  nRestart: string;
  nInboundCreated: string;
  nInboundDeleted: string;
  /* notifications — wave 2 (26-a): login fail / near expiry / digest / on-hold + autorenew */
  nLoginFailed: string;
  nNearExpiry: string;
  nDigest: string;
  nUserActivated: string;
  nUserRenewed: string;
  /* v2.8 — wallet */
  btnWallet: string;
  walletView: string;
  btnWalletPay: string;
  walletInsufficient: string;
  walletPaid: string;
  walletCredited: string;
  /* v2.8 — admin /credit */
  creditHint: string;
  creditDone: string;
  /* v2.8 — admin /adduser */
  addUserHint: string;
  addUserNotFound: string;
  uapTitle: string;
  /* v2.8 — renew / top-up existing subscription */
  btnRenew: string;
  renTitle: string;
  renEmpty: string;
  renewed: string;
  /* v2.8 — admin user tools (delete / apply-template / reset-devices) */
  btnDelete: string;
  deleteConfirm: string;
  doneDelete: string;
  btnApplyTpl: string;
  doneApplyTpl: string;
  btnResetDevices: string;
  doneResetDevices: string;
}

const FA: BotTexts = {
  pickLang: "زبان را انتخاب کنید:",
  menu: "منوی اصلی — یکی را انتخاب کنید:",
  btnShop: "🛒 فروشگاه",
  btnSubs: "📦 اشتراک‌های من",
  btnTrial: "🎁 تست رایگان",
  btnSupport: "🆘 پشتیبانی",
  shopTitle: "🛒 <b>فروشگاه</b>",
  shopEmpty: "فعلاً محصولی برای فروش موجود نیست.",
  tplLine: "<b>{name}</b>\n• حجم: {gb}\n• مدت: {days} روز\n• دستگاه: {ip}\n• قیمت: {price}",
  tplFree: "رایگان",
  payPicker: "روش پرداخت برای <b>{name}</b> ({price}):",
  payZarin: "💳 زرین‌پال",
  payCard: "🏦 کارت به کارت",
  payZarinSent: "🔗 برای پرداخت روی دکمه زیر بزنید:\nمبلغ: <b>{price} تومان</b>\n\nپس از پرداخت، سفارش تا حداکثر یک دقیقه بعد به‌صورت خودکار تأیید و کانفیگ ارسال می‌شود.",
  payCardInfo: "🏦 <b>پرداخت کارت به کارت</b>\n\nشماره کارت:\n<code>{card}</code>\nبه نام: <b>{holder}</b>\nمبلغ: <b>{price} تومان</b>\n\nپس از واریز، <b>عکس رسید</b> را همین‌جا بفرستید تا ادمین‌ها بررسی کنند.",
  payCardSendReceipt: "لطفاً عکس رسید واریز را بفرستید (Photo).",
  receiptReceived: "✅ رسید دریافت شد. نتیجه بررسی به‌زودی اعلام می‌شود.",
  noPendingReceipt: "در حال حاضر سفارشی در انتظار رسید ندارید.",
  orderPaid: "✅ پرداخت شما تأیید شد — در حال ساخت کانفیگ…",
  delivered: "🎉 <b>اشتراک شما آماده است!</b>\n\n• نام کاربری: <code>{user}</code>\n• حجم: {gb}\n• مدت: {days} روز\n\n🔗 لینک اشتراک:\n{sub}\n\n📱 لینک Clash:\n{clash}\n\n📱 لینک Sing-Box:\n{singbox}\n\nراهنما: لینک را در برنامه (v2rayNG / Streisand / Hiddify / Clash Meta) وارد کنید یا با دکمهٔ زیر باز کنید.",
  subsTitle: "📦 <b>اشتراک‌های من</b>",
  subsEmpty: "هنوز اشتراکی ندارید.",
  subsLine: "• <b>{user}</b> — {used}/{limit} GB — تا {days} روز دیگر{state}",
  btnSubLink: "🔗 باز کردن لینک اشتراک",
  noTrial: "در حال حاضر پلن تست رایگان موجود نیست.",
  trialLimit: "هر کاربر فقط یک‌بار می‌تواند پلن رایگان بگیرد.",
  support: "🆘 پشتیبانی:\n{contact}",
  payUnavailable: "این روش پرداخت فعلاً پیکربندی نشده است. با پشتیبانی تماس بگیرید.",
  checkHint: "⏳ سفارش شما در انتظار پرداخت است. به‌محض تأیید، لینک اشتراک ارسال می‌شود.",
  rejected: "❌ سفارش شما تأیید نشد. برای بررسی بیشتر با پشتیبانی تماس بگیرید.",
  backMenu: "بازگشت به منو",
  notAuthorized: "⛔ شما اجازهٔ استفاده از دستورهای مدیریتی را ندارید.",
  help: "🤖 <b>دستورهای ربات سِفیراث</b>\n/status — وضعیت سامانه\n/users [تعداد] — پر مصرف‌ترین کاربران\n/inbounds — فهرست کانفیگ‌های ورودی\n/user &lt;نام&gt; — جست‌وجوی کاربر + کنترل‌ها\n/adduser &lt;پلن&gt; — ساخت کاربر از روی پلن\n/credit &lt;کاربر&gt; &lt;مبلغ&gt; — تنظیم موجودی کیف پول\n/backup_now — ارسال فایل پشتیبان\n/start — منوی اصلی",
  stTitle: "🛰 <b>سِفیراث · وضعیت سامانه</b>",
  stCore: "• هسته: {core} ({status})",
  stInbounds: "• کانفیگ‌های فعال: {online}/{total}",
  stUsers: "• کاربران: {enabled} فعال / {total} کل",
  stTraffic: "• ترافیک مصرف‌شده: {gb} GB",
  stUptime: "• آپ‌تایم پنل: {up}",
  stVersion: "• نسخه: v{ver}",
  usersTitle: "👥 <b>کاربران برتر</b>",
  usersEmpty: "هنوز کاربری ساخته نشده است.",
  usersLine: "{n}. <code>{user}</code> — {used}/{limit} GB — {days} روز{state}",
  inbTitle: "🔌 <b>کانفیگ‌های ورودی</b>",
  inbEmpty: "هیچ کانفیگ ورودی وجود ندارد.",
  inbLine: "• <b>{tag}</b> — {proto} :{port} · {status} · {clients} کاربر",
  userCard: "👤 <b>{user}</b>\n• وضعیت: {status}\n• ترافیک: {used}/{limit} GB\n• اعتبار: {days} روز\n• دستگاه: {ip}",
  userNotFound: "کاربری با این نام پیدا نشد. (جست‌وجو: /user &lt;نام&gt;)",
  userQueryHint: "نام کاربر را بنویسید: <code>/user ali</code>",
  btnEnable: "✅ فعال‌سازی",
  btnDisable: "⛔ غیرفعال‌سازی",
  btnReset: "♻️ صفر کردن ترافیک",
  doneEnable: "کاربر {user} فعال شد",
  doneDisable: "کاربر {user} غیرفعال شد",
  doneReset: "ترافیک {user} صفر شد",
  nUserCreated: "🆕 کاربر <code>{user}</code> ساخته شد — {gb}، {days} روز",
  nUserDeleted: "🗑 کاربر <code>{user}</code> حذف شد",
  nUserUpdated: "✏️ کاربر <code>{user}</code> به‌روزرسانی شد",
  nUserExpired: "⌛ کاربر <code>{user}</code> منقضی شد — غیرفعال شد",
  nQuotaCapped: "📦 کاربر <code>{user}</code> به سقف حجم رسید ({used}/{limit} GB)",
  nTrafficReset: "♻️ شمارندهٔ ترافیک <code>{user}</code> صفر شد ({period})",
  nBackupDone: "💾 پشتیبان‌گیری کامل شد — {file} ({kb} KB)",
  nRestart: "🚀 پنل دوباره بالا آمد — v{ver}",
  nInboundCreated: "📥 کانفیگ <b>{tag}</b> ساخته شد ({proto} :{port})",
  nInboundDeleted: "📤 کانفیگ <b>{tag}</b> حذف شد",
  nLoginFailed: "🔐 تلاش ناموفق ورود برای <code>{user}</code> از {ip}",
  nNearExpiry: "⏳ کاربر <code>{user}</code> تا {days} روز دیگر منقضی می‌شود",
  nDigest: "📈 گزارش ۲۴ ساعت — {orders} سفارش موفق ({revenue} تومان)، {users} کاربر جدید",
  nUserActivated: "▶️ کاربر در انتظار <code>{user}</code> با اولین اتصال فعال شد — {days} روز اعتبار",
  nUserRenewed: "🔄 اشتراک <code>{user}</code> خودکار تمدید شد (مجموع {renewals} بار)",
  btnWallet: "💰 کیف پول",
  walletView: "💰 <b>کیف پول</b>\nموجودی: <b>{balance} تومان</b>\n\nبرای افزایش موجودی با پشتیبانی در تماس باشید؛ پس از تأیید ادمین، اعتبار به همین کیف اضافه می‌شود.",
  btnWalletPay: "💰 پرداخت از کیف پول",
  walletInsufficient: "موجودی کیف پول شما ({balance} تومان) برای این خرید کافی نیست. مبلغ لازم: {price} تومان.",
  walletPaid: "✅ مبلغ {price} تومان از کیف پول کسر شد. موجودی جدید: {balance} تومان.",
  walletCredited: "💰 کیف پول شما {amount} تومان تغییر کرد.\nموجودی جدید: <b>{balance} تومان</b>",
  creditHint: "روش استفاده: <code>/credit &lt;کاربر&gt; &lt;مبلغ&gt;</code>\nمثال: <code>/credit ali 500000</code> — مبلغ منفی موجودی را کم می‌کند.",
  creditDone: "✅ موجودی {user} از {old} به <b>{new}</b> تومان تغییر کرد.",
  addUserHint: "روش استفاده: <code>/adduser &lt;نام پلن&gt;</code>\nپلن‌های موجود:\n{list}",
  addUserNotFound: "پلنی با نام «{name}» پیدا نشد. نزدیک‌ترین‌ها:\n{suggestions}",
  uapTitle: "📋 <b>اعمال پلن روی {user}</b>\nپلن موردنظر را انتخاب کنید:",
  btnRenew: "🔄 تمدید",
  renTitle: "🔄 <b>تمدید اشتراک {user}</b>\nپلن موردنظر برای تمدید را انتخاب کنید:",
  renEmpty: "فعلاً پلنی برای تمدید موجود نیست.",
  renewed: "🔄 <b>اشتراک شما تمدید شد!</b>\n\n• نام کاربری: <code>{user}</code>\n• پلن: {tpl}\n• حجم اضافه‌شده: {gb}\n• مدت اضافه‌شده: {days} روز\n\n🔗 لینک اشتراک (بدون تغییر):\n{sub}",
  btnDelete: "🗑 حذف کاربر",
  deleteConfirm: "⚠️ کاربر <b>{user}</b> برای همیشه حذف شود؟ همهٔ کانفیگ‌های او از inbound ها پاک می‌شود.",
  doneDelete: "🗑 کاربر {user} حذف شد.",
  btnApplyTpl: "📋 اعمال پلن",
  doneApplyTpl: "📋 پلن {tpl} روی {user} اعمال شد ({gb}، {days} روز، {ip} دستگاه).",
  btnResetDevices: "📵 ریست دستگاه‌ها",
  doneResetDevices: "📵 دستگاه‌های {user} ریست شد — کلاینت‌ها باید دوباره ثبت نام کنند.",
};

const EN: BotTexts = {
  pickLang: "Choose your language:",
  menu: "Main menu — pick one:",
  btnShop: "🛒 Shop",
  btnSubs: "📦 My subscriptions",
  btnTrial: "🎁 Trial",
  btnSupport: "🆘 Support",
  shopTitle: "🛒 <b>Shop</b>",
  shopEmpty: "No products are on sale right now.",
  tplLine: "<b>{name}</b>\n• Traffic: {gb}\n• Duration: {days} days\n• Devices: {ip}\n• Price: {price}",
  tplFree: "Free",
  payPicker: "Payment method for <b>{name}</b> ({price}):",
  payZarin: "💳 ZarinPal",
  payCard: "🏦 Card-to-card",
  payZarinSent: "🔗 Tap the button below to pay:\nAmount: <b>{price} Toman</b>\n\nOnce paid, the order is verified automatically within a minute and your config is delivered here.",
  payCardInfo: "🏦 <b>Card-to-card payment</b>\n\nCard number:\n<code>{card}</code>\nHolder: <b>{holder}</b>\nAmount: <b>{price} Toman</b>\n\nAfter transferring, send a <b>photo of the receipt</b> here for admin review.",
  payCardSendReceipt: "Please send the transfer receipt as a photo.",
  receiptReceived: "✅ Receipt received. You will be notified after review.",
  noPendingReceipt: "You have no order waiting for a receipt right now.",
  orderPaid: "✅ Payment confirmed — building your config…",
  delivered: "🎉 <b>Your subscription is ready!</b>\n\n• Username: <code>{user}</code>\n• Traffic: {gb}\n• Duration: {days} days\n\n🔗 Subscription link:\n{sub}\n\n📱 Clash link:\n{clash}\n\n📱 Sing-Box link:\n{singbox}\n\nHow to use: paste the link into your app (v2rayNG / Streisand / Hiddify / Clash Meta) or tap the button below.",
  subsTitle: "📦 <b>My subscriptions</b>",
  subsEmpty: "You have no subscriptions yet.",
  subsLine: "• <b>{user}</b> — {used}/{limit} GB — {days} days left{state}",
  btnSubLink: "🔗 Open subscription link",
  noTrial: "No free trial plan is available right now.",
  trialLimit: "Each user can claim the free plan only once.",
  support: "🆘 Support:\n{contact}",
  payUnavailable: "This payment method is not configured yet. Please contact support.",
  checkHint: "⏳ Your order is awaiting payment. Your subscription link will arrive as soon as it is verified.",
  rejected: "❌ Your order was not approved. Please contact support for details.",
  backMenu: "Back to menu",
  notAuthorized: "⛔ You are not allowed to use admin commands.",
  help: "🤖 <b>Sephiroth bot commands</b>\n/status — system telemetry\n/users [n] — top users by traffic\n/inbounds — inbound list\n/user &lt;name&gt; — find a user + controls\n/adduser &lt;template&gt; — create a user from a template\n/credit &lt;user&gt; &lt;amount&gt; — adjust wallet balance\n/backup_now — receive a backup snapshot\n/start — main menu",
  stTitle: "🛰 <b>Sephiroth · System Telemetry</b>",
  stCore: "• Core: {core} ({status})",
  stInbounds: "• Active inbounds: {online}/{total}",
  stUsers: "• Users: {enabled} enabled / {total} total",
  stTraffic: "• Consumed traffic: {gb} GB",
  stUptime: "• Panel uptime: {up}",
  stVersion: "• Version: v{ver}",
  usersTitle: "👥 <b>Top users</b>",
  usersEmpty: "No users created yet.",
  usersLine: "{n}. <code>{user}</code> — {used}/{limit} GB — {days}d{state}",
  inbTitle: "🔌 <b>Inbounds</b>",
  inbEmpty: "No inbounds yet.",
  inbLine: "• <b>{tag}</b> — {proto} :{port} · {status} · {clients} clients",
  userCard: "👤 <b>{user}</b>\n• Status: {status}\n• Traffic: {used}/{limit} GB\n• Expires in: {days} days\n• Devices: {ip}",
  userNotFound: "No user matched that name. (search: /user &lt;name&gt;)",
  userQueryHint: "Type the username: <code>/user ali</code>",
  btnEnable: "✅ Enable",
  btnDisable: "⛔ Disable",
  btnReset: "♻️ Reset traffic",
  doneEnable: "User {user} enabled",
  doneDisable: "User {user} disabled",
  doneReset: "Traffic reset for {user}",
  nUserCreated: "🆕 User <code>{user}</code> created — {gb}, {days} days",
  nUserDeleted: "🗑 User <code>{user}</code> deleted",
  nUserUpdated: "✏️ User <code>{user}</code> updated",
  nUserExpired: "⌛ User <code>{user}</code> expired — disabled",
  nQuotaCapped: "📦 User <code>{user}</code> hit the quota cap ({used}/{limit} GB)",
  nTrafficReset: "♻️ Traffic counter reset — <code>{user}</code> ({period})",
  nBackupDone: "💾 Backup completed — {file} ({kb} KB)",
  nRestart: "🚀 Panel restarted — v{ver}",
  nInboundCreated: "📥 Inbound <b>{tag}</b> created ({proto} :{port})",
  nInboundDeleted: "📤 Inbound <b>{tag}</b> deleted",
  nLoginFailed: "🔐 Failed sign-in attempt for <code>{user}</code> from {ip}",
  nNearExpiry: "⏳ User <code>{user}</code> expires in {days} day(s)",
  nDigest: "📈 24h digest — {orders} completed order(s) ({revenue} Toman), {users} new user(s)",
  nUserActivated: "▶️ On-hold user <code>{user}</code> activated on first connect — {days} day(s) granted",
  nUserRenewed: "🔄 Subscription <code>{user}</code> auto-renewed ({renewals} total)",
  btnWallet: "💰 Wallet",
  walletView: "💰 <b>Wallet</b>\nBalance: <b>{balance} Toman</b>\n\nTo top up, contact support — an admin credits your wallet after confirmation.",
  btnWalletPay: "💰 Pay from wallet",
  walletInsufficient: "Your wallet balance ({balance} Toman) is not enough for this purchase. Required: {price} Toman.",
  walletPaid: "✅ {price} Toman was deducted from your wallet. New balance: {balance} Toman.",
  walletCredited: "💰 Your wallet was adjusted by {amount} Toman.\nNew balance: <b>{balance} Toman</b>",
  creditHint: "Usage: <code>/credit &lt;user&gt; &lt;amount&gt;</code>\nExample: <code>/credit ali 500000</code> — a negative amount deducts.",
  creditDone: "✅ Balance of {user} changed from {old} to <b>{new}</b> Toman.",
  addUserHint: "Usage: <code>/adduser &lt;template name&gt;</code>\nAvailable templates:\n{list}",
  addUserNotFound: "No template named \"{name}\" was found. Nearest matches:\n{suggestions}",
  uapTitle: "📋 <b>Apply template to {user}</b>\nPick a template:",
  btnRenew: "🔄 Renew",
  renTitle: "🔄 <b>Renew {user}</b>\nPick the plan to renew with:",
  renEmpty: "No plans are available for renewal right now.",
  renewed: "🔄 <b>Subscription renewed!</b>\n\n• Username: <code>{user}</code>\n• Plan: {tpl}\n• Traffic added: {gb}\n• Time added: {days} days\n\n🔗 Subscription link (unchanged):\n{sub}",
  btnDelete: "🗑 Delete user",
  deleteConfirm: "⚠️ Permanently delete user <b>{user}</b>? Their config is removed from every inbound.",
  doneDelete: "🗑 User {user} deleted.",
  btnApplyTpl: "📋 Apply template",
  doneApplyTpl: "📋 Template {tpl} applied to {user} ({gb}, {days} days, {ip} devices).",
  btnResetDevices: "📵 Reset devices",
  doneResetDevices: "📵 Devices reset for {user} — clients must re-register.",
};

const AR: BotTexts = {
  pickLang: "اختر لغتك:",
  menu: "القائمة الرئيسية — اختر:",
  btnShop: "🛒 المتجر",
  btnSubs: "📦 اشتراكاتي",
  btnTrial: "🎁 تجربة مجانية",
  btnSupport: "🆘 الدعم",
  shopTitle: "🛒 <b>المتجر</b>",
  shopEmpty: "لا توجد منتجات معروضة حالياً.",
  tplLine: "<b>{name}</b>\n• الحجم: {gb}\n• المدة: {days} يوم\n• الأجهزة: {ip}\n• السعر: {price}",
  tplFree: "مجاني",
  payPicker: "طريقة الدفع لـ <b>{name}</b> ({price}):",
  payZarin: "💳 زارين‌بال",
  payCard: "🏦 بطاقة إلى بطاقة",
  payZarinSent: "🔗 اضغط الزر أدناه للدفع:\nالمبلغ: <b>{price} تومان</b>\n\nبعد الدفع يُعتمد الطلب تلقائياً خلال دقيقة ويصلك الإعداد هنا.",
  payCardInfo: "🏦 <b>الدفع بالتحويل البنكي</b>\n\nرقم البطاقة:\n<code>{card}</code>\nباسم: <b>{holder}</b>\nالمبلغ: <b>{price} تومان</b>\n\nبعد التحويل أرسل <b>صورة الإيصال</b> هنا لمراجعة المشرفين.",
  payCardSendReceipt: "أرجو إرسال صورة إيصال التحويل.",
  receiptReceived: "✅ تم استلام الإيصال. ستُبلغ بالنتيجة قريباً.",
  noPendingReceipt: "لا يوجد لديك طلب بانتظار إيصال حالياً.",
  orderPaid: "✅ تم تأكيد الدفع — جارٍ تجهيز الإعداد…",
  delivered: "🎉 <b>اشتراكك جاهز!</b>\n\n• اسم المستخدم: <code>{user}</code>\n• الحجم: {gb}\n• المدة: {days} يوم\n\n🔗 رابط الاشتراك:\n{sub}\n\n📱 رابط Clash:\n{clash}\n\n📱 رابط Sing-Box:\n{singbox}\n\nالاستخدام: الصق الرابط في تطبيقك (v2rayNG / Streisand / Hiddify / Clash Meta) أو اضغط الزر أدناه.",
  subsTitle: "📦 <b>اشتراكاتي</b>",
  subsEmpty: "ليس لديك اشتراكات بعد.",
  subsLine: "• <b>{user}</b> — {used}/{limit} GB — بقيت {days} يوم{state}",
  btnSubLink: "🔗 فتح رابط الاشتراك",
  noTrial: "لا توجد خطة تجربة مجانية حالياً.",
  trialLimit: "يمكن لكل مستخدم الحصول على الخطة المجانية مرة واحدة فقط.",
  support: "🆘 الدعم:\n{contact}",
  payUnavailable: "طريقة الدفع هذه غير مهيأة بعد. تواصل مع الدعم.",
  checkHint: "⏳ طلبك بانتظار الدفع. سيصلك رابط الاشتراك فور التحقق.",
  rejected: "❌ لم يُعتمد طلبك. تواصل مع الدعم للتفاصيل.",
  backMenu: "العودة إلى القائمة",
  notAuthorized: "⛔ غير مسموح لك باستخدام أوامر المشرف.",
  help: "🤖 <b>أوامر بوت سيفيروث</b>\n/status — قياسات النظام\n/users [عدد] — الأكثر استهلاكاً\n/inbounds — قائمة نقاط الدخول\n/user &lt;اسم&gt; — بحث عن مستخدم + تحكم\n/adduser &lt;باقة&gt; — إنشاء مستخدم من باقة\n/credit &lt;مستخدم&gt; &lt;مبلغ&gt; — تعديل رصيد المحفظة\n/backup_now — استلام نسخة احتياطية\n/start — القائمة الرئيسية",
  stTitle: "🛰 <b>سيفيروث · قياسات النظام</b>",
  stCore: "• النواة: {core} ({status})",
  stInbounds: "• نقاط الدخول النشطة: {online}/{total}",
  stUsers: "• المستخدمون: {enabled} نشط / {total} إجمالي",
  stTraffic: "• حركة البيانات المستهلكة: {gb} GB",
  stUptime: "• مدة تشغيل اللوحة: {up}",
  stVersion: "• الإصدار: v{ver}",
  usersTitle: "👥 <b>أعلى المستخدمين</b>",
  usersEmpty: "لم يُنشأ أي مستخدم بعد.",
  usersLine: "{n}. <code>{user}</code> — {used}/{limit} GB — {days} يوم{state}",
  inbTitle: "🔌 <b>نقاط الدخول</b>",
  inbEmpty: "لا توجد نقاط دخول بعد.",
  inbLine: "• <b>{tag}</b> — {proto} :{port} · {status} · {clients} مستخدم",
  userCard: "👤 <b>{user}</b>\n• الحالة: {status}\n• البيانات: {used}/{limit} GB\n• ينتهي بعد: {days} يوم\n• الأجهزة: {ip}",
  userNotFound: "لا يوجد مستخدم بهذا الاسم. (ابحث: /user &lt;اسم&gt;)",
  userQueryHint: "اكتب اسم المستخدم: <code>/user ali</code>",
  btnEnable: "✅ تنشيط",
  btnDisable: "⛔ تعطيل",
  btnReset: "♻️ تصفير البيانات",
  doneEnable: "تم تنشيط المستخدم {user}",
  doneDisable: "تم تعطيل المستخدم {user}",
  doneReset: "تم تصفير بيانات {user}",
  nUserCreated: "🆕 أُنشئ المستخدم <code>{user}</code> — {gb}، {days} يوم",
  nUserDeleted: "🗑 حُذف المستخدم <code>{user}</code>",
  nUserUpdated: "✏️ حُدّث المستخدم <code>{user}</code>",
  nUserExpired: "⌛ انتهت صلاحية <code>{user}</code> — عُطّل",
  nQuotaCapped: "📦 بلغ <code>{user}</code> سقف الحجم ({used}/{limit} GB)",
  nTrafficReset: "♻️ صُفّر عداد بيانات <code>{user}</code> ({period})",
  nBackupDone: "💾 اكتمل النسخ الاحتياطي — {file} ({kb} KB)",
  nRestart: "🚀 أعيد تشغيل اللوحة — v{ver}",
  nInboundCreated: "📥 أُنشئت نقطة الدخول <b>{tag}</b> ({proto} :{port})",
  nInboundDeleted: "📤 حُذفت نقطة الدخول <b>{tag}</b>",
  nLoginFailed: "🔐 محاولة دخول فاشلة لـ <code>{user}</code> من {ip}",
  nNearExpiry: "⏳ ينتهي المستخدم <code>{user}</code> بعد {days} يوم",
  nDigest: "📈 ملخص ٢٤ ساعة — {orders} طلب مكتمل ({revenue} تومان)، {users} مستخدم جديد",
  nUserActivated: "▶️ فعّل المستخدم المعلّق <code>{user}</code> عند أول اتصال — {days} يوم",
  nUserRenewed: "🔄 جُدّد اشتراك <code>{user}</code> تلقائيًا ({renewals} مرة)",
  btnWallet: "💰 المحفظة",
  walletView: "💰 <b>المحفظة</b>\nالرصيد: <b>{balance} تومان</b>\n\nلشحن الرصيد تواصل مع الدعم — يضيف المشرف المبلغ بعد التأكيد.",
  btnWalletPay: "💰 الدفع من المحفظة",
  walletInsufficient: "رصيد محفظتك ({balance} تومان) لا يكفي لهذا الشراء. المطلوب: {price} تومان.",
  walletPaid: "✅ خُصم {price} تومان من محفظتك. الرصيد الجديد: {balance} تومان.",
  walletCredited: "💰 عُدّلت محفظتك بمقدار {amount} تومان.\nالرصيد الجديد: <b>{balance} تومان</b>",
  creditHint: "الاستخدام: <code>/credit &lt;مستخدم&gt; &lt;مبلغ&gt;</code>\nمثال: <code>/credit ali 500000</code> — المبلغ السالب يخصم.",
  creditDone: "✅ تغير رصيد {user} من {old} إلى <b>{new}</b> تومان.",
  addUserHint: "الاستخدام: <code>/adduser &lt;اسم الباقة&gt;</code>\nالباقات المتاحة:\n{list}",
  addUserNotFound: "لم تُوجد باقة باسم {name}. الأقرب:\n{suggestions}",
  uapTitle: "📋 <b>تطبيق باقة على {user}</b>\nاختر الباقة:",
  btnRenew: "🔄 تجديد",
  renTitle: "🔄 <b>تجديد اشتراك {user}</b>\nاختر الباقة للتجديد:",
  renEmpty: "لا توجد باقات للتجديد حالياً.",
  renewed: "🔄 <b>جُدّد اشتراكك!</b>\n\n• المستخدم: <code>{user}</code>\n• الباقة: {tpl}\n• الحجم المضاف: {gb}\n• المدة المضافة: {days} يوم\n\n🔗 رابط الاشتراك (دون تغيير):\n{sub}",
  btnDelete: "🗑 حذف المستخدم",
  deleteConfirm: "⚠️ حذف المستخدم <b>{user}</b> نهائياً؟ سيُزال إعداده من كل نقاط الدخول.",
  doneDelete: "🗑 حُذف المستخدم {user}.",
  btnApplyTpl: "📋 تطبيق باقة",
  doneApplyTpl: "📋 طُبّقت باقة {tpl} على {user} ({gb}، {days} يوم، {ip} أجهزة).",
  btnResetDevices: "📵 تصفير الأجهزة",
  doneResetDevices: "📵 صُفّرت أجهزة {user} — على العملاء إعادة التسجيل.",
};

const ZH: BotTexts = {
  pickLang: "请选择语言：",
  menu: "主菜单 — 请选择：",
  btnShop: "🛒 商店",
  btnSubs: "📦 我的订阅",
  btnTrial: "🎁 免费试用",
  btnSupport: "🆘 客服",
  shopTitle: "🛒 <b>商店</b>",
  shopEmpty: "暂时没有在售的套餐。",
  tplLine: "<b>{name}</b>\n• 流量：{gb}\n• 时长：{days} 天\n• 设备数：{ip}\n• 价格：{price}",
  tplFree: "免费",
  payPicker: "选择 <b>{name}</b> 的支付方式（{price}）：",
  payZarin: "💳 ZarinPal",
  payCard: "🏦 卡对卡转账",
  payZarinSent: "🔗 点击下方按钮付款：\n金额：<b>{price} 托曼</b>\n\n付款后订单会在一分钟内自动核验，配置将直接发送到这里。",
  payCardInfo: "🏦 <b>卡对卡转账</b>\n\n卡号：\n<code>{card}</code>\n户名：<b>{holder}</b>\n金额：<b>{price} 托曼</b>\n\n转账后请在此发送<b>回单照片</b>，等待管理员审核。",
  payCardSendReceipt: "请以照片形式发送转账回单。",
  receiptReceived: "✅ 已收到回单，审核结果稍后通知。",
  noPendingReceipt: "您当前没有待上传回单的订单。",
  orderPaid: "✅ 付款已确认 — 正在生成配置…",
  delivered: "🎉 <b>您的订阅已就绪！</b>\n\n• 用户名：<code>{user}</code>\n• 流量：{gb}\n• 时长：{days} 天\n\n🔗 订阅链接：\n{sub}\n\n📱 Clash 链接：\n{clash}\n\n📱 Sing-Box 链接：\n{singbox}\n\n使用方法：将链接粘贴到客户端（v2rayNG / Streisand / Hiddify / Clash Meta），或点击下方按钮。",
  subsTitle: "📦 <b>我的订阅</b>",
  subsEmpty: "您还没有订阅。",
  subsLine: "• <b>{user}</b> — {used}/{limit} GB — 剩余 {days} 天{state}",
  btnSubLink: "🔗 打开订阅链接",
  noTrial: "当前没有可用的免费试用套餐。",
  trialLimit: "每位用户只能领取一次免费套餐。",
  support: "🆘 客服：\n{contact}",
  payUnavailable: "该支付方式尚未配置，请联系客服。",
  checkHint: "⏳ 订单等待付款中，核验通过后订阅链接会立即发送。",
  rejected: "❌ 您的订单未通过审核，详情请联系客服。",
  backMenu: "返回菜单",
  notAuthorized: "⛔ 您无权使用管理员命令。",
  help: "🤖 <b>Sephiroth 机器人命令</b>\n/status — 系统遥测\n/users [n] — 流量排行\n/inbounds — 入站列表\n/user &lt;名称&gt; — 查找用户 + 控制\n/adduser &lt;套餐&gt; — 按套餐创建用户\n/credit &lt;用户&gt; &lt;金额&gt; — 调整钱包余额\n/backup_now — 接收备份快照\n/start — 主菜单",
  stTitle: "🛰 <b>Sephiroth · 系统遥测</b>",
  stCore: "• 核心：{core}（{status}）",
  stInbounds: "• 活跃入站：{online}/{total}",
  stUsers: "• 用户：启用 {enabled} / 共 {total}",
  stTraffic: "• 已用流量：{gb} GB",
  stUptime: "• 面板运行时间：{up}",
  stVersion: "• 版本：v{ver}",
  usersTitle: "👥 <b>用户排行</b>",
  usersEmpty: "还没有创建任何用户。",
  usersLine: "{n}. <code>{user}</code> — {used}/{limit} GB — {days} 天{state}",
  inbTitle: "🔌 <b>入站列表</b>",
  inbEmpty: "暂无入站。",
  inbLine: "• <b>{tag}</b> — {proto} :{port} · {status} · {clients} 个用户",
  userCard: "👤 <b>{user}</b>\n• 状态：{status}\n• 流量：{used}/{limit} GB\n• 剩余：{days} 天\n• 设备数：{ip}",
  userNotFound: "没有匹配的用户。（搜索：/user &lt;名称&gt;）",
  userQueryHint: "输入用户名：<code>/user ali</code>",
  btnEnable: "✅ 启用",
  btnDisable: "⛔ 停用",
  btnReset: "♻️ 流量清零",
  doneEnable: "用户 {user} 已启用",
  doneDisable: "用户 {user} 已停用",
  doneReset: "{user} 的流量已清零",
  nUserCreated: "🆕 用户 <code>{user}</code> 已创建 — {gb}，{days} 天",
  nUserDeleted: "🗑 用户 <code>{user}</code> 已删除",
  nUserUpdated: "✏️ 用户 <code>{user}</code> 已更新",
  nUserExpired: "⌛ 用户 <code>{user}</code> 已过期 — 已停用",
  nQuotaCapped: "📦 用户 <code>{user}</code> 已达流量上限（{used}/{limit} GB）",
  nTrafficReset: "♻️ 流量计数已清零 — <code>{user}</code>（{period}）",
  nBackupDone: "💾 备份完成 — {file}（{kb} KB）",
  nRestart: "🚀 面板已重启 — v{ver}",
  nInboundCreated: "📥 入站 <b>{tag}</b> 已创建（{proto} :{port}）",
  nInboundDeleted: "📤 入站 <b>{tag}</b> 已删除",
  nLoginFailed: "🔐 <code>{user}</code> 登录失败，来源 {ip}",
  nNearExpiry: "⏳ 用户 <code>{user}</code> 将在 {days} 天后到期",
  nDigest: "📈 24 小时简报 — {orders} 笔完成订单（{revenue} 托曼），{users} 个新用户",
  nUserActivated: "▶️ 待激活用户 <code>{user}</code> 已在首次连接时激活 — {days} 天",
  nUserRenewed: "🔄 订阅 <code>{user}</code> 已自动续期（共 {renewals} 次）",
  btnWallet: "💰 钱包",
  walletView: "💰 <b>钱包</b>\n余额：<b>{balance} 托曼</b>\n\n如需充值请联系客服，管理员确认后为钱包加款。",
  btnWalletPay: "💰 钱包支付",
  walletInsufficient: "钱包余额（{balance} 托曼）不足以完成本次购买，需 {price} 托曼。",
  walletPaid: "✅ 已从钱包扣除 {price} 托曼，新余额：{balance} 托曼。",
  walletCredited: "💰 您的钱包已变动 {amount} 托曼。\n新余额：<b>{balance} 托曼</b>",
  creditHint: "用法：<code>/credit &lt;用户&gt; &lt;金额&gt;</code>\n示例：<code>/credit ali 500000</code> — 负数为扣款。",
  creditDone: "✅ {user} 的余额已从 {old} 变更为 <b>{new}</b> 托曼。",
  addUserHint: "用法：<code>/adduser &lt;套餐名&gt;</code>\n可用套餐：\n{list}",
  addUserNotFound: "未找到名为 {name} 的套餐。最接近的：\n{suggestions}",
  uapTitle: "📋 <b>为 {user} 应用套餐</b>\n请选择套餐：",
  btnRenew: "🔄 续费",
  renTitle: "🔄 <b>续费 {user}</b>\n请选择用于续费的套餐：",
  renEmpty: "当前没有可续费的套餐。",
  renewed: "🔄 <b>订阅已续费！</b>\n\n• 用户名：<code>{user}</code>\n• 套餐：{tpl}\n• 增加流量：{gb}\n• 增加时长：{days} 天\n\n🔗 订阅链接（不变）：\n{sub}",
  btnDelete: "🗑 删除用户",
  deleteConfirm: "⚠️ 确认永久删除用户 <b>{user}</b>？其配置将从所有入站中移除。",
  doneDelete: "🗑 用户 {user} 已删除。",
  btnApplyTpl: "📋 应用套餐",
  doneApplyTpl: "📋 已将套餐 {tpl} 应用到 {user}（{gb}，{days} 天，{ip} 台设备）。",
  btnResetDevices: "📵 重置设备",
  doneResetDevices: "📵 已重置 {user} 的设备 — 客户端需重新注册。",
};

const TR: BotTexts = {
  pickLang: "Dilinizi seçin:",
  menu: "Ana menü — birini seçin:",
  btnShop: "🛒 Mağaza",
  btnSubs: "📦 Aboneliklerim",
  btnTrial: "🎁 Ücretsiz deneme",
  btnSupport: "🆘 Destek",
  shopTitle: "🛒 <b>Mağaza</b>",
  shopEmpty: "Şu anda satışta paket yok.",
  tplLine: "<b>{name}</b>\n• Trafik: {gb}\n• Süre: {days} gün\n• Cihaz: {ip}\n• Fiyat: {price}",
  tplFree: "Ücretsiz",
  payPicker: "<b>{name}</b> için ödeme yöntemi ({price}):",
  payZarin: "💳 ZarinPal",
  payCard: "🏦 Kart-karta",
  payZarinSent: "🔗 Ödemek için aşağıdaki düğmeye dokunun:\nTutar: <b>{price} Toman</b>\n\nÖdeme sonrası sipariş bir dakika içinde otomatik doğrulanır ve yapılandırma buraya iletilir.",
  payCardInfo: "🏦 <b>Kart-karta ödeme</b>\n\nKart numarası:\n<code>{card}</code>\nSahibi: <b>{holder}</b>\nTutar: <b>{price} Toman</b>\n\nTransferden sonra yönetici onayı için <b>dekont fotoğrafını</b> buraya gönderin.",
  payCardSendReceipt: "Lütfen transfer dekontunu fotoğraf olarak gönderin.",
  receiptReceived: "✅ Dekont alındı. Sonuç yakında bildirilecek.",
  noPendingReceipt: "Bekleyen bir dekont siparişiniz yok.",
  orderPaid: "✅ Ödeme onaylandı — yapılandırma hazırlanıyor…",
  delivered: "🎉 <b>Aboneliğiniz hazır!</b>\n\n• Kullanıcı adı: <code>{user}</code>\n• Trafik: {gb}\n• Süre: {days} gün\n\n🔗 Abonelik bağlantısı:\n{sub}\n\n📱 Clash bağlantısı:\n{clash}\n\n📱 Sing-Box bağlantısı:\n{singbox}\n\nKullanım: bağlantıyı uygulamanıza yapıştırın (v2rayNG / Streisand / Hiddify / Clash Meta) veya aşağıdaki düğmeye dokunun.",
  subsTitle: "📦 <b>Aboneliklerim</b>",
  subsEmpty: "Henüz aboneliğiniz yok.",
  subsLine: "• <b>{user}</b> — {used}/{limit} GB — {days} gün kaldı{state}",
  btnSubLink: "🔗 Abonelik bağlantısını aç",
  noTrial: "Şu anda ücretsiz deneme paketi yok.",
  trialLimit: "Her kullanıcı ücretsiz paketi yalnızca bir kez alabilir.",
  support: "🆘 Destek:\n{contact}",
  payUnavailable: "Bu ödeme yöntemi henüz yapılandırılmamış. Destekle iletişime geçin.",
  checkHint: "⏳ Siparişiniz ödeme bekliyor. Doğrulanır doğrulanmaz abonelik bağlantısı gelir.",
  rejected: "❌ Siparişiniz onaylanmadı. Ayrıntı için desteğe başvurun.",
  backMenu: "Menüye dön",
  notAuthorized: "⛔ Yönetici komutlarını kullanma yetkiniz yok.",
  help: "🤖 <b>Sephiroth bot komutları</b>\n/status — sistem telemetrisi\n/users [adet] — trafiğe göre ilk kullanıcılar\n/inbounds — inbound listesi\n/user &lt;ad&gt; — kullanıcı ara + denetim\n/adduser &lt;paket&gt; — paketten kullanıcı oluştur\n/credit &lt;kullanıcı&gt; &lt;tutar&gt; — cüzdan bakiyesi ayarla\n/backup_now — yedek anlık görüntüsü al\n/start — ana menü",
  stTitle: "🛰 <b>Sephiroth · Sistem Telemetrisi</b>",
  stCore: "• Çekirdek: {core} ({status})",
  stInbounds: "• Aktif inbound: {online}/{total}",
  stUsers: "• Kullanıcılar: {enabled} etkin / {total} toplam",
  stTraffic: "• Tüketilen trafik: {gb} GB",
  stUptime: "• Panel çalışma süresi: {up}",
  stVersion: "• Sürüm: v{ver}",
  usersTitle: "👥 <b>En çok kullananlar</b>",
  usersEmpty: "Henüz kullanıcı oluşturulmadı.",
  usersLine: "{n}. <code>{user}</code> — {used}/{limit} GB — {days} gün{state}",
  inbTitle: "🔌 <b>Inbound'ler</b>",
  inbEmpty: "Henüz inbound yok.",
  inbLine: "• <b>{tag}</b> — {proto} :{port} · {status} · {clients} istemci",
  userCard: "👤 <b>{user}</b>\n• Durum: {status}\n• Trafik: {used}/{limit} GB\n• Kalan süre: {days} gün\n• Cihaz: {ip}",
  userNotFound: "Bu isimde kullanıcı bulunamadı. (arama: /user &lt;ad&gt;)",
  userQueryHint: "Kullanıcı adını yazın: <code>/user ali</code>",
  btnEnable: "✅ Etkinleştir",
  btnDisable: "⛔ Devre dışı bırak",
  btnReset: "♻️ Trafiği sıfırla",
  doneEnable: "{user} kullanıcısı etkinleştirildi",
  doneDisable: "{user} kullanıcısı devre dışı bırakıldı",
  doneReset: "{user} trafiği sıfırlandı",
  nUserCreated: "🆕 Kullanıcı <code>{user}</code> oluşturuldu — {gb}، {days} gün",
  nUserDeleted: "🗑 Kullanıcı <code>{user}</code> silindi",
  nUserUpdated: "✏️ Kullanıcı <code>{user}</code> güncellendi",
  nUserExpired: "⌛ Kullanıcı <code>{user}</code> süresi doldu — devre dışı bırakıldı",
  nQuotaCapped: "📦 Kullanıcı <code>{user}</code> kota sınırına ulaştı ({used}/{limit} GB)",
  nTrafficReset: "♻️ Trafik sayacı sıfırlandı — <code>{user}</code> ({period})",
  nBackupDone: "💾 Yedekleme tamamlandı — {file} ({kb} KB)",
  nRestart: "🚀 Panel yeniden başlatıldı — v{ver}",
  nInboundCreated: "📥 Inbound <b>{tag}</b> oluşturuldu ({proto} :{port})",
  nInboundDeleted: "📤 Inbound <b>{tag}</b> silindi",
  nLoginFailed: "🔐 <code>{user}</code> için başarısız giriş denemesi — {ip}",
  nNearExpiry: "⏳ Kullanıcı <code>{user}</code> {days} gün içinde sona eriyor",
  nDigest: "📈 24 saatlik özet — {orders} tamamlanan sipariş ({revenue} Toman), {users} yeni kullanıcı",
  nUserActivated: "▶️ Bekleyen kullanıcı <code>{user}</code> ilk bağlantıda etkinleşti — {days} gün",
  nUserRenewed: "🔄 <code>{user}</code> aboneliği otomatik yenilendi (toplam {renewals})",
  btnWallet: "💰 Cüzdan",
  walletView: "💰 <b>Cüzdan</b>\nBakiye: <b>{balance} Toman</b>\n\nBakiye yüklemek için desteğe yazın — onaydan sonra yönetici cüzdanınıza ekler.",
  btnWalletPay: "💰 Cüzdandan öde",
  walletInsufficient: "Cüzdan bakiyeniz ({balance} Toman) bu satın alma için yetersiz. Gerekli: {price} Toman.",
  walletPaid: "✅ Cüzdandan {price} Toman düşüldü. Yeni bakiye: {balance} Toman.",
  walletCredited: "💰 Cüzdanınıza {amount} Toman işlendi.\nYeni bakiye: <b>{balance} Toman</b>",
  creditHint: "Kullanım: <code>/credit &lt;kullanıcı&gt; &lt;tutar&gt;</code>\nÖrnek: <code>/credit ali 500000</code> — negatif tutar düşer.",
  creditDone: "✅ {user} bakiyesi {old} → <b>{new}</b> Toman olarak güncellendi.",
  addUserHint: "Kullanım: <code>/adduser &lt;paket adı&gt;</code>\nMevcut paketler:\n{list}",
  addUserNotFound: "{name} adında paket bulunamadı. En yakınlar:\n{suggestions}",
  uapTitle: "📋 <b>{user} için paket uygula</b>\nPaket seçin:",
  btnRenew: "🔄 Yenile",
  renTitle: "🔄 <b>{user} aboneliğini yenile</b>\nYenilemek için paket seçin:",
  renEmpty: "Şu anda yenileme için paket yok.",
  renewed: "🔄 <b>Aboneliğiniz yenilendi!</b>\n\n• Kullanıcı: <code>{user}</code>\n• Paket: {tpl}\n• Eklenen trafik: {gb}\n• Eklenen süre: {days} gün\n\n🔗 Abonelik bağlantısı (değişmedi):\n{sub}",
  btnDelete: "🗑 Kullanıcıyı sil",
  deleteConfirm: "⚠️ <b>{user}</b> kalıcı olarak silinsin mi? Yapılandırması tüm inbound'lerden kaldırılır.",
  doneDelete: "🗑 {user} silindi.",
  btnApplyTpl: "📋 Paket uygula",
  doneApplyTpl: "📋 {tpl} paketi {user} üzerine uygulandı ({gb}, {days} gün, {ip} cihaz).",
  btnResetDevices: "📵 Cihazları sıfırla",
  doneResetDevices: "📵 {user} cihazları sıfırlandı — istemciler yeniden kaydolmalı.",
};

const RU: BotTexts = {
  pickLang: "Выберите язык:",
  menu: "Главное меню — выберите:",
  btnShop: "🛒 Магазин",
  btnSubs: "📦 Мои подписки",
  btnTrial: "🎁 Пробный период",
  btnSupport: "🆘 Поддержка",
  shopTitle: "🛒 <b>Магазин</b>",
  shopEmpty: "Сейчас нет доступных тарифов.",
  tplLine: "<b>{name}</b>\n• Трафик: {gb}\n• Срок: {days} дн.\n• Устройства: {ip}\n• Цена: {price}",
  tplFree: "Бесплатно",
  payPicker: "Способ оплаты для <b>{name}</b> ({price}):",
  payZarin: "💳 ZarinPal",
  payCard: "🏦 Перевод на карту",
  payZarinSent: "🔗 Нажмите кнопку ниже для оплаты:\nСумма: <b>{price} томанов</b>\n\nПосле оплаты заказ подтверждается автоматически в течение минуты, и конфигурация придёт сюда.",
  payCardInfo: "🏦 <b>Оплата переводом на карту</b>\n\nНомер карты:\n<code>{card}</code>\nДержатель: <b>{holder}</b>\nСумма: <b>{price} томанов</b>\n\nПосле перевода отправьте сюда <b>фото квитанции</b> на проверку администратору.",
  payCardSendReceipt: "Отправьте фото квитанции о переводе.",
  receiptReceived: "✅ Квитанция получена. О результате сообщим позже.",
  noPendingReceipt: "У вас нет заказов, ожидающих квитанцию.",
  orderPaid: "✅ Оплата подтверждена — создаём конфигурацию…",
  delivered: "🎉 <b>Ваша подписка готова!</b>\n\n• Имя пользователя: <code>{user}</code>\n• Трафик: {gb}\n• Срок: {days} дн.\n\n🔗 Ссылка подписки:\n{sub}\n\n📱 Clash-ссылка:\n{clash}\n\n📱 Sing-Box ссылка:\n{singbox}\n\nКак использовать: вставьте ссылку в приложение (v2rayNG / Streisand / Hiddify / Clash Meta) или нажмите кнопку ниже.",
  subsTitle: "📦 <b>Мои подписки</b>",
  subsEmpty: "У вас пока нет подписок.",
  subsLine: "• <b>{user}</b> — {used}/{limit} GB — осталось {days} дн.{state}",
  btnSubLink: "🔗 Открыть ссылку подписки",
  noTrial: "Бесплатный пробный тариф сейчас недоступен.",
  trialLimit: "Бесплатный тариф можно получить только один раз.",
  support: "🆘 Поддержка:\n{contact}",
  payUnavailable: "Этот способ оплаты пока не настроен. Обратитесь в поддержку.",
  checkHint: "⏳ Заказ ожидает оплаты. Ссылка подписки придёт сразу после подтверждения.",
  rejected: "❌ Ваш заказ не одобрен. Подробности в поддержке.",
  backMenu: "В меню",
  notAuthorized: "⛔ Вам недоступны команды администратора.",
  help: "🤖 <b>Команды бота Sephiroth</b>\n/status — телеметрия системы\n/users [n] — пользователи по трафику\n/inbounds — список inbound\n/user &lt;имя&gt; — найти пользователя + управление\n/adduser &lt;тариф&gt; — создать пользователя из тарифа\n/credit &lt;пользователь&gt; &lt;сумма&gt; — настроить баланс кошелька\n/backup_now — получить резервную копию\n/start — главное меню",
  stTitle: "🛰 <b>Sephiroth · Телеметрия системы</b>",
  stCore: "• Ядро: {core} ({status})",
  stInbounds: "• Активных inbound: {online}/{total}",
  stUsers: "• Пользователи: {enabled} вкл. / {total} всего",
  stTraffic: "• Потреблено трафика: {gb} GB",
  stUptime: "• Аптайм панели: {up}",
  stVersion: "• Версия: v{ver}",
  usersTitle: "👥 <b>Топ пользователей</b>",
  usersEmpty: "Пользователей ещё нет.",
  usersLine: "{n}. <code>{user}</code> — {used}/{limit} GB — {days} дн.{state}",
  inbTitle: "🔌 <b>Подключения (inbound)</b>",
  inbEmpty: "Inbound пока нет.",
  inbLine: "• <b>{tag}</b> — {proto} :{port} · {status} · клиентов: {clients}",
  userCard: "👤 <b>{user}</b>\n• Статус: {status}\n• Трафик: {used}/{limit} GB\n• Осталось: {days} дн.\n• Устройства: {ip}",
  userNotFound: "Пользователь с таким именем не найден. (поиск: /user &lt;имя&gt;)",
  userQueryHint: "Введите имя пользователя: <code>/user ali</code>",
  btnEnable: "✅ Включить",
  btnDisable: "⛔ Отключить",
  btnReset: "♻️ Сбросить трафик",
  doneEnable: "Пользователь {user} включён",
  doneDisable: "Пользователь {user} отключён",
  doneReset: "Трафик {user} сброшен",
  nUserCreated: "🆕 Пользователь <code>{user}</code> создан — {gb}, {days} дн.",
  nUserDeleted: "🗑 Пользователь <code>{user}</code> удалён",
  nUserUpdated: "✏️ Пользователь <code>{user}</code> обновлён",
  nUserExpired: "⌛ Пользователь <code>{user}</code> истёк — отключён",
  nQuotaCapped: "📦 Пользователь <code>{user}</code> исчерпал квоту ({used}/{limit} GB)",
  nTrafficReset: "♻️ Счётчик трафика сброшен — <code>{user}</code> ({period})",
  nBackupDone: "💾 Резервная копия готова — {file} ({kb} KB)",
  nRestart: "🚀 Панель перезапущена — v{ver}",
  nInboundCreated: "📥 Inbound <b>{tag}</b> создан ({proto} :{port})",
  nInboundDeleted: "📤 Inbound <b>{tag}</b> удалён",
  nLoginFailed: "🔐 Неудачная попытка входа для <code>{user}</code> с {ip}",
  nNearExpiry: "⏳ Пользователь <code>{user}</code> истекает через {days} дн.",
  nDigest: "📈 Сводка за 24 ч — {orders} завершённых заказов ({revenue} туманов), {users} новых пользователей",
  nUserActivated: "▶️ Отложенный пользователь <code>{user}</code> активирован при первом подключении — {days} дн.",
  nUserRenewed: "🔄 Подписка <code>{user}</code> автопродлена (всего {renewals})",
  btnWallet: "💰 Кошелёк",
  walletView: "💰 <b>Кошелёк</b>\nБаланс: <b>{balance} томанов</b>\n\nДля пополнения напишите в поддержку — после подтверждения администратор зачислит средства.",
  btnWalletPay: "💰 Оплатить с кошелька",
  walletInsufficient: "Баланса кошелька ({balance} томанов) недостаточно для этой покупки. Требуется: {price} томанов.",
  walletPaid: "✅ С кошелька списано {price} томанов. Новый баланс: {balance} томанов.",
  walletCredited: "💰 Баланс вашего кошелька изменён на {amount} томанов.\nНовый баланс: <b>{balance} томанов</b>",
  creditHint: "Использование: <code>/credit &lt;пользователь&gt; &lt;сумма&gt;</code>\nПример: <code>/credit ali 500000</code> — отрицательная сумма списывает.",
  creditDone: "✅ Баланс {user} изменён с {old} на <b>{new}</b> томанов.",
  addUserHint: "Использование: <code>/adduser &lt;название тарифа&gt;</code>\nДоступные тарифы:\n{list}",
  addUserNotFound: "Тариф с именем {name} не найден. Ближайшие:\n{suggestions}",
  uapTitle: "📋 <b>Применить тариф к {user}</b>\nВыберите тариф:",
  btnRenew: "🔄 Продлить",
  renTitle: "🔄 <b>Продление подписки {user}</b>\nВыберите тариф для продления:",
  renEmpty: "Сейчас нет тарифов для продления.",
  renewed: "🔄 <b>Подписка продлена!</b>\n\n• Пользователь: <code>{user}</code>\n• Тариф: {tpl}\n• Добавлено трафика: {gb}\n• Добавлено дней: {days}\n\n🔗 Ссылка подписки (не изменилась):\n{sub}",
  btnDelete: "🗑 Удалить пользователя",
  deleteConfirm: "⚠️ Удалить пользователя <b>{user}</b> навсегда? Его конфиг будет убран из всех inbound.",
  doneDelete: "🗑 Пользователь {user} удалён.",
  btnApplyTpl: "📋 Применить тариф",
  doneApplyTpl: "📋 Тариф {tpl} применён к {user} ({gb}, {days} дн., {ip} устройств).",
  btnResetDevices: "📵 Сбросить устройства",
  doneResetDevices: "📵 Устройства {user} сброшены — клиентам нужно зарегистрироваться заново.",
};

const TABLE: Record<BotLang, BotTexts> = { fa: FA, en: EN, ar: AR, zh: ZH, tr: TR, ru: RU };

export function botTexts(lang: string | null | undefined): BotTexts {
  return TABLE[(lang ?? "fa") as BotLang] ?? FA;
}

/** {key} substitution helper (missing keys stay as-is). */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

export function fmtGb(gb: number | null | undefined): string {
  if (gb === null || gb === undefined) return "∞";
  const r = Math.round(gb * 10) / 10;
  return r >= 100 ? String(Math.round(r)) : String(r);
}

export function fmtToman(n: number): string {
  return n.toLocaleString("en-US");
}

export function fmtDays(days: number | null | undefined): string {
  return days === null || days === undefined ? "∞" : String(days);
}
