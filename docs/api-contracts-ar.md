# عقود واجهات ديسكوكو الأساسية

هذه العقود تصف السلوك الحالي بعد توحيد الحساب والاستوديو. استخدمها عند تعديل الواجهة أو الخادم، وحدّثها مع أي تغيير في الحقول.

| المسار | الاستجابة الأساسية | ملاحظات |
| --- | --- | --- |
| `GET /api/account/overview` | `user`, `servers`, `projects`, `plan`, `access`, `limits`, `usage`, `alerts`, `invoices`, `plans` | مصدر صفحة الحساب والخطط والاستخدام. |
| `GET /api/workspace/:guildId` | `guild`, `connection`, `bot`, `channels`, `roles`, `members`, `onlineMembers`, `changeSets`, `activity`, `draft`, `preferences` | بيانات السيرفر الحية؛ قد تكون القنوات أو الرتب غير مقروءة ويجب عدم إظهار أدوات تعديل حينها. |
| `GET /api/guilds/:guildId/summary` | `guild`, `connection`, `bot`, `counts`, `usage`, `draft`, `changeSets`, `activity` | أعداد أوامر البوت مأخوذة من `bot_command_daily`، وليس من نصوص رسائل Discord. |
| `GET /api/bots/commands` | `commands[]`, `groups[]` | لا يُعرض كمتاح إلا ما سجّله البوت فعليًا في `lib/bot-catalog.js`. |
| `GET /api/admin/users?page=&q=` | `users[]`, `pagination: {page,pageSize,total,pages}` | البحث في الخادم؛ الصفحة الافتراضية 50 مستخدمًا. |

كل استجابة تحمل ترويسة `X-Request-Id`. الأخطاء غير المتوقعة ترجع `error` و`requestId`، وقد تضيف `code` أو `capacity` عند الحاجة. عدم تسجيل الدخول يرجع 401؛ عدم الصلاحية يرجع 403. طلبات الكتابة تتطلب جلسة صالحة، مصدرًا مسموحًا، وترويسة `X-CSRF-Token`، والتحقق من صلاحية إدارة السيرفر يتم في الخادم قبل القراءة أو التعديل.

مصدر أسعار الخطط وحدودها هو `lib/billing.js`. مصدر الأوامر المتاحة هو `lib/bot-catalog.js`. لا تضف بطاقة ميزة أو أمرًا فعالًا إلى الواجهة قبل وجود مسار تنفيذ واختبار مطابق له.
