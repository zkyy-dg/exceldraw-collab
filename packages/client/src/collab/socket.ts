import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

// Pointer data from Excalidraw's onPointerUpdate callback
export type PointerData = {
  x: number;
  y: number;
  tool: "pointer" | "laser";
  pressure: number;
  pointerType: string;
};

// WebSocket connection to the collaboration server
export class CollabSocket {
  private ws: WebSocket | null = null;
  private roomId: string;
  private username: string;
  private excalidrawAPI: ExcalidrawImperativeAPI | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(roomId: string, username: string) {
    this.roomId = roomId;
    this.username = username;
  }

  connect(excalidrawAPI: ExcalidrawImperativeAPI): void {
    this.excalidrawAPI = excalidrawAPI;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log("[CollabSocket] Connected");
      // Send JOIN message
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
      this.reconnectTimer = setTimeout(() => this.connect(excalidrawAPI), 3000);
    };

    this.ws.onerror = (err) => {
      console.error("[CollabSocket] Error:", err);
    };
  }

  private handleMessage(message: Record<string, unknown>): void {
    if (!this.excalidrawAPI) return;

    switch (message.type) {
      case "INIT":
        // Load initial elements
        console.log("[CollabSocket] Received initial state");
        break;
      case "ELEMENTS_UPDATE":
        // Merge incoming elements with local
        console.log("[CollabSocket] Received elements update");
        break;
      case "POINTER_UPDATE":
        // Update remote cursor position
        break;
      default:
        console.log("[CollabSocket] Unknown message type:", message.type);
    }
  }

  sendElementsUpdate(elements: unknown[]): void {
    this.send({ type: "ELEMENTS_UPDATE", payload: { elements } });
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
    }
    this.ws?.close();
    this.ws = null;
  }
}
