const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Configuration ───────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'shipments.json');
const BANK_FILE = path.join(__dirname, 'data', 'bank_users.json');
const UPLOADS_DIR = path.join(__dirname, 'data', 'uploads');
// IMPORTANT: Use a stable key so it survives server restarts on Render.
const MASTER_SECRET = crypto.createHash('sha256').update('TrackMyShip2026!-stable-admin-key-v1').digest('hex'); // Keep original seed for compatibility
const BANK_CHAT_FILE = path.join(__dirname, 'data', 'bank_chats.json');
const ADMIN_PATH = '/ctrl-panel-9v7k2m';
const MAX_BODY = 10 * 1024 * 1024; // 10MB max upload

// ─── Multi-Admin Accounts (20 admins) ────────────────────────────
// Each admin gets a unique username and password.
// Tokens are derived deterministically from the master secret so they survive restarts.
const ADMINS = [
  { id: 'admin1',  username: 'admin1',  password: 'Ship@Secure01' },
  { id: 'admin2',  username: 'admin2',  password: 'Ship@Secure02' },
  { id: 'admin3',  username: 'admin3',  password: 'Ship@Secure03' },
  { id: 'admin4',  username: 'admin4',  password: 'Ship@Secure04' },
  { id: 'admin5',  username: 'admin5',  password: 'Ship@Secure05' },
  { id: 'admin6',  username: 'admin6',  password: 'Ship@Secure06' },
  { id: 'admin7',  username: 'admin7',  password: 'Ship@Secure07' },
  { id: 'admin8',  username: 'admin8',  password: 'Ship@Secure08' },
  { id: 'admin9',  username: 'admin9',  password: 'Ship@Secure09' },
  { id: 'admin10', username: 'admin10', password: 'Ship@Secure10' },
  { id: 'admin11', username: 'admin11', password: 'Ship@Secure11' },
  { id: 'admin12', username: 'admin12', password: 'Ship@Secure12' },
  { id: 'admin13', username: 'admin13', password: 'Ship@Secure13' },
  { id: 'admin14', username: 'admin14', password: 'Ship@Secure14' },
  { id: 'admin15', username: 'admin15', password: 'Ship@Secure15' },
  { id: 'admin16', username: 'admin16', password: 'Ship@Secure16' },
  { id: 'admin17', username: 'admin17', password: 'Ship@Secure17' },
  { id: 'admin18', username: 'admin18', password: 'Ship@Secure18' },
  { id: 'admin19', username: 'admin19', password: 'Ship@Secure19' },
  { id: 'admin20', username: 'admin20', password: 'Ship@Secure20' }
];

// Generate a deterministic token for each admin (survives server restarts)
function getAdminToken(adminId) {
  return crypto.createHmac('sha256', MASTER_SECRET).update('admin-token:' + adminId).digest('hex');
}

// Look up which admin owns a token
function getAdminByToken(token) {
  return ADMINS.find(a => getAdminToken(a.id) === token) || null;
}

// ─── Data helpers ────────────────────────────────────────────────
if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'));
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');
if (!fs.existsSync(BANK_FILE)) fs.writeFileSync(BANK_FILE, '[]');
if (!fs.existsSync(BANK_CHAT_FILE)) fs.writeFileSync(BANK_CHAT_FILE, '[]');

function loadShipments() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}
function saveShipments(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
function generateTrackingNumber() {
  const prefix = 'THB';
  const num = crypto.randomBytes(5).toString('hex').toUpperCase();
  return `${prefix}-${num.slice(0,4)}-${num.slice(4,8)}-${num.slice(8)}`;
}

// ─── Banking Data Helpers ────────────────────────────────────────
function loadBankUsers() {
  try { return JSON.parse(fs.readFileSync(BANK_FILE, 'utf8')); }
  catch { return []; }
}
function saveBankUsers(data) {
  fs.writeFileSync(BANK_FILE, JSON.stringify(data, null, 2));
}
function hashPassword(password) {
  return crypto.createHash('sha256').update('tms-bank-salt:' + password).digest('hex');
}
function generateBankToken(userId) {
  return crypto.createHmac('sha256', MASTER_SECRET).update('bank-token:' + userId).digest('hex');
}
function getBankUserByToken(token) {
  const users = loadBankUsers();
  return users.find(u => generateBankToken(u.id) === token) || null;
}
function generateCardNumber() {
  // Generate a 16-digit card number starting with 4 (Visa-style)
  let num = '4532';
  for (let i = 0; i < 12; i++) num += Math.floor(Math.random() * 10);
  return num;
}
function formatCardDisplay(num) {
  return num.replace(/(.{4})/g, '$1 ').trim();
}
function generateCVV() {
  return String(Math.floor(100 + Math.random() * 900));
}
function generateExpiry() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = String(now.getFullYear() + 3).slice(2);
  return month + '/' + year;
}
function generateAccountNumber() {
  // 10-digit account number
  let num = '';
  for (let i = 0; i < 10; i++) num += Math.floor(Math.random() * 10);
  return num;
}

// ─── Banking Chat Helpers ────────────────────────────────────────
function loadBankChats() {
  try { return JSON.parse(fs.readFileSync(BANK_CHAT_FILE, 'utf8')); }
  catch { return []; }
}
function saveBankChats(data) {
  fs.writeFileSync(BANK_CHAT_FILE, JSON.stringify(data, null, 2));
}

// ─── Encryption helpers (AES-256-GCM) ───────────────────────────
// Each shipment gets its own encryption key derived from a master + tracking number
function deriveKey(trackingNumber) {
  return crypto.createHash('sha256').update(MASTER_SECRET + trackingNumber + 'e2e-chat').digest();
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
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    // Prevent browser caching of HTML files so updates deploy instantly
    if (ext === '.html') {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      headers['Pragma'] = 'no-cache';
      headers['Expires'] = '0';
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}

function parseBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      try { resolve(JSON.parse(body)); }
      catch(e) { console.error('[parseBody] JSON parse failed:', e.message, '| raw:', body.substring(0, 200)); resolve({}); }
    });
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
  try {
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
    console.log('[CHAT] Client sending message to:', tn, '| text length:', (body.text||'').length, '| hasFile:', !!body.fileData);
    const shipments = loadShipments();
    const idx = shipments.findIndex(s => s.trackingNumber === tn);
    if (idx === -1) { console.log('[CHAT] ERROR: Shipment not found for', tn); return jsonRes(res, 404, { error: 'Shipment not found' }); }
    if (!shipments[idx].messages) shipments[idx].messages = [];
    const msg = {
      id: crypto.randomUUID(),
      sender: 'client',
      text: encryptMessage(body.text || '', tn),
      fileName: body.fileName || null,
      fileData: body.fileData || null,
      fileType: body.fileType || null,
      timestamp: new Date().toISOString(),
      read: false
    };
    shipments[idx].messages.push(msg);
    saveShipments(shipments);
    console.log('[CHAT] Client message saved. Total messages:', shipments[idx].messages.length);
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
    if (!shipment) { console.log('[CHAT] GET messages: shipment not found for', tn); return jsonRes(res, 404, { error: 'Not found' }); }
    const messages = (shipment.messages || []).map(m => ({
      ...m,
      text: decryptMessage(m.text, tn)
    }));
    console.log('[CHAT] Returning', messages.length, 'messages for', tn);
    return jsonRes(res, 200, messages);
  }

  // ═══════════════════════════════════════════════════════════════
  //  TRACKHUB BANKING API — PUBLIC ROUTES
  // ═══════════════════════════════════════════════════════════════

  // Bank: Register new user
  if (pathname === '/api/bank/register' && req.method === 'POST') {
    const body = await parseBody(req);
    const username = (body.username || '').trim().toLowerCase();
    const password = body.password || '';
    const fullName = (body.fullName || '').trim();
    if (!username || !password || !fullName) return jsonRes(res, 400, { error: 'Username, password, and full name are required' });
    if (username.length < 3) return jsonRes(res, 400, { error: 'Username must be at least 3 characters' });
    if (password.length < 6) return jsonRes(res, 400, { error: 'Password must be at least 6 characters' });
    const users = loadBankUsers();
    if (users.find(u => u.username === username)) return jsonRes(res, 409, { error: 'Username already taken' });
    const user = {
      id: crypto.randomUUID(),
      username,
      passwordHash: hashPassword(password),
      fullName,
      accountNumber: generateAccountNumber(),
      balance: 0,
      status: 'active',
      createdAt: new Date().toISOString(),
      card: null,
      transactions: []
    };
    users.push(user);
    saveBankUsers(users);
    const token = generateBankToken(user.id);
    console.log('[BANK] New user registered:', username, '| Account:', user.accountNumber);
    return jsonRes(res, 201, { token, user: { id: user.id, username: user.username, fullName: user.fullName, accountNumber: user.accountNumber, balance: user.balance, status: user.status, card: user.card } });
  }

  // Bank: User login
  if (pathname === '/api/bank/login' && req.method === 'POST') {
    const body = await parseBody(req);
    const username = (body.username || '').trim().toLowerCase();
    const password = body.password || '';
    const users = loadBankUsers();
    const user = users.find(u => u.username === username && u.passwordHash === hashPassword(password));
    if (!user) return jsonRes(res, 401, { error: 'Invalid username or password' });
    if (user.status === 'blocked') return jsonRes(res, 403, { error: 'Your account has been suspended. Please contact support.' });
    const token = generateBankToken(user.id);
    console.log('[BANK] User login:', username);
    return jsonRes(res, 200, { token, user: { id: user.id, username: user.username, fullName: user.fullName, accountNumber: user.accountNumber, balance: user.balance, status: user.status, card: user.card, createdAt: user.createdAt } });
  }

  // Bank: Get account info (authenticated)
  if (pathname === '/api/bank/account' && req.method === 'GET') {
    const auth = req.headers.authorization;
    const token = auth ? auth.replace('Bearer ', '') : '';
    const user = getBankUserByToken(token);
    if (!user) return jsonRes(res, 403, { error: 'Please log in' });
    if (user.status === 'blocked') return jsonRes(res, 403, { error: 'Account suspended' });
    return jsonRes(res, 200, { id: user.id, username: user.username, fullName: user.fullName, accountNumber: user.accountNumber, balance: user.balance, status: user.status, card: user.card, createdAt: user.createdAt, transactions: user.transactions || [] });
  }

  // Bank: Transfer funds to another user
  if (pathname === '/api/bank/transfer' && req.method === 'POST') {
    const auth = req.headers.authorization;
    const token = auth ? auth.replace('Bearer ', '') : '';
    const sender = getBankUserByToken(token);
    if (!sender) return jsonRes(res, 403, { error: 'Please log in' });
    if (sender.status === 'blocked') return jsonRes(res, 403, { error: 'Account suspended' });
    const body = await parseBody(req);
    const recipientUsername = (body.recipientUsername || '').trim().toLowerCase();
    const recipientAccount = (body.recipientAccount || '').trim();
    const amount = parseFloat(body.amount);
    const note = body.note || '';
    if (!amount || amount <= 0) return jsonRes(res, 400, { error: 'Invalid amount' });
    if (amount > sender.balance) return jsonRes(res, 400, { error: 'Insufficient funds' });
    const users = loadBankUsers();
    const senderIdx = users.findIndex(u => u.id === sender.id);
    // Find recipient by username OR account number
    const recipientIdx = users.findIndex(u => (recipientUsername && u.username === recipientUsername) || (recipientAccount && u.accountNumber === recipientAccount));
    if (recipientIdx === -1) return jsonRes(res, 404, { error: 'Recipient not found' });
    if (users[recipientIdx].id === sender.id) return jsonRes(res, 400, { error: 'Cannot transfer to yourself' });
    if (users[recipientIdx].status === 'blocked') return jsonRes(res, 400, { error: 'Recipient account is suspended' });
    const txId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    // Debit sender
    users[senderIdx].balance = Math.round((users[senderIdx].balance - amount) * 100) / 100;
    users[senderIdx].transactions.push({ id: txId, type: 'transfer_out', amount, to: users[recipientIdx].username, toName: users[recipientIdx].fullName, note, timestamp, balanceAfter: users[senderIdx].balance });
    // Credit recipient
    users[recipientIdx].balance = Math.round((users[recipientIdx].balance + amount) * 100) / 100;
    users[recipientIdx].transactions.push({ id: txId, type: 'transfer_in', amount, from: users[senderIdx].username, fromName: users[senderIdx].fullName, note, timestamp, balanceAfter: users[recipientIdx].balance });
    saveBankUsers(users);
    console.log('[BANK] Transfer: $' + amount, 'from', sender.username, 'to', users[recipientIdx].username);
    return jsonRes(res, 200, { success: true, newBalance: users[senderIdx].balance, transactionId: txId });
  }

  // Bank: Apply for debit card
  if (pathname === '/api/bank/card/apply' && req.method === 'POST') {
    const auth = req.headers.authorization;
    const token = auth ? auth.replace('Bearer ', '') : '';
    const user = getBankUserByToken(token);
    if (!user) return jsonRes(res, 403, { error: 'Please log in' });
    if (user.status === 'blocked') return jsonRes(res, 403, { error: 'Account suspended' });
    if (user.card) return jsonRes(res, 400, { error: 'You already have a debit card' });
    const users = loadBankUsers();
    const idx = users.findIndex(u => u.id === user.id);
    const card = {
      number: generateCardNumber(),
      expiry: generateExpiry(),
      cvv: generateCVV(),
      holderName: user.fullName.toUpperCase(),
      status: 'active',
      issuedAt: new Date().toISOString()
    };
    users[idx].card = card;
    saveBankUsers(users);
    console.log('[BANK] Debit card issued for', user.username);
    return jsonRes(res, 200, { success: true, card });
  }

  // ─── BANKING CHAT: User sends message ──────────────────────────
  if (pathname === '/api/bank/chat/send' && req.method === 'POST') {
    const auth = req.headers.authorization;
    const token = auth ? auth.replace('Bearer ', '') : '';
    const user = getBankUserByToken(token);
    if (!user) return jsonRes(res, 403, { error: 'Please log in' });
    if (user.status === 'blocked') return jsonRes(res, 403, { error: 'Account suspended' });
    const body = await parseBody(req);
    const text = (body.text || '').trim();
    const imageData = body.imageData || null;
    const imageName = body.imageName || null;
    if (!text && !imageData) return jsonRes(res, 400, { error: 'Message cannot be empty' });
    const chats = loadBankChats();
    const msg = {
      id: crypto.randomUUID(),
      userId: user.id,
      username: user.username,
      fullName: user.fullName,
      sender: 'user',
      text: text,
      imageData: imageData,
      imageName: imageName,
      timestamp: new Date().toISOString(),
      read: false
    };
    chats.push(msg);
    saveBankChats(chats);
    console.log('[BANK-CHAT] User', user.username, 'sent message');
    return jsonRes(res, 200, { success: true, messageId: msg.id });
  }

  // ─── BANKING CHAT: User gets their messages ──────────────────
  if (pathname === '/api/bank/chat/messages' && req.method === 'GET') {
    const auth = req.headers.authorization;
    const token = auth ? auth.replace('Bearer ', '') : '';
    const user = getBankUserByToken(token);
    if (!user) return jsonRes(res, 403, { error: 'Please log in' });
    const chats = loadBankChats();
    const userMsgs = chats.filter(function(m) { return m.userId === user.id; });
    // Mark admin messages as read
    let changed = false;
    chats.forEach(function(m) { if (m.userId === user.id && m.sender === 'admin' && !m.read) { m.read = true; changed = true; } });
    if (changed) saveBankChats(chats);
    return jsonRes(res, 200, userMsgs);
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

  // Admin Login — checks against all 20 admin accounts
  if (pathname === `${ADMIN_PATH}/api/login` && req.method === 'POST') {
    const body = await parseBody(req);
    console.log('[LOGIN] Attempt — username:', body.username, '| password length:', (body.password||'').length);
    const admin = ADMINS.find(a => a.username === body.username && a.password === body.password);
    if (admin) {
      const token = getAdminToken(admin.id);
      console.log('[LOGIN] Success —', admin.id);
      return jsonRes(res, 200, { token, adminId: admin.id, username: admin.username, message: 'Login successful' });
    }
    console.log('[LOGIN] Failed — credentials mismatch');
    return jsonRes(res, 401, { error: 'Invalid credentials' });
  }

  // Protect admin API — validate token and attach admin identity to request
  let currentAdmin = null;
  if (pathname.startsWith(`${ADMIN_PATH}/api/`) && pathname !== `${ADMIN_PATH}/api/login`) {
    const auth = req.headers.authorization;
    const token = auth ? auth.replace('Bearer ', '') : '';
    currentAdmin = getAdminByToken(token);
    if (!currentAdmin) {
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
      messages: [],
      createdBy: currentAdmin.id
    };
    shipments.push(shipment);
    saveShipments(shipments);
    return jsonRes(res, 201, shipment);
  }

  // Admin: List shipments — each admin only sees their OWN shipments
  if (pathname === `${ADMIN_PATH}/api/shipments` && req.method === 'GET') {
    const allShipments = loadShipments();
    const shipments = allShipments.filter(s => s.createdBy === currentAdmin.id);
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
    console.log('[CHAT]', currentAdmin.id, 'sending message to shipment:', id);
    const shipments = loadShipments();
    const idx = shipments.findIndex(s => s.id === id && s.createdBy === currentAdmin.id);
    if (idx === -1) { console.log('[CHAT] ERROR: Shipment not found or not owned'); return jsonRes(res, 404, { error: 'Not found' }); }
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
    console.log('[CHAT] Admin message saved for', tn, '| Total messages:', shipments[idx].messages.length);
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
    const idx = shipments.findIndex(s => s.id === id && s.createdBy === currentAdmin.id);
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
    const idx = shipments.findIndex(s => s.id === id && s.createdBy === currentAdmin.id);
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
    const idx = shipments.findIndex(s => s.id === id && s.createdBy === currentAdmin.id);
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

  // Admin: Delete shipment (only own)
  if (pathname.startsWith(`${ADMIN_PATH}/api/shipments/`) && req.method === 'DELETE') {
    const parts = pathname.replace(ADMIN_PATH, '').split('/');
    const id = parts[3];
    let shipments = loadShipments();
    const target = shipments.find(s => s.id === id);
    if (!target || target.createdBy !== currentAdmin.id) return jsonRes(res, 404, { error: 'Not found' });
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
      if (s.createdBy === currentAdmin.id && s.status !== 'Delivered' && s.status !== 'Cancelled') {
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
  //  ADMIN BANKING MANAGEMENT
  // ═══════════════════════════════════════════════════════════════

  // Admin: List all bank users
  if (pathname === `${ADMIN_PATH}/api/bank/users` && req.method === 'GET') {
    const users = loadBankUsers();
    const safe = users.map(u => ({ id: u.id, username: u.username, fullName: u.fullName, accountNumber: u.accountNumber, balance: u.balance, status: u.status, card: u.card, createdAt: u.createdAt, transactionCount: (u.transactions || []).length }));
    return jsonRes(res, 200, safe);
  }

  // Admin: Get single bank user with transactions
  if (pathname.startsWith(`${ADMIN_PATH}/api/bank/users/`) && pathname.split('/').length === 6 && req.method === 'GET') {
    const userId = pathname.split('/')[5];
    const users = loadBankUsers();
    const user = users.find(u => u.id === userId);
    if (!user) return jsonRes(res, 404, { error: 'User not found' });
    return jsonRes(res, 200, { id: user.id, username: user.username, fullName: user.fullName, accountNumber: user.accountNumber, balance: user.balance, status: user.status, card: user.card, createdAt: user.createdAt, transactions: user.transactions || [] });
  }

  // Admin: Fund a user's account
  if (pathname.startsWith(`${ADMIN_PATH}/api/bank/users/`) && pathname.endsWith('/fund') && req.method === 'POST') {
    const parts = pathname.split('/');
    const userId = parts[5];
    const body = await parseBody(req);
    const amount = parseFloat(body.amount);
    const note = body.note || 'Admin deposit';
    if (!amount || amount <= 0) return jsonRes(res, 400, { error: 'Invalid amount' });
    const users = loadBankUsers();
    const idx = users.findIndex(u => u.id === userId);
    if (idx === -1) return jsonRes(res, 404, { error: 'User not found' });
    users[idx].balance = Math.round((users[idx].balance + amount) * 100) / 100;
    users[idx].transactions.push({
      id: crypto.randomUUID(), type: 'credit', amount, description: note,
      by: currentAdmin.id, timestamp: new Date().toISOString(), balanceAfter: users[idx].balance
    });
    saveBankUsers(users);
    console.log('[BANK] Admin', currentAdmin.id, 'funded', users[idx].username, '+$' + amount);
    return jsonRes(res, 200, { success: true, newBalance: users[idx].balance });
  }

  // Admin: Debit (withdraw) from user's account
  if (pathname.startsWith(`${ADMIN_PATH}/api/bank/users/`) && pathname.endsWith('/debit') && req.method === 'POST') {
    const parts = pathname.split('/');
    const userId = parts[5];
    const body = await parseBody(req);
    const amount = parseFloat(body.amount);
    const note = body.note || 'Admin withdrawal';
    if (!amount || amount <= 0) return jsonRes(res, 400, { error: 'Invalid amount' });
    const users = loadBankUsers();
    const idx = users.findIndex(u => u.id === userId);
    if (idx === -1) return jsonRes(res, 404, { error: 'User not found' });
    if (amount > users[idx].balance) return jsonRes(res, 400, { error: 'Insufficient funds in account' });
    users[idx].balance = Math.round((users[idx].balance - amount) * 100) / 100;
    users[idx].transactions.push({
      id: crypto.randomUUID(), type: 'debit', amount, description: note,
      by: currentAdmin.id, timestamp: new Date().toISOString(), balanceAfter: users[idx].balance
    });
    saveBankUsers(users);
    console.log('[BANK] Admin', currentAdmin.id, 'debited', users[idx].username, '-$' + amount);
    return jsonRes(res, 200, { success: true, newBalance: users[idx].balance });
  }

  // Admin: Block/unblock user's debit card (must come BEFORE /block check)
  if (pathname.startsWith(`${ADMIN_PATH}/api/bank/users/`) && pathname.endsWith('/card/block') && req.method === 'PUT') {
    const parts = pathname.split('/');
    const userId = parts[5];
    const body = await parseBody(req);
    const users = loadBankUsers();
    const idx = users.findIndex(u => u.id === userId);
    if (idx === -1) return jsonRes(res, 404, { error: 'User not found' });
    if (!users[idx].card) return jsonRes(res, 400, { error: 'User has no debit card' });
    users[idx].card.status = body.blocked ? 'blocked' : 'active';
    saveBankUsers(users);
    console.log('[BANK] Admin', currentAdmin.id, body.blocked ? 'blocked' : 'unblocked', 'card for', users[idx].username);
    return jsonRes(res, 200, { success: true, cardStatus: users[idx].card.status });
  }

  // Admin: Block/unblock user account
  if (pathname.startsWith(`${ADMIN_PATH}/api/bank/users/`) && pathname.endsWith('/block') && req.method === 'PUT') {
    const parts = pathname.split('/');
    const userId = parts[5];
    const body = await parseBody(req);
    const users = loadBankUsers();
    const idx = users.findIndex(u => u.id === userId);
    if (idx === -1) return jsonRes(res, 404, { error: 'User not found' });
    users[idx].status = body.blocked ? 'blocked' : 'active';
    saveBankUsers(users);
    console.log('[BANK] Admin', currentAdmin.id, body.blocked ? 'blocked' : 'unblocked', 'user', users[idx].username);
    return jsonRes(res, 200, { success: true, status: users[idx].status });
  }

  // ─── Admin: Get bank chat messages (all or for specific user) ──
  if (pathname === `${ADMIN_PATH}/api/bank/chats` && req.method === 'GET') {
    const chats = loadBankChats();
    // Group by userId and get latest + unread count
    const userMap = {};
    chats.forEach(function(m) {
      if (!userMap[m.userId]) {
        userMap[m.userId] = { userId: m.userId, username: m.username, fullName: m.fullName, messages: [], unreadCount: 0 };
      }
      userMap[m.userId].messages.push(m);
      if (m.sender === 'user' && !m.read) userMap[m.userId].unreadCount++;
    });
    const conversations = Object.values(userMap).map(function(c) {
      return { userId: c.userId, username: c.username, fullName: c.fullName, unreadCount: c.unreadCount, lastMessage: c.messages[c.messages.length - 1], messageCount: c.messages.length };
    });
    conversations.sort(function(a, b) { return new Date(b.lastMessage.timestamp) - new Date(a.lastMessage.timestamp); });
    return jsonRes(res, 200, conversations);
  }

  // ─── Admin: Get chat messages for specific bank user ──────────
  if (pathname.startsWith(`${ADMIN_PATH}/api/bank/chats/`) && req.method === 'GET') {
    const userId = pathname.split('/')[5];
    const chats = loadBankChats();
    const userMsgs = chats.filter(function(m) { return m.userId === userId; });
    // Mark user messages as read
    let changed = false;
    chats.forEach(function(m) { if (m.userId === userId && m.sender === 'user' && !m.read) { m.read = true; changed = true; } });
    if (changed) saveBankChats(chats);
    return jsonRes(res, 200, userMsgs);
  }

  // ─── Admin: Send message to bank user ─────────────────────────
  if (pathname.startsWith(`${ADMIN_PATH}/api/bank/chats/`) && pathname.endsWith('/send') && req.method === 'POST') {
    const userId = pathname.split('/')[5];
    const body = await parseBody(req);
    const text = (body.text || '').trim();
    const imageData = body.imageData || null;
    const imageName = body.imageName || null;
    if (!text && !imageData) return jsonRes(res, 400, { error: 'Message cannot be empty' });
    // Look up the user to get their info
    const users = loadBankUsers();
    const user = users.find(function(u) { return u.id === userId; });
    if (!user) return jsonRes(res, 404, { error: 'User not found' });
    const chats = loadBankChats();
    const msg = {
      id: crypto.randomUUID(),
      userId: userId,
      username: user.username,
      fullName: user.fullName,
      sender: 'admin',
      adminId: currentAdmin.id,
      text: text,
      imageData: imageData,
      imageName: imageName,
      timestamp: new Date().toISOString(),
      read: false
    };
    chats.push(msg);
    saveBankChats(chats);
    console.log('[BANK-CHAT] Admin', currentAdmin.id, 'replied to', user.username);
    return jsonRes(res, 200, { success: true, messageId: msg.id });
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

  // Serve banking portal
  if (pathname === '/bank' || pathname === '/bank/') {
    return serveFile(path.join(__dirname, 'public', 'bank.html'), res);
  }

  let filePath = pathname === '/' ? '/index.html' : pathname;
  serveFile(path.join(__dirname, 'public', filePath), res);

  } catch (err) {
    console.error('Server error:', err);
    if (!res.headersSent) { res.writeHead(500); res.end(JSON.stringify({ error: 'Internal server error' })); }
  }
});

// ─── Start server ────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════════════╗`);
  console.log(`║            🚚  TrackHub Server v4.0  🚚              ║`);
  console.log(`╠══════════════════════════════════════════════════════╣`);
  console.log(`║  Client Tracking:  http://localhost:${PORT}               ║`);
  console.log(`║  Admin Dashboard:  http://localhost:${PORT}${ADMIN_PATH}  ║`);
  console.log(`╠══════════════════════════════════════════════════════╣`);
  console.log(`║  Multi-Admin: ${ADMINS.length} accounts (admin1–admin${ADMINS.length})        ║`);
  console.log(`║  TrackHub Banking: ENABLED                            ║`);
  console.log(`║  Banking Chat + Image Support: ENABLED                ║`);
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
    }, 10 * 60 * 1000); // Ping every 10 minutes to prevent sleeping
  }
});
