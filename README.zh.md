[English](README.md) | [فارسی](README.fa.md) | [العربية](README.ar.md) | [中文](README.zh.md) | [Türkçe](README.tr.md) | [Русский](README.ru.md)

<p align="center">
  <img src="public/sephiroth-logo.png" alt="Sephiroth" width="140">
</p>

<h1 align="center">Sephiroth</h1>

<p align="center">
  <strong>新一代 Xray VPN 面板</strong> — 黑曜石暗色 UI、玻璃拟态、6 种语言、真实 Xray 核心驱动。
</p>

![Sephiroth v2.5.0 信息图](docs/infographic.png)

<p align="center">
  <a href="https://github.com/Edsel-Rahimi/sephiroth/releases"><img alt="Release" src="https://img.shields.io/github/v/release/edsel-rahimi/sephiroth"></a>&nbsp;
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>&nbsp;
  <a href="https://nodejs.org"><img alt="Node.js 20 or newer" src="https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white"></a>&nbsp;
  <img alt="i18n: 6 languages" src="https://img.shields.io/badge/i18n-6%20languages-blueviolet">&nbsp;
  <img alt="Platform: Linux and Docker" src="https://img.shields.io/badge/platform-Linux%20%7C%20Docker-informational">&nbsp;
  <a href="https://github.com/Edsel-Rahimi/sephiroth/stargazers"><img alt="GitHub Stars" src="https://img.shields.io/github/stars/edsel-rahimi/sephiroth?style=flat&logo=github&color=22d8ee"></a>
</p>

---

## Sephiroth 是什么？

**Sephiroth** 是一个开源的下一代 [Xray-core](https://github.com/XTLS/Xray-core) 服务器控制面板。VPN 运营者要做的一切——创建入站、给用户发放配置、盯着流量、运行真实的 Xray 核心——都收在一间安静的黑曜石玻璃驾驶舱里；它会说 6 种语言，并把从右到左的排版当作一等公民来对待。无需看管任何外部数据库：单个 Node.js 进程搭配原子化的本地 JSON 存储，在**一个端口**上同时提供 UI、API、实时遥测套接字和定时维护。当前版本：**v2.5.0**。

它的与众不同之处：

- 🪟 **玻璃拟态 UI，6 套主题** — 深黑曜石、青色霓虹、铂金银；六套完整主题（Sephiroth Cosmic、Jenova Violet、Masamune Crimson、Matrix Terminal、OLED Void Gold、One-Winged Angel），RTL 渲染货真价实。
- 🔨 **逐客户端 Forge 构建器，带实时预览** — 一个对话框搞定所有协议；你每拧一个旋钮，分享链接和订阅预览就同步刷新。
- 🩺 **配置体检得分** — 16 项自动健康检查，满分 100；别的面板都拿不出这样的东西。
- 📈 **流量耗尽预测** — 每个用户的流量条下方都有「≈N 天到达上限」的燃烧率徽章。
- 💼 **分销代理 + 售卖模板 + 支付网关** — 没有任何其他开源面板同时提供这套组合。
- ⚙️ **真实 Xray 核心驱动** — 可选的生产级核心，带来货真价实的按用户统计；内置模拟器仍是无配置负担的默认选项。

## 功能特性

### 协议与传输

- **9 种入站协议** — VLESS、VMess、Trojan、Shadowsocks、Hysteria2、WireGuard、SOCKS、HTTP 和 Dokodemo-door。
- **安全与传输层** — TLS 与 REALITY，承载于 TCP、WebSocket、gRPC、HTTPUpgrade 和 XHTTP。
- **回退与单端口组合预设** — 借助 Xray fallbacks，在单个端口上同时服务多种协议（例如 VLESS + Trojan + 面板本身）。

### 用户管理

- **用户、配额与到期** — 逐客户端的流量上限与到期日、启用/禁用和批量操作；一个身份可以同时挂多个入站。
- **预测徽章** — 在每个用户的流量条下方渲染燃烧率预测（「≈N 天到达上限」），7 天变琥珀色，3 天变深红。
- **订阅分组与品牌订阅页** — 每个分组一个公开订阅页，可加密码保护；输出格式涵盖 **原始列表、Clash Meta（Mihomo）、Sing-Box 和 Xray-JSON**，附带 `Subscription-Userinfo` 用量表头和二维码。

### 可靠性

- **真实 Xray 核心驱动**（可选，默认为模拟器）— 从你的入站生成真实的 Xray-core 进程，提供真实的按用户/按入站统计、被杀后自动重启、以及基于哈希对比的热重载。
- **配置体检** — 16 项检查，满分 100：暴露在外的 SOCKS/HTTP 代理、没有证书的 TLS、不完整的 REALITY、损坏的回退、重复的 WireGuard 密钥、失效路由规则、幽灵账号等等。
- **定时备份** — 每日服务器快照，保留最近 N 份，一键下载或恢复。
- **TOTP 两步验证** — 零依赖的 RFC-6238 登录验证；关闭验证需要输入有效代码。
- **面板自更新按钮** — 检查 → 应用 → 重启，全程在面板里完成。

### 商业化

- **分销代理** — 带用户数与流量配额的受限子运营者，只能看到自己名下的用户。
- **售卖模板** — 一键开卡的套餐模板（流量、到期、IP 上限），分销代理随点随开。
- **支付网关** — ZarinPal、Tether TRC20、TON 和卡对卡，配以每 GB 资费与自动支付 Webhook。

### Telegram

- **机器人控制台** — `/status`、`/users`、`/create_trial`、`/backup_now`，即时签发订阅链接。
- **SOCKS5 代理套件** — Telegram 原生的 `t.me/socks` 深度链接和可扫二维码。
- **MTProto 密钥工具** — dd/简单密钥、`tg://` 链接和现成的守护进程命令。

### 运维

- **服务器 IP 自动检测 + 空闲端口灵感棒** — 监听地址一键下拉（公网 → 内网 → 所有接口），Forge 里还有建议空闲端口，`0.0.0.0` 再也不会漏进客户端链接。
- **主机 · 节点 · 出站 · 路由** — 域名覆盖让链接更体面，远程节点带实时探测，出站链式转发，以及现成路由预设（屏蔽广告、伊朗直连、屏蔽 QUIC……）。
- **实时运维** — 套接字驱动的遥测驾驶舱、实时活动流，外加可搜索、可导出 JSON 的历史记录。
- **6 套主题 · 6 种语言** — 黑曜石玻璃暗色 UI，一等公民级 RTL（فارسی / العربية），还有 ⌘K 命令面板。

## 截图

<details open>
<summary><b>截图与 GIF</b> — 点击收起</summary>

<p align="center">
  <img src="docs/gif-tour.gif" alt="Sephiroth 巡览 — 登录、仪表盘、入站、Forge、配置体检、核心设置" width="92%">
</p>

<table>
  <tr>
    <td align="center" width="50%"><img src="docs/shot-dashboard.png" alt="仪表盘"><br><sub>仪表盘 — 实时遥测驾驶舱</sub></td>
    <td align="center" width="50%"><img src="docs/shot-forge-autofill.png" alt="Forge 自动填充"><br><sub>Forge — 一键自动填充服务器 IP</sub></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="docs/shot-doctor.png" alt="配置体检"><br><sub>配置体检 — 16 项检查，满分 100</sub></td>
    <td align="center" width="50%"><img src="docs/shot-sub-portal.png" alt="订阅页"><br><sub>品牌化订阅门户</sub></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="docs/shot-settings-core.png" alt="核心驱动设置"><br><sub>设置 → 核心 — 真实 Xray 驱动</sub></td>
    <td align="center" width="50%"><img src="docs/shot-users.png" alt="用户"><br><sub>用户 — 配额、到期与预测徽章</sub></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="docs/shot-fa-dashboard.png" alt="波斯语仪表盘"><br><sub>فارسی — 仪表盘（原生 RTL）</sub></td>
    <td align="center" width="50%"><img src="docs/shot-fa-inbounds.png" alt="波斯语入站"><br><sub>فارسی — 入站配置</sub></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="docs/shot-mobile-dashboard.png" alt="移动端仪表盘"><br><sub>移动端 — 仪表盘</sub></td>
    <td align="center" width="50%"><img src="docs/shot-mobile-forge.png" alt="移动端 Forge"><br><sub>移动端 — Forge</sub></td>
  </tr>
  <tr>
    <td align="center" width="50%"><img src="docs/gif-forge.gif" alt="Forge 自动填充演示"><br><sub>Forge 自动填充演示</sub></td>
    <td align="center" width="50%"><img src="docs/gif-mobile.gif" alt="移动端体验演示"><br><sub>移动端体验演示</sub></td>
  </tr>
</table>

</details>

## 快速开始

### 一键安装

```bash
bash <(curl -Ls https://raw.githubusercontent.com/Edsel-Rahimi/sephiroth/main/install.sh)
```

安装脚本会检测发行版与架构，安装系统依赖 **和 Node 22**，克隆仓库、构建应用，并创建带加固配置的 **systemd** 服务（在无 systemd 的环境中自动降级）。结束时它会打印面板地址和**随机生成的管理员密码**，并把两者写入 `/etc/sephiroth/install-result.env`（权限 `0600`）。

想固定安装某个版本，把标签作为参数传入（该标签必须存在于本仓库的 git tag 中，否则安装脚本会带着明确提示退出）：

```bash
bash <(curl -Ls https://raw.githubusercontent.com/Edsel-Rahimi/sephiroth/main/install.sh) v2.5.0
```

无人值守 / cloud-init — 零交互，密码照常写入结果文件：

```bash
SEPH_NONINTERACTIVE=1 bash <(curl -Ls https://raw.githubusercontent.com/Edsel-Rahimi/sephiroth/main/install.sh)
```

> [!IMPORTANT]
> 管理员密码只会在安装时**打印一次**，并保存到 `/etc/sephiroth/install-result.env`（权限 `0600`）。**首次登录后请立即修改**，并顺手打开面板内置的 TOTP 两步验证。

### Docker

```bash
docker run -d --name sephiroth -p 3000:3000 -v sephiroth_data:/app/db \
  -e SEPHIROTH_ADMIN_USER=admin -e SEPHIROTH_ADMIN_PASS=change-me \
  --restart unless-stopped ghcr.io/edsel-rahimi/sephiroth:latest
```

或使用 Compose（多阶段构建、命名卷、内置健康检查）：

```bash
git clone https://github.com/Edsel-Rahimi/sephiroth.git && cd Sephiroth
export SEPH_PORT=3000 SEPHIROTH_ADMIN_USER=admin SEPHIROTH_ADMIN_PASS='S3cure-Pass!'
docker compose up -d
```

- 宿主机端口默认为 `${SEPH_PORT:-3000}` — 面板在容器内始终监听 3000。
- JSON 存储与自动备份保存在 `sephiroth_data` 卷中。
- 内置健康检查轮询 `/api/auth/session`；预构建镜像随每次推送发布到 `ghcr.io/edsel-rahimi/sephiroth`。

### `sephiroth` 命令行

<details>
<summary><b>管理菜单</b> — <code>sephiroth</code> 命令（0–14 项）</summary>

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

快捷方式：`sephiroth start | stop | restart | status | logs | update | backup`

</details>

## 核心驱动

Sephiroth 自带两个可互换的核心后端。随时在 **设置 → 核心** 中切换：

| | **模拟器**（默认） | **真实 Xray 核心** |
|---|---|---|
| 运行什么 | 内置遥测模拟器 | 真实的 **Xray-core** 进程 |
| 配置 | 面板状态预览 | 由你的入站生成，并经 `run -test` 验证 |
| 统计 | 模拟图表 | 真实的按用户/按入站计数器（Xray stats API） |
| 韧性 | — | 被杀后自动重启（3/10/30 秒退避）+ 哈希对比热重载 |
| 适合场景 | 试用面板、演练 | 承载真实流量 |

切换到**真实 Xray 核心**时，面板会自动从 XTLS/Xray-core 发布页**下载 Xray-core 二进制**（解压链 unzip → 7z → python3 层层兜底）到 `db/bin/xray`。你可以固定核心版本、设置统计间隔（5–120 秒），并在设置页直接查看核心实时日志。万一真实核心启动失败，面板会自动回退到模拟器。

## 文档

- 📕 **[完整目录 — 波斯语 (PDF)](docs/sephiroth-catalog-fa.pdf)** — 覆盖每个界面、字段和设置的完整视觉指南。
- 🗒 版本更新日志（波斯语 PDF）：[v2.2](public/sephiroth-v2.2-changelog-fa.pdf) · [v2.3](public/sephiroth-v2.3-changelog-fa.pdf)
- 🧭 面板内置**指南** — 13 个章节，用大白话解释每个字段，零黑话。

## 路线图

**已交付**

- [x] 面板自更新（检查 → 应用 → 重启）
- [x] 带保留策略的定时服务器备份
- [x] TOTP 两步验证登录
- [x] MTProto Telegram 代理工具
- [x] 配置体检 — 16 项检查 + 得分
- [x] 流量耗尽预测徽章
- [x] 真实 Xray 核心驱动
- [x] 部署套件 — 一键安装脚本 · `sephiroth` 命令行 · Docker / GHCR

**下一步**

- [ ] Telegram 售卖机器人（调研已完成 — `docs/telegram-bot-research.md`）
- [ ] 多节点同步引擎
- [ ] ACME 证书管理
- [ ] IP 数量限制强制执行

## 参与贡献

欢迎提交 Issue 与 Pull Request — 缺陷报告、翻译修正和功能建议一视同仁。改动翻译时，请让术语与面板内置语言文件保持一致，让 README 和 UI 讲同一个故事。

## 支持 Sephiroth

如果 Sephiroth 让你的日子更轻松，一颗 ⭐ 就能让轨道继续运转。面板内置的**支持**对话框列出了钱包地址和支持链接。

## 许可证

[MIT](LICENSE) © Edsel-Rahimi

## 免责声明

本项目仅用于**教育目的与合法的个人使用**。遵守你所在司法辖区的法律是你的责任，作者对滥用行为不承担任何责任。

---

<p align="center"><sub><b>Sephiroth</b> · crafted by <a href="https://github.com/Edsel-Rahimi">Edsel-Rahimi</a></sub></p>
