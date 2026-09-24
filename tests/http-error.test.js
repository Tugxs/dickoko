import test from 'node:test';
import assert from 'node:assert/strict';
import { publicError } from '../lib/http-error.js';
import { problem } from '../lib/workspace-domain.js';

test('intentional upstream failures keep their status and useful message', () => {
  const result = publicError(problem('تعذر تحميل السيرفرات من Discord مؤقتًا.', 503), 'request-1');
  assert.equal(result.status, 503);
  assert.match(result.body.error, /Discord/);
  assert.equal(result.body.requestId, 'request-1');
});

test('internal failures remain private', () => {
  const result = publicError(new Error('database secret'), 'request-2');
  assert.equal(result.status, 500);
  assert.equal(result.body.error, 'حدث خطأ غير متوقع');
});
