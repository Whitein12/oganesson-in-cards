// ==========================================
// server.js - LAN server: serves the game to the local network and relays messages between the two
// players of a room over WebSockets, so LAN games need no internet. No dependencies (Node 16+).
// Usage: node server.js [port] [--open]     (PlayLAN.bat runs it on port 8080 and opens the browser)
// Endpoints: GET /rooms (open rooms), GET /lan-info (addresses friends can use), WebSocket /ws
// Client messages: { t: 'host', code, name } -> hosted | { t: 'join', code } -> joined | { t: 'relay', data }
// Server messages: hosted, joined, error { reason }, relay { data }, peer-joined, peer-left
// ==========================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = Number(process.argv.find(a => /^\d+$/.test(a))) || Number(process.env.PORT) || 8080;
const ROOT = __dirname;
const MAX_MESSAGE = 1024 * 1024;
const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

const rooms = new Map();    // code -> { host, guest, name }
const clients = new Set();

function lanUrls() {
    const out = [];
    for (const list of Object.values(os.networkInterfaces())) {
        for (const a of list || []) if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push('http://' + a.address + ':' + PORT);
    }
    return out;
}

// ---------- Static files ----------

const server = http.createServer((req, res) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch (e) { res.writeHead(400); return res.end(); }
    if (url.pathname === '/rooms') {
        const list = [...rooms].filter(([, r]) => r.host && !r.guest).map(([code, r]) => ({ code, name: r.name }));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Ogn-Lan': '1' });
        return res.end(JSON.stringify(list));
    }
    if (url.pathname === '/lan-info') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ urls: lanUrls() }));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch (e) { res.writeHead(400); return res.end(); }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(ROOT, '.' + rel);
    // nothing outside the game folder, and no hidden files (.git and friends)
    if (!file.startsWith(ROOT + path.sep) || rel.split(/[\\/]/).some(seg => seg.startsWith('.'))) { res.writeHead(404); return res.end('Not found'); }
    fs.stat(file, (err, st) => {
        if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(file).pipe(res);
    });
});

// ---------- WebSockets (RFC 6455, text frames only) ----------

class WsClient {
    constructor(socket) {
        this.socket = socket; this.buf = Buffer.alloc(0); this.parts = null;
        this.alive = true; this.closed = false; this.room = null; this.role = null;
        this.onMessage = null; this.onClose = null;
        socket.setNoDelay(true);
        socket.on('data', d => this.onData(d));
        socket.on('close', () => this.finish());
        socket.on('error', () => this.finish());
    }
    onData(chunk) {
        this.buf = Buffer.concat([this.buf, chunk]);
        try { while (this.parse()); } catch (e) { this.close(1002); }
    }
    // Reads one frame from the buffer; false when it needs more data
    parse() {
        const b = this.buf;
        if (b.length < 2) return false;
        const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
        let len = b[1] & 0x7f, off = 2;
        if (len === 126) { if (b.length < 4) return false; len = b.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (b.length < 10) return false; if (b.readUInt32BE(2) !== 0) throw new Error('frame too big'); len = b.readUInt32BE(6); off = 10; }
        if (len > MAX_MESSAGE) throw new Error('frame too big');
        if (!masked) throw new Error('client frames must be masked');
        if (b.length < off + 4 + len) return false;
        const mask = b.subarray(off, off + 4);
        const data = Buffer.from(b.subarray(off + 4, off + 4 + len));
        for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
        this.buf = b.subarray(off + 4 + len);
        switch (op) {
            case 0x0:
                if (!this.parts) throw new Error('unexpected continuation');
                this.parts.push(data);
                if (this.parts.reduce((n, p) => n + p.length, 0) > MAX_MESSAGE) throw new Error('message too big');
                if (fin) { const all = Buffer.concat(this.parts); this.parts = null; this.deliver(all); }
                return true;
            case 0x1: case 0x2:
                if (fin) this.deliver(data); else this.parts = [data];
                return true;
            case 0x8: this.close(1000); return false;
            case 0x9: this.frame(0xA, data); return true;
            case 0xA: this.alive = true; return true;
        }
        throw new Error('bad opcode');
    }
    deliver(data) { if (this.onMessage) this.onMessage(data.toString('utf8')); }
    frame(op, payload) {
        if (this.closed || this.socket.destroyed) return;
        const n = payload.length;
        let head;
        if (n < 126) head = Buffer.from([0x80 | op, n]);
        else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(n, 2); }
        else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(n, 6); }
        this.socket.write(Buffer.concat([head, payload]));
    }
    send(obj) { this.frame(0x1, Buffer.from(JSON.stringify(obj), 'utf8')); }
    close(code) {
        if (this.closed) return;
        const p = Buffer.alloc(2);
        p.writeUInt16BE(code || 1000, 0);
        try { this.frame(0x8, p); this.socket.end(); } catch (e) { /* already gone */ }
        setTimeout(() => this.socket.destroy(), 1000);
        this.finish();
    }
    finish() {
        if (this.closed) return;
        this.closed = true;
        if (this.onClose) this.onClose();
    }
}

server.on('upgrade', (req, socket) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch (e) { return socket.destroy(); }
    const key = req.headers['sec-websocket-key'];
    if (!url.pathname.endsWith('/ws') || String(req.headers.upgrade).toLowerCase() !== 'websocket' || !key) return socket.destroy();
    const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    const c = new WsClient(socket);
    clients.add(c);
    c.onMessage = text => onClientMessage(c, text);
    c.onClose = () => onClientGone(c);
});

// Drops connections that stop answering pings
setInterval(() => {
    for (const c of clients) {
        if (!c.alive) { c.socket.destroy(); c.finish(); continue; }
        c.alive = false;
        c.frame(0x9, Buffer.alloc(0));
    }
}, 20000);

// ---------- Rooms ----------

function cleanCode(s) {
    s = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return s.length >= 3 && s.length <= 12 ? s : null;
}

function onClientMessage(c, text) {
    let m;
    try { m = JSON.parse(text); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'host') {
        const code = cleanCode(m.code);
        if (!code) return c.send({ t: 'error', reason: 'Bad room code.' });
        const room = rooms.get(code);
        if (room && room.host && room.host !== c) return c.send({ t: 'error', reason: 'That room code is already taken.' });
        rooms.set(code, { host: c, guest: room ? room.guest : null, name: String(m.name || '').slice(0, 20) });
        c.room = code; c.role = 'host';
        c.send({ t: 'hosted', code });
        log('room ' + code + ' opened');
    } else if (m.t === 'join') {
        const code = cleanCode(m.code);
        const room = code && rooms.get(code);
        if (!room || !room.host) return c.send({ t: 'error', reason: 'No game found with that code.' });
        if (room.guest && room.guest !== c) return c.send({ t: 'error', reason: 'That game is already full.' });
        room.guest = c; c.room = code; c.role = 'guest';
        c.send({ t: 'joined', code });
        room.host.send({ t: 'peer-joined' });
        log('room ' + code + ': a player joined');
    } else if (m.t === 'relay') {
        const room = c.room && rooms.get(c.room);
        if (!room) return;
        const other = c.role === 'host' ? room.guest : room.host;
        if (other && !other.closed) other.send({ t: 'relay', data: m.data });
    }
}

function onClientGone(c) {
    clients.delete(c);
    const room = c.room && rooms.get(c.room);
    if (!room) return;
    if (c.role === 'host' && room.host === c) {
        if (room.guest) room.guest.send({ t: 'peer-left' });
        rooms.delete(c.room);
        log('room ' + c.room + ' closed');
    } else if (c.role === 'guest' && room.guest === c) {
        room.guest = null;
        if (room.host) room.host.send({ t: 'peer-left' });
        log('room ' + c.room + ': the guest left');
    }
}

function log(s) { console.log(new Date().toLocaleTimeString() + '  ' + s); }

// ---------- Start ----------

server.on('error', e => {
    if (e.code === 'EADDRINUSE') console.error('Port ' + PORT + ' is already in use. Close the other server or run: node server.js 8081');
    else console.error(e);
    process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
    console.log('\n  Oganesson in Cards - LAN server\n');
    console.log('  On this computer:     http://localhost:' + PORT);
    for (const u of lanUrls()) console.log('  Friends on your LAN:  ' + u);
    console.log('\n  Keep this window open while you play. Ctrl+C stops the server.\n');
    if (process.argv.includes('--open')) {
        const url = 'http://localhost:' + PORT;
        const cmd = process.platform === 'win32' ? 'start "" "' + url + '"' : process.platform === 'darwin' ? 'open "' + url + '"' : 'xdg-open "' + url + '"';
        require('child_process').exec(cmd);
    }
});
