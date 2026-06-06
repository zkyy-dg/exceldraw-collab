# Excalidraw 协作白板 MVP — 架构设计

## Monorepo 结构

```
exceldraw-collab/
├── pnpm-workspace.yaml
├── package.json                  # 根 package.json，workspace 脚本
├── tsconfig.base.json             # 共享 TS 配置
├── .gitignore
├── .npmrc                         # shamefully-hoist=true (Excalidraw 兼容性需要)
│
├── packages/
│   ├── client/                    # 前端 React + Vite + Excalidraw
│   │   ├── package.json           # @exceldraw-collab/client
│   │   ├── tsconfig.json          # extends ../../tsconfig.base.json
│   │   ├── vite.config.ts         # Vite 配置，proxy /api → backend
│   │   ├── index.html
│   │   ├── public/
│   │   │   └── fonts/             # Excalidraw 自托管字体
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── App.tsx
│   │       ├── components/
│   │       │   └── Whiteboard.tsx  # Excalidraw 组件封装
│   │       ├── collab/
│   │       │   └── socket.ts      # WebSocket 客户端，连接后端
│   │       └── index.css
│   │
│   └── server/                    # 后端 Hono + WebSocket + SQLite
│       ├── package.json           # @exceldraw-collab/server
│       ├── tsconfig.json          # extends ../../tsconfig.base.json
│       └── src/
│           ├── index.ts           # 入口：Hono app + HTTP + WebSocket 服务
│           ├── routes/
│           │   └── boards.ts      # REST: 画板 CRUD (创建/列表/获取)
│           ├── ws/
│           │   └── room.ts        # WebSocket 房间管理 & 广播
│           ├── db/
│           │   ├── index.ts       # better-sqlite3 初始化
│           │   └── schema.ts     # 建表 DDL
│           └── types.ts
│
└── packages/                      # 预留共享包（暂不创建）
```

## 技术方案

### 前端 (packages/client)

| 项 | 选型 |
|---|---|
| 框架 | React 19 + TypeScript |
| 构建 | Vite 6 |
| 画板 | @excalidraw/excalidraw@0.18.x |
| 样式 | TailwindCSS 4 |
| 开发端口 | 5173 |

**关键点：**
- Excalidraw 只能在客户端渲染（不支持 SSR，但 Vite SPA 无此问题）
- Vite dev server 通过 proxy 把 `/api/*` 和 `/ws` 代理到后端 `localhost:3001`
- Excalidraw 字体需要从 `node_modules` 复制到 `public/fonts/`，并设置 `window.EXCALIDRAW_ASSET_PATH`
- Excalidraw 的 `onChange` 回调获取 elements 变化，通过 WebSocket 发送到房间
- 光标位置通过 `onPointerUpdate` 回调获取，用 volatile 消息广播（不持久化）

### 后端 (packages/server)

| 项 | 选型 |
|---|---|
| 框架 | Hono |
| 运行时 | @hono/node-server |
| WebSocket | @hono/node-server 内置 upgradeWebSocket + ws |
| 数据库 | better-sqlite3 |
| 开发端口 | 3001 |
| 运行方式 | tsx (直接运行 TS) |

**关键点：**
- `@hono/node-server` 内置 WebSocket 支持（`@hono/node-ws` 已废弃）
- WebSocket 使用 `{ noServer: true }` 模式，与 Hono HTTP 共享端口
- 房间管理：内存 Map<roomId, Set<WebSocket>>，每个房间维护连接的客户端集合
- 消息协议：
  ```typescript
  // Client → Server
  type ClientMessage =
    | { type: "JOIN"; payload: { roomId: string; username: string } }
    | { type: "ELEMENTS_UPDATE"; payload: { elements: ExcalidrawElement[] } }
    | { type: "POINTER_UPDATE"; payload: { pointer: PointerUpdate; socketId: string } }

  // Server → Client
  type ServerMessage =
    | { type: "INIT"; payload: { elements: ExcalidrawElement[]; users: CollabUser[] } }
    | { type: "ELEMENTS_UPDATE"; payload: { elements: ExcalidrawElement[] } }
    | { type: "POINTER_UPDATE"; payload: { pointer: PointerUpdate; socketId: string } }
    | { type: "USER_JOINED"; payload: { user: CollabUser } }
    | { type: "USER_LEFT"; payload: { socketId: string } }
  ```

### 数据库 Schema (SQLite)

```sql
-- 画板表
CREATE TABLE boards (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name TEXT NOT NULL DEFAULT 'Untitled Board',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 画板元素快照（JSON 存储）
CREATE TABLE board_elements (
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  elements_json TEXT NOT NULL,  -- Excalidraw elements 数组的 JSON
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (board_id)
);
```

### 依赖清单

**Root:**
```json
{
  "devDependencies": {
    "typescript": "^5.7",
    "tsx": "^4.19"
  }
}
```

**Client (packages/client):**
```json
{
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@excalidraw/excalidraw": "^0.18.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3",
    "vite": "^6.0",
    "tailwindcss": "^4.0",
    "@tailwindcss/vite": "^4.0",
    "typescript": "^5.7",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0"
  }
}
```

**Server (packages/server):**
```json
{
  "dependencies": {
    "hono": "^4.7",
    "@hono/node-server": "^1.13",
    "ws": "^8.18",
    "better-sqlite3": "^11.7"
  },
  "devDependencies": {
    "typescript": "^5.7",
    "@types/ws": "^8.5",
    "@types/better-sqlite3": "^7.6",
    "tsx": "^4.19"
  }
}
```

## 开发脚本 (Root package.json)

```json
{
  "scripts": {
    "dev": "pnpm --parallel --filter ./packages/* dev",
    "dev:client": "pnpm --filter @exceldraw-collab/client dev",
    "dev:server": "pnpm --filter @exceldraw-collab/server dev",
    "build": "pnpm --filter ./packages/* build",
    "build:client": "pnpm --filter @exceldraw-collab/client build",
    "build:server": "pnpm --filter @exceldraw-collab/server build",
    "install:fonts": "cp -r node_modules/@excalidraw/excalidraw/dist/prod/fonts packages/client/public/fonts"
  }
}
```

## 协作架构

```
┌─────────┐     ┌─────────┐
│ Client A │     │ Client B │
│ Excalidraw│     │ Excalidraw│
└────┬────┘     └────┬────┘
     │ HTTP REST (画板 CRUD) │
     │ WebSocket (实时同步)   │
     ▼                       ▼
┌─────────────────────────────┐
│       Hono Server (:3001)   │
│  ┌──────────┐  ┌──────────┐│
│  │ REST API  │  │  WS Room  ││
│  │ /api/...  │  │ Manager   ││
│  └─────┬────┘  └─────┬────┘│
│        │              │     │
│  ┌─────▼──────────────▼────┐│
│  │     better-sqlite3      ││
│  │  boards + board_elements ││
│  └─────────────────────────┘│
└─────────────────────────────┘
```

## 开发顺序

1. **Phase 1（脚手架）— 当前：**
   - Clone repo、初始化 git
   - 创建 monorepo 结构和所有配置文件
   - `pnpm install` 安装依赖
   - 前端：空白 Excalidraw 板在浏览器中可渲染
   - 后端：Hono hello world HTTP + WebSocket echo 可连接

2. **Phase 2（核心协作）：**
   - 后端：画板 CRUD API + SQLite schema
   - 后端：WebSocket 房间管理（JOIN/LEAVE/BROADCAST）
   - 前端：WebSocket 客户端连接 + 元素同步
   - 前端：光标同步

3. **Phase 3（产品化）：**
   - 画板列表页、创建/加入流程
   - UI 美化（TailwindCSS 布局）
   - 元素持久化（定时保存到 SQLite）
