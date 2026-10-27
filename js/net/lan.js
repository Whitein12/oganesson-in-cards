// ==========================================
// lan.js - LAN transport: a WebSocket to server.js, which relays messages between the two players
// of a room. No internet needed; both players open the page from the computer running PlayLAN.bat.
// Same interface as PeerTransport (peer.js).
// ==========================================

class LanTransport {
    constructor() {
        this.ws = null; this.closed = false; this.waiters = [];
        this.onMessage = null; this.onPeer = null; this.onPeerLeft = null; this.onError = null;
    }

    // True when this page was served by server.js
    static async available() {
        if (!/^https?:$/.test(location.protocol)) return false;
        try {
            const r = await fetch('rooms', { cache: 'no-store' });
            return r.ok && r.headers.get('X-Ogn-Lan') === '1';
        } catch (e) { return false; }
    }

    static async rooms() {
        const r = await fetch('rooms', { cache: 'no-store' });
        return r.ok ? r.json() : [];
    }

    // The addresses friends can open (server.js knows the network interfaces)
    static async info() {
        try { const r = await fetch('lan-info', { cache: 'no-store' }); return r.ok ? r.json() : null; } catch (e) { return null; }
    }

    open() {
        return new Promise((resolve, reject) => {
            const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + location.pathname.replace(/[^/]*$/, '') + 'ws';
            const ws = this.ws = new WebSocket(url);
            let opened = false;
            ws.onopen = () => { opened = true; resolve(); };
            ws.onerror = () => { if (!opened) reject(new Error('Can\'t reach the LAN server. Is PlayLAN.bat still running?')); };
            ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (err) { return; } this.handle(m); };
            ws.onclose = () => {
                for (const w of this.waiters.splice(0)) w.reject(new Error('The LAN server closed the connection.'));
                if (opened && !this.closed && this.onPeerLeft) this.onPeerLeft();
            };
        });
    }

    request(msg, okType) {
        return new Promise((resolve, reject) => {
            this.waiters.push({ okType, resolve, reject });
            this.ws.send(JSON.stringify(msg));
        });
    }

    handle(m) {
        if (m.t === 'relay') { if (this.onMessage) this.onMessage(m.data); return; }
        if (m.t === 'peer-joined') { if (this.onPeer) this.onPeer(); return; }
        if (m.t === 'peer-left') { if (this.onPeerLeft) this.onPeerLeft(); return; }
        const w = this.waiters.shift();
        if (!w) return;
        if (m.t === w.okType) w.resolve(m);
        else w.reject(new Error(m.reason || 'LAN server error.'));
    }

    async host(code, name) { await this.open(); await this.request({ t: 'host', code, name }, 'hosted'); }
    async join(code) { await this.open(); await this.request({ t: 'join', code }, 'joined'); }

    send(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'relay', data: obj })); }

    // The LAN server notices dropped sockets itself (it pings them)
    dropPeer() {}

    close() {
        this.closed = true;
        try { if (this.ws) this.ws.close(); } catch (e) { /* ignore */ }
    }
}

function makeTransport(net) { return net === 'lan' ? new LanTransport() : new PeerTransport(); }
