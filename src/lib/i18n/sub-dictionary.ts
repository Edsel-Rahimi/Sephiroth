/* ============================================================
   Sephiroth · Phase 5 — public /sub/[token] dictionary
   Standalone from the admin dictionary: the sub page is public,
   language comes from ?lang= / localStorage / navigator, not
   from the admin's UI preference. All 6 languages, full parity.
   ============================================================ */

import { LANGS, type Lang } from "./dictionaries";

export interface SubDict {
  tagline: string; // small brand tagline under the wordmark
  passKind: string; // "Orbit Pass"
  langLabel: string;
  statusActive: string;
  statusOnHold: string;
  statusExpired: string;
  statusCapped: string;
  statusDisabled: string;
  usageTitle: string;
  used: string;
  unlimited: string;
  expiryTitle: string;
  expiresNever: string;
  daysLeft: string; // {n}
  expiredAgo: string; // {n}
  membersTitle: string;
  subTitle: string;
  copySub: string;
  copyRaw: string;
  copied: string;
  qrHint: string;
  appsTitle: string;
  appsHint: string;
  configsTitle: string; // {n}
  copyLink: string;
  noLinkHint: string;
  lockedTitle: string;
  lockedDesc: string;
  password: string;
  unlock: string;
  unlocking: string;
  wrongPw: string;
  notFoundTitle: string;
  notFoundDesc: string;
  disabledTitle: string;
  disabledDesc: string;
  blockedTitle: string;
  blockedDesc: string;
  blockedCount: string; // Task 23-b — {n} devices in use, {s} allowed
  blockedContact: string;
  poweredBy: string;
  loading: string;
}

/** Tiny {x} interpolation (mirrors lfmt, kept standalone). */
export function sfmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : `{${k}}`
  );
}

const en: SubDict = {
  tagline: "Subscription Pass",
  passKind: "Orbit Pass",
  langLabel: "Language",
  statusActive: "Active",
  statusOnHold: "On hold",
  statusExpired: "Expired",
  statusCapped: "Depleted",
  statusDisabled: "Suspended",
  usageTitle: "Traffic",
  used: "used",
  unlimited: "Unlimited",
  expiryTitle: "Expiry",
  expiresNever: "Never expires",
  daysLeft: "{n} days left",
  expiredAgo: "expired {n}d ago",
  membersTitle: "Members",
  subTitle: "Subscription link",
  copySub: "Copy link",
  copyRaw: "Copy raw list",
  copied: "Copied",
  qrHint: "Scan with any client app",
  appsTitle: "One-click import",
  appsHint: "Opens the app with this subscription pre-loaded",
  configsTitle: "Configs ({n})",
  copyLink: "Copy",
  noLinkHint: "No URI scheme — copy the text summary instead",
  lockedTitle: "Protected pass",
  lockedDesc: "This subscription page is locked. Enter the password you were given.",
  password: "Password",
  unlock: "Unlock",
  unlocking: "Unlocking…",
  wrongPw: "Wrong password. Try again.",
  notFoundTitle: "Pass not found",
  notFoundDesc: "This subscription link does not exist or is no longer available.",
  disabledTitle: "Pass suspended",
  disabledDesc: "This subscription has been suspended by the administrator.",
  blockedTitle: "Device limit reached",
  blockedDesc: "This subscription is already active on the maximum number of devices.",
  blockedCount: "Devices in use: {n} of {s}",
  blockedContact: "Contact your administrator to reset your devices and try again.",
  poweredBy: "Powered by Sephiroth Panel",
  loading: "Decrypting pass…",
};

const fa: SubDict = {
  tagline: "کارت اشتراک",
  passKind: "کارت مدار",
  langLabel: "زبان",
  statusActive: "فعال",
  statusOnHold: "در انتظار",
  statusExpired: "منقضی",
  statusCapped: "اتمام‌حجم",
  statusDisabled: "تعلیق",
  usageTitle: "ترافیک",
  used: "مصرف",
  unlimited: "نامحدود",
  expiryTitle: "انقضا",
  expiresNever: "بدون انقضا",
  daysLeft: "{n} روز باقی‌مانده",
  expiredAgo: "{n} روز پیش منقضی شد",
  membersTitle: "اعضا",
  subTitle: "لینک اشتراک",
  copySub: "کپی لینک",
  copyRaw: "کپی فهرست خام",
  copied: "کپی شد",
  qrHint: "با هر اپ کلاینت اسکن کنید",
  appsTitle: "اتصال یک‌کلیکی",
  appsHint: "اپ را با همین اشتراک باز می‌کند",
  configsTitle: "کانفیگ‌ها ({n})",
  copyLink: "کپی",
  noLinkHint: "بدون URI — خلاصه متنی را کپی کنید",
  lockedTitle: "کارت محافظت‌شده",
  lockedDesc: "این صفحه اشتراک قفل است. رمزی که دریافت کرده‌اید را وارد کنید.",
  password: "رمز",
  unlock: "باز کردن",
  unlocking: "در حال باز کردن…",
  wrongPw: "رمز اشتباه است. دوباره تلاش کنید.",
  notFoundTitle: "کارت پیدا نشد",
  notFoundDesc: "این لینک اشتراک وجود ندارد یا دیگر در دسترس نیست.",
  disabledTitle: "کارت تعلیق شده",
  disabledDesc: "این اشتراک توسط مدیر تعلیق شده است.",
  blockedTitle: "سقف دستگاه‌ها پر شد",
  blockedDesc: "این اشتراک از قبل روی بیشترین تعداد دستگاه مجاز فعال است.",
  blockedCount: "دستگاه‌های در حال استفاده: {n} از {s}",
  blockedContact: "برای بازنشانی دستگاه‌هایتان با مدیر تماس بگیرید و دوباره تلاش کنید.",
  poweredBy: "قدرت‌گرفته از پنل Sephiroth",
  loading: "در حال رمزگشایی کارت…",
};

const ar: SubDict = {
  tagline: "بطاقة اشتراك",
  passKind: "بطاقة المدار",
  langLabel: "اللغة",
  statusActive: "نشط",
  statusOnHold: "قيد الانتظار",
  statusExpired: "منتهي",
  statusCapped: "منضب",
  statusDisabled: "معلّق",
  usageTitle: "حركة البيانات",
  used: "مستخدم",
  unlimited: "غير محدود",
  expiryTitle: "الانتهاء",
  expiresNever: "لا ينتهي",
  daysLeft: "{n} يومًا متبقيًا",
  expiredAgo: "انتهى قبل {n} يوم",
  membersTitle: "الأعضاء",
  subTitle: "رابط الاشتراك",
  copySub: "نسخ الرابط",
  copyRaw: "نسخ القائمة",
  copied: "تم النسخ",
  qrHint: "امسح بأي تطبيق عميل",
  appsTitle: "استيراد بنقرة واحدة",
  appsHint: "يفتح التطبيق مع هذا الاشتراك جاهزًا",
  configsTitle: "الإعدادات ({n})",
  copyLink: "نسخ",
  noLinkHint: "لا يوجد URI — انسخ الملخص النصي",
  lockedTitle: "بطاقة محمية",
  lockedDesc: "صفحة الاشتراك مقفلة. أدخل كلمة المرور التي حصلت عليها.",
  password: "كلمة المرور",
  unlock: "فتح",
  unlocking: "جارٍ الفتح…",
  wrongPw: "كلمة المرور خاطئة. حاول مجددًا.",
  notFoundTitle: "البطاقة غير موجودة",
  notFoundDesc: "رابط الاشتراك غير موجود أو لم يعد متاحًا.",
  disabledTitle: "البطاقة معلّقة",
  disabledDesc: "تم تعليق هذا الاشتراك من قبل المدير.",
  blockedTitle: "تم بلوغ حد الأجهزة",
  blockedDesc: "هذا الاشتراك نشط بالفعل على الحد الأقصى لعدد الأجهزة.",
  blockedCount: "الأجهزة قيد الاستخدام: {n} من {s}",
  blockedContact: "اتصل بالمسؤول لإعادة تعيين أجهزتك ثم حاول مجددًا.",
  poweredBy: "مدعوم من لوحة Sephiroth",
  loading: "جارٍ فك تشفير البطاقة…",
};

const zh: SubDict = {
  tagline: "订阅通行证",
  passKind: "轨道通行证",
  langLabel: "语言",
  statusActive: "正常",
  statusOnHold: "待激活",
  statusExpired: "已过期",
  statusCapped: "已耗尽",
  statusDisabled: "已停用",
  usageTitle: "流量",
  used: "已用",
  unlimited: "不限量",
  expiryTitle: "到期",
  expiresNever: "永不过期",
  daysLeft: "剩余 {n} 天",
  expiredAgo: "已过期 {n} 天",
  membersTitle: "成员",
  subTitle: "订阅链接",
  copySub: "复制链接",
  copyRaw: "复制原始列表",
  copied: "已复制",
  qrHint: "使用任意客户端扫码",
  appsTitle: "一键导入",
  appsHint: "将自动打开应用并载入此订阅",
  configsTitle: "配置（{n}）",
  copyLink: "复制",
  noLinkHint: "无 URI 协议 — 请复制文本摘要",
  lockedTitle: "受保护的通行证",
  lockedDesc: "此订阅页已上锁，请输入你获得的密码。",
  password: "密码",
  unlock: "解锁",
  unlocking: "解锁中…",
  wrongPw: "密码错误，请重试。",
  notFoundTitle: "未找到通行证",
  notFoundDesc: "该订阅链接不存在或已失效。",
  disabledTitle: "通行证已停用",
  disabledDesc: "此订阅已被管理员停用。",
  blockedTitle: "已达到设备上限",
  blockedDesc: "此订阅已在最大数量的设备上激活。",
  blockedCount: "已用设备：{n} / {s}",
  blockedContact: "请联系管理员重置你的设备后重试。",
  poweredBy: "由 Sephiroth 面板提供",
  loading: "正在解密通行证…",
};

const tr: SubDict = {
  tagline: "Abonelik Kartı",
  passKind: "Yörünge Kartı",
  langLabel: "Dil",
  statusActive: "Aktif",
  statusOnHold: "Beklemede",
  statusExpired: "Süresi Doldu",
  statusCapped: "Tükendi",
  statusDisabled: "Askıda",
  usageTitle: "Trafik",
  used: "kullanıldı",
  unlimited: "Sınırsız",
  expiryTitle: "Bitiş",
  expiresNever: "Asla bitmez",
  daysLeft: "{n} gün kaldı",
  expiredAgo: "{n} gün önce doldu",
  membersTitle: "Üyeler",
  subTitle: "Abonelik bağlantısı",
  copySub: "Bağlantıyı kopyala",
  copyRaw: "Ham listeyi kopyala",
  copied: "Kopyalandı",
  qrHint: "Herhangi bir istemci uygulamasıyla tarayın",
  appsTitle: "Tek tıkla içe aktar",
  appsHint: "Uygulamayı bu abonelik yüklü olarak açar",
  configsTitle: "Yapılandırmalar ({n})",
  copyLink: "Kopyala",
  noLinkHint: "URI şeması yok — metin özetini kopyalayın",
  lockedTitle: "Korumalı kart",
  lockedDesc: "Bu abonelik sayfası kilitli. Size verilen şifreyi girin.",
  password: "Şifre",
  unlock: "Kilidi aç",
  unlocking: "Açılıyor…",
  wrongPw: "Şifre yanlış. Tekrar deneyin.",
  notFoundTitle: "Kart bulunamadı",
  notFoundDesc: "Bu abonelik bağlantısı yok veya artık kullanılamıyor.",
  disabledTitle: "Kart askıda",
  disabledDesc: "Bu abonelik yönetici tarafından askıya alındı.",
  blockedTitle: "Cihaz sınırına ulaşıldı",
  blockedDesc: "Bu abonelik zaten izin verilen maksimum cihaz sayısında aktif.",
  blockedCount: "Kullanımdaki cihazlar: {n} / {s}",
  blockedContact: "Cihazlarınızın sıfırlanması için yöneticinizle iletişime geçin.",
  poweredBy: "Sephiroth Panel tarafından",
  loading: "Kart şifresi çözülüyor…",
};

const ru: SubDict = {
  tagline: "Карта подписки",
  passKind: "Орбитальная карта",
  langLabel: "Язык",
  statusActive: "Активна",
  statusOnHold: "Ожидание",
  statusExpired: "Истекла",
  statusCapped: "Исчерпана",
  statusDisabled: "Приостановлена",
  usageTitle: "Трафик",
  used: "использовано",
  unlimited: "Безлимит",
  expiryTitle: "Срок",
  expiresNever: "Бессрочно",
  daysLeft: "осталось {n} дн.",
  expiredAgo: "истекла {n} дн. назад",
  membersTitle: "Участники",
  subTitle: "Ссылка подписки",
  copySub: "Копировать ссылку",
  copyRaw: "Копировать список",
  copied: "Скопировано",
  qrHint: "Сканируйте любым клиентом",
  appsTitle: "Импорт в один клик",
  appsHint: "Откроет приложение с этой подпиской",
  configsTitle: "Конфиги ({n})",
  copyLink: "Копировать",
  noLinkHint: "Нет URI — скопируйте текстовую сводку",
  lockedTitle: "Защищённая карта",
  lockedDesc: "Страница подписки защищена. Введите выданный вам пароль.",
  password: "Пароль",
  unlock: "Открыть",
  unlocking: "Открываем…",
  wrongPw: "Неверный пароль. Попробуйте снова.",
  notFoundTitle: "Карта не найдена",
  notFoundDesc: "Эта ссылка подписки не существует или больше недоступна.",
  disabledTitle: "Карта приостановлена",
  disabledDesc: "Эта подписка приостановлена администратором.",
  blockedTitle: "Достигнут лимит устройств",
  blockedDesc: "Эта подписка уже активна на максимальном числе устройств.",
  blockedCount: "Устройств в использовании: {n} из {s}",
  blockedContact: "Свяжитесь с администратором, чтобы сбросить ваши устройства.",
  poweredBy: "Работает на панели Sephiroth",
  loading: "Расшифровка карты…",
};

export const subDictionaries: Record<Lang, SubDict> = { en, fa, ar, zh, tr, ru };

export const SUB_LANGS = LANGS;
