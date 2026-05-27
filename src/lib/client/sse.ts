export async function* parseSSE(response: Response): AsyncGenerator<unknown, void, void> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf("\n\n");
      while (idx !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLines = raw
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart());
        if (dataLines.length) {
          const payload = dataLines.join("\n");
          try {
            yield JSON.parse(payload);
          } catch {
            // ignore malformed chunk
          }
        }
        idx = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}
