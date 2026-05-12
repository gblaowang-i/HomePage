# 家用导航中心（Docker 部署）

## 运行方式一：Docker Compose（推荐）

1. 修改 `compose.yml` 里的 `ADMIN_PASSWORD`
2. 在项目目录执行：

```bash
docker compose up -d --build
```

打开：
- 前台：`http://localhost:3000/`
- 后台：`http://localhost:3000/admin/login.html`

数据已通过 **named volume** 持久化（容器重建不丢数据）。

## 运行方式二：Docker

构建镜像：

```bash
docker build -t home-nav:latest .
```

运行容器（并持久化数据）：

```bash
docker run -d --name home-nav ^
  -p 3000:3000 ^
  -e ADMIN_PASSWORD=123456 ^
  -e DATA_FILE=/data/data.json ^
  -v home_nav_data:/data ^
  home-nav:latest
```

## 配置

- **后台密码**：环境变量 `ADMIN_PASSWORD`（默认 `123456`）
- **端口**：环境变量 `PORT`（默认 `3000`）
- **数据文件路径**：环境变量 `DATA_FILE`（默认 `./data.json`）

