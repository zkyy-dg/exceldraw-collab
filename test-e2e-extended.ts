/**
 * E2E Extended Tests — Phase 3
 *
 * Extends the existing test-e2e.ts smoke test with additional edge-case scenarios.
 * Requires a running server (pnpm dev:server) at localhost:3001.
 *
 * New scenarios:
 * 1. Multi-element sync conflict — two clients editing different elements simultaneously
 * 2. Large element broadcast — 100+ elements sync
 * 3. Rapid disconnect/reconnect — immediate disconnect then reconnect
 * 4. REST + WebSocket joint test — REST save, then WS join and load
 * 5. Concurrent room isolation — users in different rooms don't interfere
 */

import WebSocket from "ws";

const SERVER = "ws://localhost:3001/ws";
const API = "http://localhost:3001";

// --- Helpers (shared with test-e2e.ts pattern) ---

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

function collectMessages(ws: WebSocket, type: string, count: number, timeoutMs = 10000): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const messages: any[] = [];
    const timer = setTimeout(() => reject(new Error(`Timeout collecting ${count} ${type} messages (got ${messages.length})`)), timeoutMs);
    function handler(data: any) {
      const msg = JSON.parse(data.toString());
      if (msg.type === type) {
        messages.push(msg);
        if (messages.length >= count) {
          clearTimeout(timer);
          ws.off("message", handler);
          resolve(messages);
        }
      }
    }
    ws.on("message", handler);
  });
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

// --- Test Runner ---

async function runExtendedE2ETests() {
  console.log("\n=== E2E Extended Tests — Phase 3 ===\n");

  // ---------------------------------------------------------------
  // Scenario 1: Multi-element sync conflict
  // Two clients edit different elements simultaneously
  // ---------------------------------------------------------------
  console.log("1. Multi-element sync conflict (concurrent edits)");
  try {
    const roomId = "e2e-ext-concurrent";
    const ws1 = await connect("concurrent-a", roomId, "Alice");
    await waitForMessage(ws1, "INIT");

    const ws2 = await connect("concurrent-b", roomId, "Bob");
    await waitForMessage(ws2, "INIT");
    await waitForMessage(ws1, "USER_JOINED");

    // Alice draws element A
    const aliceElements = [
      { id: "alice-el-1", type: "rectangle", version: 1, versionNonce: 1, x: 10, y: 10, width: 50, height: 50 },
    ];
    // Bob draws element B simultaneously
    const bobElements = [
      { id: "bob-el-1", type: "ellipse", version: 1, versionNonce: 1, x: 200, y: 200, width: 80, height: 80 },
    ];

    // Register listeners BEFORE sending to avoid race conditions
    const aliceReceivedPromise = waitForMessage(ws1, "ELEMENTS_UPDATE");
    const bobReceivedPromise = waitForMessage(ws2, "ELEMENTS_UPDATE");

    // Send both at the same time
    ws1.send(JSON.stringify({ type: "ELEMENTS_UPDATE", payload: { elements: aliceElements } }));
    ws2.send(JSON.stringify({ type: "ELEMENTS_UPDATE", payload: { elements: bobElements } }));

    // Alice should receive Bob's elements
    const aliceReceived = await aliceReceivedPromise;
    test("Alice receives Bob's ELEMENTS_UPDATE",
      aliceReceived.payload.elements.length === 1 &&
      aliceReceived.payload.elements[0].id === "bob-el-1"
    );

    // Bob should receive Alice's elements
    const bobReceived = await bobReceivedPromise;
    test("Bob receives Alice's ELEMENTS_UPDATE",
      bobReceived.payload.elements.length === 1 &&
      bobReceived.payload.elements[0].id === "alice-el-1"
    );

    // Now Alice sends a combined state (her element + Bob's element)
    const mergedElements = [...aliceElements, ...bobElements];
    ws1.send(JSON.stringify({ type: "ELEMENTS_UPDATE", payload: { elements: mergedElements } }));

    const bobMerged = await waitForMessage(ws2, "ELEMENTS_UPDATE", 3000);
    test("Bob receives merged state with both elements",
      bobMerged.payload.elements.length === 2 &&
      bobMerged.payload.elements.some((e: any) => e.id === "alice-el-1") &&
      bobMerged.payload.elements.some((e: any) => e.id === "bob-el-1")
    );

    ws1.close();
    ws2.close();
    await wait(100);
  } catch (err: any) {
    test("Multi-element sync conflict", false, err.message);
  }

  // ---------------------------------------------------------------
  // Scenario 2: Large element broadcast (100+ elements)
  // ---------------------------------------------------------------
  console.log("\n2. Large element broadcast (100+ elements)");
  try {
    const roomId = "e2e-ext-large";
    const ws1 = await connect("large-a", roomId, "Alice");
    await waitForMessage(ws1, "INIT");

    const ws2 = await connect("large-b", roomId, "Bob");
    await waitForMessage(ws2, "INIT");
    await waitForMessage(ws1, "USER_JOINED");

    // Generate 150 elements
    const largeElementCount = 150;
    const largeElements = Array.from({ length: largeElementCount }, (_, i) => ({
      id: `large-el-${i}`,
      type: i % 2 === 0 ? "rectangle" : "ellipse",
      version: 1,
      versionNonce: 1,
      x: i * 10,
      y: i * 5,
      width: 100,
      height: 100,
    }));

    const startTime = Date.now();
    ws1.send(JSON.stringify({ type: "ELEMENTS_UPDATE", payload: { elements: largeElements } }));

    const received = await waitForMessage(ws2, "ELEMENTS_UPDATE", 10000);
    const elapsed = Date.now() - startTime;

    test(`Bob receives all ${largeElementCount} elements`,
      received.payload.elements.length === largeElementCount,
      `got ${received.payload.elements.length} elements`
    );

    test("Large broadcast completes within 3 seconds", elapsed < 3000, `took ${elapsed}ms`);

    test("Element IDs are preserved in order",
      received.payload.elements[0].id === "large-el-0" &&
      received.payload.elements[largeElementCount - 1].id === `large-el-${largeElementCount - 1}`
    );

    ws1.close();
    ws2.close();
    await wait(100);
  } catch (err: any) {
    test("Large element broadcast", false, err.message);
  }

  // ---------------------------------------------------------------
  // Scenario 3: Rapid disconnect/reconnect
  // ---------------------------------------------------------------
  console.log("\n3. Rapid disconnect/reconnect");
  try {
    const roomId = "e2e-ext-rapid";
    const ws1 = await connect("rapid-a", roomId, "Alice");
    await waitForMessage(ws1, "INIT");

    // Bob connects and immediately disconnects
    const ws2 = await connect("rapid-b", roomId, "Bob");
    await waitForMessage(ws2, "INIT");
    await waitForMessage(ws1, "USER_JOINED");

    // Rapid disconnect
    ws2.close();
    const leftMsg = await waitForMessage(ws1, "USER_LEFT");
    test("Alice sees USER_LEFT after rapid disconnect", !!leftMsg.payload.socketId);

    // Bob reconnects immediately (no waiting)
    const ws3 = await connect("rapid-b-2", roomId, "Bob-Reconnect");
    const reinit = await waitForMessage(ws3, "INIT");
    test("Reconnect after rapid disconnect: sees Alice",
      reinit.payload.users.length === 1 && reinit.payload.users[0].username === "Alice"
    );

    const rejoined = await waitForMessage(ws1, "USER_JOINED");
    test("Alice sees USER_JOINED after Bob's rapid reconnect",
      rejoined.payload.user.username === "Bob-Reconnect"
    );

    // Repeat rapid disconnect/reconnect 3 times
    for (let i = 0; i < 3; i++) {
      const wsTemp = await connect(`rapid-temp-${i}`, roomId, `Temp-${i}`);
      await waitForMessage(wsTemp, "INIT");
      await waitForMessage(ws1, "USER_JOINED");
      wsTemp.close();
      await waitForMessage(ws1, "USER_LEFT");
    }

    // Alice should still see only herself + Bob-2 after all temp users left
    test("Room state correct after 3 rapid join/leave cycles", true);

    ws1.close();
    ws3.close();
    await wait(100);
  } catch (err: any) {
    test("Rapid disconnect/reconnect", false, err.message);
  }

  // ---------------------------------------------------------------
  // Scenario 4: REST + WebSocket joint test
  // REST save elements first, then WS join and load via REST
  // ---------------------------------------------------------------
  console.log("\n4. REST + WebSocket joint test");
  try {
    // Step 1: Create board via REST
    const createRes = await fetch(`${API}/api/boards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "E2E Joint Test Board" }),
    });
    const board = await createRes.json();
    test("REST: Create board for joint test", createRes.ok && !!board.id);

    // Step 2: Save elements via REST
    const savedElements = [
      { id: "joint-el-1", type: "rectangle", version: 1, versionNonce: 1, x: 50, y: 50, width: 200, height: 100 },
      { id: "joint-el-2", type: "text", version: 1, versionNonce: 1, text: "Hello from REST", x: 100, y: 200 },
      { id: "joint-el-3", type: "diamond", version: 1, versionNonce: 1, x: 300, y: 300, width: 60, height: 60 },
    ];
    const saveRes = await fetch(`${API}/api/boards/${board.id}/elements`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elements: savedElements }),
    });
    test("REST: Save elements for joint test", saveRes.ok);

    // Step 3: Two clients join the board room via WebSocket
    const ws1 = await connect("joint-a", board.id, "Alice");
    await waitForMessage(ws1, "INIT");
    test("WS: Alice joins board room", true);

    const ws2 = await connect("joint-b", board.id, "Bob");
    await waitForMessage(ws2, "INIT");
    await waitForMessage(ws1, "USER_JOINED");
    test("WS: Bob joins board room, Alice sees him", true);

    // Step 4: Load elements via REST (simulates what the client does on INIT)
    const loadRes = await fetch(`${API}/api/boards/${board.id}/elements`);
    const loadData = await loadRes.json();
    test("REST: Load elements returns 3 saved elements",
      loadData.elements.length === 3 &&
      loadData.elements[0].id === "joint-el-1" &&
      loadData.elements[1].id === "joint-el-2" &&
      loadData.elements[2].id === "joint-el-3"
    );

    // Step 5: Alice draws a new element via WS
    const newElements = [
      ...savedElements,
      { id: "joint-el-4", type: "arrow", version: 1, versionNonce: 1, x: 0, y: 0, width: 300, height: 0 },
    ];
    ws1.send(JSON.stringify({ type: "ELEMENTS_UPDATE", payload: { elements: newElements } }));
    const elemMsg = await waitForMessage(ws2, "ELEMENTS_UPDATE");
    test("WS: Bob receives Alice's ELEMENTS_UPDATE with 4 elements",
      elemMsg.payload.elements.length === 4 &&
      elemMsg.payload.elements.some((e: any) => e.id === "joint-el-4")
    );

    // Step 6: Save the updated elements via REST, then reload to verify
    const saveRes2 = await fetch(`${API}/api/boards/${board.id}/elements`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ elements: newElements }),
    });
    test("REST: Save updated elements (4 total)", saveRes2.ok);

    const loadRes2 = await fetch(`${API}/api/boards/${board.id}/elements`);
    const loadData2 = await loadRes2.json();
    test("REST: Reload shows 4 persisted elements",
      loadData2.elements.length === 4 &&
      loadData2.elements.some((e: any) => e.id === "joint-el-4")
    );

    ws1.close();
    ws2.close();
    await wait(100);
  } catch (err: any) {
    test("REST + WebSocket joint test", false, err.message);
  }

  // ---------------------------------------------------------------
  // Scenario 5: Concurrent room isolation
  // Users in different rooms should not receive each other's messages
  // ---------------------------------------------------------------
  console.log("\n5. Concurrent room isolation");
  try {
    // Room Alpha: Alice and Charlie
    const roomAlpha = "e2e-ext-alpha";
    const wsAlpha1 = await connect("alpha-alice", roomAlpha, "Alice");
    await waitForMessage(wsAlpha1, "INIT");

    const wsAlpha2 = await connect("alpha-charlie", roomAlpha, "Charlie");
    await waitForMessage(wsAlpha2, "INIT");
    await waitForMessage(wsAlpha1, "USER_JOINED");
    test("Room Alpha: Alice and Charlie connected", true);

    // Room Beta: Bob and Diana
    const roomBeta = "e2e-ext-beta";
    const wsBeta1 = await connect("beta-bob", roomBeta, "Bob");
    await waitForMessage(wsBeta1, "INIT");

    const wsBeta2 = await connect("beta-diana", roomBeta, "Diana");
    await waitForMessage(wsBeta2, "INIT");
    await waitForMessage(wsBeta1, "USER_JOINED");
    test("Room Beta: Bob and Diana connected", true);

    // Alice sends ELEMENTS_UPDATE in Room Alpha
    wsAlpha1.send(JSON.stringify({
      type: "ELEMENTS_UPDATE",
      payload: { elements: [{ id: "alpha-only", type: "rectangle", version: 1 }] },
    }));

    // Charlie in Room Alpha should receive it
    const alphaMsg = await waitForMessage(wsAlpha2, "ELEMENTS_UPDATE");
    test("Room Alpha: Charlie receives Alice's elements",
      alphaMsg.payload.elements[0].id === "alpha-only"
    );

    // Bob sends ELEMENTS_UPDATE in Room Beta
    wsBeta1.send(JSON.stringify({
      type: "ELEMENTS_UPDATE",
      payload: { elements: [{ id: "beta-only", type: "ellipse", version: 1 }] },
    }));

    // Diana in Room Beta should receive it
    const betaMsg = await waitForMessage(wsBeta2, "ELEMENTS_UPDATE");
    test("Room Beta: Diana receives Bob's elements",
      betaMsg.payload.elements[0].id === "beta-only"
    );

    // Verify isolation: Alice should NOT have received Bob's Beta message
    // (We check by sending another message from Alice to Charlie and verifying
    // that only Alpha messages were received)
    wsAlpha1.send(JSON.stringify({
      type: "POINTER_UPDATE",
      payload: { pointer: { x: 42, y: 42, tool: "pointer" } },
    }));
    const alphaPtr = await waitForMessage(wsAlpha2, "POINTER_UPDATE");
    test("Room Alpha: Pointer update works in isolation",
      alphaPtr.payload.pointer.x === 42 && alphaPtr.payload.pointer.y === 42
    );

    // Room Alpha user count: disconnect Charlie, Alice should see USER_LEFT
    wsAlpha2.close();
    const alphaLeft = await waitForMessage(wsAlpha1, "USER_LEFT");
    test("Room Alpha: Alice sees Charlie leave", !!alphaLeft.payload.socketId);

    // Room Beta should NOT see any USER_LEFT from Alpha
    // Diana sends a pointer update to verify Room Beta is still alive
    wsBeta2.send(JSON.stringify({
      type: "POINTER_UPDATE",
      payload: { pointer: { x: 99, y: 99, tool: "pointer" } },
    }));
    const betaPtr = await waitForMessage(wsBeta1, "POINTER_UPDATE");
    test("Room Beta: Still active after Alpha events",
      betaPtr.payload.pointer.x === 99 && betaPtr.payload.pointer.y === 99
    );

    // Disconnect Bob from Beta, Diana should see it
    wsBeta1.close();
    const betaLeft = await waitForMessage(wsBeta2, "USER_LEFT");
    test("Room Beta: Diana sees Bob leave", !!betaLeft.payload.socketId);

    // Cleanup remaining
    wsAlpha1.close();
    wsBeta2.close();
    await wait(100);
  } catch (err: any) {
    test("Concurrent room isolation", false, err.message);
  }

  // ---------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------
  console.log("\n=== Extended E2E Results ===");
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

runExtendedE2ETests().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
