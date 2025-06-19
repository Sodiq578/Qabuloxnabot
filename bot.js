require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const ExcelJS = require('exceljs');
const winston = require('winston');
const cron = require('node-cron');
const sqlite3 = require('sqlite3').verbose();
const chalk = require('chalk');

// Bot sozlamalari
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);
const GROUP_ID = parseInt(process.env.GROUP_ID);

if (!BOT_TOKEN || !ADMIN_ID || !GROUP_ID) {
  console.error(chalk.red('🚫 .env faylida BOT_TOKEN, ADMIN_ID yoki GROUP_ID yo‘q!'));
  process.exit(1);
}

// Botni ishga tushirish
const bot = new TelegramBot(BOT_TOKEN, { polling: { autoStart: false } });

// Ma'lumotlar bazasi sozlamalari
const db = new sqlite3.Database('complaints.db', (err) => {
  if (err) logger.error('🚫 Ma\'lumotlar bazasiga ulanishda xato:', err);
  else logger.info('✅ Ma\'lumotlar bazasiga ulandi');
});

// Jadvalarni yaratish
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS complaints (
      id TEXT PRIMARY KEY,
      chat_id INTEGER,
      username TEXT,
      full_name TEXT,
      address TEXT,
      phone TEXT,
      passport TEXT,
      section TEXT,
      summary TEXT,
      status TEXT,
      time TEXT,
      files TEXT,
      assignee TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      complaint_id TEXT,
      text TEXT,
      admin_id INTEGER,
      time TEXT,
      FOREIGN KEY(complaint_id) REFERENCES complaints(id)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS blocked_users (
      user_id INTEGER PRIMARY KEY,
      reason TEXT,
      time TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT,
      details TEXT,
      timestamp TEXT
    )
  `);
});

// Logger sozlamalari
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'bot.log' }),
    new winston.transports.Console()
  ]
});

// Foydalanuvchi holatlari va ma'lumotlari
const userSteps = {};
const userData = {};

// Til sozlamalari
const languages = {
  uz: {
    askName: "📝 Ism-familiyangizni yozing (masalan: Ali Valiev):",
    invalidName: "🚫 Iltimos, ism-familiyangizni to‘g‘ri yozing (3 harfdan ko‘p).",
    askAddress: "🏠 Yashash manzilingizni yozing (shahar, tuman, mahalla – masalan: Toshkent, Chilanzor tumani, Olmazor mahallasi):",
    invalidAddress: "🚫 Iltimos, manzilingizni to‘g‘ri yozing (3 harfdan ko‘p).",
    askPhone: "📞 Telefon raqamingizni yozing (masalan: +998901234567):",
    invalidPhone: "🚫 Raqam +998 bilan boshlanib, 9 ta raqam bo‘lsin.",
    askPassport: "📑 Pasport seriya va raqamingizni yozing (masalan: AA1234567):",
    invalidPassport: "🚫 Pasport seriya va raqamini to‘g‘ri kiriting (masalan: AA1234567).",
    askSection: "📂 Murojaatingiz bo‘limini tanlang:",
    askSummary: "📋 Murojaatingizni qisqacha yozing:",
    invalidSummary: "🚫 Iltimos, 5 harfdan ko‘p yozing.",
    askMedia: "📸 Rasm yoki video yuboring yoki 'Tayyor' tugmasini bosing:",
    mediaReceived: "✅ Fayl qabul qilindi! Yana yuborasizmi yoki 'Tayyor'?",
    invalidMedia: "🚫 Faqat rasm yoki video yuboring yoki 'Tayyor'ni bosing.",
    confirm: "📝 Ma'lumotlarni tekshiring:\n\n👤 Ism: %s\n🏠 Manzil: %s\n📞 Telefon: %s\n📑 Pasport: %s\n📂 Bo‘lim: %s\n📋 Murojaat: %s\n📸 Fayllar: %s\n\nHammasi to‘g‘rimi?",
    success: "✅ Murojaatingiz muvaffaqiyatli qabul qilindi! ID: %s\n\n📌 Murojaatingiz O‘zbekiston Respublikasi Prezidentining Virtual va Xalq qabulxonalariga murojaatlar bilan ishlash tartibiga asosan ko‘rib chiqiladi.\n\n⏰ Murojaatingiz qonuniy tartibda 15-30 ish kuni ichida Oltinsoy tumani sektor rahbarlari yoki mas’ul tashkilotlar tomonidan ko‘rib chiqiladi va sizga javob taqdim etiladi.\n\n📞 Zarurat tug‘ilganda, qo‘shimcha ma’lumot yoki aniqlik kiritish uchun siz bilan bog‘lanish mumkin.\n\n🤝 Diqqat va ishonchingiz uchun rahmat! Oltinsoy tumani Xalq qabulxonasi sizga yordam berishga tayyor.",
    rateLimit: "⏳ 1 daqiqa kuting, xabarlar ko‘p bo‘ldi.",
    adminDashboard: "📊 Admin paneli:\n\n📬 Jami: %s\n⏳ Kutilyapti: %s\n🔄 Jarayonda: %s\n✅ Yakunlangan: %s",
    statusUpdated: "✅ Murojaat #%s holati: %s",
    invalidCommand: "🚫 Faqat admin uchun!",
    noComplaints: "🚫 Murojaatlar yo‘q.",
    exportSuccess: "✅ Xisobot yuklandi!",
    myComplaints: "📋 Sizning murojaatlaringiz:\n\n%s",
    noUserComplaints: "🚫 Murojaatlaringiz yo‘q.",
    back: "⬅️ Orqaga",
    editComplaint: "✏️ Yangi murojaat matnini yozing:",
    editSuccess: "✅ Murojaat #%s o‘zgartirildi!",
    exportReport: "📥 Xisobotni yuklash",
    invalidStatusId: "🚫 /status <murojaat_id> <holat> shaklida yozing (Pending, In Progress, Resolved)",
    broadcastPrompt: "📢 Admin nomidan xabar yozing:",
    broadcastSuccess: "✅ Xabar barcha foydalanuvchilarga va guruhga yuborildi!",
    broadcastError: "🚫 Xabar yuborishda xato yuz berdi.",
    blockedUser: "🚫 Siz ushbu botdan foydalanish huquqidan mahrum qilindingiz!",
    deleteSuccess: "✅ Murojaat #%s o'chirildi!",
    replySent: "✅ Javob #%s murojaatiga yuborildi!",
    commentAdded: "✅ #%s murojaatiga izoh qo'shildi!",
    assignSuccess: "✅ #%s murojaati %s ga biriktirildi!",
    statsToday: "📊 Bugungi statistika (%s):\n\n• Yangi murojaatlar: %s\n• Jami murojaatlar: %s",
    help: "ℹ️ *Botdan foydalanish qo'llanmasi*\n\n" +
          "/start - Yangi murojaat yuborish\n" +
          "/mycomplaints - Mening murojaatlarim\n" +
          "/edit <ID> - Murojaatni tahrirlash\n" +
          "/language - Tilni o'zgartirish\n" +
          "/help - Yordam olish\n\n" +
          "⚠️ Diqqat: Har bir murojaat qonuniy tartibda 15-30 ish kuni ichida ko'rib chiqiladi."
  },
  ru: {
    askName: "📝 Введите ваше имя и фамилию (например: Али Валиев):",
    invalidName: "🚫 Пожалуйста, введите имя и фамилию правильно (более 3 символов).",
    askAddress: "🏠 Где вы проживаете? (например: Ташкент, Чиланзар):",
    invalidAddress: "🚫 Пожалуйста, введите адрес правильно (более 3 символов).",
    askPhone: "📞 Введите номер телефона (например: +998901234567):",
    invalidPhone: "🚫 Номер должен начинаться с +998 и содержать 9 цифр.",
    askPassport: "📑 Введите серию и номер паспорта (например: AA1234567):",
    invalidPassport: "🚫 Пожалуйста, введите серию и номер паспорта правильно (например: AA1234567).",
    askSection: "📂 Выберите раздел вашего обращения:",
    askSummary: "📋 Кратко опишите ваше обращение:",
    invalidSummary: "🚫 Пожалуйста, введите более 5 символов.",
    askMedia: "📸 Отправьте фото или видео или нажмите 'Готово':",
    mediaReceived: "✅ Файл получен! Отправить еще или нажать 'Готово'?",
    invalidMedia: "🚫 Отправляйте только фото или видео или нажмите 'Готово'.",
    confirm: "📝 Проверьте данные:\n\n👤 Имя: %s\n🏠 Адрес: %s\n📞 Телефон: %s\n📑 Паспорт: %s\n📂 Раздел: %s\n📋 Обращение: %s\n📸 Файлы: %s\n\nВсе верно?",
    success: "✅ Ваше обращение успешно принято! ID: %s\n⏰ Обращение будет рассмотрено в течение 15-30 рабочих дней.",
    rateLimit: "⏳ Подождите 1 минуту, слишком много сообщений.",
    adminDashboard: "📊 Панель администратора:\n\n📬 Всего: %s\n⏳ В ожидании: %s\n🔄 В процессе: %s\n✅ Завершено: %s",
    statusUpdated: "✅ Статус обращения #%s: %s",
    invalidCommand: "🚫 Только для администратора!",
    noComplaints: "🚫 Обращений нет.",
    exportSuccess: "✅ Отчет загружен!",
    myComplaints: "📋 Ваши обращения:\n\n%s",
    noUserComplaints: "🚫 У вас нет обращений.",
    back: "⬅️ Назад",
    editComplaint: "✏️ Введите новый текст обращения:",
    editSuccess: "✅ Обращение #%s изменено!",
    exportReport: "📥 Загрузить отчет",
    invalidStatusId: "🚫 Используйте формат /status <appeal_id> <status> (Pending, In Progress, Resolved)",
    broadcastPrompt: "📢 Введите сообщение от имени администратора:",
    broadcastSuccess: "✅ Сообщение отправлено всем пользователям и группе!",
    broadcastError: "🚫 Ошибка при отправке сообщения.",
    blockedUser: "🚫 Вы заблокированы и не можете использовать этого бота!",
    deleteSuccess: "✅ Обращение #%s удалено!",
    replySent: "✅ Ответ отправлен для обращения #%s!",
    commentAdded: "✅ Комментарий добавлен к обращению #%s!",
    assignSuccess: "✅ Обращение #%s назначено на %s!",
    statsToday: "📊 Статистика за сегодня (%s):\n\n• Новые обращения: %s\n• Всего обращений: %s",
    help: "ℹ️ *Руководство по использованию бота*\n\n" +
          "/start - Подать новое обращение\n" +
          "/mycomplaints - Мои обращения\n" +
          "/edit <ID> - Редактировать обращение\n" +
          "/language - Сменить язык\n" +
          "/help - Получить помощь\n\n" +
          "⚠️ Внимание: Каждое обращение рассматривается в течение 15-30 рабочих дней."
  }
};

// Bo‘limlar
const sections = {
  "🛣 Yo‘l qurilishi": "Yo‘l qurilishi",
  "🏫 Ta‘lim": "Ta‘lim",
  "🆘 Amaliy yordam": "Amaliy yordam",
  "🏥 Sog‘liqni saqlash": "Sog‘liqni saqlash",
  "🏘 Uy-joy masalalari": "Uy-joy masalalari",
  "💧 Ichimlik suvi": "Ichimlik suvi",
  "🚰 Kanalizatsiya": "Kanalizatsiya",
  "💡 Elektr ta’minoti": "Elektr ta’minoti",
  "📶 Internet va aloqa": "Internet va aloqa",
  "🚜 Qishloq xo‘jaligi": "Qishloq xo‘jaligi",
  "🛍 Ijtimoiy yordam": "Ijtimoiy yordam",
  "🧑‍💼 Ish bilan ta’minlash": "Ish bilan ta’minlash",
  "🚓 Xavfsizlik masalalari": "Xavfsizlik masalalari",
  "♿️ Nogironligi bo‘lganlar": "Nogironligi bo‘lganlar",
  "🧾 Hujjatlar bilan bog‘liq muammolar": "Hujjatlar bilan bog‘liq muammolar",
  "🙏 Minnatdorchilik": "Minnatdorchilik",
  "📌 Boshqa soha": "Boshqa soha"
};

// Animatsiyalar
const ANIMATIONS = {
  welcome: 'CAACAgIAAxkBAAIBT2Yp3z5k8z5X5J5z5X5TaACAAd2qwEAAX5X5J5z5X5J5z5X5J5AAQ',
  success: 'CAACAgIAAxkBAAIBU2Yp4AABBWZ5X5J5z5X5J5z5X5J5AAQACAAd2qwEAAX5X5J5z5X5J5z5X5J5AAQ',
  error: 'CAACAgIAAxkBAAIBV2Yp4B5k8z5X5J5z5X5J5z5X5J5AAQACAAd2qwEAAX5X5J5z5X5J5z5X5J5AAQ',
  clock: 'CAACAgIAAxkBAAIBW2Yp4C5k8z5X5J5z3X5J5z5X5J5AAQAC'
};

// Tezlik chegarasi
const limiter = new Map();
const RATE_LIMIT = 10;
const RATE_LIMIT_WINDOW = 60 * 1000;

// Guruhga test xabari
async function testGroupAccess() {
  try {
    await bot.sendMessage(GROUP_ID, `📢 *Hurmatli fuqarolar!*\n\nEndilikda murojaatlaringizni [@QabulxonaBot_bot](https://t.me/QabulxonaBot_bot) Telegram boti orqali yuborishingiz mumkin.\n\nBu sizning murojaatingizni tezroq ko‘rib chiqish va hal qilishga yordam beradi.\n\nℹ️ Hozirda botda texnik ishlar olib borilmoqda, biroq bot to‘liq ishlayapti. Bemalol murojaat yuborishingiz mumkin.`, {
      parse_mode: "Markdown"
    });
    logger.info("✅ Guruhga test xabari yuborildi");
  } catch (err) {
    logger.error("🚫 Guruhga test xabari yuborishda xato:", err);
    bot.sendMessage(ADMIN_ID, "🚫 Guruhga ulanishda xatolik yuz berdi!");
  }
}

// Guruh a'zoligini tekshirish
async function verifyGroupMembership() {
  try {
    await bot.getChat(GROUP_ID);
    logger.info("✅ Bot guruhda");
  } catch (err) {
    logger.error("🚫 Bot guruhda emas:", err);
    bot.sendMessage(ADMIN_ID, "🚫 Bot guruhdan chiqarib yuborilgan!");
  }
}

// Pollingni qayta boshlash
function startPollingWithRetry() {
  bot.startPolling().catch(err => {
    logger.error("🚫 Polling xatosi:", err);
    setTimeout(startPollingWithRetry, 5000);
  });
}

// Botni ishga tushirish
startPollingWithRetry();
testGroupAccess();
cron.schedule('0 0 * * *', verifyGroupMembership);

// Foydalanuvchi bloklanganligini tekshirish
async function isUserBlocked(chatId) {
  return new Promise((resolve) => {
    db.get("SELECT user_id FROM blocked_users WHERE user_id = ?", [chatId], (err, row) => {
      resolve(!!row);
    });
  });
}

// Harakatlarni log qilish
function logAction(userId, action, details) {
  db.run(
    "INSERT INTO audit_log (user_id, action, details, timestamp) VALUES (?, ?, ?, ?)",
    [userId, action, details, new Date().toISOString()]
  );
}

// Tezlik chegarasini tekshirish
function checkRateLimit(chatId) {
  const now = Date.now();
  if (!limiter.has(chatId)) {
    limiter.set(chatId, { count: 1, timestamp: now });
    return true;
  }
  const userLimit = limiter.get(chatId);
  if (now - userLimit.timestamp > RATE_LIMIT_WINDOW) {
    limiter.set(chatId, { count: 1, timestamp: now });
    return true;
  }
  if (userLimit.count >= RATE_LIMIT) return false;
  userLimit.count++;
  limiter.set(chatId, userLimit);
  return true;
}

// Buyruqlar bilan ishlash
bot.onText(/\/(start|mycomplaints|edit|status|export|broadcast|delete|block|reply|comment|assign|stats|language|help)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const command = match[1];

  if (await isUserBlocked(chatId)) {
    bot.sendMessage(chatId, languages.uz.blockedUser);
    bot.sendSticker(chatId, ANIMATIONS.error);
    return;
  }

  if (!checkRateLimit(chatId)) {
    bot.sendMessage(chatId, languages.uz.rateLimit);
    bot.sendSticker(chatId, ANIMATIONS.error);
    return;
  }

  if (command === "start") {
    userSteps[chatId] = 'askName';
    userData[chatId] = userData[chatId] || { media: [], language: 'uz' };
    bot.sendSticker(chatId, ANIMATIONS.welcome);
    bot.sendMessage(chatId, languages.uz.askName, {
      reply_markup: {
        inline_keyboard: [[{ text: languages.uz.back, callback_data: "back_to_name" }]]
      }
    });
    logger.info(`👤 Foydalanuvchi ${chatId} murojaat jarayonini boshladi`);
    logAction(chatId, "start", "Foydalanuvchi murojaat jarayonini boshladi");
    return;
  }

  if (command === "mycomplaints") {
    showUserComplaints(chatId);
    return;
  }

  if (command === "edit") {
    const [, complaintId] = msg.text.match(/\/edit (\S+)/) || [];
    if (!complaintId) {
      bot.sendMessage(chatId, "🚫 /edit <murojaat_id> shaklida yozing");
      bot.sendSticker(chatId, ANIMATIONS.error);
      return;
    }
    db.get("SELECT * FROM complaints WHERE id = ? AND chat_id = ?", [complaintId, chatId], (err, row) => {
      if (err || !row) {
        bot.sendMessage(chatId, "🚫 Murojaat topilmadi!");
        bot.sendSticker(chatId, ANIMATIONS.error);
        return;
      }
      userSteps[chatId] = 'editComplaint';
      userData[chatId] = userData[chatId] || {};
      userData[chatId].complaintId = complaintId;
      userData[chatId].media = JSON.parse(row.files || '[]');
      bot.sendMessage(chatId, languages.uz.editComplaint, {
        reply_markup: {
          inline_keyboard: [[{ text: languages.uz.back, callback_data: "back_to_name" }]]
        }
      });
    });
    return;
  }

  if (command === "status" && chatId === ADMIN_ID) {
    const [, complaintId, newStatus] = msg.text.match(/\/status (\S+) (\S+)/) || [];
    if (!complaintId || !newStatus || !['Pending', 'In Progress', 'Resolved'].includes(newStatus)) {
      bot.sendMessage(chatId, languages.uz.invalidStatusId);
      bot.sendSticker(chatId, ANIMATIONS.error);
      return;
    }
    updateComplaintStatus(chatId, complaintId, newStatus);
    return;
  }

  if (command === "export" && chatId === ADMIN_ID) {
    await exportToExcel(chatId);
    return;
  }

  if (command === "broadcast" && chatId === ADMIN_ID) {
    userSteps[chatId] = 'askBroadcast';
    userData[chatId] = userData[chatId] || {};
    bot.sendMessage(chatId, languages.uz.broadcastPrompt, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📢 Yuborish", callback_data: "send_broadcast" }],
          [{ text: languages.uz.back, callback_data: "cancel_broadcast" }]
        ]
      }
    });
    return;
  }

  if (command === "delete" && chatId === ADMIN_ID) {
    const [, complaintId] = msg.text.match(/\/delete (\S+)/) || [];
    if (!complaintId) {
      bot.sendMessage(chatId, "🚫 /delete <murojaat_id> shaklida yozing");
      bot.sendSticker(chatId, ANIMATIONS.error);
      return;
    }
    db.run("DELETE FROM complaints WHERE id = ?", [complaintId], (err) => {
      if (err) {
        bot.sendMessage(chatId, "🚫 O'chirishda xato!");
        bot.sendSticker(chatId, ANIMATIONS.error);
        return;
      }
      bot.sendMessage(chatId, languages.uz.deleteSuccess.replace('%s', complaintId));
      bot.sendSticker(chatId, ANIMATIONS.success);
      logAction(chatId, "delete_complaint", `Murojaat ${complaintId} o'chirildi`);
    });
    return;
  }

  if (command === "block" && chatId === ADMIN_ID) {
    const [, userId, reason] = msg.text.match(/\/block (\d+) (.+)/) || [];
    if (!userId) {
      bot.sendMessage(chatId, "🚫 /block <user_id> <reason> shaklida yozing");
      bot.sendSticker(chatId, ANIMATIONS.error);
      return;
    }
    db.run("INSERT OR REPLACE INTO blocked_users (user_id, reason, time) VALUES (?, ?, ?)", 
      [userId, reason || "Sabab ko‘rsatilmagan", new Date().toISOString()], (err) => {
        if (err) {
          bot.sendMessage(chatId, `🚫 Foydalanuvchi #${userId} bloklashda xato!`);
          bot.sendSticker(chatId, ANIMATIONS.error);
          return;
        }
        bot.sendMessage(chatId, `✅ Foydalanuvchi #${userId} bloklandi!`);
        bot.sendMessage(userId, languages.uz.blockedUser);
        bot.sendSticker(userId, ANIMATIONS.error);
        logAction(chatId, "block_user", `Foydalanuvchi ${userId} bloklandi: ${reason}`);
      });
    return;
  }

  if (command === "reply" && chatId === ADMIN_ID) {
    const [, complaintId, replyText] = msg.text.match(/\/reply (\S+) (.+)/) || [];
    if (!complaintId || !replyText) {
      bot.sendMessage(chatId, "🚫 /reply <murojaat_id> <javob> shaklida yozing");
      bot.sendSticker(chatId, ANIMATIONS.error);
      return;
    }
    db.get("SELECT chat_id FROM complaints WHERE id = ?", [complaintId], (err, row) => {
      if (err || !row) {
        bot.sendMessage(chatId, "🚫 Murojaat topilmadi!");
        bot.sendSticker(chatId, ANIMATIONS.error);
        return;
      }
      const userChatId = row.chat_id;
      const replyMessage = `📨 Admin javobi (#${complaintId}):\n\n${replyText}`;
      bot.sendMessage(userChatId, replyMessage)
        .then(() => {
          bot.sendMessage(chatId, languages.uz.replySent.replace('%s', complaintId));
          bot.sendSticker(chatId, ANIMATIONS.success);
          logAction(chatId, "reply_complaint", `Murojaat ${complaintId} ga javob yuborildi`);
        })
        .catch(() => {
          bot.sendMessage(chatId, "🚫 Foydalanuvchiga javob yuborish mumkin emas!");
          bot.sendSticker(chatId, ANIMATIONS.error);
        });
    });
    return;
  }

  if (command === "comment" && chatId === ADMIN_ID) {
    const [, complaintId, commentText] = msg.text.match(/\/comment (\S+) (.+)/) || [];
    if (!complaintId || !commentText) {
      bot.sendMessage(chatId, "🚫 /comment <murojaat_id> <izoh> shaklida yozing");
      bot.sendSticker(chatId, ANIMATIONS.error);
      return;
    }
    db.run("INSERT INTO comments (complaint_id, text, admin_id, time) VALUES (?, ?, ?, ?)", 
      [complaintId, commentText, ADMIN_ID, new Date().toISOString()], (err) => {
        if (err) {
          bot.sendMessage(chatId, "🚫 Izoh qo'shishda xato!");
          bot.sendSticker(chatId, ANIMATIONS.error);
          return;
        }
        bot.sendMessage(chatId, languages.uz.commentAdded.replace('%s', complaintId));
        bot.sendSticker(chatId, ANIMATIONS.success);
        logAction(chatId, "comment_complaint", `Murojaat ${complaintId} ga izoh qo'shildi`);
      });
    return;
  }

  if (command === "assign" && chatId === ADMIN_ID) {
    const [, complaintId, assignee] = msg.text.match(/\/assign (\S+) (.+)/) || [];
    if (!complaintId || !assignee) {
      bot.sendMessage(chatId, "🚫 /assign <murojaat_id> <xodim> shaklida yozing");
      bot.sendSticker(chatId, ANIMATIONS.error);
      return;
    }
    db.run("UPDATE complaints SET assignee = ? WHERE id = ?", [assignee, complaintId], (err) => {
      if (err) {
        bot.sendMessage(chatId, "🚫 Xodim tayinlashda xato!");
        bot.sendSticker(chatId, ANIMATIONS.error);
        return;
      }
      bot.sendMessage(chatId, languages.uz.assignSuccess.replace('%s', complaintId).replace('%s', assignee));
      bot.sendSticker(chatId, ANIMATIONS.success);
      logAction(chatId, "assign_complaint", `Murojaat ${complaintId} ${assignee} ga tayinlandi`);
    });
    return;
  }

  if (command === "stats" && chatId === ADMIN_ID) {
    const today = new Date().toISOString().split('T')[0];
    db.get(`SELECT COUNT(*) as count FROM complaints WHERE date(time) = ?`, [today], (err, todayRow) => {
      if (err) {
        bot.sendMessage(chatId, "🚫 Statistika olishda xato!");
        bot.sendSticker(chatId, ANIMATIONS.error);
        return;
      }
      db.get(`SELECT COUNT(*) as total FROM complaints`, [], (err, totalRow) => {
        if (err) {
          bot.sendMessage(chatId, "🚫 Statistika olishda xato!");
          bot.sendSticker(chatId, ANIMATIONS.error);
          return;
        }
        bot.sendMessage(chatId, languages.uz.statsToday.replace('%s', today).replace('%s', todayRow.count).replace('%s', totalRow.total));
        bot.sendSticker(chatId, ANIMATIONS.success);
        logAction(chatId, "view_stats", "Kunlik statistika ko'rildi");
      });
    });
    return;
  }

  if (command === "language") {
    bot.sendMessage(chatId, "Tilni tanlang / Выберите язык:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "O'zbekcha", callback_data: "set_lang_uz" }],
          [{ text: "Русский", callback_data: "set_lang_ru" }]
        ]
      }
    });
    return;
  }

  if (command === "help") {
    bot.sendMessage(chatId, languages[userData[chatId]?.language || 'uz'].help, { parse_mode: "Markdown" });
    bot.sendSticker(chatId, ANIMATIONS.welcome);
    logAction(chatId, "view_help", "Foydalanuvchi yordamni ko'rdi");
    return;
  }

  if (["status", "export", "broadcast", "delete", "block", "reply", "comment", "assign", "stats"].includes(command) && chatId !== ADMIN_ID) {
    bot.sendMessage(chatId, languages.uz.invalidCommand);
    bot.sendSticker(chatId, ANIMATIONS.error);
    return;
  }
});

// Callback query ishlovchisi
bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (!checkRateLimit(chatId)) {
    bot.sendMessage(chatId, languages.uz.rateLimit);
    bot.sendSticker(chatId, ANIMATIONS.error);
    bot.answerCallbackQuery(query.id);
    return;
  }

  if (data.startsWith('set_lang_')) {
    const lang = data.replace('set_lang_', '');
    userData[chatId] = userData[chatId] || {};
    userData[chatId].language = lang;
    bot.sendMessage(chatId, lang === 'uz' ? "✅ Til O'zbekchaga o'zgartirildi!" : "✅ Язык изменен на Русский!");
    bot.answerCallbackQuery(query.id);
    return;
  }

  if (userSteps[chatId] === 'askSection' && sections[data]) {
    userData[chatId].section = sections[data];
    userSteps[chatId] = 'askSummary';
    bot.sendMessage(chatId, languages[userData[chatId].language].askSummary, {
      reply_markup: {
        inline_keyboard: [[{ text: languages[userData[chatId].language].back, callback_data: "back_to_passport" }]]
      }
    });
    bot.answerCallbackQuery(query.id);
    return;
  }

  if (data === "back_to_name") {
    userSteps[chatId] = 'askName';
    bot.sendMessage(chatId, languages[userData[chatId].language].askName, {
      reply_markup: {
        inline_keyboard: [[{ text: languages[userData[chatId].language].back, callback_data: "back_to_name" }]]
      }
    });
    bot.answerCallbackQuery(query.id);
    return;
  }

  if (data === "back_to_address") {
    userSteps[chatId] = 'askAddress';
    bot.sendMessage(chatId, languages[userData[chatId].language].askAddress, {
      reply_markup: {
        inline_keyboard: [[{ text: languages[userData[chatId].language].back, callback_data: "back_to_name" }]]
      }
    });
    bot.answerCallbackQuery(query.id);
    return;
  }

  if (data === "back_to_phone") {
    userSteps[chatId] = 'askPhone';
    bot.sendMessage(chatId, languages[userData[chatId].language].askPhone, {
      reply_markup: {
        keyboard: [[{ text: "📞 Raqamni ulashish", request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
        inline_keyboard: [[{ text: languages[userData[chatId].language].back, callback_data: "back_to_address" }]]
      }
    });
    bot.answerCallbackQuery(query.id);
    return;
  }

  if (data === "back_to_passport") {
    userSteps[chatId] = 'askPassport';
    bot.sendMessage(chatId, languages[userData[chatId].language].askPassport, {
      reply_markup: {
        inline_keyboard: [[{ text: languages[userData[chatId].language].back, callback_data: "back_to_phone" }]]
      }
    });
    bot.answerCallbackQuery(query.id);
    return;
  }

  if (data === "back_to_section") {
    userSteps[chatId] = 'askSection';
    bot.sendMessage(chatId, languages[userData[chatId].language].askSection, {
      reply_markup: {
        inline_keyboard: [
          ...Object.keys(sections).map(section => [{ text: section, callback_data: section }]),
          [{ text: languages[userData[chatId].language].back, callback_data: "back_to_passport" }]
        ]
      }
    });
    bot.answerCallbackQuery(query.id);
    return;
  }

  if (data === "back_to_summary") {
    userSteps[chatId] = 'askSummary';
    bot.sendMessage(chatId, languages[userData[chatId].language].askSummary, {
      reply_markup: {
        inline_keyboard: [[{ text: languages[userData[chatId].language].back, callback_data: "back_to_section" }]]
      }
    });
    bot.answerCallbackQuery(query.id);
    return;
  }

  if (data === "back_to_media") {
    userSteps[chatId] = 'askMedia';
    bot.sendMessage(chatId, languages[userData[chatId].language].askMedia, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "✅ Tayyor", callback_data: "ready" }],
          [{ text: languages[userData[chatId].language].back, callback_data: "back_to_summary" }]
        ]
      }
    });
    bot.answerCallbackQuery(query.id);
    return;
  }

  if (userSteps[chatId] === 'askMedia' && data === "ready") {
    sendConfirmation(chatId);
    bot.answerCallbackQuery(query.id);
    return;
  }

  if (userSteps[chatId] === 'askConfirmation') {
    if (data === "submit") {
      sendToAdminAndGroup(chatId);
    } else if (data === "edit") {
      userSteps[chatId] = 'askName';
      bot.sendMessage(chatId, languages[userData[chatId].language].askName, {
        reply_markup: {
          inline_keyboard: [[{ text: languages[userData[chatId].language].back, callback_data: "back_to_name" }]]
        }
      });
    }
    bot.answerCallbackQuery(query.id);
    return;
  }

  if (data.startsWith('filter_') && chatId === ADMIN_ID) {
    const section = data.replace('filter_', '');
    filterComplaintsBySection(chatId, section);
    bot.answerCallbackQuery(query.id);
    return;
  }

  if (data === "export_report" && chatId === ADMIN_ID) {
    exportToExcel(chatId);
    bot.answerCallbackQuery(query.id);
    return;
  }

  if (data.startsWith('status_') && chatId === ADMIN_ID) {
    const [_, complaintId, newStatus] = data.split('_');
    updateComplaintStatus(chatId, complaintId, newStatus);
    bot.answerCallbackQuery(query.id);
    return;
  }

  if (data === "send_broadcast" && chatId === ADMIN_ID && userSteps[chatId] === 'askBroadcast') {
    if (!userData[chatId]?.broadcastMessage) {
      bot.sendMessage(chatId, "🚫 Iltimos, avval xabar yozing!");
      bot.sendSticker(chatId, ANIMATIONS.error);
      bot.answerCallbackQuery(query.id);
      return;
    }
    sendBroadcast(chatId, userData[chatId].broadcastMessage);
    bot.answerCallbackQuery(query.id);
    return;
  }

  if (data === "cancel_broadcast" && chatId === ADMIN_ID) {
    cleanupBroadcast(chatId);
    bot.sendMessage(chatId, "🚫 Broadcast bekor qilindi.");
    bot.sendSticker(chatId, ANIMATIONS.error);
    bot.answerCallbackQuery(query.id);
    return;
  }
});

// Xabar ishlovchisi
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  // Guruh xabarlarini e'tiborsiz qoldirish
  if (msg.chat.type !== 'private') {
    logger.info(`Guruh xabari (${chatId}) e'tiborsiz qoldirildi`);
    return;
  }

  if (await isUserBlocked(chatId)) {
    bot.sendMessage(chatId, languages.uz.blockedUser);
    bot.sendSticker(chatId, ANIMATIONS.error);
    return;
  }

  if (!checkRateLimit(chatId)) {
    bot.sendMessage(chatId, languages[userData[chatId]?.language || 'uz'].rateLimit);
    bot.sendSticker(chatId, ANIMATIONS.error);
    return;
  }

  if (!userSteps[chatId] || text?.startsWith('/')) return;

  switch (userSteps[chatId]) {
    case 'askName':
      if (!text || text.length < 3) {
        bot.sendMessage(chatId, languages[userData[chatId].language].invalidName);
        bot.sendSticker(chatId, ANIMATIONS.error);
        return;
      }
      userData[chatId].fullName = text;
      userData[chatId].username = msg.from.username || "Noma'lum";
      userSteps[chatId] = 'askAddress';
      bot.sendMessage(chatId, languages[userData[chatId].language].askAddress, {
        reply_markup: {
          inline_keyboard: [[{ text: languages[userData[chatId].language].back, callback_data: "back_to_name" }]]
        }
      });
      break;

    case 'askAddress':
      if (!text || text.length < 3) {
        bot.sendMessage(chatId, languages[userData[chatId].language].invalidAddress);
        bot.sendSticker(chatId, ANIMATIONS.error);
        return;
      }
      userData[chatId].address = text;
      userSteps[chatId] = 'askPhone';
      bot.sendMessage(chatId, languages[userData[chatId].language].askPhone, {
        reply_markup: {
          keyboard: [[{ text: "📞 Raqamni ulashish", request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
          inline_keyboard: [[{ text: languages[userData[chatId].language].back, callback_data: "back_to_address" }]]
        }
      });
      break;

    case 'askPhone':
      let phoneNumber = '';
      if (msg.contact) {
        phoneNumber = msg.contact.phone_number;
      } else if (text && text.match(/^\+998\d{9}$/)) {
        phoneNumber = text;
      } else {
        bot.sendMessage(chatId, languages[userData[chatId].language].invalidPhone);
        bot.sendSticker(chatId, ANIMATIONS.error);
        return;
      }
      userData[chatId].phone = phoneNumber;
      userSteps[chatId] = 'askPassport';
      bot.sendMessage(chatId, languages[userData[chatId].language].askPassport, {
        reply_markup: {
          inline_keyboard: [[{ text: languages[userData[chatId].language].back, callback_data: "back_to_phone" }]]
        }
      });
      break;

    case 'askPassport':
      if (!text || !text.match(/^[A-Z]{2}\d{7}$/)) {
        bot.sendMessage(chatId, languages[userData[chatId].language].invalidPassport);
        bot.sendSticker(chatId, ANIMATIONS.error);
        return;
      }
      userData[chatId].passport = text;
      userSteps[chatId] = 'askSection';
      bot.sendMessage(chatId, languages[userData[chatId].language].askSection, {
        reply_markup: {
          inline_keyboard: [
            ...Object.keys(sections).map(section => [{ text: section, callback_data: section }]),
            [{ text: languages[userData[chatId].language].back, callback_data: "back_to_phone" }]
          ]
        }
      });
      break;

    case 'askSection':
      if (!text || !Object.values(sections).includes(text)) {
        bot.sendMessage(chatId, languages[userData[chatId].language].askSection);
        bot.sendSticker(chatId, ANIMATIONS.error);
        return;
      }
      userData[chatId].section = text;
      userSteps[chatId] = 'askSummary';
      bot.sendMessage(chatId, languages[userData[chatId].language].askSummary, {
        reply_markup: {
          inline_keyboard: [[{ text: languages[userData[chatId].language].back, callback_data: "back_to_passport" }]]
        }
      });
      break;

    case 'askSummary':
      if (!text || text.length < 5) {
        bot.sendMessage(chatId, languages[userData[chatId].language].invalidSummary);
        bot.sendSticker(chatId, ANIMATIONS.error);
        return;
      }
      userData[chatId].summary = text;
      userSteps[chatId] = 'askMedia';
      bot.sendMessage(chatId, languages[userData[chatId].language].askMedia, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Tayyor", callback_data: "ready" }],
            [{ text: languages[userData[chatId].language].back, callback_data: "back_to_section" }]
          ]
        }
      });
      break;

    case 'askMedia':
      if (msg.photo) {
        const fileId = msg.photo[msg.photo.length - 1].file_id;
        if (fileId) {
          userData[chatId].media.push({ type: 'photo', media: fileId });
          bot.sendMessage(chatId, languages[userData[chatId].language].mediaReceived, {
            reply_markup: {
              inline_keyboard: [
                [{ text: "✅ Tayyor", callback_data: "ready" }],
                [{ text: languages[userData[chatId].language].back, callback_data: "back_to_summary" }]
              ]
            }
          });
        } else {
          bot.sendMessage(chatId, "🚫 Fayl ID olishda xato!");
          bot.sendSticker(chatId, ANIMATIONS.error);
        }
      } else if (msg.video) {
        const fileId = msg.video.file_id;
        if (fileId) {
          userData[chatId].media.push({ type: 'video', media: fileId });
          bot.sendMessage(chatId, languages[userData[chatId].language].mediaReceived, {
            reply_markup: {
              inline_keyboard: [
                [{ text: "✅ Tayyor", callback_data: "ready" }],
                [{ text: languages[userData[chatId].language].back, callback_data: "back_to_summary" }]
              ]
            }
          });
        } else {
          bot.sendMessage(chatId, "🚫 Fayl ID olishda xato!");
          bot.sendSticker(chatId, ANIMATIONS.error);
        }
      } else if (text === "✅ Tayyor") {
        sendConfirmation(chatId);
      } else {
        bot.sendMessage(chatId, languages[userData[chatId].language].invalidMedia, {
          reply_markup: {
            inline_keyboard: [
              [{ text: "✅ Tayyor", callback_data: "ready" }],
              [{ text: languages[userData[chatId].language].back, callback_data: "back_to_summary" }]
            ]
          }
        });
        bot.sendSticker(chatId, ANIMATIONS.error);
      }
      break;

    case 'editComplaint':
      if (!text || text.length < 5) {
        bot.sendMessage(chatId, languages[userData[chatId].language].invalidSummary);
        bot.sendSticker(chatId, ANIMATIONS.error);
        return;
      }
      userData[chatId].summary = text;
      db.run("UPDATE complaints SET summary = ? WHERE id = ?", [text, userData[chatId].complaintId], (err) => {
        if (err) {
          logger.error("🚫 Murojaatni tahrirlashda xato:", err);
          bot.sendMessage(chatId, "🚫 Tahrirlashda xato!");
          bot.sendSticker(chatId, ANIMATIONS.error);
          return;
        }
        bot.sendMessage(chatId, languages[userData[chatId].language].editSuccess.replace('%s', userData[chatId].complaintId));
        bot.sendMessage(ADMIN_ID, `✏️ Murojaat #${userData[chatId].complaintId} o‘zgartirildi: ${text}`);
        bot.sendSticker(chatId, ANIMATIONS.success);
        logger.info(`✅ Murojaat ${userData[chatId].complaintId} tahrirlandi`);
        logAction(chatId, "edit_complaint", `Murojaat ${userData[chatId].complaintId} tahrirlandi`);
        cleanupBroadcast(chatId);
      });
      break;

    case 'askBroadcast':
      if (chatId === ADMIN_ID) {
        userData[chatId].broadcastMessage = text;
        bot.sendMessage(chatId, `📢 Xabar: ${text}\n\nYuborishni tasdiqlang:`, {
          reply_markup: {
            inline_keyboard: [
              [{ text: "📢 Yuborish", callback_data: "send_broadcast" }],
              [{ text: languages.uz.back, callback_data: "cancel_broadcast" }]
            ]
          }
        });
      }
      break;
  }
});

// Fayllarni yuborish
async function sendMediaToTarget(targetId, media, message) {
  try {
    if (media.type === 'photo' && media.media) {
      await bot.sendPhoto(targetId, media.media, { caption: message, parse_mode: "Markdown" });
      logger.info(`✅ ${targetId} ga rasm yuborildi`);
    } else if (media.type === 'video' && media.media) {
      await bot.sendVideo(targetId, media.media, { caption: message, parse_mode: "Markdown" });
      logger.info(`✅ ${targetId} ga video yuborildi`);
    } else {
      throw new Error("Noto‘g‘ri fayl turi yoki ID");
    }
  } catch (err) {
    logger.error(`🚫 ${media.type} ni ${targetId} ga yuborishda xato:`, err);
    throw err;
  }
}

// Broadcast xabar yuborish
async function sendBroadcast(chatId, message) {
  const failedChats = [];
  db.all("SELECT DISTINCT chat_id FROM complaints", [], async (err, rows) => {
    if (err) {
      logger.error("🚫 Broadcast xatosi:", err);
      bot.sendMessage(chatId, languages.uz.broadcastError);
      bot.sendSticker(chatId, ANIMATIONS.error);
      return;
    }
    for (const row of rows) {
      try {
        await bot.sendMessage(row.chat_id, `📢 Admin xabari: ${message}`);
      } catch (err) {
        failedChats.push(row.chat_id);
        logger.error(`🚫 ${row.chat_id} ga broadcast yuborishda xato:`, err);
      }
    }
    try {
      await bot.sendMessage(GROUP_ID, `📢 Admin xabari: ${message}`);
      logger.info(`✅ Guruhga (${GROUP_ID}) broadcast yuborildi`);
    } catch (err) {
      logger.error(`🚫 Guruhga (${GROUP_ID}) broadcast yuborishda xato:`, err);
      failedChats.push(GROUP_ID);
    }
    bot.sendMessage(chatId, failedChats.length ? `⚠️ Xabar yuborildi, lekin ${failedChats.length} chatda xato: ${failedChats.join(', ')}` : languages.uz.broadcastSuccess);
    bot.sendSticker(chatId, ANIMATIONS.success);
    logger.info(`✅ Admin ${chatId} tomonidan broadcast yuborildi`);
    logAction(chatId, "broadcast", `Broadcast yuborildi: ${message}`);
    cleanupBroadcast(chatId);
  });
}

// Tasdiqlash xabari
function sendConfirmation(chatId) {
  const data = userData[chatId];
  const mediaCount = data.media.length > 0 ? `${data.media.length} ta` : "Yo‘q";
  const message = languages[userData[chatId].language].confirm
    .replace('%s', data.fullName)
    .replace('%s', data.address)
    .replace('%s', data.phone)
    .replace('%s', data.passport)
    .replace('%s', data.section)
    .replace('%s', data.summary)
    .replace('%s', mediaCount);

  bot.sendMessage(chatId, message, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "✅ Yuborish", callback_data: "submit" }],
        [{ text: "✏️ Tahrirlash", callback_data: "edit" }]
      ]
    }
  });
  userSteps[chatId] = 'askConfirmation';
}

// Admin va guruhga yuborish
async function sendToAdminAndGroup(chatId) {
  const data = userData[chatId];
  const time = new Date().toLocaleString('uz-UZ');
  const complaintId = `${chatId}_${Date.now()}`;
  const mediaCount = data.media.length > 0 ? `${data.media.length} ta` : "Yo‘q";

  const message = `
📝 *Murojaat ID: ${complaintId}*
👤 Ism: ${data.fullName}
📛 Username: @${data.username}
🏠 Manzil: ${data.address}
📞 Telefon: ${data.phone}
📑 Pasport: ${data.passport}
📂 Bo'lim: ${data.section}
📋 Murojaat: ${data.summary}
📅 Vaqt: ${time}
📸 Fayllar: ${mediaCount}
  `;

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");
    db.run("INSERT INTO complaints (id, chat_id, username, full_name, address, phone, passport, section, summary, status, time, files) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [complaintId, chatId, data.username, data.fullName, data.address, data.phone, data.passport, data.section, data.summary, 'Pending', time, JSON.stringify(data.media)],
      (err) => {
        if (err) {
          db.run("ROLLBACK");
          logger.error("🚫 Ma'lumotlar bazasiga yozishda xato:", err);
          bot.sendMessage(chatId, "🚫 Murojaat yuborishda xato!");
          bot.sendSticker(chatId, ANIMATIONS.error);
          return;
        }
        db.run("COMMIT");
        sendMessages();
      }
    );
  });

  async function sendMessages() {
    const failedTargets = [];
    try {
      // Matnli xabarni avval yuborish
      try {
        await bot.sendMessage(GROUP_ID, message, { parse_mode: "Markdown" });
        logger.info(`✅ Guruhga (${GROUP_ID}) matnli xabar yuborildi`);
      } catch (err) {
        logger.error("🚫 Guruhga matnli xabar yuborishda xato:", err);
        failedTargets.push(`Guruh (${GROUP_ID})`);
      }
      try {
        await bot.sendMessage(ADMIN_ID, message, { parse_mode: "Markdown" });
        logger.info(`✅ Adminga (${ADMIN_ID}) matnli xabar yuborildi`);
      } catch (err) {
        logger.error("🚫 Adminga matnli xabar yuborishda xato:", err);
        failedTargets.push(`Admin (${ADMIN_ID})`);
      }

      // Fayllarni yuborish
      if (data.media.length > 0) {
        for (const item of data.media) {
          try {
            await sendMediaToTarget(GROUP_ID, item, message);
          } catch (err) {
            failedTargets.push(`Guruh (${GROUP_ID}) fayl`);
          }
          try {
            await sendMediaToTarget(ADMIN_ID, item, message);
          } catch (err) {
            failedTargets.push(`Admin (${ADMIN_ID}) fayl`);
          }
        }
      }

      if (failedTargets.length) {
        bot.sendMessage(chatId, `⚠️ Murojaat yuborildi, lekin xatolar bor: ${failedTargets.join(', ')}`);
        bot.sendSticker(chatId, ANIMATIONS.error);
      } else {
        bot.sendMessage(chatId, languages[userData[chatId].language].success.replace('%s', complaintId), {
          reply_markup: { remove_keyboard: true }
        });
        bot.sendSticker(chatId, ANIMATIONS.clock);
        bot.sendSticker(chatId, ANIMATIONS.success);
        logger.info(`✅ Murojaat ${complaintId} guruhga (${GROUP_ID}) va adminga (${ADMIN_ID}) yuborildi`);
        logAction(chatId, "submit_complaint", `Murojaat ${complaintId} yuborildi`);
      }
    } catch (err) {
      logger.error("🚫 Xabar yuborishda umumiy xato:", err);
      bot.sendMessage(chatId, "🚫 Murojaat yuborishda kutilmagan xato!");
      bot.sendSticker(chatId, ANIMATIONS.error);
    }
  }
}

// Foydalanuvchi murojaatlarini ko‘rsatish
function showUserComplaints(chatId) {
  db.all("SELECT * FROM complaints WHERE chat_id = ?", [chatId], (err, rows) => {
    if (err || !rows.length) {
      bot.sendMessage(chatId, languages[userData[chatId]?.language || 'uz'].noUserComplaints);
      bot.sendSticker(chatId, ANIMATIONS.error);
      return;
    }
    let message = rows.map(row => `ID: ${row.id}\nBo'lim: ${row.section}\nMurojaat: ${row.summary}\nHolati: ${row.status}\nVaqt: ${row.time}`).join('\n\n');
    bot.sendMessage(chatId, languages[userData[chatId]?.language || 'uz'].myComplaints.replace('%s', message));
    logAction(chatId, "view_complaints", "Foydalanuvchi o'z murojaatlarini ko'rdi");
  });
}

// Admin paneli
function showAdminDashboard(chatId) {
  db.all("SELECT * FROM complaints", [], (err, rows) => {
    if (err) {
      logger.error("🚫 Ma'lumotlar bazasi xatosi:", err);
      bot.sendMessage(chatId, "🚫 Ma'lumot olishda xato!");
      bot.sendSticker(chatId, ANIMATIONS.error);
      return;
    }
    const total = rows.length;
    const pending = rows.filter(r => r.status === 'Pending').length;
    const inProgress = rows.filter(r => r.status === 'In Progress').length;
    const resolved = rows.filter(r => r.status === 'Resolved').length;

    bot.sendMessage(chatId, languages.uz.adminDashboard.replace('%s', total).replace('%s', pending).replace('%s', inProgress).replace('%s', resolved), {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          ...Object.keys(sections).map(section => [{ text: section, callback_data: `filter_${section}` }]),
          [{ text: languages.uz.exportReport, callback_data: "export_report" }],
          [{ text: "📢 Broadcast", callback_data: "start_broadcast" }]
        ]
      }
    });
    logAction(chatId, "view_dashboard", "Admin panel ko'rildi");
  });
}

// Bo‘lim bo‘yicha murojaatlarni filtrlash
function filterComplaintsBySection(chatId, section) {
  db.all("SELECT * FROM complaints WHERE section = ?", [sections[section]], (err, rows) => {
    if (err || !rows.length) {
      bot.sendMessage(chatId, languages.uz.noComplaints);
      bot.sendSticker(chatId, ANIMATIONS.error);
      return;
    }
    let message = `📂 *${section} bo'limi:*\n\n`;
    rows.forEach(row => {
      message += `ID: ${row.id}\nIsm: ${row.full_name}\nHolati: ${row.status}\nVaqt: ${row.time}\n\n`;
    });
    bot.sendMessage(chatId, message, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "Pending", callback_data: `status_${rows[0].id}_Pending` }],
          [{ text: "In Progress", callback_data: `status_${rows[0].id}_In Progress` }],
          [{ text: "Resolved", callback_data: `status_${rows[0].id}_Resolved` }]
        ]
      }
    });
  });
}

// Murojaat holatini yangilash
function updateComplaintStatus(chatId, complaintId, newStatus) {
  db.run("UPDATE complaints SET status = ? WHERE id = ?", [newStatus, complaintId], (err) => {
    if (err) {
      logger.error("🚫 Holatni yangilashda xato:", err);
      bot.sendMessage(chatId, "🚫 Holatni yangilashda xato!");
      bot.sendSticker(chatId, ANIMATIONS.error);
      return;
    }
    db.get("SELECT chat_id FROM complaints WHERE id = ?", [complaintId], (err, row) => {
      if (err || !row) {
        bot.sendMessage(chatId, "🚫 Murojaat topilmadi!");
        bot.sendSticker(chatId, ANIMATIONS.error);
        return;
      }
      bot.sendMessage(chatId, languages.uz.statusUpdated.replace('%s', complaintId).replace('%s', newStatus));
      bot.sendMessage(row.chat_id, languages[userData[row.chat_id]?.language || 'uz'].statusUpdated.replace('%s', complaintId).replace('%s', newStatus));
      bot.sendSticker(chatId, ANIMATIONS.success);
      logger.info(`✅ Murojaat ${complaintId} holati ${newStatus} ga yangilandi`);
      logAction(chatId, "update_status", `Murojaat ${complaintId} ${newStatus} ga yangilandi`);
    });
  });
}

// Excelga eksport qilish
async function exportToExcel(chatId) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Complaint Bot';
  workbook.created = new Date();
  workbook.modified = new Date();

  const columns = [
    { header: 'ID', key: 'id', width: 25 },
    { header: 'Chat ID', key: 'chat_id', width: 15 },
    { header: 'Username', key: 'username', width: 20 },
    { header: 'Ism-familiya', key: 'full_name', width: 20 },
    { header: 'Manzil', key: 'address', width: 25 },
    { header: 'Telefon', key: 'phone', width: 15 },
    { header: 'Pasport', key: 'passport', width: 15 },
    { header: 'Bo‘lim', key: 'section', width: 20 },
    { header: 'Murojaat', key: 'summary', width: 50 },
    { header: 'Holati', key: 'status', width: 15 },
    { header: 'Vaqt', key: 'time', width: 20 },
    { header: 'Fayllar', key: 'files', width: 10 },
    { header: 'Xodim', key: 'assignee', width: 20 }
  ];

  db.all("SELECT * FROM complaints", [], async (err, rows) => {
    if (err) {
      logger.error("🚫 Ma'lumotlar bazasi xatosi:", err);
      bot.sendMessage(chatId, "🚫 Xisobot yuklashda xato!");
      bot.sendSticker(chatId, ANIMATIONS.error);
      return;
    }

    const summarySheet = workbook.addWorksheet('Umumiy Hisobot', { properties: { tabColor: { argb: 'FF28A745' } } });
    summarySheet.columns = [
      { header: 'Kategoriya', key: 'category', width: 20 },
      { header: 'Murojaatlar soni', key: 'count', width: 15 },
      { header: 'Foiz (%)', key: 'percentage', width: 10 }
    ];

    const totalComplaints = rows.length;
    const complaintsBySection = {};
    const statusCounts = { Pending: 0, 'In Progress': 0, Resolved: 0 };

    rows.forEach(row => {
      const section = row.section || 'Boshqa';
      complaintsBySection[section] = (complaintsBySection[section] || 0) + 1;
      statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;
    });

    summarySheet.addRow({ category: 'Jami murojaatlar', count: totalComplaints, percentage: '100%' });
    summarySheet.addRow({ category: 'Kutilyapti', count: statusCounts.Pending, percentage: totalComplaints ? ((statusCounts.Pending / totalComplaints) * 100).toFixed(2) + '%' : '0%' });
    summarySheet.addRow({ category: 'Jarayonda', count: statusCounts['In Progress'], percentage: totalComplaints ? ((statusCounts['In Progress'] / totalComplaints) * 100).toFixed(2) + '%' : '0%' });
    summarySheet.addRow({ category: 'Yakunlangan', count: statusCounts.Resolved, percentage: totalComplaints ? ((statusCounts.Resolved / totalComplaints) * 100).toFixed(2) + '%' : '0%' });
    summarySheet.addRow({ category: '', count: '', percentage: '' });

    Object.keys(complaintsBySection).forEach(section => {
      const count = complaintsBySection[section];
      summarySheet.addRow({
        category: section,
        count: count,
        percentage: totalComplaints ? ((count / totalComplaints) * 100).toFixed(2) + '%' : '0%'
      });
    });

    summarySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
    summarySheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF28A745' } };
    summarySheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
    summarySheet.getRow(1).eachCell(cell => {
      cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    });

    summarySheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber > 1) {
        row.eachCell({ includeEmpty: true }, cell => {
          cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
          cell.alignment = { vertical: 'top', horizontal: 'left' };
        });
      }
    });

    const complaintsBySectionData = {};
    rows.forEach(row => {
      const section = row.section || 'Boshqa';
      if (!complaintsBySectionData[section]) {
        complaintsBySectionData[section] = [];
      }
      complaintsBySectionData[section].push(row);
    });

    Object.keys(complaintsBySectionData).forEach(section => {
      const worksheet = workbook.addWorksheet(section, { properties: { tabColor: { argb: 'FF4A90E2' } } });
      worksheet.columns = columns;

      worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
      worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4A90E2' } };
      worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
      worksheet.getRow(1).eachCell(cell => {
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      });

      complaintsBySectionData[section].forEach(row => {
        const rowData = worksheet.addRow({
          id: row.id,
          chat_id: row.chat_id,
          username: row.username || 'Noma\'lum',
          full_name: row.full_name,
          address: row.address,
          phone: row.phone,
          passport: row.passport,
          section: row.section,
          summary: row.summary,
          status: row.status,
          time: row.time,
          files: JSON.parse(row.files || '[]').length,
          assignee: row.assignee || 'Belgilanmagan'
        });

        const daysDiff = Math.floor((new Date() - new Date(row.time)) / (1000 * 60 * 60 * 24));
        const fillColor = daysDiff > 3 ? 'FFF8D7DA' : 'FFD4EDDA';
        rowData.eachCell({ includeEmpty: true }, cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
          cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
          cell.alignment = { vertical: 'top', wrapText: true };
        });
      });

      worksheet.columns.forEach(column => {
        let maxLength = 0;
        column.eachCell({ includeEmpty: true }, cell => {
          const columnLength = cell.value ? cell.value.toString().length : 0;
          maxLength = Math.max(maxLength, columnLength);
        });
        column.width = Math.min(Math.max(maxLength + 2, column.width || 10), 50);
      });
    });

    const fileName = `murojaatlar_${Date.now()}.xlsx`;
    try {
      await workbook.xlsx.writeFile(fileName);
      await bot.sendDocument(chatId, fileName);
      bot.sendMessage(chatId, languages.uz.exportSuccess);
      bot.sendSticker(chatId, ANIMATIONS.success);
      fs.unlinkSync(fileName);
      logger.info(`✅ Admin ${chatId} uchun xisobot eksport qilindi`);
      logAction(chatId, "export_report", "Murojaatlar xisoboti eksport qilindi");
    } catch (err) {
      logger.error("🚫 Xisobot eksport qilishda xato:", err);
      bot.sendMessage(chatId, "🚫 Xisobot yuklashda xato!");
      bot.sendSticker(chatId, ANIMATIONS.error);
    }
  });
}

// Har 3 kunda avto-xisobot
cron.schedule('0 0 */3 * *', () => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Complaint Bot';
  workbook.created = new Date();
  workbook.modified = new Date();

  const columns = [
    { header: 'ID', key: 'id', width: 25 },
    { header: 'Username', key: 'username', width: 20 },
    { header: 'Ism', key: 'full_name', width: 20 },
    { header: 'Manzil', key: 'address', width: 25 },
    { header: 'Telefon', key: 'phone', width: 15 },
    { header: 'Pasport', key: 'passport', width: 15 },
    { header: 'Bo‘lim', key: 'section', width: 20 },
    { header: 'Murojaat', key: 'summary', width: 50 },
    { header: 'Vaqt', key: 'time', width: 20 },
    { header: 'Holati', key: 'status', width: 15 },
    { header: 'Fayllar', key: 'media', width: 10 },
    { header: 'Xodim', key: 'assignee', width: 20 }
  ];

  db.all("SELECT * FROM complaints", [], async (err, rows) => {
    if (err) {
      logger.error("🚫 Avto-xisobot xatosi:", err);
      return;
    }

    const complaintsBySection = {};
    rows.forEach(row => {
      const section = row.section || 'Boshqa';
      if (!complaintsBySection[section]) {
        complaintsBySection[section] = [];
      }
      complaintsBySection[section].push(row);
    });

    Object.keys(complaintsBySection).forEach(section => {
      const worksheet = workbook.addWorksheet(section, { properties: { tabColor: { argb: 'FF4A90E2' } } });
      worksheet.columns = columns;

      worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
      worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4A90E2' } };
      worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
      worksheet.getRow(1).eachCell(cell => {
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      });

      complaintsBySection[section].forEach(row => {
        const rowData = worksheet.addRow({
          id: row.id,
          username: row.username || 'Noma\'lum',
          full_name: row.full_name,
          address: row.address,
          phone: row.phone,
          passport: row.passport,
          section: row.section,
          summary: row.summary,
          time: row.time,
          status: row.status,
          media: JSON.parse(row.files || '[]').length,
          assignee: row.assignee || 'Belgilanmagan'
        });

        const daysDiff = Math.floor((new Date() - new Date(row.time)) / (1000 * 60 * 60 * 24));
        rowData.eachCell({ includeEmpty: true }, cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: daysDiff > 3 ? 'FFF8D7DA' : 'FFD4EDDA' } };
          cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
          cell.alignment = { vertical: 'top', wrapText: true };
        });
      });

      worksheet.columns.forEach(column => {
        let maxLength = 0;
        column.eachCell({ includeEmpty: true }, cell => {
          const columnLength = cell.value ? cell.value.toString().length : 0;
          maxLength = Math.max(maxLength, columnLength);
        });
        column.width = Math.min(Math.max(maxLength + 2, column.width || 10), 50);
      });
    });

    const fileName = `avto_xisobot_${Date.now()}.xlsx`;
    try {
      await workbook.xlsx.writeFile(fileName);
      await bot.sendDocument(ADMIN_ID, fileName);
      bot.sendMessage(ADMIN_ID, `📊 Har 3 kunda avtomatik xisobot: ${fileName}`);
      bot.sendSticker(ADMIN_ID, ANIMATIONS.success);
      fs.unlinkSync(fileName);
      logger.info(`✅ Admin ${ADMIN_ID} uchun avto-xisobot yuborildi`);
      logAction(ADMIN_ID, "auto_export_report", `Avto-xisobot ${fileName} yuborildi`);
    } catch (err) {
      logger.error("🚫 Avto-xisobot yuborishda xato:", err);
      bot.sendMessage(ADMIN_ID, "🚫 Avto-xisobot yuklashda xato!");
      bot.sendSticker(ADMIN_ID, ANIMATIONS.error);
    }
  });
});

// Broadcast tozalash
function cleanupBroadcast(chatId) {
  if (userSteps[chatId] === 'askBroadcast') {
    delete userSteps[chatId];
    delete userData[chatId].broadcastMessage;
  }
}

// Ma'lumotlarni tozalash
function cleanupUserData(chatId) {
  if (userSteps[chatId] && userSteps[chatId] !== 'askBroadcast') {
    delete userSteps[chatId];
    delete userData[chatId];
  }
}

// Xatolarni ushlash
process.on('unhandledRejection', (reason, promise) => {
  logger.error('🚫 Unhandled Rejection at:', promise, 'reason:', reason);
  bot.sendMessage(ADMIN_ID, `🚫 Kutilmagan xato yuz berdi: ${reason}`);
});

// Polling xatosi
bot.on('polling_error', (error) => {
  logger.error('🚫 Polling xatosi:', error);
  bot.sendMessage(ADMIN_ID, `🚫 Polling xatosi: ${error.message}`);
});

// Bot ishga tushdi
bot.on('polling', () => {
  logger.info('✅ Bot ishga tushdi');
  bot.sendMessage(ADMIN_ID, '✅ Bot muvaffaqiyatli ishga tushdi!');
});

// Statistikani ko‘rsatish uchun admin paneli
bot.onText(/\/dashboard/, (msg) => {
  const chatId = msg.chat.id;
  if (chatId !== ADMIN_ID) {
    bot.sendMessage(chatId, languages.uz.invalidCommand);
    bot.sendSticker(chatId, ANIMATIONS.error);
    return;
  }
  showAdminDashboard(chatId);
});

// Xatolar jurnalini ko‘rish
bot.onText(/\/logs/, (msg) => {
  const chatId = msg.chat.id;
  if (chatId !== ADMIN_ID) {
    bot.sendMessage(chatId, languages.uz.invalidCommand);
    bot.sendSticker(chatId, ANIMATIONS.error);
    return;
  }
  db.all("SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 50", [], (err, rows) => {
    if (err || !rows.length) {
      bot.sendMessage(chatId, "🚫 Loglar topilmadi yoki xato yuz berdi!");
      bot.sendSticker(chatId, ANIMATIONS.error);
      return;
    }
    let message = "📜 *So‘nggi 50 ta harakat:*\n\n";
    rows.forEach(row => {
      message += `ID: ${row.id}\nFoydalanuvchi: ${row.user_id}\nHarakat: ${row.action}\nTafsilot: ${row.details}\nVaqt: ${row.timestamp}\n\n`;
    });
    bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
    bot.sendSticker(chatId, ANIMATIONS.success);
    logAction(chatId, "view_logs", "Admin loglarni ko‘rdi");
  });
});

// Botni to‘xtatish
process.on('SIGINT', () => {
  logger.info('🚪 Bot to‘xtatilmoqda...');
  db.close(() => {
    logger.info('✅ Ma\'lumotlar bazasi yopildi');
    process.exit(0);
  });
});

// Test uchun guruhga xabar yuborish
bot.onText(/\/test/, async (msg) => {
  const chatId = msg.chat.id;
  if (chatId !== ADMIN_ID) {
    bot.sendMessage(chatId, languages.uz.invalidCommand);
    bot.sendSticker(chatId, ANIMATIONS.error);
    return;
  }
  try {
    await bot.sendMessage(GROUP_ID, "📢 Test xabari: Bot ishlayapti!");
    bot.sendMessage(chatId, "✅ Guruhga test xabari yuborildi!");
    bot.sendSticker(chatId, ANIMATIONS.success);
    logger.info(`✅ Admin ${chatId} tomonidan guruhga test xabari yuborildi`);
    logAction(chatId, "test_message", "Guruhga test xabari yuborildi");
  } catch (err) {
    logger.error("🚫 Test xabari yuborishda xato:", err);
    bot.sendMessage(chatId, "🚫 Guruhga test xabari yuborishda xato!");
    bot.sendSticker(chatId, ANIMATIONS.error);
  }
});