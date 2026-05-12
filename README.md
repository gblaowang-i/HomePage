# 家用导航中心（Docker 部署）

## 快速部署（推荐）

1. 修改 `compose.yml` 中的后台密码：

```yml
ADMIN_PASSWORD: "你的密码"
```

2. 启动服务：

```bash
docker compose up -d --build
```

3. 访问：
- 前台：`http://localhost:3000/`
- 后台：`http://localhost:3000/admin/login.html`

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

