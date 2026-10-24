export const LANGS = ["en", "fa", "ar", "zh", "tr", "ru"] as const;
export type Lang = (typeof LANGS)[number];

export const RTL_LANGS: ReadonlySet<Lang> = new Set<Lang>(["fa", "ar"]);

export const LANG_META: Record<Lang, { code: string; native: string; dir: "ltr" | "rtl" }> = {
  en: { code: "EN", native: "English", dir: "ltr" },
  fa: { code: "FA", native: "فارسی", dir: "rtl" },
  ar: { code: "AR", native: "العربية", dir: "rtl" },
  zh: { code: "ZH", native: "中文", dir: "ltr" },
  tr: { code: "TR", native: "Türkçe", dir: "ltr" },
  ru: { code: "RU", native: "Русский", dir: "ltr" },
};

export type ViewId =
  | "dashboard"
  | "inbounds"
  | "users"
  | "subgroups"
  | "resellers"
  | "activity"
  | "settings";

export interface Dict {
  brand: { tagline: string };
  nav: {
    dashboard: string;
    inbounds: string;
    users: string;
    subgroups: string;
    resellers: string;
    activity: string;
    settings: string;
  };
  status: { online: string; core: string; simulator: string };
  topbar: {
    search: string;
    notifications: string;
    caughtUp: string;
    profile: string;
    accountSettings: string;
    signOut: string;
  };
  common: { soon: string; soonDesc: string; backToDash: string; language: string };
  splash: { booting: string };
  dash: {
    phaseBadge: string;
    title: string;
    subtitle: string;
    health: string;
    healthNote: string;
    uptime: string;
    cpu: string;
    ram: string;
    liveTraffic: string;
    down: string;
    up: string;
    clients: string;
    clientsTotal: string;
    active: string;
    expired: string;
    limited: string;
    nearLimit: string;
    topConsumers: string;
    activity: string;
    evConnected: string;
    evCreated: string;
    evLimit: string;
    evLogin: string;
  };
  placeholder: {
    coming: string;
    bodies: Record<Exclude<ViewId, "dashboard">, string>;
  };
  footer: { phase: string; rights: string };
}

export const dictionaries: Record<Lang, Dict> = {
  en: {
    brand: { tagline: "Control Panel" },
    nav: {
      dashboard: "Dashboard",
      inbounds: "Inbounds",
      users: "Users",
      subgroups: "Sub Groups",
      resellers: "Resellers",
      activity: "Activity",
      settings: "Settings",
    },
    status: { online: "All systems nominal", core: "Core", simulator: "Simulator" },
    topbar: {
      search: "Search or jump to…",
      notifications: "Notifications",
      caughtUp: "You're all caught up",
      profile: "Profile",
      accountSettings: "Account settings",
      signOut: "Sign out",
    },
    common: {
      soon: "Under construction",
      soonDesc: "This section arrives in a later phase of our build.",
      backToDash: "Back to Dashboard",
      language: "Language",
    },
    splash: { booting: "Establishing uplink" },
    dash: {
      phaseBadge: "PHASE 0 · DESIGN SYSTEM",
      title: "Mission Control",
      subtitle: "Welcome back, Commander. Here's tonight's orbit.",
      health: "System Health",
      healthNote: "Nominal · 34°C",
      uptime: "Uptime",
      cpu: "CPU",
      ram: "RAM",
      liveTraffic: "Live Traffic",
      down: "Download",
      up: "Upload",
      clients: "Clients",
      clientsTotal: "on the grid",
      active: "Active",
      expired: "Expired",
      limited: "Limited",
      nearLimit: "Near limit",
      topConsumers: "Top Consumers",
      activity: "Activity Pulse",
      evConnected: "connected to the grid",
      evCreated: "New inbound created",
      evLimit: "Traffic limit reached",
      evLogin: "Admin signed in",
    },
    placeholder: {
      coming: "Arrives in Phase {phase}",
      bodies: {
        inbounds:
          "Protocol-grade inbound management — VLESS, VMess, Trojan and Shadowsocks with TLS/REALITY, glowing QR codes and share links.",
        users:
          "The workhorse: traffic, expiry, speed, IP and HWID limits with bulk actions and a rich user drawer.",
        subgroups:
          "Bundle configs into groups and publish one glamorous public subscription page.",
        resellers:
          "Quota-scoped reseller accounts with sale templates and their own user scope.",
        activity:
          "A live event stream — connections, creations and alerts as they happen.",
        settings:
          "Core driver, security, backups, Telegram bot and appearance — all in one orbit.",
      },
    },
    footer: { phase: "Phase 0 · Foundation", rights: "© 2025 Sephiroth" },
  },

  fa: {
    brand: { tagline: "پنل مدیریت" },
    nav: {
      dashboard: "داشبورد",
      inbounds: "کانفیگ‌ها",
      users: "کاربران",
      subgroups: "گروه‌های ساب",
      resellers: "نماینده‌ها",
      activity: "فعالیت‌ها",
      settings: "تنظیمات",
    },
    status: { online: "همه سامانه‌ها پایدار", core: "هسته", simulator: "شبیه‌ساز" },
    topbar: {
      search: "جستجو یا پرش سریع…",
      notifications: "اعلان‌ها",
      caughtUp: "همه چیز را دیده‌ای",
      profile: "پروفایل",
      accountSettings: "تنظیمات حساب",
      signOut: "خروج",
    },
    common: {
      soon: "در حال ساخت",
      soonDesc: "این بخش در فازهای بعدی ساخت پنل اضافه می‌شود.",
      backToDash: "بازگشت به داشبورد",
      language: "زبان",
    },
    splash: { booting: "برقراری اتصال" },
    dash: {
      phaseBadge: "فاز ۰ · سیستم طراحی",
      title: "مرکز فرمان",
      subtitle: "خوش برگشتی، فرمانده. این هم وضعیت مدار امشب.",
      health: "سلامت سامانه",
      healthNote: "پایدار · ۳۴ درجه",
      uptime: "آپ‌تایم",
      cpu: "پردازنده",
      ram: "حافظه",
      liveTraffic: "ترافیک زنده",
      down: "دریافت",
      up: "ارسال",
      clients: "کاربران",
      clientsTotal: "در مدار",
      active: "فعال",
      expired: "منقضی",
      limited: "محدودشده",
      nearLimit: "نزدیک سقف",
      topConsumers: "بیشترین مصرف",
      activity: "ضربان فعالیت",
      evConnected: "متصل شد",
      evCreated: "کانفیگ جدید ساخته شد",
      evLimit: "به سقف ترافیک رسید",
      evLogin: "ورود مدیر",
    },
    placeholder: {
      coming: "در فاز {phase} می‌سازیم",
      bodies: {
        inbounds:
          "مدیریت حرفه‌ای کانفیگ‌ها — VLESS، VMess، Trojan و Shadowsocks با TLS/REALITY، QR درخشان و لینک اشتراک.",
        users:
          "موتور اصلی پنل: حجم، انقضا، سرعت، آی‌پی و محدودیت HWID با عملیات گروهی و پروفایل کامل کاربر.",
        subgroups:
          "چند کانفیگ را در یک گروه جمع کن و یک صفحه اشتراک عمومی لوکس منتشر کن.",
        resellers: "حساب‌های نمایندگی با سهمیه مشخص، قالب فروش و کاربران مخصوص به خودشان.",
        activity: "جریان زنده رخدادها — اتصال‌ها، ساخت کانفیگ‌ها و هشدارها لحظه‌به‌لحظه.",
        settings: "هسته، امنیت، بکاپ، ربات تلگرام و ظاهر — همه در یک مدار.",
      },
    },
    footer: { phase: "فاز ۰ · زیرساخت", rights: "© ۲۰۲۵ Sephiroth" },
  },

  ar: {
    brand: { tagline: "لوحة التحكم" },
    nav: {
      dashboard: "لوحة التحكم",
      inbounds: "نقاط الدخول",
      users: "المستخدمون",
      subgroups: "مجموعات الاشتراك",
      resellers: "الموزّعون",
      activity: "النشاط",
      settings: "الإعدادات",
    },
    status: { online: "جميع الأنظمة مستقرة", core: "النواة", simulator: "المحاكي" },
    topbar: {
      search: "ابحث أو انتقل…",
      notifications: "الإشعارات",
      caughtUp: "لا جديد",
      profile: "الملف الشخصي",
      accountSettings: "إعدادات الحساب",
      signOut: "تسجيل الخروج",
    },
    common: {
      soon: "قيد الإنشاء",
      soonDesc: "سيصل هذا القسم في مرحلة لاحقة من البناء.",
      backToDash: "العودة إلى لوحة التحكم",
      language: "اللغة",
    },
    splash: { booting: "جارٍ إنشاء الاتصال" },
    dash: {
      phaseBadge: "المرحلة ٠ · نظام التصميم",
      title: "مركز القيادة",
      subtitle: "أهلاً بعودتك أيها القائد. هذه حالة المدار الليلة.",
      health: "صحة النظام",
      healthNote: "مستقر · ٣٤°",
      uptime: "وقت التشغيل",
      cpu: "المعالج",
      ram: "الذاكرة",
      liveTraffic: "حركة المرور المباشرة",
      down: "تنزيل",
      up: "تحميل",
      clients: "العملاء",
      clientsTotal: "في المدار",
      active: "نشط",
      expired: "منتهي",
      limited: "محدود",
      nearLimit: "قريب من الحد",
      topConsumers: "أعلى استهلاك",
      activity: "نبض النشاط",
      evConnected: "اتصل بالشبكة",
      evCreated: "تم إنشاء نقطة دخول",
      evLimit: "تم بلوغ حد الحركة",
      evLogin: "تسجيل دخول المدير",
    },
    placeholder: {
      coming: "يصل في المرحلة {phase}",
      bodies: {
        inbounds:
          "إدارة احترافية لنقاط الدخول — VLESS و VMess و Trojan و Shadowsocks مع TLS/REALITY ورموز QR وروابط المشاركة.",
        users:
          "محرك اللوحة: الحجم والانتهاء والسرعة وحدود IP وHWID مع إجراءات جماعية وملف مستخدم كامل.",
        subgroups: "اجمع عدة إعدادات في مجموعة وانشر صفحة اشتراك عامة فاخرة.",
        resellers: "حسابات موزّعين بحصص محددة وقوالب بيع ومستخدموهم الخاصون.",
        activity: "بث مباشر للأحداث — الاتصالات والإنشاءات والتنبيهات لحظة بلحظة.",
        settings: "النواة والأمان والنسخ الاحتياطي وبوت تيليجرام والمظهر — في مدار واحد.",
      },
    },
    footer: { phase: "المرحلة ٠ · الأساس", rights: "© ٢٠٢٥ Sephiroth" },
  },

  zh: {
    brand: { tagline: "控制面板" },
    nav: {
      dashboard: "仪表盘",
      inbounds: "入站配置",
      users: "用户",
      subgroups: "订阅分组",
      resellers: "分销代理",
      activity: "动态",
      settings: "设置",
    },
    status: { online: "所有系统运行正常", core: "核心", simulator: "模拟器" },
    topbar: {
      search: "搜索或跳转…",
      notifications: "通知",
      caughtUp: "已全部阅读",
      profile: "个人资料",
      accountSettings: "账户设置",
      signOut: "退出登录",
    },
    common: {
      soon: "建设中",
      soonDesc: "该部分将在后续阶段上线。",
      backToDash: "返回仪表盘",
      language: "语言",
    },
    splash: { booting: "正在建立连接" },
    dash: {
      phaseBadge: "阶段 0 · 设计系统",
      title: "指挥中心",
      subtitle: "欢迎回来，指挥官。今晚的轨道状态。",
      health: "系统健康",
      healthNote: "正常 · 34°C",
      uptime: "运行时间",
      cpu: "处理器",
      ram: "内存",
      liveTraffic: "实时流量",
      down: "下载",
      up: "上传",
      clients: "客户端",
      clientsTotal: "在线",
      active: "活跃",
      expired: "已过期",
      limited: "已限制",
      nearLimit: "接近上限",
      topConsumers: "消耗排行",
      activity: "活动脉搏",
      evConnected: "已连接",
      evCreated: "创建了新入站",
      evLimit: "达到流量上限",
      evLogin: "管理员登录",
    },
    placeholder: {
      coming: "将在第 {phase} 阶段上线",
      bodies: {
        inbounds:
          "协议级入站管理 — VLESS、VMess、Trojan 和 Shadowsocks，支持 TLS/REALITY、发光二维码与分享链接。",
        users: "核心引擎：流量、到期、速度、IP 与 HWID 限制，支持批量操作与完整用户侧栏。",
        subgroups: "将多个配置打包成组，发布一个华丽的公共订阅页。",
        resellers: "带配额的分销账户，附带销售模板与专属用户范围。",
        activity: "实时事件流 — 连接、创建与警报，尽在眼前。",
        settings: "核心驱动、安全、备份、Telegram 机器人与外观 — 同一轨道。",
      },
    },
    footer: { phase: "阶段 0 · 基础", rights: "© 2025 Sephiroth" },
  },

  tr: {
    brand: { tagline: "Kontrol Paneli" },
    nav: {
      dashboard: "Panel",
      inbounds: "Girişler",
      users: "Kullanıcılar",
      subgroups: "Abonelik Grupları",
      resellers: "Bayiler",
      activity: "Etkinlik",
      settings: "Ayarlar",
    },
    status: { online: "Tüm sistemler kararlı", core: "Çekirdek", simulator: "Simülatör" },
    topbar: {
      search: "Ara veya atla…",
      notifications: "Bildirimler",
      caughtUp: "Her şey güncel",
      profile: "Profil",
      accountSettings: "Hesap ayarları",
      signOut: "Çıkış yap",
    },
    common: {
      soon: "Yapım aşamasında",
      soonDesc: "Bu bölüm ilerleyen aşamalarda eklenecek.",
      backToDash: "Panele dön",
      language: "Dil",
    },
    splash: { booting: "Bağlantı kuruluyor" },
    dash: {
      phaseBadge: "AŞAMA 0 · TASARIM SİSTEMİ",
      title: "Komuta Merkezi",
      subtitle: "Tekrar hoş geldin Komutan. Bu geceki yörünge durumu.",
      health: "Sistem Sağlığı",
      healthNote: "Kararlı · 34°C",
      uptime: "Çalışma Süresi",
      cpu: "İşlemci",
      ram: "RAM",
      liveTraffic: "Canlı Trafik",
      down: "İndirme",
      up: "Yükleme",
      clients: "İstemciler",
      clientsTotal: "yörüngede",
      active: "Aktif",
      expired: "Süresi Bitmiş",
      limited: "Sınırlı",
      nearLimit: "Sınıra Yakın",
      topConsumers: "En Çok Tüketenler",
      activity: "Etkinlik Nabzı",
      evConnected: "ağa bağlandı",
      evCreated: "Yeni giriş oluşturuldu",
      evLimit: "Trafik sınırına ulaşıldı",
      evLogin: "Yönetici girişi",
    },
    placeholder: {
      coming: "{phase}. Aşamada geliyor",
      bodies: {
        inbounds:
          "Protokol seviyesinde giriş yönetimi — TLS/REALITY, parlayan QR kodlar ve paylaşım bağlantılarıyla VLESS, VMess, Trojan ve Shadowsocks.",
        users:
          "Ana motor: toplu işlemler ve zengin kullanıcı çekmecesiyle trafik, süre, hız, IP ve HWID limitleri.",
        subgroups:
          "Yapılandırmaları gruplara topla ve tek bir şık genel abonelik sayfası yayınla.",
        resellers: "Kotalı bayi hesapları, satış şablonları ve kendilerine ait kullanıcı kapsamı.",
        activity: "Canlı etkinlik akışı — bağlantılar, oluşturmalar ve uyarılar anbeanan.",
        settings: "Çekirdek sürücüsü, güvenlik, yedekleme, Telegram botu ve görünüm — tek yörüngede.",
      },
    },
    footer: { phase: "Aşama 0 · Temel", rights: "© 2025 Sephiroth" },
  },

  ru: {
    brand: { tagline: "Панель управления" },
    nav: {
      dashboard: "Панель",
      inbounds: "Подключения",
      users: "Пользователи",
      subgroups: "Группы подписок",
      resellers: "Реселлеры",
      activity: "Активность",
      settings: "Настройки",
    },
    status: { online: "Все системы в норме", core: "Ядро", simulator: "Симулятор" },
    topbar: {
      search: "Найти или перейти…",
      notifications: "Уведомления",
      caughtUp: "Всё просмотрено",
      profile: "Профиль",
      accountSettings: "Настройки аккаунта",
      signOut: "Выйти",
    },
    common: {
      soon: "В разработке",
      soonDesc: "Этот раздел появится на следующем этапе сборки.",
      backToDash: "Назад на панель",
      language: "Язык",
    },
    splash: { booting: "Устанавливаем связь" },
    dash: {
      phaseBadge: "ФАЗА 0 · ДИЗАЙН-СИСТЕМА",
      title: "Центр управления",
      subtitle: "С возвращением, Командир. Так выглядит орбита сегодня.",
      health: "Здоровье системы",
      healthNote: "Норма · 34°C",
      uptime: "Аптайм",
      cpu: "ЦП",
      ram: "ОЗУ",
      liveTraffic: "Живой трафик",
      down: "Загрузка",
      up: "Отдача",
      clients: "Клиенты",
      clientsTotal: "на орбите",
      active: "Активны",
      expired: "Истекли",
      limited: "Ограничены",
      nearLimit: "У лимита",
      topConsumers: "Лидеры потребления",
      activity: "Пульс активности",
      evConnected: "подключился к сети",
      evCreated: "Создано новое подключение",
      evLimit: "Достигнут лимит трафика",
      evLogin: "Вход администратора",
    },
    placeholder: {
      coming: "Появится в фазе {phase}",
      bodies: {
        inbounds:
          "Управление подключениями протокольного уровня — VLESS, VMess, Trojan и Shadowsocks с TLS/REALITY, светящимися QR-кодами и ссылками.",
        users:
          "Рабочая лошадка: трафик, срок, скорость, лимиты IP и HWID с массовыми действиями и полной карточкой пользователя.",
        subgroups:
          "Соберите конфиги в группы и опубликуйте одну роскошную страницу подписки.",
        resellers: "Аккаунты реселлеров с квотами, шаблонами продаж и своим кругом пользователей.",
        activity: "Живой поток событий — подключения, создания и оповещения в реальном времени.",
        settings: "Ядро, безопасность, бэкапы, Telegram-бот и оформление — на одной орбите.",
      },
    },
    footer: { phase: "Фаза 0 · Фундамент", rights: "© 2025 Sephiroth" },
  },
};
