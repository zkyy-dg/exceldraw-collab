/**
 * Unit tests for BoardList component
 *
 * Covers:
 * - Rendering: shows "Loading boards..." while loading, empty state when no boards
 * - Board list: renders fetched boards with names and relative times
 * - Create board: clicking "+ New Board", entering name, submitting
 * - Navigation: clicking a board navigates to the board page
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrowserRouter } from "react-router-dom";

// Mock react-router-dom navigate
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { BoardList } from "../src/components/BoardList.js";

function renderBoardList() {
  return render(
    <BrowserRouter>
      <BoardList />
    </BrowserRouter>
  );
}

describe("BoardList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockClear();
  });

  describe("Loading state", () => {
    it("should show 'Loading boards...' while fetching", () => {
      // fetch never resolves — stays loading
      mockFetch.mockReturnValue(new Promise(() => {}));

      renderBoardList();

      expect(screen.getByText("Loading boards...")).toBeInTheDocument();
    });
  });

  describe("Empty state", () => {
    it("should show 'No boards yet.' when there are no boards", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      renderBoardList();

      await waitFor(() => {
        expect(screen.getByText("No boards yet.")).toBeInTheDocument();
      });
      expect(screen.getByText("Create one to get started.")).toBeInTheDocument();
    });
  });

  describe("Board list rendering", () => {
    it("should render fetched boards", async () => {
      const boards = [
        { id: "board-1", name: "My Board", created_at: Date.now() / 1000 - 60, updated_at: Date.now() / 1000 - 10 },
        { id: "board-2", name: "Another Board", created_at: Date.now() / 1000 - 3600, updated_at: Date.now() / 1000 - 3600 },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => boards,
      });

      renderBoardList();

      await waitFor(() => {
        expect(screen.getByText("My Board")).toBeInTheDocument();
      });
      expect(screen.getByText("Another Board")).toBeInTheDocument();
    });

    it("should fetch boards on mount", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      renderBoardList();

      expect(mockFetch).toHaveBeenCalledWith("/api/boards");
    });
  });

  describe("Navigation", () => {
    it("should navigate to board page when clicking a board", async () => {
      const boards = [
        { id: "board-123", name: "Test Board", created_at: Date.now() / 1000 - 60, updated_at: Date.now() / 1000 - 10 },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => boards,
      });

      renderBoardList();

      await waitFor(() => {
        expect(screen.getByText("Test Board")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("Test Board"));

      expect(mockNavigate).toHaveBeenCalledWith("/board/board-123");
    });
  });

  describe("Create board", () => {
    it("should show input when '+ New Board' is clicked", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      renderBoardList();

      await waitFor(() => {
        expect(screen.getByText("No boards yet.")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("+ New Board"));

      expect(screen.getByPlaceholderText("Board name...")).toBeInTheDocument();
      expect(screen.getByText("Create")).toBeInTheDocument();
      expect(screen.getByText("Cancel")).toBeInTheDocument();
    });

    it("should create board and navigate when Create is clicked", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const newBoard = { id: "new-board-id", name: "New Board" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => newBoard,
      });

      renderBoardList();

      await waitFor(() => {
        expect(screen.getByText("No boards yet.")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("+ New Board"));

      const input = screen.getByPlaceholderText("Board name...");
      await userEvent.type(input, "New Board");
      await userEvent.click(screen.getByText("Create"));

      // Verify POST request was made
      expect(mockFetch).toHaveBeenCalledWith("/api/boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Board" }),
      });

      // Verify navigation to the new board
      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith("/board/new-board-id");
      });
    });

    it("should create board with default name when name is empty", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const newBoard = { id: "new-board-id", name: "Untitled Board" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => newBoard,
      });

      renderBoardList();

      await waitFor(() => {
        expect(screen.getByText("No boards yet.")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("+ New Board"));

      // Don't type anything, just click Create
      await userEvent.click(screen.getByText("Create"));

      expect(mockFetch).toHaveBeenCalledWith("/api/boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Untitled Board" }),
      });
    });

    it("should hide input when Cancel is clicked", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      renderBoardList();

      await waitFor(() => {
        expect(screen.getByText("No boards yet.")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("+ New Board"));
      expect(screen.getByPlaceholderText("Board name...")).toBeInTheDocument();

      await userEvent.click(screen.getByText("Cancel"));
      expect(screen.queryByPlaceholderText("Board name...")).not.toBeInTheDocument();
    });

    it("should create board on Enter key press", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const newBoard = { id: "new-board-id", name: "Quick Board" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => newBoard,
      });

      renderBoardList();

      await waitFor(() => {
        expect(screen.getByText("No boards yet.")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("+ New Board"));

      const input = screen.getByPlaceholderText("Board name...");
      await userEvent.type(input, "Quick Board");
      await userEvent.keyboard("{Enter}");

      expect(mockFetch).toHaveBeenCalledWith("/api/boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Quick Board" }),
      });
    });

    it("should cancel creation on Escape key press", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      renderBoardList();

      await waitFor(() => {
        expect(screen.getByText("No boards yet.")).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText("+ New Board"));
      const input = screen.getByPlaceholderText("Board name...");
      await userEvent.type(input, "Some name");
      await userEvent.keyboard("{Escape}");

      expect(screen.queryByPlaceholderText("Board name...")).not.toBeInTheDocument();
    });
  });

  describe("Error handling", () => {
    it("should handle fetch failure gracefully", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      renderBoardList();

      // Should not crash — loading should complete
      await waitFor(() => {
        expect(screen.queryByText("Loading boards...")).not.toBeInTheDocument();
      });
    });
  });
});
