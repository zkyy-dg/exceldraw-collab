// WebSocket room management
//
// Each room (identified by boardId) maintains a set of connected clients.
// Messages are broadcast to all clients in the same room except the sender.

type ClientInfo = {
  socketId: string;
  username: string;
  ws: import("ws").WebSocket;
};

const rooms = new Map<string, Map<string, ClientInfo>>();

export function joinRoom(roomId: string, client: ClientInfo): ClientInfo[] {
  let room = rooms.get(roomId);
  if (!room) {
    room = new Map();
    rooms.set(roomId, room);
  }
  room.set(client.socketId, client);
  return Array.from(room.values()).filter((c) => c.socketId !== client.socketId);
}

export function leaveRoom(roomId: string, socketId: string): void {
  const room = rooms.get(roomId);
  if (room) {
    room.delete(socketId);
    if (room.size === 0) {
      rooms.delete(roomId);
    }
  }
}

export function getRoomClients(roomId: string): ClientInfo[] {
  const room = rooms.get(roomId);
  if (!room) return [];
  return Array.from(room.values());
}

export function broadcastToRoom(
  roomId: string,
  message: object,
  excludeSocketId?: string
): void {
  const clients = getRoomClients(roomId);
  const data = JSON.stringify(message);

  for (const client of clients) {
    if (client.socketId !== excludeSocketId) {
      if (client.ws.readyState === 1) {
        // WebSocket.OPEN
        client.ws.send(data);
      }
    }
  }
}

export function getRoomSize(roomId: string): number {
  return rooms.get(roomId)?.size ?? 0;
}
