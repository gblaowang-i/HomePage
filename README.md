# 家用导航中心（Docker 部署）

## 快速部署（推荐）

1. 修改 `compose.yml` 中的密码：

```yml
ADMIN_PASSWORD: "你的密码"
# 公网部署时建议取消注释并设置（与上面独立；留空则任何人可打开主页）
SITE_PASSWORD: "站点访问密码"
```

- **`ADMIN_PASSWORD`**：仅用于 `/admin` 后台管理接口与页面。
- **`SITE_PASSWORD`**：启用后，访问主页与公开接口 `/api/settings`、`/api/links` 需先在 `/gate.html` 通过验证；Cookie 为 `site_token`（HttpOnly），与后台 `admin_token` 互不干扰。

2. 启动服务：

```bash
docker compose up -d --build
```

3. 访问：
- 前台：`http://localhost:3000/`（若已设置 `SITE_PASSWORD`，未登录会跳转到验证页）
- 后台：`http://localhost:3000/admin/login.html`

公网建议放在 **HTTPS** 反向代理之后，避免密码与 Cookie 明文传输。

## 安全相关（可选环境变量）

| 变量 | 作用 |
|------|------|
| `COOKIE_SECURE` | 设为 `1` 或 `true` 时，会话 Cookie 带 `Secure`，仅 HTTPS 传输。**仅在你已用 HTTPS 访问站点时开启**，否则浏览器不会带上 Cookie。 |
| `TRUST_PROXY` | 设为 `1` 或 `true` 时，从 `X-Forwarded-For` 取客户端 IP，用于**登录失败限速**；仅在反向代理已正确写入该头时使用，避免被伪造。 |
| `MAX_JSON_BODY_BYTES` | JSON 请求体最大字节数，默认 `262144`（256KB），上限约 2MB。 |

服务端还会：限制 JSON 体积、静态文件路径防穿越、登录接口按 IP 限速（约 15 分钟内连续错误密码超过阈值会短暂拒绝）、密码校验使用哈希后常量时间比较、常见安全响应头（`nosniff`、`DENY` 框架嵌入等）。

## 常用命令

```bash
# 查看运行状态
docker compose ps

# 查看日志
docker compose logs -f

# 停止服务
docker compose down
```

## 说明

- 当前使用 `./data.json:/app/data.json` 挂载，数据可持久化。
- 未设置 `SITE_PASSWORD` 时，直接打开 `/gate.html` 会重定向回首页。
- 若服务器上改过 `compose.yml` 导致 `git pull` 冲突，可先备份密码、`git checkout -- compose.yml` 再 `git pull`，然后重新改密码。
