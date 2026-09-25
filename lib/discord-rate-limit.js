export function discordRetryAfterMs(body, headers) {
  const seconds = Number(body?.retry_after ?? headers?.get?.('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(2_147_000_000, Math.max(1_000, Math.ceil(seconds * 1000))) : 30_000;
}

// One queue per bot token keeps simultaneous template executions from making
// unbounded Discord API requests. Discord's own 429 and reset headers always
// take precedence over the conservative local dispatch rate.
export function createDiscordRequestGate({ request = fetch, requestsPerSecond = 8, concurrency = 2, globalRequestsPerSecond = 20, globalConcurrency = 4, maxPending = 500, maxTotalPending = 600, maxWaitMs = 30_000 } = {}) {
  const buckets = new Map();
  const intervalMs = Math.ceil(1_000 / requestsPerSecond);
  const globalIntervalMs = Math.ceil(1_000 / globalRequestsPerSecond);
  const global = { active: 0, nextAt: 0, pending: 0 };
  let lastSweep = 0;
  const unavailable = (status, retryMs, message) => new Response(JSON.stringify({ message }), {
    status,
    headers: { 'content-type': 'application/json', 'retry-after': String(Math.max(1, Math.ceil(retryMs / 1_000))) },
  });

  function pump(bucket) {
    if (bucket.timer) { clearTimeout(bucket.timer); bucket.timer = null; }
    while (bucket.active < concurrency && global.active < globalConcurrency && bucket.jobs.length) {
      const now = Date.now();
      let readyIndex = -1;
      let nextDelay = Infinity;
      for (let index = 0; index < bucket.jobs.length; index++) {
        const job = bucket.jobs[index];
        if (bucket.authUntil > now) {
          bucket.jobs.splice(index--, 1); global.pending--;
          job.resolve(unavailable(401, bucket.authUntil - now, 'رمز البوت غير صالح. أعد ربط البوت من إعدادات السيرفر.'));
          continue;
        }
        const invalidUntil = bucket.invalidUntil.get(job.route) || 0;
        if (invalidUntil > now) {
          bucket.jobs.splice(index--, 1); global.pending--;
          job.resolve(unavailable(403, invalidUntil - now, 'أوقفنا تكرار طلب رفضه Discord. راجع بيانات القالب وصلاحيات البوت قبل إعادة المحاولة.'));
          continue;
        }
        const delayMs = Math.max(0, bucket.nextAt - now, global.nextAt - now, bucket.globalUntil - now, (bucket.routes.get(job.route) || 0) - now);
        if (delayMs > job.deadline - now) {
          bucket.jobs.splice(index--, 1);
          global.pending--;
          job.resolve(unavailable(429, delayMs, 'Discord حدّد عدد الطلبات مؤقتًا. أعد المحاولة بعد انتهاء المهلة.'));
        } else if (delayMs === 0 && readyIndex < 0) readyIndex = index;
        else nextDelay = Math.min(nextDelay, delayMs);
      }
      if (readyIndex < 0) {
        if (bucket.jobs.length && Number.isFinite(nextDelay)) bucket.timer = setTimeout(() => pump(bucket), Math.max(1, nextDelay));
        return;
      }
      const [job] = bucket.jobs.splice(readyIndex, 1);
      global.pending--;
      bucket.nextAt = now + intervalMs;
      global.nextAt = now + globalIntervalMs;
      bucket.active++;
      global.active++;
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
          if (response.status === 401) bucket.authUntil = Math.max(bucket.authUntil, Date.now() + 600_000);
          if ([400, 403, 404].includes(response.status)) {
            const previous = bucket.invalidCounts.get(job.route);
            const count = previous && previous.until > Date.now() ? previous.count + 1 : 1;
            bucket.invalidCounts.set(job.route, { count, until: Date.now() + 120_000 });
            if (count >= 3) bucket.invalidUntil.set(job.route, Date.now() + 300_000);
          } else if (response.ok) { bucket.invalidCounts.delete(job.route); bucket.invalidUntil.delete(job.route); }
          job.resolve(response);
        } catch (error) { job.reject(error); }
        finally { bucket.active--; global.active--; bucket.lastUsed = Date.now(); for (const waiting of buckets.values()) if (waiting.jobs.length) pump(waiting); }
      })();
    }
    if (bucket.jobs.length && bucket.active < concurrency) bucket.timer = setTimeout(() => pump(bucket), Math.max(1, bucket.nextAt - Date.now()));
  }

  return (key, route, url, options) => {
    const now = Date.now();
    if (now - lastSweep > 600_000) {
      lastSweep = now;
      for (const [entryKey, entry] of buckets) {
        if (!entry.active && !entry.jobs.length && now - entry.lastUsed > 1_800_000) {
          if (entry.timer) clearTimeout(entry.timer);
          buckets.delete(entryKey);
          continue;
        }
        for (const [entryRoute, until] of entry.routes) if (until <= now) entry.routes.delete(entryRoute);
        for (const [entryRoute, until] of entry.invalidUntil) if (until <= now) entry.invalidUntil.delete(entryRoute);
        for (const [entryRoute, state] of entry.invalidCounts) if (state.until <= now) entry.invalidCounts.delete(entryRoute);
      }
    }
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { jobs: [], active: 0, nextAt: 0, globalUntil: 0, authUntil: 0, routes: new Map(), invalidCounts: new Map(), invalidUntil: new Map(), timer: null, lastUsed: now };
      buckets.set(key, bucket);
    }
    bucket.lastUsed = now;
    if (bucket.jobs.length >= maxPending || global.pending >= maxTotalPending) return Promise.resolve(unavailable(503, maxWaitMs, 'طلبات Discord كثيرة الآن. أعد المحاولة بعد قليل.'));
    return new Promise((resolve, reject) => {
      bucket.jobs.push({ route, url, options, resolve, reject, deadline: Date.now() + maxWaitMs });
      global.pending++;
      pump(bucket);
    });
  };
}
