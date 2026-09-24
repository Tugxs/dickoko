export function problem(message, status = 400) { return Object.assign(new Error(message), { status, expose: true }); }
export { BOT_COMMAND_KEYS as supportedCommands } from './bot-catalog.js';
export function manageable(guild) {
  const permissions = BigInt(guild.permissions || '0');
  return Boolean(guild.owner || (permissions & 32n) || (permissions & 8n));
}
export function normalizeOperations(input, snapshot) {
  if (!Array.isArray(input) || !input.length || input.length > 100) throw problem('أضف من 1 إلى 100 تغيير في المراجعة.');
  const keys = new Set();
  const plannedCategories = new Map();
  return input.map((item, index) => {
    if (!item || !['category', 'channel', 'role'].includes(item.resource_type)) throw problem('نوع العنصر غير مدعوم.');
    const action = item.action || 'create';
    if (!['create', 'update'].includes(action)) throw problem('هذه العملية غير مدعومة.');
    const name = String(item.name || '').trim();
    if (!name || name.length > 100 || /\[[^\]]+\]/.test(name)) throw problem('اكتب اسم العنصر النهائي دون خانات بين أقواس، بحد أقصى 100 حرف.');
    const op = { operation_key: `edit:${index}`, resource_type: item.resource_type, action, name };
    if (op.resource_type === 'category' && action === 'create') plannedCategories.set(name.toLowerCase(), op.operation_key);
    if (action === 'update') {
      const rows = op.resource_type === 'role' ? snapshot.roles : snapshot.channels;
      const resource = rows.find(row => row.id === String(item.resource_id));
      if (!resource || (op.resource_type === 'category' ? resource.type !== 4 : op.resource_type === 'channel' && resource.type === 4)) throw problem('العنصر لم يعد موجودًا في هذا السيرفر. حدّث البيانات.');
      if (op.resource_type === 'role' && (resource.managed || resource.id === snapshot.guildId)) throw problem('رتبة النظام لا يمكن تعديلها هنا.');
      if (keys.has(resource.id)) throw problem('اجمع تعديل العنصر في تغيير واحد.');
      keys.add(resource.id);
      op.resource_id = resource.id;
      op.before = { name: resource.name };
    }
    if (op.resource_type === 'channel') {
      if (action === 'create') {
        op.type = Number(item.type ?? 0);
        if (![0, 2, 15].includes(op.type)) throw problem('اختر قناة نصية أو صوتية أو منتدى.');
        if (item.access) {
          if (!['read_only', 'staff_only'].includes(item.access)) throw problem('إعداد وصول القناة غير مدعوم.');
          if (item.access === 'read_only' && op.type === 2) throw problem('القراءة فقط متاحة للقنوات النصية والمنتديات.');
          op.access = item.access;
          op.guild_id = snapshot.guildId;
          if (op.access === 'staff_only') {
            const role = snapshot.roles.find(row => row.id === String(item.staff_role_id) && row.id !== snapshot.guildId);
            if (!role) throw problem('اختر رتبة موجودة لقناة الفريق الخاصة.');
            op.staff_role_id = role.id;
          }
        }
        if (item.parent_name) {
          const parentName = String(item.parent_name).trim().toLowerCase();
          const planned = plannedCategories.get(parentName);
          const existing = snapshot.channels.find(row => row.type === 4 && row.name.toLowerCase() === parentName);
          if (planned) op.parent_key = planned;
          else if (existing) op.parent_id = existing.id;
          else throw problem(`التصنيف «${item.parent_name}» غير موجود. ضعه قبل القناة في الخطة.`);
        }
      }
      if (Object.hasOwn(item, 'parent_id')) {
        op.parent_id = item.parent_id || null;
        if (op.parent_id && !snapshot.channels.some(row => row.id === op.parent_id && row.type === 4)) throw problem('التصنيف المختار غير موجود.');
        if (action === 'update') op.before.parent_id = snapshot.channels.find(row => row.id === op.resource_id).parent_id ?? null;
      }
      if (Object.hasOwn(item, 'topic')) {
        const topic = String(item.topic || '').trim();
        if (topic.length > 1024) throw problem('وصف القناة يجب ألا يتجاوز 1024 حرفًا.');
        op.topic = topic || null;
        if (action === 'update') op.before.topic = snapshot.channels.find(row => row.id === op.resource_id).topic ?? null;
      }
      if (Object.hasOwn(item, 'position')) {
        const position = Number(item.position);
        if (!Number.isInteger(position) || position < 0 || position > 500) throw problem('ترتيب القناة غير صالح.');
        op.position = position;
        if (action === 'update') op.before.position = snapshot.channels.find(row => row.id === op.resource_id).position;
      }
    }
    if (op.resource_type === 'role' && Object.hasOwn(item, 'color')) {
      const color = Number(item.color);
      if (!Number.isInteger(color) || color < 0 || color > 0xffffff) throw problem('لون الرتبة غير صالح.');
      op.color = color;
      if (action === 'update') op.before.color = snapshot.roles.find(row => row.id === op.resource_id).color;
    }
    if (op.resource_type === 'role' && Object.hasOwn(item, 'position')) {
      const position = Number(item.position);
      if (!Number.isInteger(position) || position < 1 || position > 500) throw problem('ترتيب الرتبة غير صالح.');
      op.position = position;
      if (action === 'update') op.before.position = snapshot.roles.find(row => row.id === op.resource_id).position;
    }
    return op;
  });
}
export function operationBody(op, parentId) {
  const body = { name: op.name };
  if ((op.action || 'create') === 'create') {
    if (op.resource_type === 'category') body.type = 4;
    else if (op.resource_type === 'channel') body.type = op.type ?? 0;
    else body.mentionable = false;
  }
  if (op.resource_type === 'channel' && (op.parent_key || Object.hasOwn(op, 'parent_id'))) body.parent_id = parentId ?? op.parent_id ?? null;
  if (op.resource_type === 'channel' && op.action === 'create' && op.access === 'read_only') body.permission_overwrites = [{ id: op.guild_id, type: 0, allow: '0', deny: String(PermissionFlagsBits.SendMessages) }];
  if (op.resource_type === 'channel' && op.action === 'create' && op.access === 'staff_only') body.permission_overwrites = [
    { id: op.guild_id, type: 0, allow: '0', deny: String(PermissionFlagsBits.ViewChannel) },
    { id: op.staff_role_id, type: 0, allow: String(PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory | PermissionFlagsBits.SendMessages), deny: '0' },
  ];
  if (op.resource_type === 'channel' && Object.hasOwn(op, 'topic') && (op.type ?? 0) !== 2) body.topic = op.topic;
  if (op.resource_type === 'role' && Object.hasOwn(op, 'color')) body.color = op.color;
  return body;
}
export function resolveExisting(op, snapshot, parentId) {
  const rows = op.resource_type === 'role' ? snapshot.roles : snapshot.channels;
  if (op.action === 'update') return rows.find(row => row.id === op.resource_id);
  const expectedType = op.resource_type === 'category' ? 4 : (op.type ?? 0);
  const matches = rows.filter(row => row.name.toLowerCase() === op.name.toLowerCase()
    && (op.resource_type === 'role' || row.type === expectedType)
    && (op.resource_type !== 'channel' || (row.parent_id ?? null) === (parentId ?? op.parent_id ?? null)));
  if (matches.length > 1) throw problem(`يوجد أكثر من عنصر باسم «${op.name}». راجع الأسماء قبل المتابعة.`, 409);
  return matches[0];
}
export function checkExistingAccess(op, resource) {
  if (!resource || !op.access) return;
  const overwrites = Array.isArray(resource.permission_overwrites) ? resource.permission_overwrites : [];
  const everyone = overwrites.find(row => row.id === op.guild_id);
  const denied = BigInt(everyone?.deny || '0');
  if (op.access === 'read_only' && (denied & PermissionFlagsBits.SendMessages) !== 0n) return;
  if (op.access === 'staff_only') {
    const staff = overwrites.find(row => row.id === op.staff_role_id);
    if ((denied & PermissionFlagsBits.ViewChannel) !== 0n && (BigInt(staff?.allow || '0') & PermissionFlagsBits.ViewChannel) !== 0n) return;
  }
  throw problem(`القناة «${op.name}» موجودة لكن صلاحياتها مختلفة عن الخطة. راجعها قبل المتابعة.`, 409);
}
export function checkConflict(op, resource) {
  if (op.action !== 'update') return;
  if (!resource) throw problem(`العنصر «${op.name}» لم يعد موجودًا. أنشئ مراجعة جديدة.`, 409);
  const changed = Object.entries(op.before || {}).some(([key, value]) => (resource[key] ?? null) !== (value ?? null));
  // A prior request may have succeeded at Discord before its response was lost.
  const alreadyApplied = Object.entries(operationBody(op)).every(([key, value]) => (resource[key] ?? null) === (value ?? null));
  if (changed && !alreadyApplied) throw problem(`تغيّر «${resource.name}» خارج هذه المراجعة. حدّث السيرفر وأنشئ مراجعة جديدة.`, 409);
}
export function connectionState(response) {
  if (response.ok) return 'installed';
  if (response.status === 404) return 'install_required';
  if (response.status === 403) return 'permissions_insufficient';
  return 'unavailable';
}
export function normalizeSchedule(body, now = Date.now()) {
  const content = String(body.content || '').trim();
  const runAt = new Date(body.run_at);
  if (!content || content.length > 2000) throw problem('اكتب رسالة من 1 إلى 2000 حرف.');
  if (!Number.isFinite(runAt.getTime()) || runAt.getTime() < now + 60_000) throw problem('اختر موعدًا بعد دقيقة على الأقل.');
  if (!['once', 'daily', 'weekly'].includes(body.repeat)) throw problem('اختر تكرارًا صالحًا.');
  const timezone = String(body.timezone || 'UTC');
  try { new Intl.DateTimeFormat('ar', { timeZone: timezone }).format(); } catch { throw problem('المنطقة الزمنية غير صالحة.'); }
  return { content, run_at: runAt.toISOString(), repeat: body.repeat, timezone, channel_id: String(body.channel_id || '') };
}
import { PermissionFlagsBits } from 'discord.js';
