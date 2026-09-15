const { Attendance, User, Shift } = require('../models');
const { Op } = require('sequelize');
const PayrollService = require('../services/payroll');
const telegramService = require('../services/telegram');

const attendanceController = {
  /**
   * Turniketdan kelgan webhook - CHECK-IN / CHECK-OUT
   */
  async turnstileWebhook(req, res) {
    try {
      const { user_id, card_id, face_id, timestamp, device_id } = req.body;

      if (!user_id && !card_id && !face_id) {
        return res.status(400).json({ error: 'user_id, card_id yoki face_id talab qilinadi' });
      }

      const eventTime = timestamp ? new Date(timestamp) : new Date();
      const today = eventTime.toISOString().split('T')[0];

      // Hodimni topish: user_id, karta ID yoki yuz ID orqali
      let user = null;
      if (user_id) {
        user = await User.findOne({ where: { id: user_id, is_active: true } });
      }
      if (!user && card_id) {
        user = await User.findOne({ where: { card_id, is_active: true } });
      }
      if (!user && face_id) {
        user = await User.findOne({ where: { face_id, is_active: true } });
      }

      if (!user) {
        return res.status(404).json({ error: 'Hodim topilmadi (karta/yuz ID baza bilan mos kelmayapti)' });
      }

      // Bugungi smena topish
      const shift = await Shift.findOne({
        where: { user_id: user.id, shift_date: today },
      });

      // Bugungi davomat yozuvini tekshirish
      const existingAttendance = await Attendance.findOne({
        where: {
          user_id: user.id,
          check_in: {
            [Op.gte]: new Date(today + 'T00:00:00'),
            [Op.lt]: new Date(today + 'T23:59:59'),
          },
        },
      });

      let attendance;
      let eventType;

      if (!existingAttendance) {
        // CHECK-IN (Birinchi kirish)
        const lateMinutes = PayrollService.calculateLateMinutes(eventTime, shift);

        attendance = await Attendance.create({
          user_id: user.id,
          shift_id: shift ? shift.id : null,
          check_in: eventTime,
          late_minutes: lateMinutes,
          // Kech qolgan bo'lsa 'late', aks holda 'present'
          status: lateMinutes > 0 ? 'late' : 'present',
        });

        eventType = 'CHECK_IN';

        // Shu oydagi jami dijurliklar sonini hisoblash
        const monthStart = new Date(eventTime.getFullYear(), eventTime.getMonth(), 1);
        const monthEnd = new Date(eventTime.getFullYear(), eventTime.getMonth() + 1, 0, 23, 59, 59);
        const monthlyCount = await Attendance.count({
          where: {
            user_id: user.id,
            check_in: { [Op.gte]: monthStart, [Op.lte]: monthEnd }
          }
        });

        // Telegram xabar yuborish (avtomatik push)
        telegramService.sendCheckInNotification(user, eventTime, monthlyCount);
      } else {
        // CHECK-OUT (yoki qayta ketishni urish)
        const workedHours = PayrollService.calculateWorkedHours(
          existingAttendance.check_in,
          eventTime
        );

        const salaryData = PayrollService.calculateDailySalary(
          workedHours,
          existingAttendance.late_minutes,
          user,
          shift
        );

        await existingAttendance.update({
          check_out: eventTime,
          ...salaryData,
        });

        attendance = existingAttendance;
        eventType = 'CHECK_OUT';

        // Smena statusini yangilash
        if (shift) {
          await shift.update({ status: 'completed' });
        }

        // Shu oydagi jami dijurliklar sonini hisoblash
        const monthStart = new Date(eventTime.getFullYear(), eventTime.getMonth(), 1);
        const monthEnd = new Date(eventTime.getFullYear(), eventTime.getMonth() + 1, 0, 23, 59, 59);
        const monthlyCount = await Attendance.count({
          where: {
            user_id: user.id,
            check_in: { [Op.gte]: monthStart, [Op.lte]: monthEnd }
          }
        });

        // Telegram xabar yuborish (avtomatik push)
        telegramService.sendCheckOutNotification(user, eventTime, monthlyCount);
      }

      // Socket.IO orqali live monitor yangilash
      const io = req.app.get('io');
      if (io) {
        io.emit('turnstile_event', {
          event: eventType,
          user: {
            id: user.id,
            full_name: user.full_name,
            department: user.department,
            position: user.position,
            avatar_url: user.avatar_url,
          },
          time: eventTime,
          attendance,
        });
      }

      res.json({
        event: eventType,
        user: { id: user.id, full_name: user.full_name, department: user.department, position: user.position },
        late_minutes: attendance.late_minutes || 0,
        status: attendance.status,
        attendance,
      });
    } catch (err) {
      console.error('Turnstile webhook error:', err);
      res.status(500).json({ error: 'Server xatosi' });
    }
  },

  /**
   * Davomat yozuvlarini olish
   */
  async getAll(req, res) {
    try {
      const { user_id, date, start_date, end_date, status } = req.query;
      const where = {};

      if (user_id) where.user_id = user_id;
      if (status) where.status = status;

      if (date) {
        where.check_in = {
          [Op.gte]: new Date(date + 'T00:00:00'),
          [Op.lt]: new Date(date + 'T23:59:59'),
        };
      } else if (start_date && end_date) {
        where.check_in = {
          [Op.between]: [new Date(start_date), new Date(end_date + 'T23:59:59')],
        };
      }

      const attendances = await Attendance.findAll({
        where,
        include: [
          { model: User, as: 'user', attributes: ['id', 'full_name', 'department', 'position', 'avatar_url'] },
          { model: Shift, as: 'shift' },
        ],
        order: [['check_in', 'DESC']],
      });

      res.json(attendances);
    } catch (err) {
      console.error('Get attendance error:', err);
      res.status(500).json({ error: 'Server xatosi' });
    }
  },

  /**
   * Qo'lda tahrirlash (Manual Override)
   */
  async override(req, res) {
    try {
      const attendance = await Attendance.findByPk(req.params.id, {
        include: [
          { model: User, as: 'user' },
          { model: Shift, as: 'shift' },
        ],
      });

      if (!attendance) {
        return res.status(404).json({ error: 'Davomat yozuvi topilmadi' });
      }

      const { check_in, check_out, status, override_reason } = req.body;

      const updates = {
        is_manual_override: true,
        override_reason: override_reason || 'Admin tomonidan tahrirlangan',
      };

      if (check_in) updates.check_in = new Date(check_in);
      if (check_out) updates.check_out = new Date(check_out);
      if (status) updates.status = status;

      // Agar check_out yangilansa, maoshni qayta hisoblash
      const finalCheckIn = updates.check_in || attendance.check_in;
      const finalCheckOut = updates.check_out || attendance.check_out;

      if (finalCheckIn && finalCheckOut) {
        const workedHours = PayrollService.calculateWorkedHours(finalCheckIn, finalCheckOut);
        const lateMinutes = attendance.shift
          ? PayrollService.calculateLateMinutes(new Date(finalCheckIn), attendance.shift)
          : 0;

        const salaryData = PayrollService.calculateDailySalary(
          workedHours,
          lateMinutes,
          attendance.user,
          attendance.shift
        );

        Object.assign(updates, salaryData);
        updates.late_minutes = lateMinutes;
      }

      await attendance.update(updates);

      res.json(attendance);
    } catch (err) {
      console.error('Override error:', err);
      res.status(500).json({ error: 'Server xatosi' });
    }
  },

  /**
   * Bugungi davomat (incomplete yozuvlar - kechki log yo'q)
   */
  async getIncomplete(req, res) {
    try {
      const today = new Date().toISOString().split('T')[0];

      const incomplete = await Attendance.findAll({
        where: {
          check_out: null,
          check_in: {
            [Op.gte]: new Date(today + 'T00:00:00'),
            [Op.lt]: new Date(today + 'T23:59:59'),
          },
        },
        include: [
          { model: User, as: 'user', attributes: ['id', 'full_name', 'department'] },
        ],
      });

      res.json(incomplete);
    } catch (err) {
      res.status(500).json({ error: 'Server xatosi' });
    }
  },
};

module.exports = attendanceController;
