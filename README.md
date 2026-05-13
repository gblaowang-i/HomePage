# 家用导航中心

家庭导航页 + 简易后台，单容器 Node 服务，数据存放在挂载的 `data.json`。

---

## 一、服务器环境要求

- **Linux**（示例以常见发行版为准）
- **Git**：用于拉取代码
- **Docker** 与 **Docker Compose**（插件版 `docker compose` 或独立 `docker-compose`）

若尚未安装 Docker，请先按官方文档安装，并确认当前用户能执行 `docker`（或全程使用 `root`）。

检查命令示例：

```bash
git --version
docker --version
docker compose version
```

---

## 二、从 Git 拉取到服务器并首次运行

### 1. 选择安装目录并克隆仓库

在服务器上执行（目录可按习惯修改，例如 `/opt`）：

```bash
cd /opt
sudo git clone https://github.com/gblaowang-i/HomePage.git
cd HomePage
```

若仓库地址不同，把上面的 URL 换成你自己的远程地址。

### 2. 配置密码与环境变量

编辑项目根目录下的 `compose.yml`，至少修改 **`ADMIN_PASSWORD`**（后台管理密码）。

```bash
nano compose.yml
```

建议修改项说明：

| 配置项 | 说明 |
|--------|------|
| `ADMIN_PASSWORD` | **必填改强密码**。用于 `/admin` 后台登录与 `/api/admin/*` 接口。 |
| `SITE_PASSWORD` | **可选**。取消注释并填写后，访问主页与 `/api/settings`、`/api/links` 需先在 `/gate.html` 输入站点密码；与后台密码独立。 |
| `COOKIE_SECURE` | **可选**。设为 `1` 时 Cookie 带 `Secure`，**仅当你用 HTTPS 访问站点时**再开，否则浏览器可能不发送 Cookie。 |
| `TRUST_PROXY` | **可选**。设为 `1` 时从 `X-Forwarded-For` 取客户端 IP 做登录限速；**仅在前面有可信反向代理且正确写头时**开启。 |

保存后退出编辑器。

### 3. 确认数据文件

仓库里带有示例 `data.json`。首次部署可直接使用；之后链接与站点标题都会写进该文件。

`compose.yml` 中已挂载：

```yaml
volumes:
  - ./data.json:/app/data.json
```

即容器内读写的就是当前目录下的 **`./data.json`**，升级镜像不会丢数据（只要不要误删宿主机上的该文件）。

### 4. 构建并启动容器

仍在项目根目录（与 `compose.yml` 同级）执行：

```bash
docker compose up -d --build
```

- **`-d`**：后台运行  
- **`--build`**：根据当前目录的 `Dockerfile` 重新构建镜像（代码更新后建议带上）

首次成功后可查看状态与日志：

```bash
docker compose ps
docker compose logs -f
```

按 `Ctrl+C` 退出日志跟踪，容器会继续运行。

### 5. 本机验证

在服务器上若开放了 `3000` 端口，可浏览器访问：

- **前台**：`http://服务器IP:3000/`  
  - 若已配置 `SITE_PASSWORD`，会先进入访问验证页，再进入主页。  
- **后台**：`http://服务器IP:3000/admin/login.html`  

若只在本机测试：

```bash
curl -sI http://127.0.0.1:3000/ | head -n 5
```

---

## 三、公网与 HTTPS（强烈建议）

- 不要长期把管理后台和站点密码暴露在 **纯 HTTP** 下；建议在前面加 **Nginx / Caddy** 等做 **HTTPS 终止**，再反代到本服务的 `3000`。
- 使用 HTTPS 且经反代访问时，可在 `compose.yml` 中取消注释并设置 **`COOKIE_SECURE: "1"`**，使会话 Cookie 仅通过 HTTPS 发送。
- 反代需把真实客户端 IP 写入 **`X-Forwarded-For`** 时，可开启 **`TRUST_PROXY: "1"`**，以便登录失败限速按真实 IP 统计（反代必须可信、配置正确）。

---

## 四、日常更新代码（拉取最新再重建）

在服务器项目目录下：

```bash
cd /opt/HomePage
git pull
docker compose up -d --build
```

### `git pull` 提示 `compose.yml` 有本地修改无法合并

说明你在服务器上改过 `compose.yml`（例如密码），与仓库版本冲突。任选一种方式处理：

**方式 A（简单）**：放弃本地对该文件的修改，用仓库版本覆盖后再改密码：

```bash
cd /opt/HomePage
# 建议先记下当前密码
git checkout -- compose.yml
git pull
nano compose.yml   # 重新填写密码
docker compose up -d --build
```

**方式 B**：先备份再拉取，再手工合并：

```bash
cp compose.yml compose.yml.bak
git stash push -m "compose" -- compose.yml
git pull
# 对照 compose.yml 与 compose.yml.bak，把需要的密码等抄回 compose.yml
docker compose up -d --build
```

---

## 五、常用运维命令

```bash
cd /opt/HomePage   # 换成你的实际路径

# 查看容器状态
docker compose ps

# 查看实时日志
docker compose logs -f

# 停止并删除容器（不删镜像与本地 data.json）
docker compose down

# 修改 compose 或代码后重新构建并启动
docker compose up -d --build
```

---

## 六、本地开发（不通过 Docker）

需本机安装 **Node.js**（建议 LTS）：

```bash
cd HomePage
npm install   # 当前无第三方依赖时也会很快结束
npm start
```

浏览器访问 `http://localhost:3000/`。默认后台密码见 `server.js` 中 `ADMIN_PASSWORD` 环境变量说明；本地未设置 `SITE_PASSWORD` 时不会启用站点门禁。

---

## 七、安全与行为摘要（可选阅读）

- 会话：**后台**使用 Cookie `admin_token`；**站点门禁**使用 `site_token`（均为 HttpOnly，与用途分离）。
- 服务端对 JSON 请求体有大小限制；静态文件路径防目录穿越；登录接口带失败次数限速；密码校验经哈希后做常量时间比较；响应带常见安全头（如 `nosniff`、禁止被嵌套框架等）。
- 更多环境变量说明见上文 **`compose.yml` 配置** 表格及第二节表格。

---

## 八、端口说明

默认映射 **`3000:3000`**。若本机 `3000` 已被占用，可编辑 `compose.yml` 左侧端口，例如改为 `8080:3000`，则对外访问 `http://服务器IP:8080/`。

如有问题，可先 `docker compose logs` 查看容器内 Node 进程输出。
