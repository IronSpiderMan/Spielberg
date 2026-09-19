# Spielberg · AI 漫剧工作室

基于 Tauri 构建的 AI 漫剧创作桌面应用。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Arco Design |
| 后端 | Rust + Tauri 2 |
| 数据库 | SQLite (rusqlite) |
| 构建 | Vite + tauri-cli |

## 快速开始

### 环境要求

- Node.js >= 18
- Rust >= 1.70
- 系统依赖：参考 [Tauri 官方文档](https://v2.tauri.app/start/prerequisites/)

### 安装依赖

```bash
npm install
```

### 开发

```bash
# 仅前端
npm run dev

# 桌面应用（含 Rust 后端）
npm run desktop:dev
```

### 构建

```bash
# 前端构建
npm run build

# 桌面应用构建
npm run desktop:build

# macOS DMG
npm run desktop:dmg
```

## 项目结构

```
Spielberg/
├── src/                # 前端源码 (React + TypeScript)
├── src-tauri/          # Tauri 后端 (Rust)
│   ├── src/            # Rust 源码
│   ├── Cargo.toml      # Rust 依赖配置
│   └── tauri.conf.json # Tauri 应用配置
├── public/             # 静态资源
├── scripts/            # 构建脚本
├── index.html          # 入口 HTML
├── vite.config.ts      # Vite 配置
└── package.json        # Node 依赖配置
```

## License

Private
