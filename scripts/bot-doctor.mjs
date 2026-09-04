/**
 * Diagnoses why the Telegram bot is silent.
 *
 * A misconfigured Telegram bot does not error — it simply never answers, and
 * the cause is invisible from the outside: a webhook pointing at the wrong
 * host, a secret that no longer matches, a token that was revoked. Each of
 * those looks identical from the chat window. This asks Telegram directly and
 * says which one it is.
 *
 *   node scripts/bot-doctor.mjs
 */

const token = process.env.TELEGRAM_BOT_TOKEN;
const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const username = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, '');
const api = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org/bot';

const rows = [];
const note = (ok, label, detail, fix) => rows.push({ ok, label, detail, fix });

async function call(method) {
  const response = await fetch(`${api}${token}/${method}`);
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.description || `HTTP ${response.status}`);
  return payload.result;
}

console.log('\n🩺 فحص بوت تلگرام\n' + '─'.repeat(46));

if (!token) {
  note(false, 'التوكن', 'غير مضبوط', 'أنشئ بوتاً عند @BotFather وضع TELEGRAM_BOT_TOKEN');
} else {
  try {
    const me = await call('getMe');
    note(true, 'التوكن', `@${me.username} — ${me.first_name}`, null);

    if (username && username !== me.username) {
      note(false, 'اسم البوت', `الإعداد "${username}" لا يطابق "${me.username}"`,
        `صحّح TELEGRAM_BOT_USERNAME إلى ${me.username}`);
    } else if (!username) {
      note(false, 'اسم البوت', 'TELEGRAM_BOT_USERNAME غير مضبوط',
        `ضعه = ${me.username} — بدونه لا يظهر زر الدخول في الموقع`);
    } else {
      note(true, 'اسم البوت', `@${username}`, null);
    }

    const hook = await call('getWebhookInfo');
    const expected = appUrl ? `${appUrl}/api/telegram` : null;

    if (!hook.url) {
      note(false, 'الويبهوك', 'غير مسجَّل — البوت لن يرد على أي رسالة',
        'شغّل: node telegram-bot/register-webhook.mjs');
    } else if (expected && hook.url !== expected) {
      note(false, 'الويبهوك', `مسجَّل على ${hook.url}`,
        `المتوقّع ${expected} — أعد التسجيل بعد ضبط APP_URL`);
    } else {
      note(true, 'الويبهوك', hook.url, null);
    }

    // A pending backlog with a stored error is the clearest signal that
    // Telegram is delivering and our endpoint is refusing.
    if (hook.last_error_message) {
      const when = hook.last_error_date ? new Date(hook.last_error_date * 1000).toISOString().slice(0, 16) : '';
      note(false, 'آخر خطأ من تلگرام', `${hook.last_error_message} (${when})`,
        'تلگرام يصل إلينا لكن المسار يرفض — راجع السر والنشر');
    }
    if (hook.pending_update_count > 0) {
      note(false, 'رسائل معلّقة', `${hook.pending_update_count} لم تُسلَّم`,
        'الموقع لا يستجيب — تأكد أنه منشور ويعمل');
    }

    note(Boolean(hook.has_custom_certificate) === false, 'الشهادة', 'قياسية', null);

    if (!secret) {
      note(false, 'سر الويبهوك', 'غير مضبوط',
        'أي جهة تعرف العنوان تقدر ترسل تحديثات مزوّرة — اضبط TELEGRAM_WEBHOOK_SECRET');
    } else {
      note(true, 'سر الويبهوك', 'مضبوط', null);
    }

    const commands = await call('getMyCommands');
    if (!commands.length) {
      note(false, 'الأوامر', 'غير مسجَّلة',
        'شغّل register-webhook.mjs — بدونها لا تظهر قائمة الأوامر للمستخدم');
    } else {
      note(true, 'الأوامر', commands.map((c) => `/${c.command}`).join(' · '), null);
    }
  } catch (error) {
    note(false, 'الاتصال بتلگرام', error.message,
      error.message.includes('Unauthorized')
        ? 'التوكن غير صالح أو أُلغي — أنشئ واحداً جديداً عند @BotFather'
        : 'تحقق من الشبكة ومن صحة التوكن');
  }
}

if (!appUrl) {
  note(false, 'عنوان الموقع', 'APP_URL غير مضبوط',
    'بدونه زر «افتح صفّي» لن يعرف إلى أين يذهب');
} else {
  note(true, 'عنوان الموقع', appUrl, null);
}

for (const row of rows) {
  console.log(`${row.ok ? '✅' : '❌'} ${row.label.padEnd(20)} ${row.detail}`);
  if (row.fix) console.log(`   ↳ ${row.fix}`);
}

const failed = rows.filter((r) => !r.ok).length;
console.log('─'.repeat(46));
console.log(failed ? `❌ ${failed} مشكلة تمنع البوت من العمل` : '✅ البوت جاهز — جرّب /start');
process.exit(failed ? 1 : 0);
