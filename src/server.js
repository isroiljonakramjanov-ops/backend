require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const sequelize = require('./config/database');
const setupWebSocket = require('./websocket/liveMonitor');
const setupCronJobs = require('./jobs/reminders');

// Import routes
const authRoutes = require('./routes/auth');
const employeeRoutes = require('./routes/employees');
const shiftRoutes = require('./routes/shifts');
const attendanceRoutes = require('./routes/attendance');
const payrollRoutes = require('./routes/payroll');
const dashboardRoutes = require('./routes/dashboard');
const leaveRoutes = require('./routes/leaves');

const app = express();
const server = http.createServer(app);

// Socket.IO setup
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  },
});

// Store io instance for use in controllers
app.set('io', io);

// Middleware
app.use(cors({
  origin: '*',
  credentials: false,
}));
app.use(express.json());

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/shifts', shiftRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/leaves', leaveRoutes);

// File Uploads
const uploadRoutes = require('./routes/upload');
app.use('/api/upload', uploadRoutes);

// Static files (Avatars)
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Ping (keep-alive uchun)
app.get('/api/ping', (req, res) => {
  res.json({ pong: true, uptime: process.uptime() });
});


// WebSocket setup
setupWebSocket(io);

// Database sync & Server start
const PORT = process.env.PORT || 3000;

// SQLite uchun xavfsiz ustun qo'shish (agar mavjud bo'lmasa)
async function addColumnIfNotExists(table, column, type) {
  try {
    const [rows] = await sequelize.query(`PRAGMA table_info(${table})`);
    const exists = rows.some(r => r.name === column);
    if (!exists) {
      await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      console.log(`  ➕ ${table}.${column} ustuni qo'shildi`);
    }
  } catch (err) {
    console.warn(`  ⚠️  ${table}.${column} qo'shishda xato:`, err.message);
  }
}

async function startServer() {
  try {
    await sequelize.authenticate();
    console.log('✅ Ma\'lumotlar bazasi ulandi');

    // Normal sync (jadval strukturasini yaratish, lekin o'zgartirmaslik)
    await sequelize.sync({ force: false });
    console.log('✅ Jadvallar sinxronlashtirildi');

    // Yangi ustunlarni xavfsiz qo'shish (agar mavjud bo'lmasa)
    await addColumnIfNotExists('payroll', 'advance_payment', 'FLOAT DEFAULT 0');
    await addColumnIfNotExists('users', 'face_id', 'VARCHAR(255)');
    await addColumnIfNotExists('users', 'telegram_chat_id', 'VARCHAR(255)');
    console.log('✅ Yangi ustunlar tekshirildi va qo\'shildi');

    // Standart admin yaratish (agar yo'q bo'lsa)
    const { User } = require('./models');
    const bcrypt = require('bcryptjs');
    const adminCount = await User.count({ where: { role: 'admin' } });
    if (adminCount === 0) {
      const password = await bcrypt.hash('5511', 10);
      await User.create({
        full_name: 'Administrator',
        phone: '+998938215511',
        department: 'IT',
        position: 'Tizim Administratori',
        card_id: 'ADMIN001',
        hourly_rate: 35000,
        penalty_per_minute: 0,
        overtime_coefficient: 1.5,
        role: 'admin',
        password,
        is_active: true,
      });
      console.log('👑 Standart Admin yaratildi (+998938215511 / 5511)');
    }


    // Cron jobs
    setupCronJobs();

    const HOST = process.env.HOST || '0.0.0.0';
    const SERVER_IP = process.env.SERVER_IP || 'localhost';
    server.listen(PORT, HOST, () => {
      console.log(`\n🚀 Server ishga tushdi:`);
      console.log(`   Local:   http://localhost:${PORT}`);
      console.log(`   Network: http://${SERVER_IP}:${PORT}`);
      console.log(`📡 WebSocket: ws://${SERVER_IP}:${PORT}`);
      console.log(`\n📋 API Endpoints:`);
      console.log(`   POST   /api/auth/login`);
      console.log(`   GET    /api/employees`);
      console.log(`   GET    /api/shifts`);
      console.log(`   POST   /api/attendance/turnstile/webhook  ← Turniket/Face ID`);
      console.log(`   GET    /api/attendance`);
      console.log(`   GET    /api/payroll`);
      console.log(`   GET    /api/dashboard/admin`);
      console.log(`   GET    /api/dashboard/director`);
      console.log(`   GET    /api/leaves`);
      console.log(`\n`);

      // ─── Keep-Alive (Render uxlab qolmasligi uchun) ───
      const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
      if (RENDER_URL) {
        const https = require('https');
        const http = require('http');
        const pingUrl = `${RENDER_URL}/api/ping`;
        const client = RENDER_URL.startsWith('https') ? https : http;

        setInterval(() => {
          client.get(pingUrl, (res) => {
            console.log(`[KEEP-ALIVE] Ping → ${res.statusCode}`);
          }).on('error', (err) => {
            console.error('[KEEP-ALIVE] Ping xato:', err.message);
          });
        }, 3 * 60 * 1000); // Har 3 daqiqada

        console.log(`🔄 Keep-Alive yoqildi: har 3 daqiqada ${pingUrl}`);
      }
    });
  } catch (err) {
    console.error('❌ Server xatosi:', err);
    process.exit(1);
  }
}

startServer();

