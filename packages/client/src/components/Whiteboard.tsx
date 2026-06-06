import { useCallback, useRef, useEffect } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import type {
  ExcalidrawImperativeAPI,
  AppState,
} from "@excalidraw/excalidraw/types";

// @ts-expect-error — OrderedExcalidrawElement is not re-exported from top-level types
type OrderedExcalidrawElement = import("@excalidraw/excalidraw/types").OrderedExcalidrawElement;
import "@excalidraw/excalidraw/index.css";
import { CollabSocket, mergeElements } from "../collab/socket.js";
import type { PointerData } from "../collab/socket.js";

// Set asset path for self-hosted fonts
declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH: string;
  }
}

if (typeof window !== "undefined") {
  window.EXCALIDRAW_ASSET_PATH = "/";
}

// Generate a random username for this session
const USERNAME = "User-" + Math.random().toString(36).substring(2, 6);

interface WhiteboardProps {
  roomId: string;
}

export function Whiteboard({ roomId }: WhiteboardProps) {
  const excalidrawAPIRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const collabSocketRef = useRef<CollabSocket | null>(null);

  useEffect(() => {
    const socket = new CollabSocket(roomId, USERNAME);
    collabSocketRef.current = socket;

    socket.connect((message) => {
      const api = excalidrawAPIRef.current;
      if (!api) return;

      switch (message.type) {
        case "INIT": {
          const { users } = message.payload as { users: Array<{ socketId: string; username: string }> };
          console.log("[Whiteboard] Users in room:", users);
          break;
        }
        case "ELEMENTS_UPDATE": {
          const { elements: remoteElements } = message.payload as { elements: OrderedExcalidrawElement[] };
          if (remoteElements.length > 0) {
            const appState = api.getAppState() as AppState;
            const localElements = api.getSceneElements() as readonly OrderedExcalidrawElement[];
            const merged = mergeElements(localElements, remoteElements, appState);
            api.updateScene({ elements: merged });
          }
          break;
        }
        case "USER_JOINED": {
          const { user } = message.payload as { user: { username: string } };
          console.log("[Whiteboard] User joined:", user.username);
          break;
        }
        case "USER_LEFT": {
          const { socketId } = message.payload as { socketId: string };
          console.log("[Whiteboard] User left:", socketId);
          break;
        }
      }
    });

    return () => {
      socket.disconnect();
      collabSocketRef.current = null;
    };
  }, [roomId]);

  const handleExcalidrawAPI = useCallback((api: ExcalidrawImperativeAPI) => {
    excalidrawAPIRef.current = api;
  }, []);

  const handleChange = useCallback(
    (elements: readonly OrderedExcalidrawElement[], _appState: unknown, _files: unknown) => {
      collabSocketRef.current?.sendElementsUpdate(elements);
    },
    []
  );

  const handlePointerUpdate = useCallback(
    (payload: { pointer: { x: number; y: number; tool: "pointer" | "laser" } }) => {
      const pointer: PointerData = {
        x: payload.pointer.x,
        y: payload.pointer.y,
        tool: payload.pointer.tool,
      };
      collabSocketRef.current?.sendPointerUpdate(pointer);
    },
    []
  );

  return (
    <div style={{ height: "100%", width: "100%" }}>
      <Excalidraw
        excalidrawAPI={handleExcalidrawAPI}
        onChange={handleChange}
        onPointerUpdate={handlePointerUpdate}
      />
    </div>
  );
}
