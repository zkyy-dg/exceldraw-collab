# Excalidraw Collab

多人实时协作白板 MVP — 基于 Excalidraw 的在线协作绘图工具。

## 功能特性

- **实时协作绘图** — 多用户同时编辑同一画板，元素变更通过 WebSocket 实时同步
- **远端光标** — 显示其他用户的鼠标位置和名称，使用 Excalidraw 内置协作光标
- **画板管理** — 创建、查看、加入画板，支持无限画板
- **自动保存** — 绘图内容每 2 秒自动保存到 SQLite，刷新不丢失
- **手动保存** — 支持 Ctrl+S 快捷键手动保存
- **断线重连** — WebSocket 断开后 3 秒自动重连
- **元素合并** — 使用 Excalidraw 的 reconcileElements 策略，按元素 ID 合并，最新版本优先

## 技术栈

| 层级 | 技术 |
|------|------|
| **前端** | React 19 + Vite 6 + Excalidraw 0.18 + TailwindCSS 4 + react-router-dom |
| **后端** | Hono + @hono/node-server + ws (WebSocket) + better-sqlite3 |
| **构建** | pnpm workspace monorepo, TypeScript |
| **测试** | Vitest + @testing-library/react (单元/集成), Node.js WebSocket client (E2E) |

## 快速开始

```bash
# 安装依赖
pnpm install

# 启动开发服务（前后端并行）
pnpm dev

# 访问地址
# 前端: http://localhost:5173
# 后端: http://localhost:3001
```

## 运行测试

```bash
# 全部单元/集成测试（108 tests）
pnpm test

# E2E 烟雾测试（需要先启动后端）
pnpm dev:server    # 另一个终端
npx tsx test-e2e.ts

# E2E 扩展测试（26 tests）
npx tsx test-e2e-extended.ts
```

## 项目结构

```
exceldraw-collab/
├── packages/
│   ├── server/                  # 后端
│   │   ├── src/
│   │   │   ├── index.ts         # 入口：Hono HTTP + WebSocket 服务
│   │   │   ├── routes/
│   │   │   │   └── boards.ts    # REST API：画板 CRUD + 元素读写
│   │   │   ├── ws/
│   │   │   │   └── room.ts      # WebSocket 房间管理
│   │   │   └── db/
│   │   │       └── index.ts     # SQLite 数据库初始化
│   │   └── __tests__/
│   │       ├── boards-api.test.ts   # API 单元测试 (19)
│   │       └── room.test.ts         # 房间管理测试 (17)
│   │
│   └── client/                  # 前端
│       ├── src/
│       │   ├── App.tsx           # 路由入口
│       │   ├── components/
│       │   │   ├── BoardList.tsx   # 画板列表页
│       │   │   └── Whiteboard.tsx  # 白板协作页
│       │   └── collab/
│       │       └── socket.ts     # WebSocket 客户端 (CollabSocket)
│       └── __tests__/
│           ├── BoardList.test.tsx     # (12)
│           ├── Whiteboard.test.tsx    # (11)
│           └── collab-socket.test.ts   # (11)
│
├── test-e2e.ts               # E2E 基础测试 (12)
├── test-e2e-extended.ts      # E2E 扩展测试 (26)
├── prd.json                  # 产品需求文档
├── progress.txt              # 开发日志
└── package.json              # Monorepo 根配置
```

## 架构设计

### WebSocket 协作协议

客户端和服务器通过 JSON 消息通信：

| 消息类型 | 方向 | 说明 |
|----------|------|------|
| `JOIN` | Client → Server | 加入房间，携带 roomId 和 username |
| `INIT` | Server → Client | 加入成功，返回房间内已有用户列表 |
| `ELEMENTS_UPDATE` | 双向 | 元素变更广播（绘图、删除等） |
| `POINTER_UPDATE` | Client → Server → 其他 Client | 鼠标位置广播，渲染远端光标 |
| `USER_JOINED` | Server → 其他 Client | 新用户加入通知 |
| `USER_LEFT` | Server → 其他 Client | 用户离开通知 |

### 数据流

```
用户A绘图 → Excalidraw onChange → CollabSocket.sendElementsUpdate()
                                        ↓
                              WebSocket → 服务器
                                        ↓
                         broadcastToRoom() → 所有其他客户端
                                        ↓
                              收到 ELEMENTS_UPDATE → reconcileElements() → updateScene()
```

### 持久化

- 用户绘图元素通过 REST API 保存到 SQLite（`board_elements` 表）
- 前端使用 2 秒 debounce 避免频繁写入
- 加入房间时从服务器加载已保存的元素

## License

Private
