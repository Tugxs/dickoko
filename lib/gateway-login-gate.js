// Space gateway logins across all bots in this process. A deployment can
// restore many customer bots at once, but must not burst /gateway/bot.
export function createGatewayLoginGate({ minimumSpacingMs = 4_000 } = {}) {
  let previous = Promise.resolve();
  let nextAt = 0;
  return () => {
    const slot = previous.then(async () => {
      const delay = Math.max(0, nextAt - Date.now());
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      nextAt = Date.now() + minimumSpacingMs;
    });
    previous = slot.catch(() => {});
    return slot;
  };
}

export const waitForGatewayLoginSlot = createGatewayLoginGate();

