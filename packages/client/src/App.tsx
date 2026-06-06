import { BrowserRouter, Routes, Route, useParams } from "react-router-dom";
import { BoardList } from "./components/BoardList.js";
import { Whiteboard } from "./components/Whiteboard.js";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<BoardList />} />
        <Route path="/board/:id" element={<BoardRoute />} />
      </Routes>
    </BrowserRouter>
  );
}

/** Wrapper that passes the board ID from URL params to Whiteboard */
function BoardRoute() {
  const params = useParams();
  const boardId = params.id ?? "default";
  return <Whiteboard roomId={boardId} />;
}
