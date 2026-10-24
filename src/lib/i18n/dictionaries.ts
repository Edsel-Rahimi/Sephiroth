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
  auth: {
    heroBadge: string;
    heroTitle: string;
    heroSub: string;
    chipCore: string;
    chipLive: string;
    chipLangs: string;
    secureNote: string;
    welcome: string;
    welcomeSub: string;
    username: string;
    usernamePh: string;
    password: string;
    passwordPh: string;
    remember: string;
    signIn: string;
    signingIn: string;
    lostAccess: string;
    useRecovery: string;
    or: string;
    forgotShort: string;
    backToLogin: string;
    recoverTitle: string;
    recoverSub: string;
    recoveryKey: string;
    recoveryKeyPh: string;
    newPassword: string;
    newPasswordPh: string;
    resetPassword: string;
    resetting: string;
    previewHint: string;
    demoLabel: string;
    demoFill: string;
    errFields: string;
    errInvalid: string;
    errLocked: string;
    attemptsLeft: string;
    errBadKey: string;
    errWeak: string;
    okRecovered: string;
    welcomeToast: string;
    loggedOutToast: string;
  };
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
    auth: {
      heroBadge: "SECURE TERMINAL",
      heroTitle: "Command the orbit.",
      heroSub:
        "Every inbound, user and byte — one control deck, wrapped in an encrypted session.",
      chipCore: "Xray core ready",
      chipLive: "Realtime telemetry",
      chipLangs: "6 languages",
      secureNote: "Encrypted session · local core",
      welcome: "Welcome back",
      welcomeSub: "Sign in to the Sephiroth control deck",
      username: "Username",
      usernamePh: "Enter username",
      password: "Password",
      passwordPh: "Enter password",
      remember: "Keep me signed in for 30 days",
      signIn: "Sign in",
      signingIn: "Authenticating…",
      lostAccess: "Lost access?",
      useRecovery: "Use recovery key",
      or: "or",
      forgotShort: "Forgot?",
      backToLogin: "Back to sign in",
      recoverTitle: "Account recovery",
      recoverSub: "Set a new password using the recovery key from first setup.",
      recoveryKey: "Recovery key",
      recoveryKeyPh: "SEPH-XXXX-XXXX-XXXX",
      newPassword: "New password",
      newPasswordPh: "At least 8 characters",
      resetPassword: "Reset password",
      resetting: "Resetting…",
      previewHint: "Preview recovery key: SEPH-ORBIT-2077-NOVA",
      demoLabel: "Preview credentials",
      demoFill: "Autofill",
      errFields: "Please fill in all fields.",
      errInvalid: "Invalid username or password.",
      errLocked: "Too many attempts — locked for {s}",
      attemptsLeft: "{n} attempts left before lockout",
      errBadKey: "Recovery key not recognized.",
      errWeak: "Password must be at least 8 characters.",
      okRecovered: "Password updated. Sign in with your new password.",
      welcomeToast: "Welcome back, {name}",
      loggedOutToast: "Signed out safely",
    },
    dash: {
      phaseBadge: "PHASE 0 · DESIGN SYSTEM",
      title: "Mission Control",
      subtitle: "Here's tonight's orbit — every system, one view.",
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
    auth: {
      heroBadge: "پایانه امن",
      heroTitle: "فرمان مدار را در دست بگیر.",
      heroSub:
        "همه کانفیگ‌ها، کاربران و ترافیک — یک مرکز فرمان، در قالب یک نشست رمزنگاری‌شده.",
      chipCore: "هسته Xray آماده",
      chipLive: "تله‌متری لحظه‌ای",
      chipLangs: "۶ زبان",
      secureNote: "نشست رمزنگاری‌شده · هسته محلی",
      welcome: "خوش برگشتی",
      welcomeSub: "برای ورود به مرکز فرمان Sephiroth وارد شو",
      username: "نام کاربری",
      usernamePh: "نام کاربری را وارد کن",
      password: "رمز عبور",
      passwordPh: "رمز عبور را وارد کن",
      remember: "۳۰ روز مرا به خاطر بسپار",
      signIn: "ورود",
      signingIn: "در حال بررسی…",
      lostAccess: "دسترسی را گم کردی؟",
      useRecovery: "از کلید بازیابی استفاده کن",
      or: "یا",
      forgotShort: "فراموش کردی؟",
      backToLogin: "بازگشت به ورود",
      recoverTitle: "بازیابی حساب",
      recoverSub: "با کلید بازیابیِ نصب اولیه، یک رمز تازه تنظیم کن.",
      recoveryKey: "کلید بازیابی",
      recoveryKeyPh: "SEPH-XXXX-XXXX-XXXX",
      newPassword: "رمز تازه",
      newPasswordPh: "حداقل ۸ کاراکتر",
      resetPassword: "تغییر رمز",
      resetting: "در حال تغییر…",
      previewHint: "کلید بازیابی پیش‌نمایش: SEPH-ORBIT-2077-NOVA",
      demoLabel: "اطلاعات پیش‌نمایش",
      demoFill: "پرکردن خودکار",
      errFields: "لطفاً همه فیلدها را پر کن.",
      errInvalid: "نام کاربری یا رمز عبور اشتباه است.",
      errLocked: "تلاش‌های زیاد — قفل تا {s}",
      attemptsLeft: "{n} تلاش باقی مانده تا قفل",
      errBadKey: "کلید بازیابی شناسایی نشد.",
      errWeak: "رمز عبور باید حداقل ۸ کاراکتر باشد.",
      okRecovered: "رمز به‌روزرسانی شد. با رمز تازه وارد شو.",
      welcomeToast: "خوش برگشتی، {name}",
      loggedOutToast: "با خیال راحت خارج شدی",
    },
    dash: {
      phaseBadge: "فاز ۰ · سیستم طراحی",
      title: "مرکز فرمان",
      subtitle: "این هم وضعیت مدار امشب — همه سامانه‌ها، یک نگاه.",
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
    auth: {
      heroBadge: "الطرفية الآمنة",
      heroTitle: "قُد المدار.",
      heroSub:
        "كل نقاط الدخول والمستخدمين والبايتات — لوحة قيادة واحدة داخل جلسة مشفّرة.",
      chipCore: "نواة Xray جاهزة",
      chipLive: "قياس لحظي",
      chipLangs: "٦ لغات",
      secureNote: "جلسة مشفّرة · نواة محلية",
      welcome: "مرحبًا بعودتك",
      welcomeSub: "سجّل دخولك إلى لوحة قيادة Sephiroth",
      username: "اسم المستخدم",
      usernamePh: "أدخل اسم المستخدم",
      password: "كلمة المرور",
      passwordPh: "أدخل كلمة المرور",
      remember: "أبقني مسجلاً لمدة 30 يوماً",
      signIn: "تسجيل الدخول",
      signingIn: "جارٍ التحقق…",
      lostAccess: "فقدت الوصول؟",
      useRecovery: "استخدم مفتاح الاسترداد",
      or: "أو",
      forgotShort: "نسيت؟",
      backToLogin: "العودة لتسجيل الدخول",
      recoverTitle: "استعادة الحساب",
      recoverSub: "عيّن كلمة مرور جديدة باستخدام مفتاح الاسترداد من الإعداد الأول.",
      recoveryKey: "مفتاح الاسترداد",
      recoveryKeyPh: "SEPH-XXXX-XXXX-XXXX",
      newPassword: "كلمة المرور الجديدة",
      newPasswordPh: "8 أحرف على الأقل",
      resetPassword: "إعادة تعيين كلمة المرور",
      resetting: "جارٍ إعادة التعيين…",
      previewHint: "مفتاح استرداد المعاينة: SEPH-ORBIT-2077-NOVA",
      demoLabel: "بيانات المعاينة",
      demoFill: "تعبئة تلقائية",
      errFields: "يرجى إكمال جميع الحقول.",
      errInvalid: "اسم المستخدم أو كلمة المرور غير صحيحة.",
      errLocked: "محاولات كثيرة — مقفل لمدة {s}",
      attemptsLeft: "بقيت {n} محاولات قبل القفل",
      errBadKey: "مفتاح الاسترداد غير معروف.",
      errWeak: "يجب ألا تقل كلمة المرور عن 8 أحرف.",
      okRecovered: "تم تحديث كلمة المرور. سجّل دخولك بكلمتك الجديدة.",
      welcomeToast: "مرحباً بعودتك، {name}",
      loggedOutToast: "تم تسجيل الخروج بأمان",
    },
    dash: {
      phaseBadge: "المرحلة ٠ · نظام التصميم",
      title: "مركز القيادة",
      subtitle: "هذه حالة المدار الليلة — كل الأنظمة في نظرة واحدة.",
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
    auth: {
      heroBadge: "安全终端",
      heroTitle: "执掌轨道。",
      heroSub: "所有入站、用户与流量 — 一块指挥甲板，护以加密会话。",
      chipCore: "Xray 内核就绪",
      chipLive: "实时遥测",
      chipLangs: "6 种语言",
      secureNote: "加密会话 · 本地内核",
      welcome: "欢迎回来",
      welcomeSub: "登录 Sephiroth 指挥甲板",
      username: "用户名",
      usernamePh: "输入用户名",
      password: "密码",
      passwordPh: "输入密码",
      remember: "30 天内保持登录",
      signIn: "登录",
      signingIn: "正在验证…",
      lostAccess: "无法访问？",
      useRecovery: "使用恢复密钥",
      or: "或",
      forgotShort: "忘记密码？",
      backToLogin: "返回登录",
      recoverTitle: "账户恢复",
      recoverSub: "使用首次安装生成的恢复密钥设置新密码。",
      recoveryKey: "恢复密钥",
      recoveryKeyPh: "SEPH-XXXX-XXXX-XXXX",
      newPassword: "新密码",
      newPasswordPh: "至少 8 个字符",
      resetPassword: "重置密码",
      resetting: "正在重置…",
      previewHint: "预览恢复密钥：SEPH-ORBIT-2077-NOVA",
      demoLabel: "预览凭据",
      demoFill: "自动填充",
      errFields: "请填写所有字段。",
      errInvalid: "用户名或密码无效。",
      errLocked: "尝试过多 — 已锁定 {s}",
      attemptsLeft: "还剩 {n} 次尝试机会",
      errBadKey: "恢复密钥无法识别。",
      errWeak: "密码至少需要 8 个字符。",
      okRecovered: "密码已更新。请用新密码登录。",
      welcomeToast: "欢迎回来，{name}",
      loggedOutToast: "已安全退出",
    },
    dash: {
      phaseBadge: "阶段 0 · 设计系统",
      title: "指挥中心",
      subtitle: "今晚的轨道状态 — 所有系统，尽收眼底。",
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
    auth: {
      heroBadge: "GÜVENLİ TERMİNAL",
      heroTitle: "Yörüngenin komutanı ol.",
      heroSub:
        "Tüm girişler, kullanıcılar ve baytlar — şifreli oturumla korunan tek bir kumanda köprüsü.",
      chipCore: "Xray çekirdeği hazır",
      chipLive: "Gerçek zamanlı telemetri",
      chipLangs: "6 dil",
      secureNote: "Şifreli oturum · yerel çekirdek",
      welcome: "Tekrar hoş geldin",
      welcomeSub: "Sephiroth kumanda köprüsüne giriş yap",
      username: "Kullanıcı adı",
      usernamePh: "Kullanıcı adını gir",
      password: "Şifre",
      passwordPh: "Şifreni gir",
      remember: "30 gün hatırla",
      signIn: "Giriş yap",
      signingIn: "Doğrulanıyor…",
      lostAccess: "Erişimi mi kaybettin?",
      useRecovery: "Kurtarma anahtarını kullan",
      or: "veya",
      forgotShort: "Unuttum",
      backToLogin: "Girişe dön",
      recoverTitle: "Hesap kurtarma",
      recoverSub: "İlk kurulumdaki kurtarma anahtarıyla yeni bir şifre belirle.",
      recoveryKey: "Kurtarma anahtarı",
      recoveryKeyPh: "SEPH-XXXX-XXXX-XXXX",
      newPassword: "Yeni şifre",
      newPasswordPh: "En az 8 karakter",
      resetPassword: "Şifreyi sıfırla",
      resetting: "Sıfırlanıyor…",
      previewHint: "Önizleme kurtarma anahtarı: SEPH-ORBIT-2077-NOVA",
      demoLabel: "Önizleme bilgileri",
      demoFill: "Otomatik doldur",
      errFields: "Lütfen tüm alanları doldur.",
      errInvalid: "Kullanıcı adı veya şifre geçersiz.",
      errLocked: "Çok fazla deneme — {s} kilitli",
      attemptsLeft: "Kilitlemeden önce {n} deneme kaldı",
      errBadKey: "Kurtarma anahtarı tanınmadı.",
      errWeak: "Şifre en az 8 karakter olmalı.",
      okRecovered: "Şifre güncellendi. Yeni şifrenle giriş yap.",
      welcomeToast: "Tekrar hoş geldin, {name}",
      loggedOutToast: "Güvenle çıkış yapıldı",
    },
    dash: {
      phaseBadge: "AŞAMA 0 · TASARIM SİSTEMİ",
      title: "Komuta Merkezi",
      subtitle: "Bu geceki yörünge durumu — tüm sistemler tek bakışta.",
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
    auth: {
      heroBadge: "ЗАЩИЩЁННЫЙ ТЕРМИНАЛ",
      heroTitle: "Командуй орбитой.",
      heroSub:
        "Все подключения, пользователи и трафик — одна командная палуба в шифрованной сессии.",
      chipCore: "Ядро Xray готово",
      chipLive: "Телеметрия в реальном времени",
      chipLangs: "6 языков",
      secureNote: "Шифрованная сессия · локальное ядро",
      welcome: "С возвращением",
      welcomeSub: "Войдите на командную палубу Sephiroth",
      username: "Имя пользователя",
      usernamePh: "Введите имя пользователя",
      password: "Пароль",
      passwordPh: "Введите пароль",
      remember: "Запомнить меня на 30 дней",
      signIn: "Войти",
      signingIn: "Проверяем…",
      lostAccess: "Потеряли доступ?",
      useRecovery: "Использовать ключ восстановления",
      or: "или",
      forgotShort: "Забыли?",
      backToLogin: "Назад ко входу",
      recoverTitle: "Восстановление аккаунта",
      recoverSub:
        "Задайте новый пароль с помощью ключа восстановления из первичной настройки.",
      recoveryKey: "Ключ восстановления",
      recoveryKeyPh: "SEPH-XXXX-XXXX-XXXX",
      newPassword: "Новый пароль",
      newPasswordPh: "Минимум 8 символов",
      resetPassword: "Сбросить пароль",
      resetting: "Сбрасываем…",
      previewHint: "Ключ восстановления для предпросмотра: SEPH-ORBIT-2077-NOVA",
      demoLabel: "Демо-данные",
      demoFill: "Автозаполнение",
      errFields: "Пожалуйста, заполните все поля.",
      errInvalid: "Неверное имя пользователя или пароль.",
      errLocked: "Слишком много попыток — блокировка на {s}",
      attemptsLeft: "Осталось попыток: {n}",
      errBadKey: "Ключ восстановления не распознан.",
      errWeak: "Пароль должен содержать минимум 8 символов.",
      okRecovered: "Пароль обновлён. Войдите с новым паролем.",
      welcomeToast: "С возвращением, {name}",
      loggedOutToast: "Вышли безопасно",
    },
    dash: {
      phaseBadge: "ФАЗА 0 · ДИЗАЙН-СИСТЕМА",
      title: "Центр управления",
      subtitle: "Так выглядит орбита сегодня — все системы одним взглядом.",
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
