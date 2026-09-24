export function discordRetryAfterMs(body, headers) {
  const seconds = Number(body?.retry_after ?? headers?.get?.('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(3_600_000, Math.max(1_000, Math.ceil(seconds * 1000))) : 30_000;
}
