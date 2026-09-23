import test from 'node:test';
import assert from 'node:assert/strict';
import { selectAiKnowledge } from '../scripts/ai-knowledge.mjs';

test('local AI receives the relevant real workflow without flooding every request', () => {
  const support = selectAiKnowledge('سوي لوحة تذاكر دعم ببطاقة وصورة');
  assert.match(support, /قناة خاصة/);
  assert.match(support, /بنر ثم عنوان/);
  assert.doesNotMatch(support, /مشاركة جيف آواي، تصويت، أو تنزيل.*بطاقة الملف/s);
  const file = selectAiKnowledge('خل الملف PDF يطلع زر تحميل');
  assert.match(file, /رابط مرفق Discord صالحًا/);
  assert.doesNotMatch(file, /ألعاب تفاعلية/);
});
