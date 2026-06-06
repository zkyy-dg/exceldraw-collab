import { Whiteboard } from "./components/Whiteboard";

// For now, use a default room ID. US-008 will add routing.
// The roomId can come from URL params or a board selection page.
const DEFAULT_ROOM_ID = "default-room";

export default function App() {
  return (
    <div className="h-full w-full">
      <Whiteboard roomId={DEFAULT_ROOM_ID} />
    </div>
  );
}
