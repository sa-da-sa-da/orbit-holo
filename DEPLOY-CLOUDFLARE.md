# 部署指南 · 局域网 / Cloudflare Workers + R2 + Cron（在线自动刷新）

> 目标架构：**Cloudflare Worker（静态资源 + /api）+ R2（目录数据）+ Cron（每 6 小时）+ GitHub Actions（真正干重活）**
> 为什么重活放 GitHub Actions：Worker 免费版单次 CPU 只有 10ms（付费 30s），解析 3.5 万条 TLE + 分类远超；放 Actions 又稳又免费。

---

## 0. 你在 Cloudflare 控制台那个页面怎么填

你截图是「连接到 Git → 设置您的应用程序（Worker 项目）」：

| 字段 | 填什么 |
| --- | --- |
| 项目名称 | `orbit-holo` |
| 构建命令（可选） | **留空** |
| 部署命令 | `npx wrangler deploy` |
| 预览命令 | **留空**（或默认 `npx wrangler versions upload`） |

点「部署」即可。仓库根目录的 `wrangler.toml` 已配好 `main`、`[assets]`、R2 绑定与 cron，wrangler 会自动读取，不需要额外参数。

> 前提：仓库里必须已经有 `wrangler.toml`、`worker/index.js` 和 `public/`（本仓库已就绪）。

---

## 1. 建 R2 桶

控制台 → R2 → Create bucket → 名称 **`orbit-holo-catalog`**（与 wrangler.toml 一致）。

## 2. 设置密钥（不要写进代码）

```bash
npx wrangler secret put ADMIN_TOKEN        # /api/refresh 的管理令牌（自己生成一串随机）
npx wrangler secret put GITHUB_TOKEN       # GitHub PAT（fine-grained，权限：Actions: write）
```

`GITHUB_REPO` 已写在 wrangler.toml 的 `[vars]` 里（`sa-da-sa-da/orbit-holo`），改成你的仓库即可。

## 3. 配置 GitHub Actions（数据刷新）

在 GitHub 仓库 → Settings → Secrets and variables → Actions 添加：

| Secret | 用途 |
| --- | --- |
| `SPACETRACK_USER` / `SPACETRACK_PASS` | Space-Track 账号 |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token（权限：Workers R2 Storage: Edit） |
| `CLOUDFLARE_ACCOUNT_ID` | 你的 Account ID |

然后跑一次 **Actions → refresh-data → Run workflow**。它会：
1. 用 Space-Track 抓 TLE + SATCAT 构建全量目录；
2. 导出 `public/data/catalog.json.gz`；
3. 上传到 R2 的 `catalog.json.gz` 与 `meta.json`。

之后 **每 6 小时自动跑**（workflow 里的 cron），Worker 的 cron 也会去唤起它（双保险）。

## 4. 数据读取链路

```
浏览器 → GET /api/catalog
        → Worker：R2 有对象？→ 返回（gzip 直出，Cache-Control 10 分钟，ETag 304）
                   R2 没对象？→ 回退随包发布的 /data/catalog.json.gz（首屏不至于空）
        → 前端解析 → 渲染 3.5 万目标
```

- 首次部署即使 R2 为空也能用（用仓库里的快照）。
- 数据更新**不需要重新部署**：Actions 写完 R2，10 分钟内 CDN 缓存过期即生效。
- 想立刻刷新：`curl -X POST https://<你的域名>/api/refresh -H "x-admin-token: <ADMIN_TOKEN>"`

## 5. 前端兼容（已内置）

- 有 `/api/catalog` → 走 API（Worker 环境）；
- 没有（纯静态 Pages / file://）→ 自动回退到 `/data/catalog.json.gz`，用 `DecompressionStream` 解压（实测 3.5 万目标 208ms）；
- 静态模式下「刷新星历」按钮自动禁用并提示。

## 6. 自定义域名 / 访问控制

- 域名：Workers 项目 → Settings → Domains & Routes → Add custom domain。
- 只给指定人看：Zero Trust → Access → 给该域名加策略（邮箱验证码 / Google 登录）。

## 7. 验证清单

```bash
curl -s https://<域名>/api/health | jq        # count / updated / sourceDetail
curl -sI https://<域名>/api/catalog | head    # Content-Encoding: gzip、Cache-Control、ETag
curl -s https://<域名>/api/catalog | gunzip | jq '.satellites | length'   # 35465
```

---

## 8. 合规提醒（重要）

- **Space-Track 数据通常限非商业用途**，公开发布前请确认符合其条款；不想受限就换 CelesTrak（18,600 条）。
- 望远镜图像为 NASA 公共领域，**逐图署名必须保留**（站点已标注并链回原页）。
- 站点已内置隐私提示 + `/privacy.html`（含 **GDPR 章节**：控制者、法律依据、权利、跨境、投诉渠道）；若你以公司名义运营，请在页面补上**运营者名称与联系邮箱**。
- 不要把 Space-Track 凭据放进前端或公开仓库；本方案中它只存在于 GitHub Secrets 与 Actions 运行时的临时文件里。

## 9. 成本

| 资源 | 免费额度 | 本项目占用 |
| --- | --- | --- |
| Workers 请求 | 10 万次/天 | 每次访问 1~2 次 |
| Workers 静态资源 | 20,000 文件 / 25MiB 单文件 | 约 120 个文件，单文件最大 3.5MB |
| R2 存储 | 10 GB | 约 3.5 MB |
| R2 读操作 | 100 万次/月 | 与访问量同阶 |
| GitHub Actions | 公开仓库免费 | 每 6 小时一次，每次约 3 分钟 |
