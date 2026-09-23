import test from 'node:test';
import assert from 'node:assert/strict';
import { composeWelcomeImage, decodeWelcomePng, encodeWelcomePng } from '../lib/welcome-image.js';

function solid(width, height, color) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = color[0]; pixels[index + 1] = color[1]; pixels[index + 2] = color[2]; pixels[index + 3] = 255;
  }
  return encodeWelcomePng({ width, height, pixels });
}

test('welcome compositor places the member avatar in each chosen position', () => {
  const background = solid(1200, 480, [20, 30, 40]);
  const avatar = solid(16, 16, [220, 40, 50]);
  for (const [position, x] of [['left', 185], ['center', 600], ['right', 1015]]) {
    const composed = decodeWelcomePng(composeWelcomeImage(background, avatar, { position, vertical: 45, radius: 105 }));
    assert.deepEqual([...composed.pixels.subarray((216 * 1200 + x) * 4, (216 * 1200 + x) * 4 + 3)], [220, 40, 50]);
    assert.deepEqual([...composed.pixels.subarray(0, 3)], [20, 30, 40]);
  }
});

test('welcome compositor rejects unsupported dimensions and corrupt PNG data', () => {
  assert.throws(() => composeWelcomeImage(solid(100, 100, [1, 2, 3]), solid(16, 16, [4, 5, 6])), /1200×480/);
  const broken = solid(1200, 480, [1, 2, 3]); broken[30] ^= 1;
  assert.throws(() => decodeWelcomePng(broken), /تالفة/);
});
