# SailCode-Bridge

SailCode-Bridge 是一个轻量的本地只读服务，用于让 SailCode-web 读取**用户本机**的环境信息与项目文件（在用户授权范围内）。

## 功能

- 环境探测（OS / Node / npm / git / pnpm）
- 项目结构扫描（目录树）
- 文件读取（只读，白名单目录 + 黑名单扩展名）
- 本地 UI 管理（token 与授权目录）
- Web UI 连接（用于 SailCode-web）

## 快速开始（Windows 优先）

```bash
# 进入目录
cd SailCode-Bridge

# 安装依赖
npm install

# 启动（默认端口 3737）
npm start
```

启动后打开：
- Bridge UI: http://localhost:3737

## 安全模型

- **只读**：不执行命令、不写文件
- **Token**：所有数据接口必须带 `X-Bridge-Token`
- **目录白名单**：仅允许读取用户授权的目录
- **扩展名黑名单**：默认拒绝 `.env/.key/.pem/.exe` 等敏感文件

## 与 SailCode-web 联动

在 SailCode-web 侧配置：
- `Bridge Base URL`: `http://localhost:3737`
- `Bridge Token`: 从 Bridge UI 复制
- 添加允许目录并设置为 Active Root

完成后，Web 侧将优先读取本地 Bridge 的 `envInfo` 与 `projectContext`。

## 配置文件

配置文件保存在：
- Windows: `%USERPROFILE%\.sailcode\bridge.config.json`
- macOS/Linux: `~/.sailcode/bridge.config.json`

可配置项（示例）：
```json
{
  "token": "...",
  "allowedPaths": ["C:/Projects/SailCode"],
  "activeProjectRoot": "C:/Projects/SailCode",
  "port": 3737
}
```

## API（简要）

- `GET /health`
- `GET /capabilities`
- `GET /env` (需 token)
- `GET /project/scan?path=...` (需 token)
- `POST /fs/read` (需 token)
- `POST /config/allowed-paths` (需 token)

