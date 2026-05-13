# 家用导航中心

家庭导航页 + 简易后台，单容器 Node 服务，数据存放在挂载的 `data.json`。

---

## 一、从 Git 拉取到服务器并首次运行

服务器需已安装 **Git**、**Docker**，且可使用 **`docker compose`** 命令。

### 1. 选择安装目录并克隆仓库

目录可按习惯修改（示例用 `/opt`）：

```bash
cd /opt
sudo git clone https://github.com/gblaowang-i/HomePage.git
cd HomePage
```

### 2. 配置密码与环境变量

编辑项目根目录下的 `compose.yml`，至少修改 **`ADMIN_PASSWORD`**。

```bash
nano compose.yml
```

| 配置项 | 说明 |
|--------|------|
| `ADMIN_PASSWORD` | **必填改强密码**。用于 `/admin` 后台与 `/api/admin/*`。 |
| `SITE_PASSWORD` | **可选**。取消注释并填写后，主页与 `/api/settings`、`/api/links` 需经 `/gate.html` 验证；与后台密码独立。 |
| `COOKIE_SECURE` | **可选**。设为 `1` 时 Cookie 带 `Secure`。**仅全程 HTTPS 访问时**再开。 |
| `TRUST_PROXY` | **可选**。设为 `1` 时用 `X-Forwarded-For` 做登录限速的客户端 IP。**仅反代可信且正确写头时**开。 |

### 3. 数据文件

`compose.yml` 已挂载 `./data.json`，链接与站点标题写入该文件；升级容器不丢数据（勿误删宿主机上的 `data.json`）。

### 4. 构建并启动容器

在项目根目录（与 `compose.yml` 同级）执行：

```bash
docker compose up -d --build
```

查看状态与日志：

```bash
docker compose ps
docker compose logs -f
```

### 5. 访问验证

- **前台**：`http://服务器IP:3000/`（若配置了 `SITE_PASSWORD`，会先进入验证页）  
- **后台**：`http://服务器IP:3000/admin/login.html`  

---

## 二、更新代码

```bash
cd /opt/HomePage
git pull
docker compose up -d --build
```

若 `git pull` 提示 **`compose.yml` 本地修改会被覆盖**：先记下密码，执行 `git checkout -- compose.yml`，再 `git pull`，然后重新编辑 `compose.yml` 填回密码并 `docker compose up -d --build`。

---

## 三、常用运维命令

```bash
cd /opt/HomePage

docker compose ps
docker compose logs -f
docker compose down
docker compose up -d --build
```

`docker compose down` 会停掉并删除容器，**不会**删除镜像与当前目录下的 `data.json`。

