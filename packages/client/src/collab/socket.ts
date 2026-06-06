import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { reconcileElements } from "@excalidraw/excalidraw";
import type { AppState } from "@excalidraw/excalidraw/types";

// Element types for sync — use broader types to avoid branded type issues
// @ts-expect-error — OrderedExcalidrawElement is not re-exported from top-level types
type OrderedExcalidrawElement = import("@excalidraw/excalidraw/types").OrderedExcalidrawElement;

// Pointer data from Excalidraw's onPointerUpdate callback
export type PointerData = {
  x: number;
  y: number;
  tool: "pointer" | "laser";
};

type MessageHandler = (message: Record<string, unknown>) => void;

// WebSocket connection to the collaboration server
export class CollabSocket {
  private ws: WebSocket | null = null;
  private roomId: string;
  private username: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private messageHandler: MessageHandler | null = null;

  constructor(roomId: string, username: string) {
    this.roomId = roomId;
    this.username = username;
  }

  connect(onMessage: MessageHandler): void {
    this.messageHandler = onMessage;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log("[CollabSocket] Connected");
      this.send({
        type: "JOIN",
        payload: { roomId: this.roomId, username: this.username },
      });
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data as string);
        this.handleMessage(message);
      } catch (err) {
        console.error("[CollabSocket] Failed to parse message:", err);
      }
    };

    this.ws.onclose = () => {
      console.log("[CollabSocket] Disconnected, reconnecting...");
      this.reconnectTimer = setTimeout(() => this.connect(onMessage), 3000);
    };

    this.ws.onerror = (err) => {
      console.error("[CollabSocket] Error:", err);
    };
  }

  private handleMessage(message: Record<string, unknown>): void {
    if (!this.messageHandler) return;
    this.messageHandler(message);
  }

  sendElementsUpdate(elements: readonly OrderedExcalidrawElement[]): void {
    const serialized = elements.map((el) => ({ ...el }));
    this.send({ type: "ELEMENTS_UPDATE", payload: { elements: serialized } });
  }

  sendPointerUpdate(pointer: PointerData): void {
    this.send({ type: "POINTER_UPDATE", payload: { pointer } });
  }

  private send(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}

/**
 * Merge incoming remote elements with local elements.
 * Uses Excalidraw's reconcileElements: union by element ID, latest version wins.
 */
export function mergeElements(
  localElements: readonly OrderedExcalidrawElement[],
  remoteElements: readonly OrderedExcalidrawElement[],
  appState: AppState
): OrderedExcalidrawElement[] {
  // Cast to bypass branded types — reconcileElements accepts the same underlying shape
  return reconcileElements(
    localElements as any[],
    remoteElements as any[],
    appState
  );
}
