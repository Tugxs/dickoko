import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeEventPayload, nativeEventCover } from '../lib/native-events.js';

const voiceId = '123456789012345678';
const stageId = '223456789012345678';
const channels = [{ id: voiceId, type: 2 }, { id: stageId, type: 13 }];
const startTime = '2026-10-01T18:00:00.000Z', endTime = '2026-10-01T19:00:00.000Z';
const base = { title: 'لقاء مجتمعنا', description: 'نلتقي ونتحدث عن القادم.', startTime, endTime };
const now = new Date('2026-09-24T00:00:00Z').getTime();

test('native Discord event uses voice, stage or external fields exactly as required', () => {
  const voice = nativeEventPayload({ ...base, locationType: 'voice', channelId: voiceId }, channels, now);
  assert.equal(voice.entity_type, 2); assert.equal(voice.channel_id, voiceId); assert.equal(voice.entity_metadata, undefined);
  const stage = nativeEventPayload({ ...base, locationType: 'stage', channelId: stageId }, channels, now);
  assert.equal(stage.entity_type, 1); assert.equal(stage.channel_id, stageId);
  const external = nativeEventPayload({ ...base, locationType: 'elsewhere', location: 'https://example.com/meet', recurrence: 'weekly' }, channels, now);
  assert.equal(external.entity_type, 3); assert.equal(external.channel_id, undefined); assert.deepEqual(external.entity_metadata, { location: 'https://example.com/meet' });
  assert.equal(external.recurrence_rule.frequency, 2); assert.equal(external.privacy_level, 2);
});

test('native event refuses wrong channel type, missing location and invalid dates', () => {
  assert.throws(() => nativeEventPayload({ ...base, locationType: 'voice', channelId: stageId }, channels, now), /قناة/);
  assert.throws(() => nativeEventPayload({ ...base, locationType: 'elsewhere', location: '' }, channels, now), /مكان/);
  assert.throws(() => nativeEventPayload({ ...base, locationType: 'voice', channelId: voiceId, endTime: startTime }, channels, now), /نهاية/);
  assert.throws(() => nativeEventPayload({ ...base, locationType: 'voice', channelId: voiceId, startTime: '2026-09-23T00:00:00Z' }, channels, now), /مستقبلية/);
});

test('native event cover accepts image bytes and rejects forged image type', () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  assert.match(nativeEventCover({ mime: 'image/png', base64: png.toString('base64') }), /^data:image\/png;base64,/);
  const gif = Buffer.from('GIF89a\0\0');
  assert.match(nativeEventCover({ mime: 'image/gif', base64: gif.toString('base64') }), /^data:image\/gif;base64,/);
  assert.throws(() => nativeEventCover({ mime: 'image/gif', base64: Buffer.from('not a gif').toString('base64') }), /غير صالحة/);
  assert.throws(() => nativeEventCover({ mime: 'image/png', base64: Buffer.from('not a png').toString('base64') }), /غير صالحة/);
});
