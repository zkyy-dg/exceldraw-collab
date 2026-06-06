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

// Collaborator data stored by socketId
interface RemoteCollaborator {
  pointer?: { x: number; y: number };
  username: string;
  color: { background: string; stroke: string };
}

// Generate a consistent color from a string hash
function hashColor(str: string): { background: string; stroke: string } {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return {
    background: `hsl(${hue}, 80%, 85%)`,
    stroke: `hsl(${hue}, 80%, 55%)`,
  };
}

interface WhiteboardProps {
  roomId: string;
}

export function Whiteboard({ roomId }: WhiteboardProps) {
  const excalidrawAPIRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const collabSocketRef = useRef<CollabSocket | null>(null);
  const collaboratorsRef = useRef<Map<string, RemoteCollaborator>>(new Map());

  const updateCollaborators = useCallback(() => {
    const api = excalidrawAPIRef.current;
    if (!api) return;

    const excalidrawCollaborators = new Map<string, any>();
    for (const [socketId, collab] of collaboratorsRef.current) {
      excalidrawCollaborators.set(socketId as any, {
        pointer: collab.pointer,
        username: collab.username,
        color: collab.color,
      });
    }

    api.updateScene({
      appState: {
        collaborators: excalidrawCollaborators as any,
      },
    });
  }, []);

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
          // Initialize collaborators for existing users
          for (const user of users) {
            collaboratorsRef.current.set(user.socketId, {
              username: user.username,
              color: hashColor(user.socketId),
            });
          }
          updateCollaborators();
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
        case "POINTER_UPDATE": {
          const { pointer, socketId } = message.payload as { pointer: PointerData; socketId: string };
          const collab = collaboratorsRef.current.get(socketId);
          if (collab) {
            collab.pointer = { x: pointer.x, y: pointer.y };
            updateCollaborators();
          }
          break;
        }
        case "USER_JOINED": {
          const { user } = message.payload as { user: { socketId: string; username: string } };
          console.log("[Whiteboard] User joined:", user.username);
          collaboratorsRef.current.set(user.socketId, {
            username: user.username,
            color: hashColor(user.socketId),
          });
          updateCollaborators();
          break;
        }
        case "USER_LEFT": {
          const { socketId } = message.payload as { socketId: string };
          console.log("[Whiteboard] User left:", socketId);
          collaboratorsRef.current.delete(socketId);
          updateCollaborators();
          break;
        }
      }
    });

    return () => {
      socket.disconnect();
      collabSocketRef.current = null;
      collaboratorsRef.current.clear();
    };
  }, [roomId, updateCollaborators]);

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
