import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";

interface Board {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
}

function relativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function BoardList() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [newBoardName, setNewBoardName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const fetchBoards = useCallback(async () => {
    try {
      const res = await fetch("/api/boards");
      const data = await res.json();
      setBoards(data);
    } catch (err) {
      console.error("[BoardList] Failed to fetch boards:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBoards();
  }, [fetchBoards]);

  const handleCreate = async () => {
    const name = newBoardName.trim() || "Untitled Board";
    try {
      const res = await fetch("/api/boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const board = await res.json();
      setNewBoardName("");
      setIsCreating(false);
      // Navigate to the new board immediately
      navigate(`/board/${board.id}`);
    } catch (err) {
      console.error("[BoardList] Failed to create board:", err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleCreate();
    } else if (e.key === "Escape") {
      setIsCreating(false);
      setNewBoardName("");
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-gray-800">
            Excalidraw Collab
          </h1>
          <button
            onClick={() => setIsCreating(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            + New Board
          </button>
        </div>

        {isCreating && (
          <div className="mb-6 p-4 bg-white rounded-lg shadow-sm border border-gray-200">
            <input
              type="text"
              placeholder="Board name..."
              value={newBoardName}
              onChange={(e) => setNewBoardName(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              autoFocus
            />
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleCreate}
                className="px-4 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
              >
                Create
              </button>
              <button
                onClick={() => {
                  setIsCreating(false);
                  setNewBoardName("");
                }}
                className="px-4 py-1.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center text-gray-500 py-12">Loading boards...</div>
        ) : boards.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-gray-400 text-lg mb-2">No boards yet.</div>
            <div className="text-gray-400">Create one to get started.</div>
          </div>
        ) : (
          <div className="space-y-3">
            {boards.map((board) => (
              <button
                key={board.id}
                onClick={() => navigate(`/board/${board.id}`)}
                className="w-full text-left p-4 bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-md hover:border-blue-300 transition-all cursor-pointer"
              >
                <div className="font-medium text-gray-800">{board.name}</div>
                <div className="text-sm text-gray-400 mt-1">
                  Created {relativeTime(board.created_at)} · Updated {relativeTime(board.updated_at)}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
