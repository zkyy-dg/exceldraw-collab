import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";

// Set asset path for self-hosted fonts
declare global {
  interface Window {
    EXCALIDRAW_ASSET_PATH: string;
  }
}

if (typeof window !== "undefined") {
  window.EXCALIDRAW_ASSET_PATH = "/";
}

export function Whiteboard() {
  return (
    <div style={{ height: "100%", width: "100%" }}>
      <Excalidraw />
    </div>
  );
}
