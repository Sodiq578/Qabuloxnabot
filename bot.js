require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const winston = require('winston');

// Configuration
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = process.env.ADMIN_IDS.split(',').map(id => parseInt(id.trim()));
const GROUP_ID = parseInt(process.env.TARGET_CHAT_ID);

if (!BOT_TOKEN || !ADMIN_IDS.length || !GROUP_ID) {
  console.error('🚫 Muhim muhit o\'zgaruvchilari yetishmayapti!');
  process.exit(1);
}

// Initialize bot
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Logger setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.File({ filename: 'bot.log' })]
});

// Database setup
const db = new sqlite3.Database('complaints.db', (err) => {
  if (err) {
    logger.error('Bazaga ulanishda xato:', err);
    process.exit(1);
  }
  logger.info('✅ Bazaga ulandi');
});

// Create tables if they don't exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS murojaatlar (
    id TEXT PRIMARY KEY,
    chat_id INTEGER,
    foydalanuvchi_nomi TEXT,
    toliq_ism TEXT,
    manzil TEXT,
    telefon TEXT,
    pasport TEXT,
    bolim TEXT,
    murojaat TEXT,
    holat TEXT DEFAULT 'Kutilmoqda',
    vaqt TEXT,
    fayllar TEXT
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS bloklangan_foydalanuvchilar (
    foydalanuvchi_id INTEGER PRIMARY KEY,
    vaqt TEXT
  )`);
});

// Messages
const messages = {
  askName: "📝 Ismingizni yozing:",
  askAddress: "🏠 Manzilingizni yozing:",
  askPhone: "📞 Telefon raqamingizni yozing (+998901234567):",
  askPassport: "📑 Pasport raqamingizni yozing (AA1234567):",
  askSection: "📂 Murojaat bo'limini tanlang:",
  askSummary: "📋 Murojaatni qisqacha yozing:",
  askMedia: "📸 Rasm yoki video yuboring yoki 'Tayyor' ni bosing:",
  mediaReceived: "✅ Fayl qabul qilindi! Yana yuborasizmi yoki 'Tayyor' ni bosing.",
  confirm: `📝 Tekshiring:
👤 Ism: %s
🏠 Manzil: %s
📞 Telefon: %s
📂 Bo'lim: %s
📋 Murojaat: %s
📸 Fayllar: %s

To'g'rimi?`,
  success: "✅ Murojaatingiz qabul qilindi! ID: %s\n⏰ 1 kunda ko'rib chiqiladi.",
  statusUpdated: "✅ Murojaat #%s holati: %s",
  statusNotification: `📢 Murojaatingiz holati yangilandi!
  
ID: %s
Holat: %s
Bo'lim: %s`,
  invalidCommand: "🚫 Faqat admin uchun!",
  noComplaints: "🚫 Murojaatlar yo'q.",
  exportSuccess: "✅ Xisobot yuklandi!",
  myComplaints: "📋 Murojaatlaringiz:\n\n%s",
  noUserComplaints: "🚫 Murojaatlaringiz yo'q.",
  back: "⬅️ Orqaga",
  help: `/start - Yangi murojaat
/mycomplaints - Murojaatlarim
/help - Yordam`
};

// Status translations
const statusTranslations = {
  'Kutilmoqda': 'Kutilmoqda',
  'Jarayonda': 'Jarayonda',
  'Yakunlandi': 'Yakunlandi',
  'Pending': 'Kutilmoqda',
  'In Progress': 'Jarayonda',
  'Resolved': 'Yakunlandi'
};

// Sections
const sections = {
  "🛣 Yo'l qurilishi": "Yo'l qurilishi",
  "🏫 Ta'lim": "Ta'lim",
  "🆘 Amaliy yordam": "Amaliy yordam",
  "🏥 Sog'liqni saqlash": "Sog'liqni saqlash",
  "🏘 Uy-joy": "Uy-joy",
  "💧 Ichimlik suvi": "Ichimlik suvi",
  "🚰 Kanalizatsiya": "Kanalizatsiya",
  "💡 Elektr": "Elektr",
  "📶 Internet": "Internet",
  "🚜 Qishloq xo'jaligi": "Qishloq xo'jaligi",
  "🛍 Ijtimoiy yordam": "Ijtimoiy yordam",
  "🧑‍💼 Ish": "Ish",
  "🚓 Xavfsizlik": "Xavfsizlik",
  "♿️ Nogironlar": "Nogironlar",
  "🧾 Hujjatlar": "Hujjatlar",
  "🙏 Minnatdorchilik": "Minnatdorchilik",
  "📌 Boshqa": "Boshqa"
};

// User state management
const userSteps = {};
const userData = {};

// Helper functions
function generateShortId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function isUserBlocked(chatId) {
  return new Promise(resolve => {
    db.get("SELECT 1 FROM bloklangan_foydalanuvchilar WHERE foydalanuvchi_id = ?", [chatId], (err, row) => {
      resolve(!!row);
    });
  });
}

function isAdmin(chatId) {
  return ADMIN_IDS.includes(chatId);
}

// Command handlers
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (msg.chat.type !== 'private') return;
  if (await isUserBlocked(chatId)) {
    return bot.sendMessage(chatId, "🚫 Siz bloklangansiz!");
  }

  userSteps[chatId] = 'askName';
  userData[chatId] = { media: [] };
  bot.sendMessage(chatId, messages.askName, {
    reply_markup: { inline_keyboard: [[{ text: messages.back, callback_data: "back_to_name" }]] }
  });
});

bot.onText(/\/mycomplaints/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (msg.chat.type !== 'private') return;
  if (await isUserBlocked(chatId)) {
    return bot.sendMessage(chatId, "🚫 Siz bloklangansiz!");
  }

  db.all("SELECT id, bolim, murojaat, holat FROM murojaatlar WHERE chat_id = ?", [chatId], (err, rows) => {
    if (err || !rows?.length) {
      return bot.sendMessage(chatId, messages.noUserComplaints);
    }
    const complaints = rows.map(r => `ID: ${r.id}\nBo'lim: ${r.bolim}\nHolati: ${statusTranslations[r.holat] || r.holat}\nMurojaat: ${r.murojaat}`).join('\n\n');
    bot.sendMessage(chatId, messages.myComplaints.replace('%s', complaints));
  });
});

bot.onText(/\/status (\S+) (\S+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return bot.sendMessage(chatId, messages.invalidCommand);

  const [, id, status] = match;
  const validStatuses = ['Kutilmoqda', 'Jarayonda', 'Yakunlandi', 'Pending', 'In Progress', 'Resolved'];
  
  if (!validStatuses.includes(status)) {
    return bot.sendMessage(chatId, "🚫 Noto'g'ri holat! Kutilmoqda, Jarayonda yoki Yakunlandi bo'lishi kerak.");
  }

  // Get complaint details before updating
  db.get("SELECT chat_id, bolim FROM murojaatlar WHERE id = ?", [id], (err, row) => {
    if (err || !row) {
      logger.error('Status update error:', err);
      return bot.sendMessage(chatId, "🚫 Murojaat topilmadi!");
    }

    const translatedStatus = statusTranslations[status] || status;
    
    db.run("UPDATE murojaatlar SET holat = ? WHERE id = ?", [translatedStatus, id], (err) => {
      if (err) {
        logger.error('Status update error:', err);
        return bot.sendMessage(chatId, "🚫 Holatni yangilashda xato!");
      }
      
      // Send notification to user
      const userNotification = messages.statusNotification
        .replace('%s', id)
        .replace('%s', translatedStatus)
        .replace('%s', row.bolim);
      
      bot.sendMessage(row.chat_id, userNotification);
      
      // Send notification to group
      const groupNotification = `📢 Murojaat holati yangilandi!\n\nID: ${id}\nHolat: ${translatedStatus}\nBo'lim: ${row.bolim}\nAdmin: @${msg.from.username || 'noma\'lum'}`;
      bot.sendMessage(GROUP_ID, groupNotification);
      
      // Send confirmation to admin
      bot.sendMessage(chatId, messages.statusUpdated.replace('%s', id).replace('%s', translatedStatus));
    });
  });
});

bot.onText(/\/export/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return bot.sendMessage(chatId, messages.invalidCommand);

  db.all("SELECT * FROM murojaatlar", [], (err, rows) => {
    if (err || !rows?.length) {
      return bot.sendMessage(chatId, messages.noComplaints);
    }

    const csv = [
      'ID,Foydalanuvchi nomi,To\'liq ism,Manzil,Telefon,Pasport,Bo\'lim,Murojaat,Holat,Vaqt,Fayllar',
      ...rows.map(r => `${r.id},${r.foydalanuvchi_nomi || ''},${r.toliq_ism},${r.manzil},${r.telefon},${r.pasport},${r.bolim},"${r.murojaat}",${r.holat},${r.vaqt},${JSON.parse(r.fayllar || '[]').length}`)
    ].join('\n');

    const fileName = `murojaatlar_${Date.now()}.csv`;
    fs.writeFileSync(fileName, csv);
    
    bot.sendDocument(chatId, fileName)
      .then(() => fs.unlinkSync(fileName))
      .catch(err => {
        logger.error('Export error:', err);
        bot.sendMessage(chatId, "🚫 Xisobot yuklashda xato!");
      });
  });
});

bot.onText(/\/block (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return bot.sendMessage(chatId, messages.invalidCommand);

  const [, userId] = match;
  db.run("INSERT OR REPLACE INTO bloklangan_foydalanuvchilar (foydalanuvchi_id, vaqt) VALUES (?, ?)", 
    [userId, new Date().toISOString()], 
    (err) => {
      if (err) {
        logger.error('Block user error:', err);
        return bot.sendMessage(chatId, `🚫 Foydalanuvchi #${userId} bloklashda xato!`);
      }
      bot.sendMessage(chatId, `✅ Foydalanuvchi #${userId} bloklandi!`);
    }
  );
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  if (msg.chat.type !== 'private') return;
  bot.sendMessage(chatId, messages.help);
});

// Callback query handler
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  
  if (query.message.chat.type !== 'private') {
    return bot.answerCallbackQuery(query.id);
  }

  try {
    if (data.startsWith('section_')) {
      userData[chatId].section = sections[data.replace('section_', '')];
      userSteps[chatId] = 'askSummary';
      await bot.sendMessage(chatId, messages.askSummary, {
        reply_markup: { inline_keyboard: [[{ text: messages.back, callback_data: "back_to_passport" }]] }
      });
    } 
    else if (data === "back_to_name") {
      userSteps[chatId] = 'askName';
      await bot.sendMessage(chatId, messages.askName, {
        reply_markup: { inline_keyboard: [[{ text: messages.back, callback_data: "back_to_name" }]] }
      });
    } 
    else if (data === "back_to_address") {
      userSteps[chatId] = 'askAddress';
      await bot.sendMessage(chatId, messages.askAddress, {
        reply_markup: { inline_keyboard: [[{ text: messages.back, callback_data: "back_to_name" }]] }
      });
    } 
    else if (data === "back_to_phone") {
      userSteps[chatId] = 'askPhone';
      await bot.sendMessage(chatId, messages.askPhone, {
        reply_markup: { keyboard: [[{ text: "📞 Raqamni ulashish", request_contact: true }]], resize_keyboard: true }
      });
    } 
    else if (data === "back_to_passport") {
      userSteps[chatId] = 'askPassport';
      await bot.sendMessage(chatId, messages.askPassport, {
        reply_markup: { inline_keyboard: [[{ text: messages.back, callback_data: "back_to_phone" }]] }
      });
    } 
    else if (data === "back_to_section") {
      userSteps[chatId] = 'askSection';
      await bot.sendMessage(chatId, messages.askSection, {
        reply_markup: { 
          inline_keyboard: [
            ...Object.keys(sections).map(s => [{ text: s, callback_data: `section_${s}` }]),
            [{ text: messages.back, callback_data: "back_to_passport" }]
          ]
        }
      });
    } 
    else if (data === "ready") {
      const d = userData[chatId];
      await bot.sendMessage(chatId, messages.confirm
        .replace('%s', d.fullName)
        .replace('%s', d.address)
        .replace('%s', d.phone)
        .replace('%s', d.section)
        .replace('%s', d.summary)
        .replace('%s', d.media.length ? `${d.media.length} ta` : "Yo'q"), {
        reply_markup: { 
          inline_keyboard: [
            [{ text: "✅ Yuborish", callback_data: "submit" }],
            [{ text: "✏️ Tahrirlash", callback_data: "edit" }]
          ]
        }
      });
      userSteps[chatId] = 'askConfirmation';
    } 
    else if (data === "submit") {
      const d = userData[chatId];
      const id = generateShortId();
      const time = new Date().toLocaleString('uz-UZ');
      
      const complaintMessage = `📝 *Yangi Murojaat #${id}*\n👤 Ism: ${d.fullName}\n📛 @${d.username}\n🏠 Manzil: ${d.address}\n📞 Telefon: ${d.phone}\n📂 Bo'lim: ${d.section}\n📋 Murojaat: ${d.summary}\n📅 Vaqt: ${time}\n🔰 Holat: Kutilmoqda`;

      db.run(
        "INSERT INTO murojaatlar (id, chat_id, foydalanuvchi_nomi, toliq_ism, manzil, telefon, pasport, bolim, murojaat, holat, vaqt, fayllar) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [id, chatId, d.username, d.fullName, d.address, d.phone, d.passport, d.section, d.summary, 'Kutilmoqda', time, JSON.stringify(d.media)],
        async (err) => {
          if (err) {
            logger.error('Database insert error:', err);
            await bot.sendMessage(chatId, "🚫 Xato yuz berdi!");
            return;
          }

          // Send text message to group and admins
          await bot.sendMessage(GROUP_ID, complaintMessage, { parse_mode: "Markdown" });
          ADMIN_IDS.forEach(adminId => bot.sendMessage(adminId, complaintMessage, { parse_mode: "Markdown" }));

          // Send media files if any
          for (const media of d.media) {
            try {
              if (media.type === 'photo') {
                await bot.sendPhoto(GROUP_ID, media.media, { caption: complaintMessage, parse_mode: "Markdown" });
              } else if (media.type === 'video') {
                await bot.sendVideo(GROUP_ID, media.media, { caption: complaintMessage, parse_mode: "Markdown" });
              }
            } catch (error) {
              logger.error('Media send error:', error);
            }
          }

          await bot.sendMessage(chatId, messages.success.replace('%s', id));
          delete userSteps[chatId];
          delete userData[chatId];
        }
      );
    } 
    else if (data === "edit") {
      userSteps[chatId] = 'askName';
      await bot.sendMessage(chatId, messages.askName, {
        reply_markup: { inline_keyboard: [[{ text: messages.back, callback_data: "back_to_name" }]] }
      });
    }
  } catch (error) {
    logger.error('Callback error:', error);
  } finally {
    bot.answerCallbackQuery(query.id);
  }
});

// Message handler
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (msg.chat.type !== 'private') return;
  if (await isUserBlocked(chatId)) return bot.sendMessage(chatId, "🚫 Siz bloklangansiz!");
  if (!userSteps[chatId] || text?.startsWith('/')) return;

  try {
    switch (userSteps[chatId]) {
      case 'askName':
        userData[chatId].fullName = text;
        userData[chatId].username = msg.from.username || "Noma'lum";
        userSteps[chatId] = 'askAddress';
        await bot.sendMessage(chatId, messages.askAddress, {
          reply_markup: { inline_keyboard: [[{ text: messages.back, callback_data: "back_to_name" }]] }
        });
        break;

      case 'askAddress':
        userData[chatId].address = text;
        userSteps[chatId] = 'askPhone';
        await bot.sendMessage(chatId, messages.askPhone, {
          reply_markup: { 
            keyboard: [[{ text: "📞 Raqamni ulashish", request_contact: true }]], 
            resize_keyboard: true,
            one_time_keyboard: true 
          }
        });
        break;

      case 'askPhone':
        userData[chatId].phone = msg.contact?.phone_number || text;
        userSteps[chatId] = 'askPassport';
        await bot.sendMessage(chatId, messages.askPassport, {
          reply_markup: { inline_keyboard: [[{ text: messages.back, callback_data: "back_to_phone" }]] }
        });
        break;

      case 'askPassport':
        userData[chatId].passport = text;
        userSteps[chatId] = 'askSection';
        await bot.sendMessage(chatId, messages.askSection, {
          reply_markup: { 
            inline_keyboard: [
              ...Object.keys(sections).map(s => [{ text: s, callback_data: `section_${s}` }]),
              [{ text: messages.back, callback_data: "back_to_passport" }]
            ]
          }
        });
        break;

      case 'askSummary':
        userData[chatId].summary = text;
        userSteps[chatId] = 'askMedia';
        await bot.sendMessage(chatId, messages.askMedia, {
          reply_markup: { 
            inline_keyboard: [
              [{ text: "✅ Tayyor", callback_data: "ready" }],
              [{ text: messages.back, callback_data: "back_to_section" }]
            ]
          }
        });
        break;

      case 'askMedia':
        if (msg.photo) {
          userData[chatId].media.push({ type: 'photo', media: msg.photo[msg.photo.length - 1].file_id });
          await bot.sendMessage(chatId, messages.mediaReceived, {
            reply_markup: { 
              inline_keyboard: [
                [{ text: "✅ Tayyor", callback_data: "ready" }],
                [{ text: messages.back, callback_data: "back_to_section" }]
              ]
            }
          });
        } else if (msg.video) {
          userData[chatId].media.push({ type: 'video', media: msg.video.file_id });
          await bot.sendMessage(chatId, messages.mediaReceived, {
            reply_markup: { 
              inline_keyboard: [
                [{ text: "✅ Tayyor", callback_data: "ready" }],
                [{ text: messages.back, callback_data: "back_to_section" }]
              ]
            }
          });
        } else if (text !== 'Tayyor') {
          await bot.sendMessage(chatId, "🚫 Iltimos, rasm yoki video yuboring yoki 'Tayyor' ni bosing!");
        }
        break;
    }
  } catch (error) {
    logger.error('Message handling error:', error);
    await bot.sendMessage(chatId, "🚫 Xatolik yuz berdi! Iltimos, qaytadan urinib ko'ring.");
  }
});

// Bot startup
logger.info('✅ Bot ishga tushdi');
ADMIN_IDS.forEach(adminId => bot.sendMessage(adminId, '✅ Bot ishga tushdi!'));