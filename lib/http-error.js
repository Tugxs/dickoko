export function publicError(error, requestId) {
  const candidate = Number(error?.status);
  const status = Number.isInteger(candidate) && candidate >= 400 && candidate < 600 ? candidate : 500;
  const message = status === 500 ? 'حدث خطأ غير متوقع' : status >= 500 && !error?.expose ? 'الخدمة الخارجية غير متاحة مؤقتًا' : error.message;
  return { status, body: { error: message, requestId, ...(error?.code ? { code: error.code } : {}), ...(error?.capacity ? { capacity: error.capacity } : {}) } };
}
