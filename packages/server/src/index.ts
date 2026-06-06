import { Hono } from "hono";
import { createAdaptorServer } from "@hono/node-server";
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import { cors } from "hono/cors";
import boards from "./routes/boards.js";
import { joinRoom, leaveRoom, broadcastToRoom } from "./ws/room.js";

const app = new Hono();

// Middleware
app.use("/api/*", cors());

// REST API routes
app.route("/api/boards", boards);

// Health check
app.get("/api/health", (c) => c.json({ status: "ok", time: new Date().toISOString() }));

// Create HTTP server using @hono/node-server adaptor
const port = Number(process.env.PORT) || 3001;
const server = createAdaptorServer({ fetch: app.fetch });

// Create WebSocket server (noServer mode — we handle upgrade manually)
const wss = new WebSocketServer({ noServer: true });

// Handle WebSocket upgrade requests
server.on("upgrade", (req: IncomingMessage, socket, head) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (url.pathname === "/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

// Handle WebSocket connections
wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
  const socketId = crypto.randomUUID();
  console.log("[WS] Client connected:", socketId);

  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case "JOIN": {
          const { roomId, username } = message.payload;

          // Store room context on the socket
          (ws as any).__roomId = roomId;
          (ws as any).__username = username;

          const others = joinRoom(roomId, {
            socketId,
            username,
            ws,
          });

          // Notify the new user about existing users
          ws.send(
            JSON.stringify({
              type: "INIT",
              payload: {
                users: others.map((c) => ({ socketId: c.socketId, username: c.username })),
              },
            })
          );

          // Notify others about the new user
          broadcastToRoom(
            roomId,
            {
              type: "USER_JOINED",
              payload: { user: { socketId, username } },
            },
            socketId
          );

          console.log(`[WS] User ${username} joined room ${roomId}`);
          break;
        }

        case "ELEMENTS_UPDATE": {
          const roomId = (ws as any).__roomId as string | undefined;
          if (roomId) {
            broadcastToRoom(
              roomId,
              {
                type: "ELEMENTS_UPDATE",
                payload: message.payload,
              },
              socketId
            );
          }
          break;
        }

        case "POINTER_UPDATE": {
          const roomId = (ws as any).__roomId as string | undefined;
          if (roomId) {
            broadcastToRoom(
              roomId,
              {
                type: "POINTER_UPDATE",
                payload: {
                  pointer: message.payload.pointer,
                  socketId,
                },
              },
              socketId
            );
          }
          break;
        }

        default:
          // Echo back unrecognized messages as a basic connectivity test
          ws.send(JSON.stringify({ type: "ECHO", payload: message }));
          console.log("[WS] Echoed unknown message type:", message.type);
      }
    } catch (err) {
      // Echo raw data back for basic connectivity testing
      ws.send(data);
      console.log("[WS] Echoed raw message:", data.toString().substring(0, 100));
    }
  });

  ws.on("close", () => {
    const roomId = (ws as any).__roomId as string | undefined;
    if (roomId) {
      leaveRoom(roomId, socketId);
      broadcastToRoom(roomId, {
        type: "USER_LEFT",
        payload: { socketId },
      });
      console.log(`[WS] Client disconnected from room ${roomId}`);
    }
  });
});

// Start server
server.listen(port, () => {
  console.log(`[Server] Running at http://localhost:${port}`);
});
