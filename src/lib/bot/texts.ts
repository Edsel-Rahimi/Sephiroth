/* ============================================================
   Sephiroth · Task 23-c — Sales-bot chat strings (fa / en)

   These are BOT-facing texts (per Telegram user language), not
   panel UI strings — the panel UI lives in i18n/dictionaries.ts.
   Kept deliberately small: HTML parse mode, <b> for emphasis,
   <code> for monospace values.
   ============================================================ */

export type BotLang = "fa" | "en";

export interface BotTexts {
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
};

const TABLE: Record<BotLang, BotTexts> = { fa: FA, en: EN };

export function botTexts(lang: string | null | undefined): BotTexts {
  return TABLE[lang === "fa" ? "fa" : "en"];
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
