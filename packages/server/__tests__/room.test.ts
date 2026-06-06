/**
 * Unit tests for WebSocket room management (ws/room.ts)
 *
 * Covers:
 * - joinRoom: joining empty/non-empty rooms, duplicate socket IDs
 * - leaveRoom: leaving updates user list, empty room cleanup
 * - broadcastToRoom: message routing to correct room, exclude sender
 * - getRoomClients: listing clients in a room
 * - getRoomSize: room size tracking
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// We need to mock or work around the module-scoped `rooms` Map
// Since room.ts uses a module-level Map, we import the functions directly
// and use unique roomId/socketId values to avoid cross-test contamination.

// Mock WebSocket for testing (minimal implementation)
function createMockWebSocket(readyState = 1): any {
  const ws: any = {
    readyState,
    send: vi.fn(),
    close: vi.fn(),
  };
  return ws;
}

function createClient(socketId: string, username: string, ws?: any) {
  return {
    socketId,
    username,
    ws: ws ?? createMockWebSocket(),
  };
}

// Dynamic import to get fresh module each test suite
import { joinRoom, leaveRoom, broadcastToRoom, getRoomClients, getRoomSize } from "../src/ws/room.js";

describe("WebSocket Room Management", () => {
  // Use unique room IDs per test to avoid contamination from module-scoped Map
  const uniqueId = () => `test-${Math.random().toString(36).slice(2)}`;

  describe("joinRoom", () => {
    it("should return empty array when joining an empty room", () => {
      const roomId = uniqueId();
      const client = createClient("user-1", "Alice");

      const others = joinRoom(roomId, client);

      expect(others).toEqual([]);
    });

    it("should return existing users when joining a non-empty room", () => {
      const roomId = uniqueId();
      const clientA = createClient("user-a", "Alice");
      const clientB = createClient("user-b", "Bob");

      // Alice joins first
      const aliceOthers = joinRoom(roomId, clientA);
      expect(aliceOthers).toEqual([]);

      // Bob joins — should see Alice
      const bobOthers = joinRoom(roomId, clientB);
      expect(bobOthers).toHaveLength(1);
      expect(bobOthers[0].socketId).toBe("user-a");
      expect(bobOthers[0].username).toBe("Alice");
    });

    it("should not include the joining user in the returned list", () => {
      const roomId = uniqueId();
      const clientA = createClient("user-a", "Alice");
      const clientB = createClient("user-b", "Bob");
      const clientC = createClient("user-c", "Charlie");

      joinRoom(roomId, clientA);
      joinRoom(roomId, clientB);

      // Charlie joins — should see Alice and Bob but not self
      const charliesView = joinRoom(roomId, clientC);
      expect(charliesView).toHaveLength(2);
      const socketIds = charliesView.map((c) => c.socketId);
      expect(socketIds).not.toContain("user-c");
      expect(socketIds).toContain("user-a");
      expect(socketIds).toContain("user-b");
    });

    it("should update room client list when same user re-joins", () => {
      const roomId = uniqueId();
      const clientV1 = createClient("user-1", "Alice-v1");
      const clientV2 = createClient("user-1", "Alice-v2"); // Same socketId

      joinRoom(roomId, clientV1);
      const afterRejoin = joinRoom(roomId, clientV2);

      // The room should still have only 1 entry for socketId "user-1"
      expect(getRoomClients(roomId)).toHaveLength(1);
      expect(afterRejoin).toHaveLength(0);
    });
  });

  describe("leaveRoom", () => {
    it("should remove the user from the room", () => {
      const roomId = uniqueId();
      const clientA = createClient("user-a", "Alice");
      const clientB = createClient("user-b", "Bob");

      joinRoom(roomId, clientA);
      joinRoom(roomId, clientB);

      leaveRoom(roomId, "user-a");

      const remaining = getRoomClients(roomId);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].socketId).toBe("user-b");
    });

    it("should delete the room when last user leaves", () => {
      const roomId = uniqueId();
      const clientA = createClient("user-a", "Alice");

      joinRoom(roomId, clientA);
      leaveRoom(roomId, "user-a");

      expect(getRoomClients(roomId)).toEqual([]);
      expect(getRoomSize(roomId)).toBe(0);
    });

    it("should be a no-op when leaving a room the user is not in", () => {
      const roomId = uniqueId();
      const clientA = createClient("user-a", "Alice");

      joinRoom(roomId, clientA);
      // Try to remove a non-existent user
      leaveRoom(roomId, "ghost-user");

      // Alice should still be there
      expect(getRoomClients(roomId)).toHaveLength(1);
      expect(getRoomClients(roomId)[0].socketId).toBe("user-a");
    });

    it("should be a no-op when leaving a non-existent room", () => {
      const roomId = uniqueId();
      // Should not throw
      expect(() => leaveRoom(roomId, "nobody")).not.toThrow();
    });
  });

  describe("getRoomClients", () => {
    it("should return empty array for a non-existent room", () => {
      const roomId = uniqueId();
      expect(getRoomClients(roomId)).toEqual([]);
    });

    it("should return all clients in the room", () => {
      const roomId = uniqueId();
      const clientA = createClient("user-a", "Alice");
      const clientB = createClient("user-b", "Bob");

      joinRoom(roomId, clientA);
      joinRoom(roomId, clientB);

      const clients = getRoomClients(roomId);
      expect(clients).toHaveLength(2);
      const usernames = clients.map((c) => c.username).sort();
      expect(usernames).toEqual(["Alice", "Bob"]);
    });
  });

  describe("getRoomSize", () => {
    it("should return 0 for a non-existent room", () => {
      const roomId = uniqueId();
      expect(getRoomSize(roomId)).toBe(0);
    });

    it("should return correct count after joins and leaves", () => {
      const roomId = uniqueId();
      const clientA = createClient("user-a", "Alice");
      const clientB = createClient("user-b", "Bob");

      joinRoom(roomId, clientA);
      expect(getRoomSize(roomId)).toBe(1);

      joinRoom(roomId, clientB);
      expect(getRoomSize(roomId)).toBe(2);

      leaveRoom(roomId, "user-a");
      expect(getRoomSize(roomId)).toBe(1);

      leaveRoom(roomId, "user-b");
      expect(getRoomSize(roomId)).toBe(0);
    });
  });

  describe("broadcastToRoom", () => {
    it("should send message to all clients in the room except sender", () => {
      const roomId = uniqueId();
      const wsA = createMockWebSocket();
      const wsB = createMockWebSocket();
      const wsC = createMockWebSocket();

      const clientA = createClient("user-a", "Alice", wsA);
      const clientB = createClient("user-b", "Bob", wsB);
      const clientC = createClient("user-c", "Charlie", wsC);

      joinRoom(roomId, clientA);
      joinRoom(roomId, clientB);
      joinRoom(roomId, clientC);

      const message = { type: "TEST", payload: { data: "hello" } };
      broadcastToRoom(roomId, message, "user-a");

      // Alice (sender) should NOT receive the message
      expect(wsA.send).not.toHaveBeenCalled();

      // Bob and Charlie should receive the message
      expect(wsB.send).toHaveBeenCalledTimes(1);
      expect(wsC.send).toHaveBeenCalledTimes(1);

      const sentToBob = JSON.parse(wsB.send.mock.calls[0][0]);
      const sentToCharlie = JSON.parse(wsC.send.mock.calls[0][0]);
      expect(sentToBob).toEqual(message);
      expect(sentToCharlie).toEqual(message);
    });

    it("should send to all clients when no sender is excluded", () => {
      const roomId = uniqueId();
      const wsA = createMockWebSocket();
      const wsB = createMockWebSocket();

      const clientA = createClient("user-a", "Alice", wsA);
      const clientB = createClient("user-b", "Bob", wsB);

      joinRoom(roomId, clientA);
      joinRoom(roomId, clientB);

      const message = { type: "BROADCAST", payload: {} };
      broadcastToRoom(roomId, message);

      expect(wsA.send).toHaveBeenCalledTimes(1);
      expect(wsB.send).toHaveBeenCalledTimes(1);

      const sentToAlice = JSON.parse(wsA.send.mock.calls[0][0]);
      expect(sentToAlice).toEqual(message);
    });

    it("should not send to clients with non-OPEN readyState", () => {
      const roomId = uniqueId();
      const wsA = createMockWebSocket(); // OPEN by default (1)
      const wsB = createMockWebSocket(0); // CONNECTING (0)
      const wsC = createMockWebSocket(2); // CLOSING (2)

      const clientA = createClient("user-a", "Alice", wsA);
      const clientB = createClient("user-b", "Bob", wsB);
      const clientC = createClient("user-c", "Charlie", wsC);

      joinRoom(roomId, clientA);
      joinRoom(roomId, clientB);
      joinRoom(roomId, clientC);

      broadcastToRoom(roomId, { type: "TEST" });

      // Only Alice (OPEN) should receive
      expect(wsA.send).toHaveBeenCalledTimes(1);
      expect(wsB.send).not.toHaveBeenCalled(); // not OPEN
      expect(wsC.send).not.toHaveBeenCalled(); // not OPEN
    });

    it("should be a no-op for a non-existent room", () => {
      const roomId = uniqueId();
      // Should not throw
      expect(() => broadcastToRoom(roomId, { type: "TEST" })).not.toThrow();
    });

    it("should not send to excluded sender even if they are the only client", () => {
      const roomId = uniqueId();
      const wsA = createMockWebSocket();

      const clientA = createClient("user-a", "Alice", wsA);
      joinRoom(roomId, clientA);

      broadcastToRoom(roomId, { type: "TEST" }, "user-a");

      expect(wsA.send).not.toHaveBeenCalled();
    });
  });
});
