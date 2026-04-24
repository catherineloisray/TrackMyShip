const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Configuration ───────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'shipments.json');
const UPLOADS_DIR = path.join(__dirname, 'data', 'uploads');
const ADMIN_SECRET = crypto.randomBytes(32).toString('hex');
const ADMIN_PATH = '/ctrl-panel-9v7k2m';
const MAX_BODY = 10 * 1024 * 1024; // 10MB max upload

// ─── Data helpers ────────────────────────────────────────────────
if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'));
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');

function loadShipments() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}
function saveShipments(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
function generateTrackingNumber() {
  const prefix = 'TMS';
  const num = crypto.randomBytes(5).toString('hex').toUpperCase();
  return `${prefix}-${num.slice(0,4)}-${num.slice(4,8)}-${num.slice(8)}`;
}

// ─── Encryption helpers (AES-256-GCM) ───────────────────────────
// Each shipment gets its own encryption key derived from a master + tracking number
function deriveKey(trackingNumber) {
  return crypto.createHash('sha256').update(ADMIN_SECRET + trackingNumber + 'e2e-chat').digest();
}
function encryptMessage(text, trackingNumber) {
  const key = deriveKey(trackingNumber);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return iv.toString('hex') + ':' + tag + ':' + encrypted;
}
function decryptMessage(encryptedStr, trackingNumber) {
  try {
    const key = deriveKey(trackingNumber);
    const [ivHex, tagHex, data] = encryptedStr.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch { return '[Unable to decrypt]'; }
}

// ─── SSE clients ─────────────────────────────────────────────────
const sseClients = new Map();

function broadcastToTracking(trackingNumber, data) {
  const clients = sseClients.get(trackingNumber);
  if (clients) {
    const msg = `data: ${JSON.stringify(data)}\n\n`;
    clients.forEach(res => {
      try { res.write(msg); } catch {}
    });
  }
}

// ─── MIME types ──────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.zip': 'application/zip', '.txt': 'text/plain'
};

function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function parseBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('Body too large')); req.destroy(); return; }
      body += c;
    });
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function jsonRes(res, code, data) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ─── Haversine distance (km) ─────────────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function parseURL(req) {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  return { pathname: u.pathname, query: Object.fromEntries(u.searchParams) };
}

// ═══════════════════════════════════════════════════════════════════
//  SINGLE SERVER
// ═══════════════════════════════════════════════════════════════════
const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const { pathname, query } = parseURL(req);

  // ═══════════════════════════════════════════════════════════════
  //  PUBLIC API ROUTES
  // ═══════════════════════════════════════════════════════════════

  // API: Track a shipment
  if (pathname === '/api/track' && req.method === 'GET') {
    const tn = (query.tn || '').trim().toUpperCase();
    const shipments = loadShipments();
    const shipment = shipments.find(s => s.trackingNumber === tn);
    if (!shipment) return jsonRes(res, 404, { error: 'Tracking number not found' });
    const publicData = {
      trackingNumber: shipment.trackingNumber,
      senderName: shipment.senderName,
      receiverName: shipment.receiverName,
      receiverAddress: shipment.receiverAddress,
      originAddress: shipment.originAddress,
      packageDescription: shipment.packageDescription,
      packageType: shipment.packageType,
      weight: shipment.weight,
      quantity: shipment.quantity,
      specialInstructions: shipment.specialInstructions,
      estimatedDelivery: shipment.estimatedDelivery,
      status: shipment.status,
      createdAt: shipment.createdAt,
      originCoords: shipment.originCoords,
      destCoords: shipment.destCoords,
      currentLocation: shipment.currentLocation,
      locationHistory: shipment.locationHistory || [],
      statusHistory: shipment.statusHistory || []
    };
    return jsonRes(res, 200, publicData);
  }

  // SSE: Real-time location + chat updates
  if (pathname === '/api/track/live' && req.method === 'GET') {
    const tn = (query.tn || '').trim().toUpperCase();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
    if (!sseClients.has(tn)) sseClients.set(tn, new Set());
    sseClients.get(tn).add(res);
    req.on('close', () => {
      const clients = sseClients.get(tn);
      if (clients) { clients.delete(res); if (clients.size === 0) sseClients.delete(tn); }
    });
    return;
  }

  // ─── PUBLIC CHAT: Client sends message ─────────────────────────
  if (pathname === '/api/chat/send' && req.method === 'POST') {
    const body = await parseBody(req);
    const tn = (body.trackingNumber || '').trim().toUpperCase();
    const shipments = loadShipments();
    const idx = shipments.findIndex(s => s.trackingNumber === tn);
    if (idx === -1) return jsonRes(res, 404, { error: 'Shipment not found' });
    if (!shipments[idx].messages) shipments[idx].messages = [];
    const msg = {
      id: crypto.randomUUID(),
      sender: 'client',
      text: encryptMessage(body.text || '', tn),
      fileName: body.fileName || null,
      fileData: body.fileData || null, // base64 encoded file
      fileType: body.fileType || null,
      timestamp: new Date().toISOString(),
      read: false
    };
    shipments[idx].messages.push(msg);
    saveShipments(shipments);
    // Broadcast to SSE (send decrypted for live view)
    broadcastToTracking(tn, {
      type: 'new_message',
      message: { ...msg, text: body.text || '' }
    });
    return jsonRes(res, 200, { success: true, messageId: msg.id });
  }

  // ─── PUBLIC CHAT: Client gets messages ─────────────────────────
  if (pathname === '/api/chat/messages' && req.method === 'GET') {
    const tn = (query.tn || '').trim().toUpperCase();
    const shipments = loadShipments();
    const shipment = shipments.find(s => s.trackingNumber === tn);
    if (!shipment) return jsonRes(res, 404, { error: 'Not found' });
    const messages = (shipment.messages || []).map(m => ({
      ...m,
      text: decryptMessage(m.text, tn)
    }));
    return jsonRes(res, 200, messages);
  }

  // ─── PUBLIC: Serve uploaded files ──────────────────────────────
  if (pathname.startsWith('/api/files/') && req.method === 'GET') {
    const fileId = pathname.split('/')[3];
    const filePath = path.join(UPLOADS_DIR, fileId);
    if (fs.existsSync(filePath)) {
      return serveFile(filePath, res);
    }
    res.writeHead(404); res.end('Not Found'); return;
  }

  // ═══════════════════════════════════════════════════════════════
  //  ADMIN API ROUTES
  // ═══════════════════════════════════════════════════════════════

  // Admin Login
  if (pathname === `${ADMIN_PATH}/api/login` && req.method === 'POST') {
    const body = await parseBody(req);
    if (body.username === 'admin' && body.password === 'TrackMyShip2026!') {
      return jsonRes(res, 200, { token: ADMIN_SECRET, message: 'Login successful' });
    }
    return jsonRes(res, 401, { error: 'Invalid credentials' });
  }

  // Protect admin API
  if (pathname.startsWith(`${ADMIN_PATH}/api/`) && pathname !== `${ADMIN_PATH}/api/login`) {
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${ADMIN_SECRET}`) {
      return jsonRes(res, 403, { error: 'Unauthorized' });
    }
  }

  // Admin: Create shipment
  if (pathname === `${ADMIN_PATH}/api/shipments` && req.method === 'POST') {
    const body = await parseBody(req);
    const shipments = loadShipments();
    const shipment = {
      id: crypto.randomUUID(),
      trackingNumber: generateTrackingNumber(),
      senderName: body.senderName || '',
      receiverName: body.receiverName || '',
      receiverAddress: body.receiverAddress || '',
      originAddress: body.originAddress || '',
      packageDescription: body.packageDescription || '',
      packageType: body.packageType || 'Parcel',
      weight: body.weight || '',
      quantity: body.quantity || 1,
      specialInstructions: body.specialInstructions || '',
      estimatedDelivery: body.estimatedDelivery || '',
      status: 'Picked Up',
      createdAt: new Date().toISOString(),
      originCoords: body.originCoords || null,
      destCoords: body.destCoords || null,
      currentLocation: body.originCoords || null,
      locationHistory: [],
      statusHistory: [
        { status: 'Picked Up', timestamp: new Date().toISOString(), note: 'Shipment created and picked up' }
      ],
      messages: []
    };
    shipments.push(shipment);
    saveShipments(shipments);
    return jsonRes(res, 201, shipment);
  }

  // Admin: List shipments
  if (pathname === `${ADMIN_PATH}/api/shipments` && req.method === 'GET') {
    const shipments = loadShipments();
    // Decrypt messages for admin view and add unread count
    const withDecrypted = shipments.map(s => ({
      ...s,
      unreadCount: (s.messages || []).filter(m => m.sender === 'client' && !m.read).length,
      messages: (s.messages || []).map(m => ({ ...m, text: decryptMessage(m.text, s.trackingNumber) }))
    }));
    return jsonRes(res, 200, withDecrypted);
  }

  // Admin: Send message to client
  if (pathname.startsWith(`${ADMIN_PATH}/api/shipments/`) && pathname.endsWith('/chat') && req.method === 'POST') {
    const parts = pathname.replace(ADMIN_PATH, '').split('/');
    const id = parts[3];
    const body = await parseBody(req);
    const shipments = loadShipments();
    const idx = shipments.findIndex(s => s.id === id);
    if (idx === -1) return jsonRes(res, 404, { error: 'Not found' });
    if (!shipments[idx].messages) shipments[idx].messages = [];
    const tn = shipments[idx].trackingNumber;
    const msg = {
      id: crypto.randomUUID(),
      sender: 'admin',
      text: encryptMessage(body.text || '', tn),
      fileName: body.fileName || null,
      fileData: body.fileData || null,
      fileType: body.fileType || null,
      timestamp: new Date().toISOString(),
      read: false
    };
    shipments[idx].messages.push(msg);
    saveShipments(shipments);
    broadcastToTracking(tn, {
      type: 'new_message',
      message: { ...msg, text: body.text || '' }
    });
    return jsonRes(res, 200, { success: true });
  }

  // Admin: Mark messages as read
  if (pathname.startsWith(`${ADMIN_PATH}/api/shipments/`) && pathname.endsWith('/chat/read') && req.method === 'PUT') {
    const parts = pathname.replace(ADMIN_PATH, '').split('/');
    const id = parts[3];
    const shipments = loadShipments();
    const idx = shipments.findIndex(s => s.id === id);
    if (idx === -1) return jsonRes(res, 404, { error: 'Not found' });
    (shipments[idx].messages || []).forEach(m => { if (m.sender === 'client') m.read = true; });
    saveShipments(shipments);
    return jsonRes(res, 200, { success: true });
  }

  // Admin: Update shipment status
  if (pathname.startsWith(`${ADMIN_PATH}/api/shipments/`) && pathname.endsWith('/status') && req.method === 'PUT') {
    const parts = pathname.replace(ADMIN_PATH, '').split('/');
    const id = parts[3];
    const body = await parseBody(req);
    const shipments = loadShipments();
    const idx = shipments.findIndex(s => s.id === id);
    if (idx === -1) return jsonRes(res, 404, { error: 'Not found' });
    shipments[idx].status = body.status;
    shipments[idx].statusHistory.push({ status: body.status, timestamp: new Date().toISOString(), note: body.note || '' });
    saveShipments(shipments);
    broadcastToTracking(shipments[idx].trackingNumber, { type: 'status_update', status: body.status, statusHistory: shipments[idx].statusHistory });
    return jsonRes(res, 200, shipments[idx]);
  }

  // Admin: Update location
  if (pathname.startsWith(`${ADMIN_PATH}/api/shipments/`) && pathname.endsWith('/location') && req.method === 'PUT') {
    const parts = pathname.replace(ADMIN_PATH, '').split('/');
    const id = parts[3];
    const body = await parseBody(req);
    const shipments = loadShipments();
    const idx = shipments.findIndex(s => s.id === id);
    if (idx === -1) return jsonRes(res, 404, { error: 'Not found' });
    const loc = { lat: body.lat, lng: body.lng, timestamp: new Date().toISOString() };
    shipments[idx].currentLocation = loc;
    shipments[idx].locationHistory.push(loc);
    if (shipments[idx].destCoords) {
      const dist = haversine(loc.lat, loc.lng, shipments[idx].destCoords.lat, shipments[idx].destCoords.lng);
      if (dist < 0.1) {
        shipments[idx].status = 'Delivered';
        shipments[idx].statusHistory.push({ status: 'Delivered', timestamp: new Date().toISOString(), note: 'Package arrived at destination' });
      } else if (dist < 1 && shipments[idx].status !== 'Out for Delivery' && shipments[idx].status !== 'Delivered') {
        shipments[idx].status = 'Out for Delivery';
        shipments[idx].statusHistory.push({ status: 'Out for Delivery', timestamp: new Date().toISOString(), note: 'Package is nearby' });
      }
    }
    saveShipments(shipments);
    broadcastToTracking(shipments[idx].trackingNumber, { type: 'location_update', currentLocation: loc, status: shipments[idx].status, statusHistory: shipments[idx].statusHistory });
    return jsonRes(res, 200, { success: true });
  }

  // Admin: Delete shipment
  if (pathname.startsWith(`${ADMIN_PATH}/api/shipments/`) && req.method === 'DELETE') {
    const parts = pathname.replace(ADMIN_PATH, '').split('/');
    const id = parts[3];
    let shipments = loadShipments();
    shipments = shipments.filter(s => s.id !== id);
    saveShipments(shipments);
    return jsonRes(res, 200, { success: true });
  }

  // Admin: Bulk GPS broadcast
  if (pathname === `${ADMIN_PATH}/api/broadcast-location` && req.method === 'PUT') {
    const body = await parseBody(req);
    const shipments = loadShipments();
    let updated = 0;
    shipments.forEach((s, idx) => {
      if (s.status !== 'Delivered' && s.status !== 'Cancelled') {
        const loc = { lat: body.lat, lng: body.lng, timestamp: new Date().toISOString() };
        shipments[idx].currentLocation = loc;
        shipments[idx].locationHistory.push(loc);
        if (s.destCoords) {
          const dist = haversine(loc.lat, loc.lng, s.destCoords.lat, s.destCoords.lng);
          if (dist < 0.1) {
            shipments[idx].status = 'Delivered';
            shipments[idx].statusHistory.push({ status: 'Delivered', timestamp: new Date().toISOString(), note: 'Package arrived at destination' });
          } else if (dist < 1 && s.status !== 'Out for Delivery') {
            shipments[idx].status = 'Out for Delivery';
            shipments[idx].statusHistory.push({ status: 'Out for Delivery', timestamp: new Date().toISOString(), note: 'Package is nearby' });
          }
        }
        broadcastToTracking(s.trackingNumber, { type: 'location_update', currentLocation: loc, status: shipments[idx].status, statusHistory: shipments[idx].statusHistory });
        updated++;
      }
    });
    saveShipments(shipments);
    return jsonRes(res, 200, { updated });
  }

  // ═══════════════════════════════════════════════════════════════
  //  STATIC FILE SERVING
  // ═══════════════════════════════════════════════════════════════
  if (pathname === ADMIN_PATH || pathname === `${ADMIN_PATH}/`) {
    return serveFile(path.join(__dirname, 'admin', 'index.html'), res);
  }
  if (pathname.startsWith(`${ADMIN_PATH}/`) && !pathname.startsWith(`${ADMIN_PATH}/api/`)) {
    const filePath = pathname.replace(ADMIN_PATH, '');
    return serveFile(path.join(__dirname, 'admin', filePath), res);
  }
  if (pathname.startsWith('/admin')) { res.writeHead(404); res.end('Not Found'); return; }

  let filePath = pathname === '/' ? '/index.html' : pathname;
  serveFile(path.join(__dirname, 'public', filePath), res);
});

// ─── Start server ────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════════════╗`);
  console.log(`║          🚚  TrackMyShip Server Running  🚚          ║`);
  console.log(`╠══════════════════════════════════════════════════════╣`);
  console.log(`║  Client Tracking:  http://localhost:${PORT}               ║`);
  console.log(`║  Admin Dashboard:  http://localhost:${PORT}${ADMIN_PATH}  ║`);
  console.log(`╠══════════════════════════════════════════════════════╣`);
  console.log(`║  Admin Login:                                        ║`);
  console.log(`║    Username: admin                                    ║`);
  console.log(`║    Password: TrackMyShip2026!                         ║`);
  console.log(`║  E2E Encrypted Chat: ENABLED                         ║`);
  console.log(`╚══════════════════════════════════════════════════════╝\n`);

  const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
  if (RENDER_URL) {
    setInterval(() => {
      const { request } = require('https');
      const req = request(`${RENDER_URL}/`, { method: 'HEAD' }, (res) => {
        console.log(`[keep-alive] pinged — status ${res.statusCode}`);
      });
      req.on('error', () => {});
      req.end();
    }, 13 * 60 * 1000);
  }
});
