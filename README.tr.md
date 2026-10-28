[English](README.md) | [فارسی](README.fa.md) | [العربية](README.ar.md) | [中文](README.zh.md) | [Türkçe](README.tr.md) | [Русский](README.ru.md)

<p align="center">
  <img src="public/sephiroth-logo.png" alt="Sephiroth" width="140">
</p>

<h1 align="center">Sephiroth</h1>

<p align="center">
  <strong>Yeni nesil Xray VPN paneli</strong> — obsidyen koyu arayüz, glassmorphism, 6 dil, gerçek Xray çekirdek sürücüsü.
</p>

![Sephiroth v2.5.0 infografiği](docs/infographic.png)

<p align="center">
  <a href="https://github.com/Edsel-Rahimi/Sephiroth/releases"><img alt="Release" src="https://img.shields.io/github/v/release/edsel-rahimi/sephiroth"></a>&nbsp;
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>&nbsp;
  <a href="https://nodejs.org"><img alt="Node.js 20 or newer" src="https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white"></a>&nbsp;
  <img alt="i18n: 6 languages" src="https://img.shields.io/badge/i18n-6%20languages-blueviolet">&nbsp;
  <img alt="Platform: Linux and Docker" src="https://img.shields.io/badge/platform-Linux%20%7C%20Docker-informational">&nbsp;
  <a href="https://github.com/Edsel-Rahimi/Sephiroth/stargazers"><img alt="GitHub Stars" src="https://img.shields.io/github/stars/edsel-rahimi/sephiroth?style=flat&logo=github&color=22d8ee"></a>
</p>

---

## Sephiroth nedir?

**Sephiroth**, [Xray-core](https://github.com/XTLS/Xray-core) sunucuları için açık kaynaklı, yeni nesil bir yönetim panelidir. Bir VPN operatörünün dokunduğu her şey — giriş oluşturmak, kullanıcılara config dağıtmak, trafiği izlemek, gerçek Xray çekirdeğini çalıştırmak — altı dil konuşan ve sağdan sola yazımı birinci sınıf vatandaş sayan sakin bir obsidyen-cam kokpitinin ardındadır. Bakılacak harici bir veritabanı yok: tek bir Node.js süreci, atomik yerel JSON deposuyla arayüzü, API'yi, canlı telemetri soketini ve bakım görevlerini **tek portta** sunar. Güncel sürüm: **v2.4.0**.

Onu farklı yapan ne?

- 🪟 **6 temalı cam arayüz** — derin obsidyen, camgöbeği neon, platin gümüş; altı tam tema (Sephiroth Cosmic, Jenova Violet, Masamune Crimson, Matrix Terminal, OLED Void Gold, One-Winged Angel) ve gerçek RTL.
- 🔨 **Canlı önizlemeli, istemci başına Forge** — tek diyaloğu her protokolü kurar; ayarları çevirirken paylaşım bağlantısı ve abonelik önizlemesi anında güncellenir.
- 🩺 **Konfigürasyon Doktoru puanı** — 0–100 arası puanla 16 otomatik sağlık kontrolü; başka hiçbir panelde benzeri yok.
- 📈 **Trafik tahmini** — her kullanıcının trafik çubuğunun altında "≈ N gün kaldı · günlük oran" yanma hızı çipleri.
- 💼 **Bayiler + satış şablonları + ödeme kapıları** — hiçbir açık kaynak panelin sunmadığı bir kombinasyon.
- ⚙️ **Gerçek Xray çekirdek sürücüsü** — kullanıcı başına gerçek istatistik sunan, isteğe bağlı üretim çekirdeği; yerleşik simülatör sıfır kurulumla varsayılan kalmaya devam eder.

## Özellikler

### Protokoller ve Taşıyıcılar

- **9 giriş protokolü** — VLESS, VMess, Trojan, Shadowsocks, Hysteria2, WireGuard, SOCKS, HTTP ve Dokodemo-door.
- **Güvenlik ve taşıyıcılar** — TCP, WebSocket, gRPC, HTTPUpgrade ve XHTTP üzerinden TLS ve REALITY.
- **Fallback'lar ve tek port combo önyapısı** — Xray fallback'larıyla tek portta birden çok protokol (örn. VLESS + Trojan + panelin kendisi).

### Kullanıcı Yönetimi

- **Kullanıcılar, kotalar ve bitiş** — istemci başına trafik limiti, bitiş tarihi, açma/kapama ve toplu işlemler; tek kimlik birden çok girişte koşabilir.
- **Tahmin çipleri** — her kullanıcının trafik çubuğunun altında yanma hızı tahmini ("≈ N gün kaldı"); 7 günde amber, 3 günde kızıl.
- **Abonelik Grupları ve markalı portal** — her grup için tek herkese açık abonelik sayfası, parola ile kilitlenebilir; çıktı **ham liste, Clash Meta (Mihomo), Sing-Box ve Xray-JSON** olarak, `Subscription-Userinfo` sayacı ve QR kodlarıyla.

### Güvenilirlik

- **Gerçek Xray çekirdek sürücüsü** (isteğe bağlı; varsayılan simülatör) — girişlerinizden kurulan gerçek Xray-core süreci, kullanıcı/giriş başına gerçek istatistik, kill'e dayanıklı otomatik yeniden başlatma ve hash-farklıysa sıcak yeniden yükleme.
- **Konfigürasyon Doktoru** — 100 üzerinden puanla 16 kontrol: açık SOCKS/HTTP proxy'leri, sertifikasız TLS, eksik REALITY, bozuk fallback'lar, mükerrer WireGuard anahtarları, ölü yönlendirme kuralları, hayalet hesaplar ve dahası.
- **Zamanlanmış yedekler** — N dosya saklamalı günlük sunucu anlık görüntüleri; tek tıkla indirme veya geri yükleme.
- **TOTP 2FA** — sıfır bağımlılıklı RFC-6238 doğrulayıcı girişi; kapatmak geçerli kod ister.
- **Kendi kendine güncelleme düğmesi** — kontrol → uygula → yeniden başlat, doğrudan panelden.

### İş Dünyası

- **Bayiler** — kullanıcı sayısı ve trafik kotalı, sadece kendi kullanıcılarını gören yetkili alt operatörler.
- **Satış şablonları** — bayilerin anında açtığı tek tık paketler (trafik, bitiş, IP limiti).
- **Ödeme kapıları** — ZarinPal, Tether TRC20, TON ve karttan karta; GB başına tarif ve otomatik ödeme webhook'larıyla.

### Telegram

- **Bot konsolu** — `/status`, `/users`, `/create_trial`, `/backup_now`; anında abonelik bağlantısıyla.
- **SOCKS5 proxy seti** — Telegram'ın yerel `t.me/socks` derin bağlantıları ve okunabilir QR.
- **MTProto gizli anahtar aracı** — dd/basit secret'lar, `tg://` bağlantıları ve hazır daemon komutları.

### Operasyon

- **Sunucu IP otomatik algılama + boş port büyüsü** — dinleme IP'si için tek tıkla açılır liste (genel → özel → tüm arayüzler) ve Forge'da önerilen boş port; `0.0.0.0` bir daha asla istemci bağlantılarına sızmaz.
- **Host'lar · Düğümler · Çıkışlar · Yönlendirme** — şık bağlantılar için alan adı geçersiz kılmaları, canlı sonda düğümleri, çıkış zincirleme ve tek tık yönlendirme ön ayarları (reklam engelle, İran→doğrudan, QUIC engelle…).
- **Canlı operasyon** — soket tabanlı telemetri kokpiti, canlı etkinlik akışı artı aranabilir ve JSON dışa aktarılabilir geçmiş.
- **6 tema · 6 dil** — birinci sınıf RTL'li (فارسی / العربية) obsidyen-cam koyu arayüz ve ⌘K komut paleti.

## Ekran Görüntüleri

<details open>
<summary><b>Ekran görüntüleri ve GIF'ler</b> — katlamak için tıklayın</summary>

<p align="center">
  <img src="docs/gif-tour.gif" alt="Sephiroth turu — giriş, panel, girişler, Forge, Konfigürasyon Doktoru, çekirdek ayarları" width="92%">
</p>

<table>
  <tr>
    <td align="center" width="50%"><img src="docs/shot-dashboard.png" alt="Panel"><br><sub>Panel — canlı telemetri kokpiti</sub></td>
    <td align="center" width="50%"><img src="docs/shot-forge-autofill.png" alt="Otomatik IP doldurma"><br><sub>Forge — tek tık sunucu IP doldurma</sub></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="docs/shot-doctor.png" alt="Konfigürasyon Doktoru"><br><sub>Konfigürasyon Doktoru — 16 kontrol, 0–100 puan</sub></td>
    <td align="center" width="50%"><img src="docs/shot-sub-portal.png" alt="Abonelik portalı"><br><sub>Markalı abonelik portalı</sub></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="docs/shot-settings-core.png" alt="Çekirdek sürücüsü ayarları"><br><sub>Ayarlar → Çekirdek — gerçek Xray sürücüsü</sub></td>
    <td align="center" width="50%"><img src="docs/shot-users.png" alt="Kullanıcılar"><br><sub>Kullanıcılar — kotalar, bitiş ve tahmin çipleri</sub></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="docs/shot-fa-dashboard.png" alt="Farsça panel"><br><sub>فارسی — panel, yerel RTL</sub></td>
    <td align="center" width="50%"><img src="docs/shot-fa-inbounds.png" alt="Farsça girişler"><br><sub>فارسی — girişler</sub></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="docs/shot-mobile-dashboard.png" alt="Mobil panel"><br><sub>Mobil — panel</sub></td>
    <td align="center" width="50%"><img src="docs/shot-mobile-forge.png" alt="Mobil Forge"><br><sub>Mobil — Forge</sub></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="docs/gif-forge.gif" alt="Hareket hâlinde otomatik doldurma"><br><sub>Hareket hâlinde Forge otomatik doldurma</sub></td>
    <td align="center" width="50%"><img src="docs/gif-mobile.gif" alt="Hareket hâlinde mobil deneyim"><br><sub>Hareket hâlinde mobil deneyim</sub></td>
  </tr>
</table>

</details>

## Hızlı Başlangıç

### Tek tıkla kurulum

```bash
bash <(curl -Ls https://raw.githubusercontent.com/Edsel-Rahimi/Sephiroth/main/install.sh)
```

Kurulum betiği dağıtımınızı ve mimarinizi algılar, sistem bağımlılıklarını **ve Node 22'yi** kurar, depoyu klonlar, uygulamayı derler ve sıkılaştırılmış bir **systemd** servisi oluşturur (systemd yokken devre dışı kalır). Sonunda panel adresini ve **rastgele üretilmiş yönetici parolasını** yazdırır ve ikisini de `/etc/sephiroth/install-result.env` içine (`0600` izniyle) kaydeder.

Belirli bir sürümü sabitlemek için etiketi argüman olarak geçirin (etiket bu depodaki git tag'lerinde bulunmalıdır; yoksa kurulum betiği açıklayıcı bir ipucuyla çıkar):

```bash
bash <(curl -Ls https://raw.githubusercontent.com/Edsel-Rahimi/Sephiroth/main/install.sh) v2.4.0
```

Katılımsız / cloud-init — sıfır soru; parola yine de sonuç dosyasına yazılır:

```bash
SEPH_NONINTERACTIVE=1 bash <(curl -Ls https://raw.githubusercontent.com/Edsel-Rahimi/Sephiroth/main/install.sh)
```

> [!IMPORTANT]
> Yönetici parolası yalnızca kurulum sırasında **bir kez** yazdırılır ve `/etc/sephiroth/install-result.env` (`0600`) içine kaydedilir. **İlk girişten hemen sonra değiştirin** — ve panelin TOTP iki adımlı doğrulamasını açın.

### Docker

```bash
docker run -d --name sephiroth -p 3000:3000 -v sephiroth_data:/app/db \
  -e SEPHIROTH_ADMIN_USER=admin -e SEPHIROTH_ADMIN_PASS=change-me \
  --restart unless-stopped ghcr.io/edsel-rahimi/sephiroth:latest
```

Ya da Compose ile (çok aşamalı derleme, isimli volume, yerleşik healthcheck):

```bash
git clone https://github.com/Edsel-Rahimi/Sephiroth.git && cd Sephiroth
export SEPH_PORT=3000 SEPHIROTH_ADMIN_USER=admin SEPHIROTH_ADMIN_PASS='S3cure-Pass!'
docker compose up -d
```

- Host portu varsayılan olarak `${SEPH_PORT:-3000}` — panel kapsayıcı içinde her zaman 3000 portunu dinler.
- JSON deposu ve otomatik yedekler `sephiroth_data` volume'ünde yaşar.
- Yerleşik healthcheck `/api/auth/session` uç noktasını yoklar; hazır imaj her push'ta `ghcr.io/edsel-rahimi/sephiroth` adresine yayınlanır.

### `sephiroth` komut satırı

<details>
<summary><b>Yönetim menüsü</b> — <code>sephiroth</code> komutu (0–14)</summary>

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

Kısayollar: `sephiroth start | stop | restart | status | logs | update | backup`

</details>

## Çekirdek sürücüsü

Sephiroth birbiriyle değiştirilebilen iki çekirdek arkayüzüyle gelir. **Ayarlar → Çekirdek** bölümünden istediğiniz an geçiş yapın:

| | **Simülatör** (varsayılan) | **Gerçek Xray çekirdeği** |
|---|---|---|
| Ne çalışır | yerleşik telemetri simülatörü | gerçek bir **Xray-core** süreci |
| Config | panel durumu, önizlemeli | girişlerinizden üretilir, `run -test` ile doğrulanır |
| İstatistik | simüle grafikler | kullanıcı ve giriş başına gerçek sayaçlar (Xray stats API) |
| Dayanıklılık | — | kill sonrası otomatik yeniden başlatma (3/10/30 sn bekleme) + hash karşılaştırmalı sıcak yeniden yükleme |
| Kimin için | paneli denemek, provada | gerçek trafik sunmak |

**Gerçek Xray çekirdeğine** geçtiğinizde panel, Xray-core ikili dosyasını XTLS/Xray-core yayınlarından **otomatik indirir** (unzip → 7z → python3 yedekleme zinciriyle) ve `db/bin/xray` altına koyar. Belirli bir çekirdek sürümünü sabitleyebilir, istatistik aralığını ayarlayabilirsiniz (5–120 sn) ve çekirdeğin canlı günlüğünü doğrudan Ayarlar'dan izleyebilirsiniz. Gerçek çekirdek bir gün başlamazsa panel otomatik olarak simülatöre döner.

## Belgeler

- 📕 **[Tam katalog — Farsça (PDF)](docs/sephiroth-catalog-fa.pdf)** — her ekranı, alanı ve ayarı anlatan eksiksiz görsel rehber.
- 🗒 Sürüm değişiklik günlükleri (Farsça PDF): [v2.2](public/sephiroth-v2.2-changelog-fa.pdf) · [v2.3](public/sephiroth-v2.3-changelog-fa.pdf)
- 🧭 Panel içi **Rehber** ekranı — her alanı sade dille anlatan 13 bölüm, sıfır jargon.

## Yol Haritası

**Tamamlandı**

- [x] Panelden kendi kendine güncelleme (kontrol → uygula → yeniden başlat)
- [x] Saklama politikalı zamanlanmış sunucu yedekleri
- [x] TOTP iki adımlı giriş
- [x] MTProto Telegram proxy aracı
- [x] Konfigürasyon Doktoru — 16 kontrol + puan
- [x] Trafik tahmin çipleri
- [x] Gerçek Xray çekirdek sürücüsü
- [x] Dağıtım seti — tek tık kurulum · `sephiroth` CLI · Docker / GHCR

**Sırada**

- [ ] Telegram satış botu (araştırma tamam — `docs/telegram-bot-research.md`)
- [ ] Çok düğümlü senkronizasyon motoru
- [ ] ACME sertifika yönetimi
- [ ] IP limiti zorlaması

## Katkı

Hata raporları, çeviri düzeltmeleri ve özellik önerileri dahil Issue ve PR'lar memnuniyetle karşılanır. Çevirilere dokunurken terminolojiyi panelin kendi dil dosyalarıyla hizalı tutun; README ile arayüz aynı dili konuşsun.

## Sephiroth'ı Destekle

Sephiroth işinizi kolaylaştırıyorsa bir ⭐ yörüngeyi canlı tutar. Panel içindeki **Destek** penceresi cüzdan adreslerini ve destek bağlantılarını listeler.

## Lisans

[MIT](LICENSE) © EPODONIOS

## Yasal Uyarı

Bu proje **eğitim amaçlı ve yasal kişisel kullanım** için yapılmıştır. Bulunduğunuz yargı bölgesinin yasalarına uymak sizin sorumluluğunuzdadır; kötüye kullanım için yazarlar hiçbir sorumluluk kabul etmez.

---

<p align="center"><sub><b>Sephiroth</b> · crafted by <a href="https://github.com/Edsel-Rahimi">EPODONIOS</a></sub></p>
