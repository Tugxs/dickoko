import test from 'node:test';
import assert from 'node:assert/strict';
import { composeWelcomeGif, composeWelcomeImage, decodeWelcomePng, encodeWelcomePng } from '../lib/welcome-image.js';

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

test('animated welcome keeps one centered avatar within every GIF frame', async () => {
  const sharp = (await import('sharp')).default;
  const background = await sharp([
    solid(120, 48, [20, 30, 90]),
    solid(120, 48, [20, 90, 30]),
  ], { join: { animated: true } }).gif({ delay: [100, 100] }).toBuffer();
  const avatar = solid(16, 16, [220, 30, 40]);
  const result = await composeWelcomeGif(background, avatar, { position: 'center', vertical: 50, radius: 80 });
  const metadata = await sharp(result, { animated: true }).metadata();
  assert.equal(metadata.pages, 2);
  for (let page = 0; page < 2; page++) {
    const { data, info } = await sharp(result, { page }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 1200);
    assert.equal(info.height, 480);
    const pixel = (x, y) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    const center = pixel(600, 240);
    assert.ok(center[0] > center[1] * 2 && center[0] > center[2] * 2, `avatar missing at center of frame ${page}`);
    for (const y of [20, 460]) {
      const edge = pixel(600, y);
      assert.ok(edge[0] < 100, `avatar repeated at edge of frame ${page}`);
    }
  }
});
