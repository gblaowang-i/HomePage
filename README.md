# 家用导航中心（Docker 部署）

## 快速部署（推荐）

1. 在项目根目录创建 **`.env`**（已加入 `.gitignore`，不会被 `git pull` 覆盖）：

```bash
cp .env.example .env
# 编辑 .env，填写 ADMIN_PASSWORD；公网建议再设置 SITE_PASSWORD
```

- **`ADMIN_PASSWORD`**：仅用于 `/admin` 后台管理接口与页面。
- **`SITE_PASSWORD`**：启用后，访问主页与公开接口 `/api/settings`、`/api/links` 需先在 `/gate.html` 通过验证；Cookie 为 `site_token`（HttpOnly），与后台 `admin_token` 互不干扰。不填或留空表示不启用站点门禁。

`compose.yml` 只引用变量，**不要在服务器上改 `compose.yml` 存密码**，避免与仓库冲突。

2. 启动服务：

```bash
docker compose up -d --build
```

3. 访问：
- 前台：`http://localhost:3000/`（若已设置 `SITE_PASSWORD`，未登录会跳转到验证页）
- 后台：`http://localhost:3000/admin/login.html`

公网建议放在 **HTTPS** 反向代理之后，避免密码与 Cookie 明文传输。

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

## 服务器上 `git pull` 报 compose.yml 冲突时

说明远程已更新，但你本地改过 `compose.yml`。按下面做一次即可：

```bash
cd /opt/HomePage
git checkout -- compose.yml
git pull
cp .env.example .env   # 若还没有 .env
nano .env             # 填好密码后保存
docker compose up -d --build
```

若你希望保留旧版 `compose.yml` 里的改动，可先 `git stash push -- compose.yml` 再 `git pull`，再手动对照合并到新的 `compose.yml` / `.env`。

