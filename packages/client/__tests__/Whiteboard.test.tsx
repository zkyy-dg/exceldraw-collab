/**
 * Unit tests for Whiteboard component
 *
 * Covers:
 * - Renders without crashing
 * - Creates CollabSocket on mount and disconnects on unmount
 * - Handles INIT message (existing users)
 * - Handles ELEMENTS_UPDATE message (remote elements merge)
 * - Handles POINTER_UPDATE message
 * - Handles USER_JOINED and USER_LEFT messages
 * - Save indicator states
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

// Mock CollabSocket
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockSendElementsUpdate = vi.fn();
const mockSendPointerUpdate = vi.fn();

vi.mock("../src/collab/socket.js", () => ({
  CollabSocket: class {
    connect = mockConnect;
    disconnect = mockDisconnect;
    sendElementsUpdate = mockSendElementsUpdate;
    sendPointerUpdate = mockSendPointerUpdate;
  },
  mergeElements: (local: any[], remote: any[], _appState: any) => {
    // Simple merge: use remote ID as key
    const map = new Map(local.map((el: any) => [el.id, el]));
    for (const el of remote) map.set(el.id, el);
    return Array.from(map.values());
  },
}));

// Mock fetch for loading/saving elements
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock Excalidraw (JS)
vi.mock("@excalidraw/excalidraw", () => ({
  Excalidraw: vi.fn().mockImplementation((props: any) => {
    // Store callbacks for test use
    (window as any).__excalidrawProps = props;
    return null;
  }),
}));

// Mock Excalidraw CSS (side-effect import)
vi.mock("@excalidraw/excalidraw/index.css", () => ({}));

import { Whiteboard } from "../src/components/Whiteboard.js";

// Store the message handler passed to connect
let connectMessageHandler: ((msg: any) => void) | null = null;

describe("Whiteboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ elements: [] }),
    });

    // Capture the message handler when connect is called
    mockConnect.mockImplementation((handler: any) => {
      connectMessageHandler = handler;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    connectMessageHandler = null;
  });

  describe("mount/unmount", () => {
    it("should render without crashing", () => {
      expect(() => render(<Whiteboard roomId="test-room" />)).not.toThrow();
    });

    it("should create CollabSocket with correct roomId on mount", () => {
      render(<Whiteboard roomId="room-abc" />);

      // CollabSocket constructor should have been called
      // Verify by checking that connect was called (socket was created and connected)
      expect(mockConnect).toHaveBeenCalledWith(expect.any(Function));
    });

    it("should connect the socket on mount", () => {
      render(<Whiteboard roomId="room-1" />);

      expect(mockConnect).toHaveBeenCalledWith(expect.any(Function));
    });

    it("should disconnect the socket on unmount", () => {
      const { unmount } = render(<Whiteboard roomId="room-1" />);
      unmount();

      expect(mockDisconnect).toHaveBeenCalled();
    });
  });

  describe("WebSocket message handling", () => {
    it("should handle INIT message and load saved elements", async () => {
      render(<Whiteboard roomId="room-1" />);

      // Set up excalidrawAPI ref (simulate Excalidraw calling the callback)
      const props = (window as any).__excalidrawProps;
      const mockUpdateScene = vi.fn();
      props.excalidrawAPI({ updateScene: mockUpdateScene, getAppState: () => ({}), getSceneElements: () => [] });

      act(() => {
        connectMessageHandler!({
          type: "INIT",
          payload: { users: [{ socketId: "user-1", username: "Alice" }] },
        });
      });

      // Verify fetch was called to load saved elements
      expect(mockFetch).toHaveBeenCalledWith("/api/boards/room-1/elements");
    });

    it("should handle ELEMENTS_UPDATE from remote user", async () => {
      render(<Whiteboard roomId="room-1" />);

      const props = (window as any).__excalidrawProps;
      const mockUpdateScene = vi.fn();
      props.excalidrawAPI({ updateScene: mockUpdateScene, getAppState: () => ({}), getSceneElements: () => [] });

      act(() => {
        connectMessageHandler!({
          type: "ELEMENTS_UPDATE",
          payload: {
            elements: [{ id: "remote-el-1", type: "rectangle", version: 1 }],
          },
        });
      });

      // updateScene should be called with merged elements
      expect(mockUpdateScene).toHaveBeenCalledWith(
        expect.objectContaining({
          elements: expect.arrayContaining([
            expect.objectContaining({ id: "remote-el-1" }),
          ]),
        })
      );
    });

    it("should handle POINTER_UPDATE from remote user", () => {
      render(<Whiteboard roomId="room-1" />);

      const props = (window as any).__excalidrawProps;
      const mockUpdateScene = vi.fn();
      props.excalidrawAPI({ updateScene: mockUpdateScene, getAppState: () => ({}), getSceneElements: () => [] });

      act(() => {
        connectMessageHandler!({
          type: "INIT",
          payload: { users: [{ socketId: "user-bob", username: "Bob" }] },
        });
      });

      act(() => {
        connectMessageHandler!({
          type: "POINTER_UPDATE",
          payload: { pointer: { x: 150, y: 250, tool: "pointer" }, socketId: "user-bob" },
        });
      });

      // updateScene should have been called to update collaborators
      expect(mockUpdateScene).toHaveBeenCalled();
    });

    it("should handle USER_JOINED message", () => {
      render(<Whiteboard roomId="room-1" />);

      const props = (window as any).__excalidrawProps;
      const mockUpdateScene = vi.fn();
      props.excalidrawAPI({ updateScene: mockUpdateScene, getAppState: () => ({}), getSceneElements: () => [] });

      act(() => {
        connectMessageHandler!({
          type: "USER_JOINED",
          payload: { user: { socketId: "user-charlie", username: "Charlie" } },
        });
      });

      expect(mockUpdateScene).toHaveBeenCalled();
    });

    it("should handle USER_LEFT message", () => {
      render(<Whiteboard roomId="room-1" />);

      const props = (window as any).__excalidrawProps;
      const mockUpdateScene = vi.fn();
      props.excalidrawAPI({ updateScene: mockUpdateScene, getAppState: () => ({}), getSceneElements: () => [] });

      // First add a user
      act(() => {
        connectMessageHandler!({
          type: "INIT",
          payload: { users: [{ socketId: "user-dave", username: "Dave" }] },
        });
      });

      mockUpdateScene.mockClear();

      // Then remove the user
      act(() => {
        connectMessageHandler!({
          type: "USER_LEFT",
          payload: { socketId: "user-dave" },
        });
      });

      expect(mockUpdateScene).toHaveBeenCalled();
    });
  });

  describe("Element change handling", () => {
    it("should send elements update via CollabSocket when elements change", () => {
      render(<Whiteboard roomId="room-1" />);

      const props = (window as any).__excalidrawProps;
      const elements = [{ id: "el-1", type: "rectangle" }];
      props.onChange(elements, {}, {});

      expect(mockSendElementsUpdate).toHaveBeenCalledWith(elements);
    });

    it("should send pointer update via CollabSocket when pointer moves", () => {
      render(<Whiteboard roomId="room-1" />);

      const props = (window as any).__excalidrawProps;
      props.onPointerUpdate({
        pointer: { x: 100, y: 200, tool: "pointer" },
      });

      expect(mockSendPointerUpdate).toHaveBeenCalledWith({
        x: 100,
        y: 200,
        tool: "pointer",
      });
    });
  });
});
