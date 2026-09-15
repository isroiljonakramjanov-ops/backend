const path = require('path');
const fs = require('fs');

/**
 * Telegram Bot xabar yuborish xizmati
 * Hozircha mock rejimda ishlaydi, keyin real Telegram API ulanadi
 */

class TelegramService {
  constructor() {
    this.enabled = false;
    const token = process.env.TELEGRAM_BOT_TOKEN || '8982817506:AAGEepl6prLKJxA7gDRLlG3RxuCotm6TrbQ';
    if (token) {
      try {
        const TelegramBot = require('node-telegram-bot-api');
        this.bot = new TelegramBot(token, { polling: false });
        this.enabled = true;
      } catch (err) {
        console.warn('Telegram bot init error:', err.message);
      }
    }
  }

  /**
   * Hodimga CHECK-IN xabari yuborish
   */
  async sendCheckInNotification(user, checkInTime, monthlyCount = 1) {
    if (!user || !user.telegram_chat_id) return;
    const time = this.formatTime(checkInTime);
    const dateStr = new Date(checkInTime).toLocaleDateString('uz-UZ');

    const message = `🟢 <b>KELISH QAYD ETILDI</b>\n\n`
      + `👤 <b>Hodim:</b> ${user.full_name}\n`
      + `📥 <b>Kelish vaqti:</b> ${time}\n`
      + `📅 <b>Sana:</b> ${dateStr}\n\n`
      + `📊 <b>Shu oydagi jami dijurliklaringiz:</b> ${monthlyCount} ta`;

    if (user.avatar_url) {
      return this.sendPhotoMessage(user.telegram_chat_id, user.avatar_url, message);
    }
    return this.sendMessage(user.telegram_chat_id, message);
  }

  /**
   * Hodimga CHECK-OUT xabari yuborish
   */
  async sendCheckOutNotification(user, checkOutTime, monthlyCount = 1) {
    if (!user || !user.telegram_chat_id) return;
    const time = this.formatTime(checkOutTime);
    const dateStr = new Date(checkOutTime).toLocaleDateString('uz-UZ');

    const message = `🔴 <b>CHIQUV QAYD ETILDI</b>\n\n`
      + `👤 <b>Hodim:</b> ${user.full_name}\n`
      + `📤 <b>Chiqish vaqti:</b> ${time}\n`
      + `📅 <b>Sana:</b> ${dateStr}\n\n`
      + `📊 <b>Shu oydagi jami dijurliklaringiz:</b> ${monthlyCount} ta`;

    if (user.avatar_url) {
      return this.sendPhotoMessage(user.telegram_chat_id, user.avatar_url, message);
    }
    return this.sendMessage(user.telegram_chat_id, message);
  }

  /**
   * Dijurlik eslatmasi yuborish
   */
  async sendShiftReminder(user, shift) {
    const message = `⏰ *Eslatma*\n`
      + `Bugun soat *${shift.start_time}* da dijurligingiz boshlanadi.\n`
      + `Kelishni unutmang!`;

    return this.sendMessage(user.telegram_chat_id, message);
  }

  /**
   * Karta urish eslatmasi
   */
  async sendCardReminder(user) {
    const message = `⚠️ *Diqqat!*\n`
      + `Smenangiz tugadi, lekin ketayotganda turniketga karta urishni unutdingiz.\n`
      + `Iltimos, turniketdan o'ting!`;

    return this.sendMessage(user.telegram_chat_id, message);
  }

  /**
   * Direktorga kunlik davomat hisoboti
   */
  async sendDailyReport(chatId, report) {
    const message = `📊 *Bugungi Davomat Hisoboti*\n`
      + `━━━━━━━━━━━━━━━━━\n`
      + `👥 Jami hodimlar: *${report.total}*\n`
      + `✅ Ishda: *${report.present}* (${report.presentPercent}%)\n`
      + `❌ Kelmagan: *${report.absent}*\n`
      + `⏰ Kechikkan: *${report.late}*\n`
      + `━━━━━━━━━━━━━━━━━`;

    return this.sendMessage(chatId, message);
  }

  /**
   * Xabar yuborish
   */
  async sendMessage(chatId, message) {
    if (!chatId) {
      console.log('[TELEGRAM MOCK]:', message.replace(/\*/g, ''));
      return { success: true, mock: true };
    }

    if (this.enabled && this.bot) {
      try {
        await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        return { success: true };
      } catch (err) {
        console.error('[TELEGRAM ERROR]:', err.message);
        return { success: false, error: err.message };
      }
    }

    console.log('[TELEGRAM MOCK]:', message.replace(/\*/g, ''));
    return { success: true, mock: true };
  }

  /**
   * Rasm bilan xabar yuborish
   */
  async sendPhotoMessage(chatId, photoUrl, caption) {
    if (!chatId) {
      console.log(`[TELEGRAM MOCK PHOTO]: ${photoUrl}`);
      console.log(`[TELEGRAM MOCK CAPTION]:\n${caption.replace(/\*/g, '')}`);
      return { success: true, mock: true };
    }

    if (this.enabled && this.bot) {
      try {
        let photoData = photoUrl;
        
        if (photoUrl && photoUrl.startsWith('/uploads/')) {
          const uploadsPath = path.join(__dirname, '../../uploads', photoUrl.replace('/uploads/', ''));
          if (fs.existsSync(uploadsPath)) {
            photoData = uploadsPath;
          } else {
            const rootPath = path.join(process.cwd(), photoUrl);
            if (fs.existsSync(rootPath)) {
              photoData = rootPath;
            }
          }
        }
        
        if (photoData && (fs.existsSync(photoData) || photoData.startsWith('http'))) {
          await this.bot.sendPhoto(chatId, photoData, { caption, parse_mode: 'HTML' });
        } else {
          await this.bot.sendMessage(chatId, caption, { parse_mode: 'HTML' });
        }
        return { success: true };
      } catch (err) {
        console.error('[TELEGRAM PHOTO ERROR]:', err.message);
        try {
          await this.bot.sendMessage(chatId, caption, { parse_mode: 'HTML' });
        } catch (e) {}
        return { success: false, error: err.message };
      }
    }

    console.log(`[TELEGRAM MOCK PHOTO]: ${photoUrl}`);
    console.log(`[TELEGRAM MOCK CAPTION]:\n${caption.replace(/\*/g, '')}`);
    return { success: true, mock: true };
  }

  formatTime(date) {
    return new Date(date).toLocaleTimeString('uz-UZ', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  formatMoney(amount) {
    return new Intl.NumberFormat('uz-UZ').format(amount);
  }
}

module.exports = new TelegramService();
