/**
 * Unit tests for CollabSocket (collab/socket.ts)
 *
 * Covers:
 * - connect: creates WebSocket, sends JOIN message on open
 * - disconnect: cleans up WebSocket, stops reconnect timer
 * - sendElementsUpdate: serializes and sends ELEMENTS_UPDATE
 * - sendPointerUpdate: sends POINTER_UPDATE
 * - reconnect: attempts reconnection on close
 * - message handling: routes messages to onMessage callback
 * - error handling: handles invalid JSON gracefully
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Track created WebSocket instances
let mockWebSocketInstances: any[] = [];
let wsOnOpenCallback: (() => void) | null = null;
let wsOnMessageCallback: ((event: { data: string }) => void) | null = null;
let wsOnCloseCallback: (() => void) | null = null;
let wsOnErrorCallback: ((err: any) => void) | null = null;

// Mock WebSocket class
class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = MockWebSocket.OPEN;
  send = vi.fn();
  close = vi.fn();

  constructor(public url: string) {
    mockWebSocketInstances.push(this);
    // Simulate open on next tick
    setTimeout(() => {
      if (wsOnOpenCallback) wsOnOpenCallback();
    }, 0);
  }

  // Simulate server messages
  simulateMessage(data: object) {
    if (wsOnMessageCallback) {
      wsOnMessageCallback({ data: JSON.stringify(data) });
    }
  }

  // Simulate server close
  simulateClose() {
    if (wsOnCloseCallback) wsOnCloseCallback();
  }

  set onopen(cb: (() => void) | null) { wsOnOpenCallback = cb; }
  set onmessage(cb: ((event: { data: string }) => void) | null) { wsOnMessageCallback = cb; }
  set onclose(cb: (() => void) | null) { wsOnCloseCallback = cb; }
  set onerror(cb: ((err: any) => void) | null) { wsOnErrorCallback = cb; }
}

// Mock Excalidraw imports used by socket.ts (reconcileElements, types)
vi.mock("@excalidraw/excalidraw", () => ({
  reconcileElements: (local: any[], remote: any[], _appState: any) => {
    const remoteMap = new Map(remote.map((el: any) => [el.id, el]));
    const result: any[] = [];
    for (const el of local) {
      if (remoteMap.has(el.id)) {
        result.push(remoteMap.get(el.id));
        remoteMap.delete(el.id);
      } else {
        result.push(el);
      }
    }
    for (const el of remoteMap.values()) result.push(el);
    return result;
  },
}));

// Stub window.location for protocol/host
Object.defineProperty(window, "location", {
  value: {
    protocol: "http:",
    host: "localhost:3001",
  },
  writable: true,
});

// Mock global WebSocket
vi.stubGlobal("WebSocket", MockWebSocket);

// Import after mock is set up
import { CollabSocket } from "../src/collab/socket.js";

describe("CollabSocket", () => {
  beforeEach(() => {
    mockWebSocketInstances = [];
    wsOnOpenCallback = null;
    wsOnMessageCallback = null;
    wsOnCloseCallback = null;
    wsOnErrorCallback = null;
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("connect", () => {
    it("should create a WebSocket connection on connect", () => {
      const socket = new CollabSocket("room-1", "Alice");
      socket.connect(vi.fn());

      expect(mockWebSocketInstances).toHaveLength(1);
      expect(mockWebSocketInstances[0].url).toBe("ws://localhost:3001/ws");
    });

    it("should send JOIN message after WebSocket opens", async () => {
      const socket = new CollabSocket("room-1", "Alice");
      const messageHandler = vi.fn();
      socket.connect(messageHandler);

      // Wait for the simulated open callback
      await vi.advanceTimersByTimeAsync(1);

      const ws = mockWebSocketInstances[0];
      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: "JOIN",
          payload: { roomId: "room-1", username: "Alice" },
        })
      );
    });

    it("should route received messages to the onMessage callback", async () => {
      const socket = new CollabSocket("room-1", "Alice");
      const messageHandler = vi.fn();
      socket.connect(messageHandler);

      await vi.advanceTimersByTimeAsync(1);

      // Simulate server sending a message
      mockWebSocketInstances[0].simulateMessage({
        type: "INIT",
        payload: { users: [] },
      });

      expect(messageHandler).toHaveBeenCalledWith({
        type: "INIT",
        payload: { users: [] },
      });
    });

    it("should use wss: when on https:", async () => {
      Object.defineProperty(window, "location", {
        value: { protocol: "https:", host: "example.com" },
      });

      const socket = new CollabSocket("room-1", "Alice");
      socket.connect(vi.fn());

      await vi.advanceTimersByTimeAsync(1);

      expect(mockWebSocketInstances[0].url).toBe("wss://example.com/ws");

      // Restore
      Object.defineProperty(window, "location", {
        value: { protocol: "http:", host: "localhost:3001" },
      });
    });
  });

  describe("disconnect", () => {
    it("should close the WebSocket connection", async () => {
      const socket = new CollabSocket("room-1", "Alice");
      socket.connect(vi.fn());
      await vi.advanceTimersByTimeAsync(1);

      socket.disconnect();

      expect(mockWebSocketInstances[0].close).toHaveBeenCalled();
    });

    it("should prevent reconnection after disconnect", async () => {
      const socket = new CollabSocket("room-1", "Alice");
      socket.connect(vi.fn());
      await vi.advanceTimersByTimeAsync(1);

      // Simulate close event (which triggers reconnect timer setup)
      mockWebSocketInstances[0].simulateClose();

      // Advance slightly to let the timer be set up
      vi.advanceTimersByTime(100);

      // Now disconnect — should clear the reconnect timer
      socket.disconnect();

      // Advance past the 3s reconnect timer
      vi.advanceTimersByTime(4000);

      // No new WebSocket should be created (disconnect cleared the timer)
      expect(mockWebSocketInstances).toHaveLength(1);
    });
  });

  describe("reconnect", () => {
    it("should attempt to reconnect after WebSocket closes", async () => {
      const socket = new CollabSocket("room-1", "Alice");
      socket.connect(vi.fn());
      await vi.advanceTimersByTimeAsync(1);

      // Simulate connection close
      mockWebSocketInstances[0].simulateClose();

      // Should not reconnect immediately
      expect(mockWebSocketInstances).toHaveLength(1);

      // After 3 seconds, should attempt reconnect
      vi.advanceTimersByTime(3000);
      expect(mockWebSocketInstances).toHaveLength(2);

      // Wait for the new connection to open and send JOIN
      await vi.advanceTimersByTimeAsync(1);
      expect(mockWebSocketInstances[1].send).toHaveBeenCalledWith(
        expect.stringContaining('"JOIN"')
      );
    });
  });

  describe("sendElementsUpdate", () => {
    it("should send ELEMENTS_UPDATE message with serialized elements", async () => {
      const socket = new CollabSocket("room-1", "Alice");
      socket.connect(vi.fn());
      await vi.advanceTimersByTimeAsync(1);

      const elements = [
        { id: "el-1", type: "rectangle", version: 1, x: 10, y: 20 },
      ] as any;

      socket.sendElementsUpdate(elements);

      expect(mockWebSocketInstances[0].send).toHaveBeenCalledWith(
        JSON.stringify({
          type: "ELEMENTS_UPDATE",
          payload: { elements: [{ id: "el-1", type: "rectangle", version: 1, x: 10, y: 20 }] },
        })
      );
    });

    it("should not throw when WebSocket is not connected", () => {
      const socket = new CollabSocket("room-1", "Alice");
      // Don't call connect — no WebSocket exists
      expect(() => socket.sendElementsUpdate([] as any)).not.toThrow();
    });
  });

  describe("sendPointerUpdate", () => {
    it("should send POINTER_UPDATE message with pointer data", async () => {
      const socket = new CollabSocket("room-1", "Alice");
      socket.connect(vi.fn());
      await vi.advanceTimersByTimeAsync(1);

      socket.sendPointerUpdate({ x: 100, y: 200, tool: "pointer" });

      expect(mockWebSocketInstances[0].send).toHaveBeenCalledWith(
        JSON.stringify({
          type: "POINTER_UPDATE",
          payload: { pointer: { x: 100, y: 200, tool: "pointer" } },
        })
      );
    });
  });

  describe("error handling", () => {
    it("should handle non-JSON messages gracefully", async () => {
      const socket = new CollabSocket("room-1", "Alice");
      const messageHandler = vi.fn();
      socket.connect(messageHandler);
      await vi.advanceTimersByTimeAsync(1);

      // Simulate receiving invalid JSON
      if (wsOnMessageCallback) {
        wsOnMessageCallback({ data: "not-json" });
      }

      // Should not crash, and messageHandler should not be called
      expect(messageHandler).not.toHaveBeenCalled();
    });
  });
});
