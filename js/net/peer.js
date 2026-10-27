// ==========================================
// peer.js - Online transport: WebRTC through PeerJS (lib/peerjs.min.js) and its free signaling
// server (0.peerjs.com), so it works from GitHub Pages. Both browsers need internet to connect;
// the game data then flows directly between them.
// A transport offers host(code) / join(code) / send(obj) / close() and the callbacks
// onMessage(obj), onPeer() (the guest connected), onPeerLeft(), onError(text).
// To use your own PeerServer, set window.OGN_PEER_OPTIONS = { host, port, path, secure } before this file loads.
// ==========================================

const PEER_PREFIX = 'ogn-';

class PeerTransport {
    constructor() {
        this.peer = null; this.conn = null; this.closed = false;
        this.onMessage = null; this.onPeer = null; this.onPeerLeft = null; this.onError = null;
    }

    static available() { return typeof Peer === 'function'; }

    host(code) {
        return new Promise((resolve, reject) => {
            if (!PeerTransport.available()) return reject(new Error('PeerJS did not load (lib/peerjs.min.js).'));
            const peer = this.peer = new Peer(PEER_PREFIX + code.toLowerCase(), peerOptions());
            let open = false;
            peer.on('open', () => { open = true; resolve(); });
            peer.on('connection', conn => {
                conn.on('open', () => {
                    if (this.conn && this.conn.open) {
                        // one guest at a time; a dropped guest gets in once its old connection closes
                        // (or the host's heartbeat gives up on it), so `busy` tells it to keep trying
                        conn.send({ t: 'reject', reason: 'This game is already full.', busy: true });
                        setTimeout(() => conn.close(), 500);
                        return;
                    }
                    this.attach(conn);
                    if (this.onPeer) this.onPeer();
                });
            });
            // keep the room code registered so a dropped guest can reconnect
            peer.on('disconnected', () => { if (!this.closed && !peer.destroyed) setTimeout(() => { try { peer.reconnect(); } catch (e) { /* retried on the next drop */ } }, 1500); });
            peer.on('error', err => {
                const msg = peerErrorText(err);
                if (!open) reject(new Error(msg));
                else if (this.onError && err.type !== 'peer-unavailable') this.onError(msg);
            });
        });
    }

    join(code) {
        return new Promise((resolve, reject) => {
            if (!PeerTransport.available()) return reject(new Error('PeerJS did not load (lib/peerjs.min.js).'));
            const peer = this.peer = new Peer(peerOptions());
            const timer = setTimeout(() => reject(new Error('The host did not answer. Check the code, and that the host is waiting in the lobby.')), 20000);
            peer.on('open', () => {
                const conn = peer.connect(PEER_PREFIX + code.toLowerCase(), { reliable: true, serialization: 'json' });
                conn.on('open', () => { clearTimeout(timer); this.attach(conn); resolve(); });
            });
            peer.on('error', err => {
                clearTimeout(timer);
                const msg = peerErrorText(err);
                if (!this.conn) reject(new Error(msg));
                else if (this.onError) this.onError(msg);
            });
        });
    }

    attach(conn) {
        const old = this.conn;
        this.conn = conn;
        if (old && old !== conn) { try { old.close(); } catch (e) { /* already gone */ } }
        conn.on('data', d => {
            let m = d;
            if (typeof d === 'string') { try { m = JSON.parse(d); } catch (e) { return; } }
            if (this.onMessage) this.onMessage(m);
        });
        conn.on('close', () => {
            if (this.conn !== conn) return;
            this.conn = null;
            if (!this.closed && this.onPeerLeft) this.onPeerLeft();
        });
        conn.on('error', () => {});
    }

    send(obj) { if (this.conn && this.conn.open) this.conn.send(obj); }

    // Host: forget a guest that stopped answering, so it can connect again
    dropPeer() {
        const conn = this.conn;
        if (!conn) return;
        this.conn = null;
        try { conn.close(); } catch (e) { /* already gone */ }
        if (!this.closed && this.onPeerLeft) this.onPeerLeft();
    }

    close() {
        this.closed = true;
        try { if (this.conn) this.conn.close(); } catch (e) { /* ignore */ }
        try { if (this.peer) this.peer.destroy(); } catch (e) { /* ignore */ }
    }
}

function peerOptions() { return Object.assign({ debug: 1 }, window.OGN_PEER_OPTIONS || {}); }

function peerErrorText(err) {
    switch (err && err.type) {
        case 'peer-unavailable': return 'No game found with that code.';
        case 'unavailable-id': return 'That room code is already taken.';
        case 'browser-incompatible': return 'This browser does not support WebRTC.';
        case 'network': case 'socket-error': case 'socket-closed': case 'server-error':
            return 'Can\'t reach the online server (online play needs internet). On a local network you can use the LAN server (PlayLAN.bat).';
    }
    return 'Connection error: ' + ((err && (err.message || err.type)) || err);
}
