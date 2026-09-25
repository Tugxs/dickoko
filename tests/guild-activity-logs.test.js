import test from 'node:test';
import assert from 'node:assert/strict';
import { activityLogDestinations } from '../lib/guild-activity-logs.js';

test('unified logs include source channels but never loop into their destination', () => {
  const config = { mode: 'unified', events: ['message_create'], targetId: 'all-logs' };
  assert.deepEqual(activityLogDestinations(config, 'message_create', 'general'), ['all-logs']);
  assert.deepEqual(activityLogDestinations(config, 'message_create', 'all-logs'), []);
  assert.deepEqual(activityLogDestinations(config, 'voice_join', 'general'), []);
});

test('routed logs combine multiple sources, deduplicate destinations and keep other rooms separate', () => {
  const config = { mode: 'routed', events: ['message_delete'], routes: [
    { sourceIds: ['general', 'memes'], targetId: 'chat-logs' },
    { sourceIds: ['general'], targetId: 'chat-logs' },
    { sourceIds: ['voice'], targetId: 'voice-logs' },
  ] };
  assert.deepEqual(activityLogDestinations(config, 'message_delete', 'general'), ['chat-logs']);
  assert.deepEqual(activityLogDestinations(config, 'message_delete', 'memes'), ['chat-logs']);
  assert.deepEqual(activityLogDestinations(config, 'message_delete', 'voice'), ['voice-logs']);
  assert.deepEqual(activityLogDestinations(config, 'message_delete', 'other'), []);
});
