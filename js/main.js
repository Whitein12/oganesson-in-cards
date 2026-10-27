// ==========================================
// main.js - Boot (input, menus, #join=CODE invite links) and the ?autoplay debug modes:
//   ?autoplay=bots[&seed=N&stopAt=T&fast=0&turbo=1]  watch bot vs bot (stopAt pauses at a turn, turbo skips animations)
//   ?autoplay=host&net=peer|lan&code=XXXXX            host a network game, played by the bot
//   ?autoplay=guest&net=peer|lan&code=XXXXX           join it, played by the bot
//   &deck0=ID&deck1=ID                                 the decks (premade or your own deck ids)
// At the end the result goes to the console, the page title and <pre id="debug-result">.
// ==========================================

window.addEventListener('DOMContentLoaded', () => {
    document.title = GAME_TITLE;
    Input.init();
    Menu.init();
    const q = new URLSearchParams(location.search);
    if (q.get('autoplay')) return Debug.autoplay(q);
    const m = location.hash.match(/join=([A-Za-z0-9]+)/);
    if (m) Menu.setupJoin('peer', m[1].toUpperCase());
    else Menu.main();
});

// Close the connection when the page goes away (Chrome may otherwise keep it open in its back/forward
// cache, holding the room code); a page restored from that cache starts fresh.
window.addEventListener('pagehide', () => {
    const s = UI.session;
    if (s && s.t) { try { s.t.close(); } catch (e) { /* already closed */ } }
});
window.addEventListener('pageshow', e => { if (e.persisted) location.reload(); });

const Debug = {
    autoplay(q) {
        UI.settings.fast = q.get('fast') !== '0';
        UI.settings.turbo = q.get('turbo') === '1';
        UI.settings.passScreen = false;
        const mode = q.get('autoplay'), net = q.get('net') || 'peer';
        const code = (q.get('code') || 'TEST1').toUpperCase();
        const deck0 = deckData(findDeck(q.get('deck0')) || DECKS[0]), deck1 = deckData(findDeck(q.get('deck1')) || DECKS[1 % DECKS.length]);
        if (mode === 'bots') {
            Menu.start(new BotSession({ decks: [deck0, deck1], names: ['Bot A', 'Bot B'], bots: [true, true],
                seed: Number(q.get('seed')) || undefined, stopAt: Number(q.get('stopAt')) || 0 }));
        } else if (mode === 'host' || mode === 'guest') {
            const s = mode === 'host'
                ? new HostSession({ transport: makeTransport(net), net, code, name: 'Host Bot', deck: deck0 })
                : new GuestSession({ transport: makeTransport(net), net, code, name: 'Guest Bot', deck: deck1 });
            Menu.start(s);
            Debug.drive(s, mode === 'host' ? 0 : 1);
        }
        Debug.watch();
    },

    // Plays the local side of a network game with the bot, from this player's own view
    drive(session, me) {
        const step = () => {
            if (UI.session !== session || UI.busy || UI.waiting || Debug.pending) return;
            const v = UI.view;
            if (!v || v.phase === 'over') return;
            const a = Bot.act(v, me, { mode: 'greedy' });
            if (!a) return;
            Debug.pending = setTimeout(() => {
                Debug.pending = null;
                if (UI.session === session && !UI.busy && !UI.waiting && UI.view === v) { Overlay.hide(); uiSend(a); }
            }, 150);
        };
        UI.onIdle = step;
        setInterval(step, 700);
    },

    watch() {
        const timer = setInterval(() => {
            const v = UI.view;
            if (!v || v.phase !== 'over' || UI.busy) return;
            clearInterval(timer);
            const s = UI.session;
            const result = { winner: v.winner, turn: v.turn, me: UI.me, kind: s && s.kind, viewHash: Debug.hash(v) };
            if (s && s.kind === 'host') result.guestViewHash = Debug.hash(Engine.viewFor(s.g, 1));
            Debug.report(result);
        }, 300);
    },

    report(result) {
        const text = JSON.stringify(result);
        console.log('OGN_RESULT ' + text);
        document.title = 'OGN_DONE ' + text;
        let pre = document.getElementById('debug-result');
        if (!pre) { pre = document.createElement('pre'); pre.id = 'debug-result'; pre.style.display = 'none'; document.body.appendChild(pre); }
        pre.textContent = text;
    },

    hash(obj) {
        const s = JSON.stringify(obj);
        let h = 0x811c9dc5;
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
        return (h >>> 0).toString(36);
    },
};
