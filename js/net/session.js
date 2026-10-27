// ==========================================
// session.js - Who runs the engine and how actions travel
//   LocalSession  hot-seat: both players on this screen
//   BotSession    you against the bot (or bot against bot when spectating)
//   HostSession   this browser runs the game; the guest's actions arrive over a transport
//   GuestSession  sends actions to the host and shows the views the host sends back
// Every session has start(), send(action), rematch(), leave() and shows updates with uiPush().
// Decks travel as plain data ({ name, hero, cards: { cardId: copies } }), so custom decks work everywhere.
// Messages (both transports): hello{name, deck, version, token}, welcome{you, rejoin}, reject{reason, busy},
// state{view, events, reset, timeLeft}, action{action}, error{msg}, rematch, bye, ping / pong.
// ==========================================

const SAVE_KEY = 'ogn_save';

function randomSeed() { return (Math.random() * 4294967296) >>> 0; }
function randomCode() {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 5; i++) s += abc[Math.floor(Math.random() * abc.length)];
    return s;
}
function cleanName(s) { return String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20); }

// A deck that arrived over the network: only real card ids and sane counts (null otherwise).
// The host then checks it with Engine.validateDeck like any other deck.
function sanitizeDeck(d) {
    if (!d || typeof d !== 'object' || typeof d.hero !== 'string' || !d.cards || typeof d.cards !== 'object' || Array.isArray(d.cards)) return null;
    const ids = Object.keys(d.cards);
    if (ids.length > RULES.deckSize) return null;
    const cards = {};
    for (const id of ids) {
        const n = Math.floor(Number(d.cards[id]));
        if (!hasCard(id) || !(n >= 1 && n <= RULES.deckSize)) return null;
        cards[id] = n;
    }
    return { id: 'guest', name: cleanName(d.name) || 'Guest deck', hero: d.hero, cards };
}
function saveGame(data) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) { /* storage off */ } }
function loadSave() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { return null; } }
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* storage off */ } }
function rematchNote(text) { const n = document.getElementById('rematch-note'); if (n) n.textContent = text; }

// A guest keeps the same token per room code, so the host can tell a reconnect from a stranger
function guestToken(code) {
    const key = 'ogn_token_' + code;
    try {
        let t = localStorage.getItem(key);
        if (!t) { t = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(key, t); }
        return t;
    } catch (e) { return 'tok' + Math.random().toString(36).slice(2); }
}

// ---------- Hot-seat ----------

class LocalSession {
    constructor(opts) {
        this.kind = 'local';
        this.opts = { decks: opts.decks, names: opts.names };
        this.g = opts.g || Engine.newGame({ seed: randomSeed(), players: [{ name: opts.names[0], deck: opts.decks[0] }, { name: opts.names[1], deck: opts.decks[1] }] });
    }
    // The player who acts now, and whose side of the table is shown
    actor() { const w = Engine.whoActs(this.g); return w.length ? w[0] : UI.me; }
    start() { const me = this.actor(); uiPush({ view: Engine.viewFor(this.g, me), events: [], me, reset: true, timer: null }); this.save(); }
    send(action) {
        const pi = action.type === 'concede' ? UI.me : this.actor();
        const r = Engine.apply(this.g, pi, action);
        if (!r.ok) { UI.waiting = false; uiToast(r.error); Input.refresh(); return; }
        const me = this.actor();
        uiPush({ view: Engine.viewFor(this.g, me), events: Engine.redactEvents(r.events, pi), me });
        this.save();
    }
    save() { if (this.g.phase === 'over') clearSave(); else saveGame({ kind: 'local', g: this.g, opts: this.opts }); }
    rematch() { Menu.start(new LocalSession(this.opts)); }
    leave() {}
}

// ---------- Against the bot ----------

class BotSession {
    constructor(opts) {
        this.kind = 'bot';
        this.opts = { decks: opts.decks, names: opts.names, bots: opts.bots || [false, true], seed: opts.seed, stopAt: opts.stopAt };
        this.bots = this.opts.bots;
        this.spectate = this.bots[0] && this.bots[1];
        this.me = this.bots[0] && !this.bots[1] ? 1 : 0;
        this.viewer = this.spectate ? 'all' : this.me;
        this.g = opts.g || Engine.newGame({ seed: opts.seed || randomSeed(), players: [{ name: opts.names[0], deck: opts.decks[0] }, { name: opts.names[1], deck: opts.decks[1] }] });
        this.handle = null;
        this.stopped = false;
    }
    start() {
        UI.onIdle = () => this.tick();
        uiPush({ view: Engine.viewFor(this.g, this.viewer), events: [], me: this.me, reset: true, timer: null });
        this.save();
    }
    send(action) { this.apply(this.me, action); }
    apply(pi, action) {
        const r = Engine.apply(this.g, pi, action);
        if (!r.ok) {
            if (!this.bots[pi]) { UI.waiting = false; uiToast(r.error); Input.refresh(); }
            else console.warn('Bot action rejected', action, r.error);
            return false;
        }
        uiPush({ view: Engine.viewFor(this.g, this.viewer), events: Engine.redactEvents(r.events, this.viewer), me: this.me });
        this.save();
        return true;
    }
    // Runs when the UI has shown everything: a bot whose turn it is takes one action
    tick() {
        if (this.stopped || this.handle) return;
        if (this.opts.stopAt && this.g.turn >= this.opts.stopAt) return;
        if (!Engine.whoActs(this.g).some(pi => this.bots[pi])) return;
        this.handle = setTimeout(() => {
            this.handle = null;
            if (this.stopped || UI.busy || UI.session !== this) return;
            const pi = Engine.whoActs(this.g).find(i => this.bots[i]);
            if (pi == null) return;
            const a = Bot.act(Engine.viewFor(this.g, pi), pi, { mode: 'greedy' });
            if (!a || !this.apply(pi, a)) this.apply(pi, Engine.legalActions(this.g, pi).pop() || { type: 'concede' });
        }, (UI.settings.fast ? 260 : 700) * (this.spectate ? 0.7 : 1));
    }
    save() {
        if (this.spectate) return;
        if (this.g.phase === 'over') clearSave(); else saveGame({ kind: 'bot', g: this.g, opts: this.opts });
    }
    rematch() { Menu.start(new BotSession(Object.assign({}, this.opts, { seed: undefined }))); }
    leave() { this.stopped = true; clearTimeout(this.handle); }
}

// ---------- Network host ----------

class HostSession {
    constructor(opts) {
        this.kind = 'host';
        this.net = opts.net;
        this.t = opts.transport;
        this.code = opts.code || randomCode();
        this.name = cleanName(opts.name) || 'Host';
        this.deck = opts.deck || deckById(opts.deckId);   // (deckId: saves from older versions)
        this.g = opts.g || null;            // set once the guest says hello (or when resuming)
        this.guest = opts.guest || null;    // { name, deck, token }
        this.wantRematch = [false, false];
        this.timerKey = null; this.timerHandle = null; this.deadline = null;
        this.heard = 0;     // when the guest last sent anything (0 = no guest connected)
        this.beat = null;
        this.left = false;
    }
    bind(t) {
        t.onMessage = m => { this.heard = Date.now(); try { this.onMessage(m); } catch (e) { console.error(e); } };
        t.onPeer = () => uiStatus('Opponent connected.');
        t.onPeerLeft = () => { this.heard = 0; uiStatus('Your opponent disconnected. They can rejoin with code ' + this.code + '.', 'warn'); };
        t.onError = msg => uiStatus(msg, 'err');
    }
    async start() {
        this.bind(this.t);
        this.beat = setInterval(() => this.heartbeat(), 5000);
        uiStatus('Opening room ' + this.code + '...');
        // a resumed game wants its old code back, which the old page may still hold for a few seconds
        for (let attempt = 1; ; attempt++) {
            try { await this.t.host(this.code, this.name); break; }
            catch (e) {
                if (this.left) return;
                if (!this.g || attempt >= 12) { uiStatus(e.message, 'err'); Menu.lobbyFailed(); return; }
                uiStatus(e.message + ' Trying again...', 'warn');
                this.t.close();
                this.t = makeTransport(this.net);
                this.bind(this.t);
                await new Promise(r => setTimeout(r, 2500));
            }
        }
        if (this.left) return this.t.close();
        if (this.g) { uiStatus('Room ' + this.code + ' is open again. Waiting for your opponent to rejoin...', 'warn'); this.pushLocal([], true); }
        else uiStatus('Room ' + this.code + ' is open. Waiting for an opponent...');
    }
    onMessage(m) {
        if (!m || typeof m !== 'object') return;
        if (m.t === 'hello') this.onHello(m);
        else if (m.t === 'action' && this.g && this.guest) this.apply(1, m.action);
        else if (m.t === 'rematch') { this.wantRematch[1] = true; rematchNote('Your opponent wants a rematch!'); this.tryRematch(); }
        else if (m.t === 'ping') this.t.send({ t: 'pong' });
        else if (m.t === 'bye') uiStatus('Your opponent left the game.', 'warn');
    }
    // A guest whose connection died without closing would block its own reconnect; drop it after 15 s of silence
    heartbeat() {
        if (!this.heard || this.left) return;
        if (Date.now() - this.heard > 15000) {
            this.heard = 0;
            this.t.dropPeer();
            return;
        }
        this.t.send({ t: 'ping' });
    }
    onHello(m) {
        const version = Engine.cardsetHash();
        if (m.version !== version) {
            this.t.send({ t: 'reject', reason: 'The two games are different versions (' + version + ' / ' + m.version + '). Both players should reload the same version.' });
            return;
        }
        if (!this.g) {
            const deck = sanitizeDeck(m.deck);
            const problems = deck ? Engine.validateDeck(deck) : ['The deck could not be read.'];
            if (problems.length) { this.t.send({ t: 'reject', reason: 'The host refused your deck: ' + problems[0] }); return; }
            this.guest = { name: cleanName(m.name) || 'Guest', deck, token: String(m.token || '') };
            this.newGame();
            this.t.send({ t: 'welcome', you: 1, code: this.code });
            this.broadcast([], true);
        } else if (this.guest && m.token && m.token === this.guest.token) {
            this.t.send({ t: 'welcome', you: 1, code: this.code, rejoin: true });
            uiStatus('Your opponent reconnected.');
            this.sendGuest([], true);
        } else this.t.send({ t: 'reject', reason: 'This game has already started with someone else.' });
    }
    newGame() {
        this.g = Engine.newGame({ seed: randomSeed(), players: [{ name: this.name, deck: this.deck }, { name: this.guest.name, deck: this.guest.deck }] });
        this.timerKey = null;
    }
    send(action) { this.apply(0, action); }
    apply(pi, action) {
        const r = Engine.apply(this.g, pi, action);
        if (!r.ok) {
            if (pi === 0) { UI.waiting = false; uiToast(r.error); Input.refresh(); }
            else { this.t.send({ t: 'error', msg: r.error }); this.sendGuest([], false); }
            return false;
        }
        this.broadcast(r.events);
        return true;
    }
    broadcast(events, reset) {
        this.updateTimer();
        this.pushLocal(events, reset);
        this.sendGuest(events, reset);
        this.save();
    }
    pushLocal(events, reset) {
        uiPush({ view: Engine.viewFor(this.g, 0), events: Engine.redactEvents(events, 0), me: 0, reset: !!reset, timer: this.deadline ? { deadline: this.deadline } : null });
    }
    sendGuest(events, reset) {
        this.t.send({ t: 'state', view: Engine.viewFor(this.g, 1), events: Engine.redactEvents(events, 1), reset: !!reset, timeLeft: this.deadline ? this.deadline - Date.now() : null });
    }
    // One timer per turn (and one for the mulligan); when it runs out the host plays for the slow player
    updateTimer() {
        const g = this.g;
        const key = g.phase === 'over' ? null : g.phase + ':' + g.turn;
        if (key === this.timerKey) return;
        this.timerKey = key;
        clearTimeout(this.timerHandle);
        this.deadline = null;
        if (!key || !RULES.turnSeconds) return;
        const secs = g.phase === 'mulligan' ? RULES.mulliganSeconds : RULES.turnSeconds;
        this.deadline = Date.now() + secs * 1000;
        this.timerHandle = setTimeout(() => this.timeUp(), secs * 1000);
    }
    timeUp() {
        const g = this.g;
        if (!g || g.phase === 'over' || this.left) return;
        if (g.phase === 'mulligan') { for (const pi of Engine.whoActs(g)) this.apply(pi, { type: 'mulligan', replace: [] }); return; }
        if (g.pending) this.apply(g.pending.player, { type: 'choose', index: Math.floor(Math.random() * g.pending.options.length) });
        if (g.phase === 'main' && !g.pending) this.apply(g.current, { type: 'end' });
    }
    save() {
        if (this.g.phase === 'over') clearSave();
        else saveGame({ kind: 'host', net: this.net, code: this.code, name: this.name, deck: this.deck, g: this.g, guest: this.guest });
    }
    rematch() {
        this.wantRematch[0] = true;
        this.t.send({ t: 'rematch' });
        rematchNote(this.wantRematch[1] ? '' : 'Waiting for your opponent...');
        this.tryRematch();
    }
    tryRematch() {
        if (!this.wantRematch[0] || !this.wantRematch[1]) return;
        this.wantRematch = [false, false];
        this.newGame();
        this.broadcast([], true);
    }
    leave() {
        this.left = true;
        clearTimeout(this.timerHandle);
        clearInterval(this.beat);
        this.t.send({ t: 'bye' });
        clearSave();
        setTimeout(() => this.t.close(), 200);
    }
}

// ---------- Network guest ----------

class GuestSession {
    constructor(opts) {
        this.kind = 'guest';
        this.net = opts.net;
        this.t = opts.transport;
        this.code = String(opts.code || '').toUpperCase();
        this.name = cleanName(opts.name) || 'Guest';
        this.deck = opts.deck;
        this.token = guestToken(this.code);
        this.left = false;
        this.joined = false;
    }
    bind(t) {
        t.onMessage = m => { try { this.onMessage(m); } catch (e) { console.error(e); } };
        t.onPeerLeft = () => { if (!this.left) this.reconnect(); };
        t.onError = msg => uiStatus(msg, 'err');
    }
    async start() {
        this.bind(this.t);
        uiStatus('Connecting to room ' + this.code + '...');
        try { await this.t.join(this.code); }
        catch (e) { uiStatus(e.message, 'err'); Menu.lobbyFailed(); return; }
        if (this.left) return this.t.close();
        uiStatus('Connected. Waiting for the host...');
        this.hello();
    }
    hello() { this.t.send({ t: 'hello', name: this.name, deck: this.deck, version: Engine.cardsetHash(), token: this.token }); }
    // Tries to get back into the game for a while (about a minute) after losing the connection
    async reconnect() {
        if (this.reconnecting) return;
        if (!this.joined) { uiStatus('The connection to the host was lost.', 'err'); Menu.lobbyFailed(); return; }
        this.reconnecting = true;
        try {
            for (let i = 1; i <= 24 && !this.left; i++) {
                uiStatus('Connection lost. Reconnecting (' + i + ')...', 'warn');
                await new Promise(r => setTimeout(r, 2500));
                if (this.left) return;
                const t = makeTransport(this.net);
                this.bind(t);
                try {
                    await t.join(this.code);
                    try { this.t.close(); } catch (e) { /* the old one is gone */ }
                    this.t = t;
                    this.hello();
                    return;
                } catch (e) { t.close(); }
            }
            if (!this.left) uiStatus('Could not reconnect. Use Join with code ' + this.code + ' to try again.', 'err');
        } finally { this.reconnecting = false; }
    }
    onMessage(m) {
        if (!m || typeof m !== 'object') return;
        if (m.t === 'welcome') { this.joined = true; uiStatus(m.rejoin ? 'Back in the game.' : ''); }
        else if (m.t === 'reject' && m.busy && this.joined && !this.left) {
            // the host still holds our old, dead connection: try again shortly
            const old = this.t;
            setTimeout(() => { try { old.close(); } catch (e) { /* gone */ } this.reconnect(); }, 0);
        }
        else if (m.t === 'reject') { uiStatus(m.reason, 'err'); Menu.lobbyFailed(); this.left = true; this.t.close(); }
        else if (m.t === 'ping') this.t.send({ t: 'pong' });
        else if (m.t === 'state') uiPush({ view: m.view, events: m.events || [], me: 1, reset: !!m.reset, timer: m.timeLeft != null ? { deadline: Date.now() + m.timeLeft } : null });
        else if (m.t === 'error') { UI.waiting = false; uiToast(m.msg); Input.refresh(); }
        else if (m.t === 'rematch') rematchNote('Your opponent wants a rematch!');
        else if (m.t === 'bye') uiStatus('The host left the game.', 'warn');
    }
    send(action) { this.t.send({ t: 'action', action }); }
    rematch() { this.t.send({ t: 'rematch' }); rematchNote('Waiting for the host...'); }
    leave() {
        this.left = true;
        this.t.send({ t: 'bye' });
        setTimeout(() => this.t.close(), 200);
    }
}
