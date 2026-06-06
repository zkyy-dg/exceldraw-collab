/**
 * US-010: End-to-end collaboration smoke test
 *
 * Tests the full flow:
 * 1. Two WebSocket clients connect to the same room
 * 2. Client A sends ELEMENTS_UPDATE → Client B receives it
 * 3. Client A sends POINTER_UPDATE → Client B receives it
 * 4. User count updates on JOIN/USER_JOINED/USER_LEFT
 * 5. Disconnect/reconnect works
 * 6. REST API: create board, save elements, load elements, verify persistence
 */

import WebSocket from "ws";

const SERVER = "ws://localhost:3001/ws";
const API = "http://localhost:3001";

function connect(socketId: string, roomId: string, username: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SERVER);
    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "JOIN",
        payload: { roomId, username },
      }));
      resolve(ws);
    });
    ws.on("error", reject);
  });
}

function waitForMessage(ws: WebSocket, type: string, timeoutMs = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeoutMs);
    function handler(data: any) {
      const msg = JSON.parse(data.toString());
      if (msg.type === type) {
        clearTimeout(timer);
        ws.off("message", handler);
        resolve(msg);
      }
    }
    ws.on("message", handler);
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface TestResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const results: TestResult[] = [];

function test(name: string, passed: boolean, detail?: string) {
  results.push({ name, passed, detail });
  console.log(passed ? `  ✅ ${name}` : `  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
}

async function runE2ETest() {
  console.log("\n=== US-010: End-to-End Collaboration Smoke Test ===\n");

  // --- Test 1: REST API — Create board, save elements, load elements ---
  console.log("1. REST API persistence");
  try {
    const createRes = await fetch(`${API}/api/boards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "E2E Test Board" }),
    });
    const board = await createRes.json();
    test("Create board", createRes.ok && !!board.id, `id=${board.id}`);

    // Save elements
    const testElements = [
      { id: "el-1", type: "rectangle", version: 1, versionNonce: 1, x: 10, y: 20, width: 100, height: 50 },
      { id: "el-2", type: "ellipse", version: 1, versionNonce: 1, x: 200, y: 300, width: 80, height: 80 },
    ];
    const saveRes = await fetch(`${API}/api/boards/${board.id}/elements`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elements: testElements }),
    });
    const saveData = await saveRes.json();
    test("Save elements", saveRes.ok && saveData.ok === true);

    // Load elements
    const loadRes = await fetch(`${API}/api/boards/${board.id}/elements`);
    const loadData = await loadRes.json();
    const elementsMatch =
      loadData.elements.length === 2 &&
      loadData.elements[0].id === "el-1" &&
      loadData.elements[1].id === "el-2";
    test("Load elements (persistence)", elementsMatch, `got ${loadData.elements.length} elements`);

    // List boards — should include our new board
    const listRes = await fetch(`${API}/api/boards`);
    const listData = await listRes.json();
    const boardInList = listData.some((b: any) => b.id === board.id);
    test("Board appears in list", boardInList);
  } catch (err: any) {
    test("REST API tests", false, err.message);
  }

  // --- Test 2: WebSocket real-time collaboration ---
  console.log("\n2. WebSocket real-time collaboration");
  const roomId = "e2e-test-room";
  const ws1 = await connect("client-a", roomId, "Alice");
  const init1 = await waitForMessage(ws1, "INIT");
  test("Alice joins empty room (INIT users=[])", init1.payload.users.length === 0);

  const ws2 = await connect("client-b", roomId, "Bob");
  const init2 = await waitForMessage(ws2, "INIT");
  test("Bob joins, INIT lists Alice", init2.payload.users.length === 1 && init2.payload.users[0].username === "Alice");

  const joinedMsg = await waitForMessage(ws1, "USER_JOINED");
  test("Alice receives USER_JOINED (Bob)", joinedMsg.payload.user.username === "Bob");

  // --- Test 3: Element sync ---
  console.log("\n3. Element sync");
  const testDrawElements = [
    { id: "draw-1", type: "rectangle", version: 1, versionNonce: 1, x: 100, y: 100, width: 200, height: 100 },
  ];
  ws1.send(JSON.stringify({
    type: "ELEMENTS_UPDATE",
    payload: { elements: testDrawElements },
  }));
  const elemMsg = await waitForMessage(ws2, "ELEMENTS_UPDATE");
  test("Bob receives ELEMENTS_UPDATE", elemMsg.payload.elements.length === 1 && elemMsg.payload.elements[0].id === "draw-1");

  // --- Test 4: Pointer sync ---
  console.log("\n4. Pointer sync");
  ws1.send(JSON.stringify({
    type: "POINTER_UPDATE",
    payload: { pointer: { x: 350, y: 250, tool: "pointer" } },
  }));
  const ptrMsg = await waitForMessage(ws2, "POINTER_UPDATE");
  test("Bob receives POINTER_UPDATE",
    ptrMsg.payload.pointer.x === 350 &&
    ptrMsg.payload.pointer.y === 250 &&
    ptrMsg.payload.socketId !== undefined
  );

  // --- Test 5: User count and disconnect ---
  console.log("\n5. Disconnect and user count");
  ws2.close();
  const leftMsg = await waitForMessage(ws1, "USER_LEFT");
  test("Alice receives USER_LEFT when Bob disconnects", !!leftMsg.payload.socketId);

  // --- Test 6: Reconnect ---
  console.log("\n6. Reconnect");
  const ws3 = await connect("client-b-reconnect", roomId, "Bob-2");
  const reinit = await waitForMessage(ws3, "INIT");
  test("Reconnect: Bob-2 INIT lists Alice", reinit.payload.users.length === 1 && reinit.payload.users[0].username === "Alice");
  const rejoined = await waitForMessage(ws1, "USER_JOINED");
  test("Reconnect: Alice sees USER_JOINED", rejoined.payload.user.username === "Bob-2");

  // Cleanup
  ws1.close();
  ws3.close();

  // --- Summary ---
  console.log("\n=== Results ===");
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`  ${passed} passed, ${failed} failed, ${results.length} total\n`);

  if (failed > 0) {
    console.log("Failed tests:");
    results.filter((r) => !r.passed).forEach((r) => {
      console.log(`  ❌ ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
    });
  }

  process.exit(failed > 0 ? 1 : 0);
}

runE2ETest().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
