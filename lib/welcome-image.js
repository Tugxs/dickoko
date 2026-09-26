import zlib from 'node:zlib';

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, checksum]);
}

function paeth(left, above, upperLeft) {
  const target = left + above - upperLeft;
  const a = Math.abs(target - left), b = Math.abs(target - above), c = Math.abs(target - upperLeft);
  return a <= b && a <= c ? left : b <= c ? above : upperLeft;
}

export function decodeWelcomePng(input, maxPixels = 2_000_000) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (!bytes.subarray(0, 8).equals(signature)) throw Error('صورة PNG غير صالحة.');
  let offset = 8, width = 0, height = 0, colorType = 0, bitDepth = 0, palette = null, transparency = null;
  const compressed = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > bytes.length) throw Error('بيانات صورة PNG غير مكتملة.');
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== bytes.readUInt32BE(offset + 8 + length)) throw Error('صورة PNG تالفة.');
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      if (!width || !height || width * height > maxPixels || bitDepth !== 8 || ![0, 2, 3, 4, 6].includes(colorType) || data[12] !== 0) throw Error('مقاس أو صيغة الصورة غير مدعومة.');
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') transparency = data;
    else if (type === 'IDAT') compressed.push(data);
    else if (type === 'IEND') break;
    offset = end;
  }
  if (!width || !compressed.length) throw Error('صورة PNG ناقصة.');
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[colorType];
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(compressed), { maxOutputLength: (stride + 1) * height });
  if (raw.length !== (stride + 1) * height) throw Error('بيانات الصورة غير متوقعة.');
  const pixels = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride), rowOffset = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rowOffset++];
    if (filter > 4) throw Error('فلتر PNG غير صالح.');
    const row = Buffer.from(raw.subarray(rowOffset, rowOffset + stride)); rowOffset += stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0;
      const above = previous[x];
      const upperLeft = x >= channels ? previous[x - channels] : 0;
      row[x] = (row[x] + (filter === 1 ? left : filter === 2 ? above : filter === 3 ? Math.floor((left + above) / 2) : filter === 4 ? paeth(left, above, upperLeft) : 0)) & 255;
    }
    for (let x = 0; x < width; x++) {
      const source = x * channels, target = (y * width + x) * 4;
      if (colorType === 6) { row.copy(pixels, target, source, source + 4); continue; }
      if (colorType === 2) { row.copy(pixels, target, source, source + 3); pixels[target + 3] = 255; continue; }
      if (colorType === 4) { pixels.fill(row[source], target, target + 3); pixels[target + 3] = row[source + 1]; continue; }
      if (colorType === 0) { pixels.fill(row[source], target, target + 3); pixels[target + 3] = 255; continue; }
      const paletteOffset = row[source] * 3;
      if (!palette || paletteOffset + 2 >= palette.length) throw Error('ألوان PNG غير صالحة.');
      pixels[target] = palette[paletteOffset]; pixels[target + 1] = palette[paletteOffset + 1]; pixels[target + 2] = palette[paletteOffset + 2]; pixels[target + 3] = transparency?.[row[source]] ?? 255;
    }
    previous = row;
  }
  return { width, height, pixels };
}

export function encodeWelcomePng({ width, height, pixels }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

export function composeWelcomeImage(backgroundBytes, avatarBytes, { position = 'right', vertical = 50, radius = 95 } = {}) {
  const background = decodeWelcomePng(backgroundBytes, 1200 * 480);
  const avatar = decodeWelcomePng(avatarBytes, 1024 * 1024);
  if (background.width !== 1200 || background.height !== 480) throw Error('مقاس تصميم الترحيب يجب أن يكون 1200×480.');
  if (!['left', 'center', 'right'].includes(position)) throw Error('موضع صورة العضو غير صالح.');
  const r = Math.round(Math.min(160, Math.max(60, Number(radius) || 95)));
  const centerX = position === 'left' ? 185 : position === 'center' ? 600 : 1015;
  const centerY = Math.round(480 * Math.min(85, Math.max(15, Number(vertical) || 50)) / 100);
  const pixels = Buffer.from(background.pixels);
  const ring = 9;
  for (let y = Math.max(0, centerY - r - ring); y <= Math.min(479, centerY + r + ring); y++) {
    for (let x = Math.max(0, centerX - r - ring); x <= Math.min(1199, centerX + r + ring); x++) {
      const distance = Math.hypot(x - centerX, y - centerY);
      const target = (y * 1200 + x) * 4;
      if (distance >= r && distance <= r + ring) {
        pixels[target] = 190; pixels[target + 1] = 159; pixels[target + 2] = 255; pixels[target + 3] = 255;
      } else if (distance < r) {
        const sourceX = Math.min(avatar.width - 1, Math.max(0, Math.floor((x - centerX + r) * avatar.width / (2 * r))));
        const sourceY = Math.min(avatar.height - 1, Math.max(0, Math.floor((y - centerY + r) * avatar.height / (2 * r))));
        const source = (sourceY * avatar.width + sourceX) * 4;
        const alpha = avatar.pixels[source + 3] / 255;
        for (let color = 0; color < 3; color++) pixels[target + color] = Math.round(avatar.pixels[source + color] * alpha + pixels[target + color] * (1 - alpha));
        pixels[target + 3] = 255;
      }
    }
  }
  return encodeWelcomePng({ width: 1200, height: 480, pixels });
}

export async function validateWelcomeGif(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (!['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) throw Error('ملف GIF غير صالح.');
  let metadata;
  try {
    const sharp = (await import('sharp')).default;
    metadata = await sharp(bytes, { animated: true, limitInputPixels: 100_000_000 }).metadata();
  } catch {
    throw Error('تعذر قراءة GIF. تحقق من سلامة الملف أو اختر GIF آخر.');
  }
  const frames = metadata.pages || 1;
  const frameHeight = metadata.pageHeight || metadata.height;
  if (!metadata.width || !frameHeight) throw Error('تعذر قراءة أبعاد GIF. جرّب ملفًا آخر.');
  if (frames > 100 || metadata.width * frameHeight * frames > 60_000_000) {
    throw Error('هذا GIF يتجاوز حد دمج صورة العضو (100 إطار أو 60 مليون بكسل عبر الإطارات). قلّل مدة GIF أو أبعاده، أو أوقف خيار وضع صورة العضو داخل التصميم لعرض GIF كما هو.');
  }
  return metadata;
}

export async function composeWelcomeGif(backgroundBytes, avatarBytes, options = {}, logoOverlayBytes = null) {
  await validateWelcomeGif(backgroundBytes);
  const transparent = logoOverlayBytes || encodeWelcomePng({ width: 1200, height: 480, pixels: Buffer.alloc(1200 * 480 * 4) });
  const overlay = composeWelcomeImage(transparent, avatarBytes, options);
  const sharp = (await import('sharp')).default;
  // Tiling a full-frame transparent layer places the avatar on every animation frame.
  const output = await sharp(backgroundBytes, { animated: true, limitInputPixels: 100_000_000 })
    .resize(1200, 480, { fit: 'cover' })
    .composite([{ input: overlay, tile: true, blend: 'over' }])
    .gif({ effort: 3, reuse: false, interFrameMaxError: 8 })
    .toBuffer();
  if (output.length > 20 * 1024 * 1024) throw Error('GIF الناتج يتجاوز 20 ميجابايت. استخدم تصميمًا أقصر أو أبسط.');
  return output;
}
