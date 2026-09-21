# Unified workspace release

## Product
- One server entry point and a standalone Studio document; removes three competing legacy Studio controllers.
- Arabic responsive navigation, truthful connection/readability states, retriable loading failures.
- Live channels/categories/roles with staged additions, renaming, category moves, and role colors. No permission escalation or deletion from the editor.
- Guild- and account-scoped device drafts, persisted change plans, explicit Discord application confirmation, operation-level results.
- Actual bot command settings (`/diskoko help`, `ping`, `about`) and server-owned log channel validation.
- Scheduled announcements with approval, cancellation, status and errors; mentions suppressed. Daily/weekly repetition uses fixed intervals.
- Opt-in message-count analytics (no message content), active members/channels, 7/14/30 day views and JSON export.
- Permission review, read-only structure export, per-user operation history.

## Reliability
- Discord errors are not converted into empty server lists; bot online state reflects gateway connectivity.
- Serialize token refresh; include Discord Administrator users among manageable servers.
- Change creation is transactional. Guild-scoped database advisory locks serialize application. Retries retain original immutable plan inputs and completed category references.
- Schedules use database claims; ambiguous interrupted deliveries are failed for manual review, never blindly replayed.
- Analytics retention is 30 UTC calendar days; counts start only after opt-in. Requires standard GuildMessages events, not MessageContent intent.

## Validation
`npm ci`, `npm run check`, `npm test` (22 initial regression tests for domain, API application and DOM journeys).
`node tests/preview.js` starts a localhost-only fixture preview. Production never mounts fixture APIs; `/tests`, `/lib`, `/scripts` are blocked from static serving.

## Deployment notes
Existing Render service and database are reused. Three additive tables are created at startup; no existing data is dropped. No secrets or hosting-plan changes.
The existing free Render web service can sleep; scheduled delivery and event collection are best-effort while it is awake. The UI explains possible delivery delays. Do not promise uninterrupted scheduling without always-on hosting.
No live Discord mutations, outgoing messages, or analytics opt-ins are part of deployment verification.

## Rollback
Redeploy the previous commit on Render if needed. New tables are additive and can remain; older code does not use them. Preserve any queued jobs and explain their paused execution before re-enabling a newer release.
