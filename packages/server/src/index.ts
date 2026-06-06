import { Hono } from "hono";
import { serve, upgradeWebSocket } from "@hono/node-server";
import { WebSocketServer } from "ws";
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

// WebSocket endpoint
app.get(
  "/ws",
  upgradeWebSocket((c) => ({
    onOpen(event, ws) {
      console.log("[WS] Client connected:", ws.socketId);
    },

    onMessage(event, ws) {
      try {
        const message = JSON.parse(event.data as string);
        const socketId = ws.socketId ?? crypto.randomUUID();

        switch (message.type) {
          case "JOIN": {
            const { roomId, username } = message.payload;
            // Store room context on the socket
            (ws as any).__roomId = roomId;
            (ws as any).__username = username;

            const others = joinRoom(roomId, {
              socketId,
              username,
              ws: ws.raw,
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
            const roomId = (ws as any).__roomId;
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
            const roomId = (ws as any).__roomId;
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
            console.log("[WS] Unknown message type:", message.type);
        }
      } catch (err) {
        console.error("[WS] Failed to handle message:", err);
      }
    },

    onClose(event, ws) {
      const roomId = (ws as any).__roomId;
      const socketId = ws.socketId;
      if (roomId) {
        leaveRoom(roomId, socketId);
        broadcastToRoom(roomId, {
          type: "USER_LEFT",
          payload: { socketId },
        });
        console.log(`[WS] Client disconnected from room ${roomId}`);
      }
    },
  }))
);

// Start server
const port = Number(process.env.PORT) || 3001;

const wss = new WebSocketServer({ noServer: true });

console.log(`[Server] Starting on http://localhost:${port}`);

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`[Server] Running at http://localhost:${info.port}`);
  }
);
