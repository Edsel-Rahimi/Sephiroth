import type { Lang } from "@/lib/i18n/dictionaries";

/** Strings for the Phase-2 live layer: activity feed, connection chips, parametric alerts + event templates. */
export interface L {
  feedTitle: string;
  feedSub: string;
  feedEmpty: string;
  eventsPerMin: string;
  filterAll: string;
  filterAlerts: string;
  liveChip: string;
  connecting: string;
  offline: string;
  now: string;
  sAgo: string;
  mAgo: string;
  hAgo: string;
  alertNearLimitDesc: string;
  alertExpiringDesc: string;
  evtUserConnected: string;
  evtUserDisconnected: string;
  evtUserCreated: string;
  evtUserExpired: string;
  evtUserLimit: string;
  evtAuthSuccess: string;
  evtAuthFailed: string;
  evtInboundOnline: string;
  evtInboundOffline: string;
  evtCoreReload: string;
  evtBackup: string;
  evtSpike: string;
  evtCert: string;
  evtSubFetch: string;
  evtInboundCreated: string;
  evtInboundUpdated: string;
  evtInboundDeleted: string;
}

export const liveDictionaries: Record<Lang, L> = {
  en: {
    feedTitle: "Live Activity",
    feedSub: "Core event stream — updates in real time",
    feedEmpty: "Waiting for core events…",
    eventsPerMin: "events/min",
    filterAll: "All",
    filterAlerts: "Alerts",
    liveChip: "LIVE",
    connecting: "SYNCING",
    offline: "OFFLINE",
    now: "now",
    sAgo: "{n}s",
    mAgo: "{n}m",
    hAgo: "{n}h",
    alertNearLimitDesc: "{user} consumed {pct}% of this month's quota.",
    alertExpiringDesc: "{user}'s subscription ends in {h} hours.",
    evtUserConnected: "{user} connected · {inbound}",
    evtUserDisconnected: "{user} disconnected",
    evtUserCreated: "New client {user} provisioned",
    evtUserExpired: "{user}'s subscription expired",
    evtUserLimit: "{user} hit the traffic ceiling",
    evtAuthSuccess: "Admin sign-in from {ip}",
    evtAuthFailed: "Failed login attempt from {ip}",
    evtInboundOnline: "Inbound {inbound} back online",
    evtInboundOffline: "Inbound {inbound} went offline",
    evtCoreReload: "Xray core reloaded · v{version}",
    evtBackup: "Automatic backup completed",
    evtSpike: "Traffic spike on {inbound}",
    evtCert: "TLS certificate renewed",
    evtSubFetch: "{user} fetched subscription",
    evtInboundCreated: "Inbound {inbound} created on port {port}",
    evtInboundUpdated: "Inbound {inbound} updated · port {port}",
    evtInboundDeleted: "Inbound {inbound} removed",
  },
  fa: {
    feedTitle: "فعالیت زنده",
    feedSub: "جریان رویدادهای هسته — به‌روزرسانی لحظه‌ای",
    feedEmpty: "در انتظار رویدادهای هسته…",
    eventsPerMin: "رویداد در دقیقه",
    filterAll: "همه",
    filterAlerts: "هشدارها",
    liveChip: "زنده",
    connecting: "همگام‌سازی",
    offline: "قطع",
    now: "همین حالا",
    sAgo: "{n} ثانیه",
    mAgo: "{n} دقیقه",
    hAgo: "{n} ساعت",
    alertNearLimitDesc: "{user} حدود {pct}٪ از سهمیه این ماه را مصرف کرده است.",
    alertExpiringDesc: "اشتراک {user} تا {h} ساعت آینده پایان می‌یابد.",
    evtUserConnected: "{user} متصل شد · {inbound}",
    evtUserDisconnected: "{user} قطع شد",
    evtUserCreated: "کاربر جدید {user} ساخته شد",
    evtUserExpired: "اشتراک {user} منقضی شد",
    evtUserLimit: "{user} به سقف ترافیک رسید",
    evtAuthSuccess: "ورود مدیر از {ip}",
    evtAuthFailed: "تلاش ناموفق ورود از {ip}",
    evtInboundOnline: "اینباند {inbound} دوباره آنلاین شد",
    evtInboundOffline: "اینباند {inbound} آفلاین شد",
    evtCoreReload: "هسته Xray بازنشانی شد · v{version}",
    evtBackup: "پشتیبان‌گیری خودکار انجام شد",
    evtSpike: "جهش ترافیک روی {inbound}",
    evtCert: "گواهی TLS تمدید شد",
    evtSubFetch: "{user} اشتراک را دریافت کرد",
    evtInboundCreated: "اینباند {inbound} روی پورت {port} ساخته شد",
    evtInboundUpdated: "اینباند {inbound} به‌روزرسانی شد · پورت {port}",
    evtInboundDeleted: "اینباند {inbound} حذف شد",
  },
  ar: {
    feedTitle: "النشاط المباشر",
    feedSub: "بث أحداث النواة — تحديث لحظي",
    feedEmpty: "في انتظار أحداث النواة…",
    eventsPerMin: "أحداث/دقيقة",
    filterAll: "الكل",
    filterAlerts: "التنبيهات",
    liveChip: "مباشر",
    connecting: "مزامنة",
    offline: "منقطع",
    now: "الآن",
    sAgo: "قبل {n} ث",
    mAgo: "قبل {n} د",
    hAgo: "قبل {n} س",
    alertNearLimitDesc: "استهلك {user} نسبة {pct}٪ من حصة هذا الشهر.",
    alertExpiringDesc: "ينتهي اشتراك {user} خلال {h} ساعة.",
    evtUserConnected: "{user} متصل · {inbound}",
    evtUserDisconnected: "انقطع اتصال {user}",
    evtUserCreated: "تم إنشاء عميل جديد {user}",
    evtUserExpired: "انتهى اشتراك {user}",
    evtUserLimit: "بلغ {user} حد البيانات المسموح",
    evtAuthSuccess: "تسجيل دخول المدير من {ip}",
    evtAuthFailed: "محاولة دخول فاشلة من {ip}",
    evtInboundOnline: "المدخل {inbound} متصل مجددًا",
    evtInboundOffline: "المدخل {inbound} غير متصل",
    evtCoreReload: "تمت إعادة تحميل نواة Xray · v{version}",
    evtBackup: "اكتمل النسخ الاحتياطي التلقائي",
    evtSpike: "ارتفاع مفاجئ في الحركة على {inbound}",
    evtCert: "تم تجديد شهادة TLS",
    evtSubFetch: "جلب {user} للاشتراك",
    evtInboundCreated: "تم إنشاء المدخل {inbound} على المنفذ {port}",
    evtInboundUpdated: "تم تحديث المدخل {inbound} · المنفذ {port}",
    evtInboundDeleted: "تمت إزالة المدخل {inbound}",
  },
  zh: {
    feedTitle: "实时动态",
    feedSub: "核心事件流 — 实时更新",
    feedEmpty: "等待核心事件…",
    eventsPerMin: "事件/分钟",
    filterAll: "全部",
    filterAlerts: "告警",
    liveChip: "实时",
    connecting: "同步中",
    offline: "离线",
    now: "刚刚",
    sAgo: "{n}秒前",
    mAgo: "{n}分钟前",
    hAgo: "{n}小时前",
    alertNearLimitDesc: "{user} 已使用本月配额的 {pct}%。",
    alertExpiringDesc: "{user} 的订阅将在 {h} 小时后到期。",
    evtUserConnected: "{user} 已连接 · {inbound}",
    evtUserDisconnected: "{user} 已断开",
    evtUserCreated: "新客户端 {user} 已创建",
    evtUserExpired: "{user} 的订阅已过期",
    evtUserLimit: "{user} 已达流量上限",
    evtAuthSuccess: "管理员登录 · {ip}",
    evtAuthFailed: "登录失败尝试 · {ip}",
    evtInboundOnline: "入站 {inbound} 已恢复在线",
    evtInboundOffline: "入站 {inbound} 已离线",
    evtCoreReload: "Xray 核心已重载 · v{version}",
    evtBackup: "自动备份已完成",
    evtSpike: "{inbound} 检测到流量激增",
    evtCert: "TLS 证书已续期",
    evtSubFetch: "{user} 获取了订阅",
    evtInboundCreated: "入站 {inbound} 已创建 · 端口 {port}",
    evtInboundUpdated: "入站 {inbound} 已更新 · 端口 {port}",
    evtInboundDeleted: "入站 {inbound} 已移除",
  },
  tr: {
    feedTitle: "Canlı Etkinlik",
    feedSub: "Çekirdek olay akışı — gerçek zamanlı güncellenir",
    feedEmpty: "Çekirdek olayları bekleniyor…",
    eventsPerMin: "olay/dk",
    filterAll: "Tümü",
    filterAlerts: "Uyarılar",
    liveChip: "CANLI",
    connecting: "EŞİTLENİYOR",
    offline: "ÇEVRİMDIŞI",
    now: "şimdi",
    sAgo: "{n} sn",
    mAgo: "{n} dk",
    hAgo: "{n} sa",
    alertNearLimitDesc: "{user}, bu ayın kotasının %{pct}'ini tüketti.",
    alertExpiringDesc: "{user} kullanıcısının aboneliği {h} saat içinde sona eriyor.",
    evtUserConnected: "{user} bağlandı · {inbound}",
    evtUserDisconnected: "{user} bağlantısı kesildi",
    evtUserCreated: "Yeni istemci {user} oluşturuldu",
    evtUserExpired: "{user} aboneliğinin süresi doldu",
    evtUserLimit: "{user} trafik sınırına ulaştı",
    evtAuthSuccess: "Yönetici girişi · {ip}",
    evtAuthFailed: "Başarısız giriş denemesi · {ip}",
    evtInboundOnline: "{inbound} girişi yeniden çevrimiçi",
    evtInboundOffline: "{inbound} girişi çevrimdışı oldu",
    evtCoreReload: "Xray çekirdeği yeniden yüklendi · v{version}",
    evtBackup: "Otomatik yedekleme tamamlandı",
    evtSpike: "{inbound} üzerinde trafik artışı",
    evtCert: "TLS sertifikası yenilendi",
    evtSubFetch: "{user} aboneliği indirdi",
    evtInboundCreated: "{inbound} girişi {port} portunda oluşturuldu",
    evtInboundUpdated: "{inbound} girişi güncellendi · port {port}",
    evtInboundDeleted: "{inbound} girişi kaldırıldı",
  },
  ru: {
    feedTitle: "Активность в реальном времени",
    feedSub: "Поток событий ядра — обновление live",
    feedEmpty: "Ожидание событий ядра…",
    eventsPerMin: "соб/мин",
    filterAll: "Все",
    filterAlerts: "Оповещения",
    liveChip: "LIVE",
    connecting: "СИНХРОНИЗАЦИЯ",
    offline: "ОФЛАЙН",
    now: "только что",
    sAgo: "{n} с",
    mAgo: "{n} мин",
    hAgo: "{n} ч",
    alertNearLimitDesc: "{user} израсходовал {pct}% месячной квоты.",
    alertExpiringDesc: "Подписка {user} истекает через {h} ч.",
    evtUserConnected: "{user} подключился · {inbound}",
    evtUserDisconnected: "{user} отключился",
    evtUserCreated: "Создан новый клиент {user}",
    evtUserExpired: "Подписка {user} истекла",
    evtUserLimit: "{user} достиг лимита трафика",
    evtAuthSuccess: "Вход администратора с {ip}",
    evtAuthFailed: "Неудачная попытка входа с {ip}",
    evtInboundOnline: "Инбаунд {inbound} снова в сети",
    evtInboundOffline: "Инбаунд {inbound} отключился",
    evtCoreReload: "Ядро Xray перезагружено · v{version}",
    evtBackup: "Автоматическое резервное копирование завершено",
    evtSpike: "Всплеск трафика на {inbound}",
    evtCert: "TLS-сертификат продлён",
    evtSubFetch: "{user} получил подписку",
    evtInboundCreated: "Инбаунд {inbound} создан на порту {port}",
    evtInboundUpdated: "Инбаунд {inbound} обновлён · порт {port}",
    evtInboundDeleted: "Инбаунд {inbound} удалён",
  },
};

/** Substitute {key} placeholders in a template. */
export function lfmt(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    params[k] !== undefined ? String(params[k]) : `{${k}}`
  );
}

/** Compact relative label for an event timestamp. */
export function relTime(ts: number, now: number, L: L): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 5) return L.now;
  if (s < 60) return lfmt(L.sAgo, { n: s });
  const m = Math.floor(s / 60);
  if (m < 60) return lfmt(L.mAgo, { n: m });
  const h = Math.floor(m / 60);
  return lfmt(L.hAgo, { n: h });
}

/** Split an epoch-ms start time into dd / hh / mm / ss uptime parts. */
export function splitUptime(startedAt: number, now: number) {
  const total = Math.max(0, Math.floor((now - startedAt) / 1000));
  return {
    dd: Math.floor(total / 86400),
    hh: String(Math.floor((total % 86400) / 3600)).padStart(2, "0"),
    mm: String(Math.floor((total % 3600) / 60)).padStart(2, "0"),
    ss: String(total % 60).padStart(2, "0"),
  };
}
