// ==========================================
// view.js - What one player may see: redacted copies of the state and of the event list
// The host sends viewFor(g, guest) over the network, so nothing hidden may stay in a view:
// the opponent's hand and secrets, every deck's order, the RNG and a pending choice's replay data.
// viewer 'all' shows everything (spectating bots, tests).
// ==========================================

function viewFor(g, viewer) {
    const v = JSON.parse(JSON.stringify(g));
    delete v.rng;
    v.viewer = viewer;
    if (g.pending) {
        const mine = viewer === 'all' || viewer === g.pending.player;
        v.pending = { player: g.pending.player, kind: g.pending.kind, options: mine ? g.pending.options.slice() : null, count: g.pending.options.length };
    }
    for (const p of v.players) {
        p.deckCount = p.deck.length;
        delete p.deck;
        if (viewer === 'all' || p.index === viewer) continue;
        p.hand = p.hand.map(c => ({ uid: c.uid, owner: c.owner, zone: 'hand', hidden: true }));
        p.secrets = p.secrets.map(s => ({ uid: s.uid, owner: s.owner, zone: 'secret', hidden: true, cls: (CARDS[s.cardId] || {}).class }));
    }
    return v;
}

function redactEvents(events, viewer) {
    if (viewer === 'all') return events.slice();
    return events.map(ev => {
        if (ev.p == null || ev.p === viewer) return ev;
        switch (ev.t) {
            case 'draw': case 'addCard': return Object.assign({}, ev, { cardId: null });
            case 'discover': return Object.assign({}, ev, { options: null });
            case 'mulligan': return { t: 'mulligan', p: ev.p, count: ev.count };
            case 'secret': return Object.assign({}, ev, { cardId: null });
            case 'play': return ev.secret ? Object.assign({}, ev, { cardId: null }) : ev;
            default: return ev;
        }
    });
}
