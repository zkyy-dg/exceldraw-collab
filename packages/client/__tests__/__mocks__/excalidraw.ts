/**
 * Mock for @excalidraw/excalidraw
 *
 * Provides minimal stubs for all exports used by the application code.
 */

export function reconcileElements(
  localElements: any[],
  remoteElements: any[],
  _appState: any
): any[] {
  // Simple merge: remote wins on ID collision, local-only kept
  const remoteMap = new Map(remoteElements.map((el: any) => [el.id, el]));
  const result: any[] = [];

  // Add all local elements, but override with remote if same ID
  for (const el of localElements) {
    if (remoteMap.has(el.id)) {
      result.push(remoteMap.get(el.id));
      remoteMap.delete(el.id);
    } else {
      result.push(el);
    }
  }

  // Add remaining remote-only elements
  for (const el of remoteMap.values()) {
    result.push(el);
  }

  return result;
}

// Mock Excalidraw component
export function Excalidraw(_props: any) {
  return null;
}

// Mock CSS import — no-op
export {};
