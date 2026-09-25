export function discordRetryAfterMs(body, headers) {
  const seconds = Number(body?.retry_after ?? headers?.get?.('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(2_147_000_000, Math.max(1_000, Math.ceil(seconds * 1000))) : 30_000;
}

// One queue per bot token keeps simultaneous template executions from making
// unbounded Discord API requests. Discord's own 429 and reset headers always
// take precedence over the conservative local dispatch rate.
export function createDiscordRequestGate({ request = fetch, requestsPerSecond = 8, concurrency = 2, maxPending = 500, maxWaitMs = 30_000 } = {}) {
  const buckets = new Map();
  const intervalMs = Math.ceil(1_000 / requestsPerSecond);
  const unavailable = (status, retryMs, message) => new Response(JSON.stringify({ message }), {
    status,
    headers: { 'content-type': 'application/json', 'retry-after': String(Math.max(1, Math.ceil(retryMs / 1_000))) },
  });

  function pump(bucket) {
    if (bucket.timer) { clearTimeout(bucket.timer); bucket.timer = null; }
    while (bucket.active < concurrency && bucket.jobs.length) {
      const now = Date.now();
      let readyIndex = -1;
      let nextDelay = Infinity;
      for (let index = 0; index < bucket.jobs.length; index++) {
        const job = bucket.jobs[index];
        const delayMs = Math.max(0, bucket.nextAt - now, bucket.globalUntil - now, (bucket.routes.get(job.route) || 0) - now);
        if (delayMs > job.deadline - now) {
          bucket.jobs.splice(index--, 1);
          job.resolve(unavailable(429, delayMs, 'Discord حدّد عدد الطلبات مؤقتًا. أعد المحاولة بعد انتهاء المهلة.'));
        } else if (delayMs === 0 && readyIndex < 0) readyIndex = index;
        else nextDelay = Math.min(nextDelay, delayMs);
      }
      if (readyIndex < 0) {
        if (bucket.jobs.length && Number.isFinite(nextDelay)) bucket.timer = setTimeout(() => pump(bucket), Math.max(1, nextDelay));
        return;
      }
      const [job] = bucket.jobs.splice(readyIndex, 1);
      bucket.nextAt = now + intervalMs;
      bucket.active++;
      void (async () => {
        try {
          const response = await request(job.url, job.options);
          const remaining = response.headers.get('x-ratelimit-remaining');
          if (response.status === 429) {
            const body = await response.clone().json().catch(() => null);
            const waitMs = discordRetryAfterMs(body, response.headers);
            const global = body?.global === true || response.headers.get('x-ratelimit-scope') === 'global';
            if (global) bucket.globalUntil = Math.max(bucket.globalUntil, Date.now() + waitMs);
            else bucket.routes.set(job.route, Math.max(bucket.routes.get(job.route) || 0, Date.now() + waitMs));
            console.warn('Discord API rate limited', { route: job.route, global, retryAfterMs: waitMs });
          } else if (remaining === '0') {
            const resetSeconds = Number(response.headers.get('x-ratelimit-reset-after'));
            if (Number.isFinite(resetSeconds) && resetSeconds > 0) bucket.routes.set(job.route, Date.now() + Math.ceil(resetSeconds * 1_000));
          }
          job.resolve(response);
        } catch (error) { job.reject(error); }
        finally { bucket.active--; pump(bucket); }
      })();
    }
    if (bucket.jobs.length && bucket.active < concurrency) bucket.timer = setTimeout(() => pump(bucket), Math.max(1, bucket.nextAt - Date.now()));
  }

  return (key, route, url, options) => {
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { jobs: [], active: 0, nextAt: 0, globalUntil: 0, routes: new Map(), timer: null };
      buckets.set(key, bucket);
    }
    if (bucket.jobs.length >= maxPending) return Promise.resolve(unavailable(503, maxWaitMs, 'طلبات Discord كثيرة الآن. أعد المحاولة بعد قليل.'));
    return new Promise((resolve, reject) => {
      bucket.jobs.push({ route, url, options, resolve, reject, deadline: Date.now() + maxWaitMs });
      pump(bucket);
    });
  };
}

