// ==========================================
// board.js - The UI controller: the update queue (animate the events, then render the new view),
// drawing a view onto the table (elements are keyed by uid so they survive between renders),
// the overlays that follow the game state, the history log, the turn timer and the hover zoom
// ==========================================

const UI = {
    session: null,      // the running session (session.js)
    me: 0,              // the player shown at the bottom
    view: null,         // the view on screen
    queue: [],          // updates waiting to be shown
    busy: false,        // an update is being animated
    waiting: false,     // an action was sent and its result hasn't arrived
    timer: null,        // { deadline (local ms), total (ms) } or null
    onIdle: null,       // called whenever the queue runs empty (the bot session continues)
    gen: 0,             // bumped when a session starts or ends, so a stale animation loop stops
    overReason: '',
    settings: { name: '', fast: false, passScreen: true },
};

function $(id) { return document.getElementById(id); }

function showScreen(which) {
    for (const id of ['menu', 'game', 'collection']) $('screen-' + id).classList.toggle('hidden', which !== id);
}

// ---------- Updates ----------

// Sessions call this with { view, events, me, timer, reset }
function uiPush(u) {
    UI.queue.push(u);
    if (!UI.busy) uiProcess();
}

async function uiProcess() {
    const gen = UI.gen;
    UI.busy = true;
    while (UI.queue.length && gen === UI.gen) {
        const u = UI.queue.shift();
        try { await uiShow(u, gen); }
        catch (e) { console.error(e); UI.me = u.me; UI.view = u.view; renderGame(); afterRender(); }
    }
    if (gen !== UI.gen) return; // another session took over and runs its own loop
    UI.busy = false;
    Input.refresh();
    if (UI.onIdle) UI.onIdle();
}

async function uiShow(u, gen) {
    UI.waiting = false;
    if ('timer' in u) UI.timer = u.timer;
    showScreen('game');
    if (!UI.view || u.reset) {
        UI.me = u.me; UI.view = u.view;
        Overlay.hide();
        Log.clear();
        Log.add('<b>' + esc(GAME_TITLE) + '</b> - ' + esc(u.view.players[0].name) + ' vs ' + esc(u.view.players[1].name), 'sys');
        renderGame();
        afterRender();
        return;
    }
    const events = u.events || [];
    Input.cancel();
    if (u.me !== UI.me) {
        // hot-seat: finish the old player's part on their side of the table, hide it, then turn the table
        let cut = events.findIndex(e => e.t === 'turn');
        if (cut < 0) cut = events.length;
        await Anim.run(events.slice(0, cut), u.view);
        if (gen !== UI.gen) return;
        if (UI.settings.passScreen) await passScreen(u.view.players[u.me].name);
        if (gen !== UI.gen) return;
        UI.me = u.me; UI.view = u.view;
        renderGame();
        await Anim.run(events.slice(cut), u.view);
    } else {
        await Anim.run(events, u.view);
        if (gen !== UI.gen) return;
        UI.view = u.view;
        renderGame();
    }
    if (gen !== UI.gen) return;
    afterRender();
}

function uiSend(action) {
    if (!UI.session) return;
    UI.waiting = true;
    Input.refresh();
    UI.session.send(action);
}

function uiToast(text, kind) {
    const t = $('toast');
    t.textContent = text;
    t.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(uiToast.h);
    uiToast.h = setTimeout(() => { t.className = 'toast'; }, 2600);
}

function uiStatus(text, kind) {
    const s = $('net-status');
    s.textContent = text || '';
    s.className = 'net-status' + (kind ? ' ' + kind : '');
    if (typeof Menu !== 'undefined') Menu.status(text, kind);
}

// ---------- Overlays ----------

const Overlay = {
    kind: null,
    show(kind, html, cls) {
        const o = $('overlay');
        o.className = 'overlay' + (cls ? ' ' + cls : '');
        o.innerHTML = html;
        Overlay.kind = kind;
        return o;
    },
    hide(kind) {
        if (kind && Overlay.kind !== kind) return;
        $('overlay').className = 'overlay hidden';
        $('overlay').innerHTML = '';
        Overlay.kind = null;
    },
};

function passScreen(name) {
    return new Promise(resolve => {
        const o = Overlay.show('pass', '<h1>' + esc(name) + '\'s turn</h1><div class="sub">Pass the device, then continue.</div>' +
            '<button class="btn" type="button">I am ' + esc(name) + '</button>', 'opaque');
        o.querySelector('.btn').onclick = () => { Overlay.hide('pass'); resolve(); };
    });
}

// The overlays that depend on the game state (mulligan, Discover, waiting, game over)
function afterRender() {
    const v = UI.view, me = UI.me;
    if (v.phase === 'over') return showGameOver(v);
    if (v.phase === 'mulligan') return v.mulligan[me] ? showWaiting('Waiting for your opponent\'s starting hand') : showMulligan(v);
    if (v.pending) return v.pending.player === me ? showDiscover(v) : showWaiting('Your opponent is choosing');
    if (['mulligan', 'discover', 'waiting', 'over'].includes(Overlay.kind)) Overlay.hide();
}

function showWaiting(text) {
    Overlay.show('waiting', '<div class="sub waiting-dots">' + esc(text) + '</div>', 'clear');
}

function showMulligan(v) {
    if (Overlay.kind === 'mulligan') return;
    const p = v.players[UI.me];
    const toss = new Set();
    const first = v.first === UI.me;
    const o = Overlay.show('mulligan', '<h1>Starting Hand</h1><div class="sub">' + (first ? 'You go first.' : 'You go second and get The Coin.') +
        ' Click the cards you want to replace.</div><div class="choice-row">' +
        p.hand.map(c => '<div class="choice" data-uid="' + c.uid + '">' + cardHTML(CARDS[c.cardId], c) + '</div>').join('') +
        '</div><button class="btn" type="button">Confirm</button>');
    fitCards(o);
    o.querySelectorAll('.choice').forEach(el => el.onclick = () => {
        const uid = Number(el.dataset.uid);
        if (toss.has(uid)) toss.delete(uid); else toss.add(uid);
        el.classList.toggle('toss', toss.has(uid));
    });
    o.querySelector('.btn').onclick = () => { Overlay.hide('mulligan'); uiSend({ type: 'mulligan', replace: [...toss] }); };
}

function showDiscover(v) {
    if (Overlay.kind === 'discover') return;
    const opts = v.pending.options || [];
    const o = Overlay.show('discover', '<h1>Choose a Card</h1><div class="choice-row">' +
        opts.map((id, i) => '<div class="choice" data-i="' + i + '">' + cardHTML(CARDS[id], null) + '</div>').join('') +
        '</div><button class="btn secondary" type="button" id="peek-board">Hold to see the board</button>');
    fitCards(o);
    o.querySelectorAll('.choice').forEach(el => el.onclick = () => { Overlay.hide('discover'); uiSend({ type: 'choose', index: Number(el.dataset.i) }); });
    const peek = o.querySelector('#peek-board');
    peek.onpointerdown = () => { o.style.opacity = '0.08'; };
    peek.onpointerup = peek.onpointerleave = () => { o.style.opacity = ''; };
}

function showGameOver(v) {
    if (Overlay.kind === 'over') return;
    const w = v.winner, local = isLocalGame();
    let title = 'Draw', cls = '';
    if (w !== 'draw') {
        if (local) { title = esc(v.players[w].name) + ' Wins!'; cls = 'victory'; }
        else if (w === UI.me) { title = 'Victory!'; cls = 'victory'; }
        else { title = 'Defeat'; cls = 'defeat'; }
    }
    const o = Overlay.show('over', '<h1 class="' + cls + '">' + title + '</h1><div class="sub">' + esc(UI.overReason) + '</div>' +
        '<div class="row"><button class="btn" type="button" id="go-rematch">Rematch</button>' +
        '<button class="btn secondary" type="button" id="go-board">See the board</button>' +
        '<button class="btn secondary" type="button" id="go-menu">Main menu</button></div><div class="note" id="rematch-note"></div>');
    o.querySelector('#go-rematch').onclick = () => { if (UI.session) UI.session.rematch(); };
    o.querySelector('#go-board').onclick = () => Overlay.hide('over');
    o.querySelector('#go-menu').onclick = () => Menu.leaveGame();
}

function showGameMenu() {
    if (Overlay.kind && Overlay.kind !== 'menu') return;
    const over = UI.view && UI.view.phase === 'over';
    const o = Overlay.show('menu', '<h1>Menu</h1><div class="row">' +
        '<button class="btn secondary" type="button" id="gm-close">Back to the game</button>' +
        (over ? '' : '<button class="btn secondary" type="button" id="gm-concede">Concede</button>') +
        '<button class="btn secondary" type="button" id="gm-leave">Leave game</button></div>' +
        '<label class="toggle"><input type="checkbox" id="gm-fast"' + (UI.settings.fast ? ' checked' : '') + '> Fast animations</label>');
    o.querySelector('#gm-close').onclick = () => Overlay.hide('menu');
    if (!over) o.querySelector('#gm-concede').onclick = () => { Overlay.hide('menu'); uiSend({ type: 'concede' }); };
    o.querySelector('#gm-leave').onclick = () => Menu.leaveGame();
    o.querySelector('#gm-fast').onchange = e => { UI.settings.fast = e.target.checked; Menu.saveSettings(); };
}

// ---------- Rendering ----------

// Keeps container's children in the order of items, reusing elements by key
function syncChildren(container, items, keyOf, create, update) {
    const existing = new Map();
    for (const el of Array.from(container.children)) if (el.dataset.key) existing.set(el.dataset.key, el);
    let prev = null;
    const seen = new Set();
    items.forEach((item, i) => {
        const key = String(keyOf(item));
        let el = existing.get(key);
        const fresh = !el;
        if (fresh) { el = create(item); el.dataset.key = key; }
        update(el, item, i);
        if (fresh) { el.classList.add('enter'); setTimeout(() => el.classList.remove('enter'), 400); }
        seen.add(key);
        const ref = prev ? prev.nextSibling : container.firstChild;
        if (el !== ref) container.insertBefore(el, ref);
        prev = el;
    });
    for (const [key, el] of existing) if (!seen.has(key)) el.remove();
}

function renderGame() {
    const v = UI.view;
    if (!v) return;
    const me = UI.me, P = v.players[me], O = v.players[1 - me];
    renderHand($('my-hand'), P, true);
    renderHand($('opp-hand'), O, false);
    renderBoard($('my-board'), P);
    renderBoard($('opp-board'), O);
    renderHeroArea('my', P);
    renderHeroArea('opp', O);
    renderMana($('my-mana'), P);
    renderMana($('opp-mana'), O);
    renderDeck($('my-deck'), P);
    renderDeck($('opp-deck'), O);
    $('my-name').innerHTML = esc(P.name) + '<span class="tag">' + esc(HEROES[P.heroId].name) + '</span>';
    $('opp-name').innerHTML = esc(O.name) + '<span class="tag">' + esc(HEROES[O.heroId].name) + '</span>';
    renderEndTurn();
    Input.refresh();
}

function renderHand(el, p, mine) {
    const n = p.hand.length;
    const spacing = Math.min(mine ? 11 : 7, (mine ? 92 : 62) / Math.max(n, 1));
    const sp = mine && UI.view ? Engine.spellPower(UI.view, p.index) : 0;
    syncChildren(el, p.hand, c => c.uid, c => {
        const w = document.createElement('div');
        w.className = 'hand-card';
        w.dataset.uid = c.uid;
        return w;
    }, (w, c, i) => {
        const off = i - (n - 1) / 2;
        w.style.setProperty('--x', 'calc(var(--u) * ' + (off * spacing).toFixed(2) + ')');
        w.style.setProperty('--y', 'calc(var(--u) * ' + (off * off * (mine ? 0.3 : 0.2)).toFixed(2) + ')');
        w.style.setProperty('--rot', (n > 1 ? off * Math.min(4, 26 / n) : 0).toFixed(2) + 'deg');
        w.style.setProperty('--z', String(10 + i));
        const def = mine ? CARDS[c.cardId] : null;
        const sig = mine ? [c.cardId, c.cost, c.atk, c.maxHp, def && def.type === 'spell' ? sp : 0].join('|') : 'back';
        if (w._sig !== sig) {
            w._sig = sig;
            w.innerHTML = mine ? cardHTML(def, c, { spellDamage: def && def.type === 'spell' ? sp : 0 }) : cardBackHTML();
            w._fit = mine;
        }
    });
    // new cards can only be measured once they are on the page
    for (const w of el.children) if (w._fit) { w._fit = false; fitCards(w); }
}

function renderBoard(el, p) {
    syncChildren(el, p.board, m => m.uid, m => {
        const d = document.createElement('div');
        d.dataset.uid = m.uid;
        return d;
    }, (d, m) => {
        d.className = minionClasses(m);
        d.style.setProperty('--cls', classColor((CARDS[m.cardId] || {}).class));
        const sig = JSON.stringify([m.cardId, m.atk, m.hp, m.maxHp, m.damage, m.shield, m.frozen, m.stealth, m.silenced, m.sleeping, m.reborn, m.spellburst, m.kw, m.enchants.length]);
        if (d._sig !== sig) { d._sig = sig; d.innerHTML = minionInner(m); }
    });
}

// One child element per slot (hero, power, weapon); returns it
function slotChild(slot, uid, cls) {
    let el = slot.firstElementChild;
    if (!el || el.dataset.uid !== String(uid)) {
        slot.innerHTML = '';
        el = document.createElement('div');
        el.dataset.uid = uid;
        slot.appendChild(el);
        if (cls === 'weapon') { el.classList.add('enter'); setTimeout(() => el.classList.remove('enter'), 400); }
    }
    el.className = cls;
    return el;
}

function renderHeroArea(side, p) {
    const v = UI.view;
    const hero = slotChild($(side + '-hero'), p.hero.uid, 'hero' + (p.hero.frozen ? ' frozen' : '') + (p.hero.kw && p.hero.kw.immune ? ' immune' : ''));
    hero.style.setProperty('--cls', HEROES[p.heroId].color);
    const hsig = JSON.stringify([p.hero.hp, p.hero.armor, p.hero.atk, p.hero.damage]);
    if (hero._sig !== hsig) { hero._sig = hsig; hero.innerHTML = heroInner(p.hero); }

    const pdef = HEROES[p.heroId].power;
    const used = v.current === p.index && p.power.uses >= (pdef.uses || 1);
    const pow = slotChild($(side + '-power'), p.power.uid, 'power' + (used ? ' used' : ''));
    pow.style.setProperty('--cls', HEROES[p.heroId].color);
    const psig = String(p.power.cost);
    if (pow._sig !== psig) { pow._sig = psig; pow.innerHTML = powerInner(p.power); }

    const wslot = $(side + '-weapon');
    if (p.weapon) {
        const w = slotChild(wslot, p.weapon.uid, 'weapon');
        const wsig = p.weapon.atk + '|' + p.weapon.durability;
        if (w._sig !== wsig) { w._sig = wsig; w.innerHTML = weaponInner(p.weapon); }
    } else wslot.innerHTML = '';

    syncChildren($(side + '-secrets'), p.secrets, s => s.uid, s => {
        const d = document.createElement('div');
        d.dataset.uid = s.uid;
        d.innerHTML = secretHTML(s);
        return d;
    }, () => {});
}

function renderMana(el, p) {
    const avail = p.maxMana - p.overloadNow;
    const slots = Math.max(p.maxMana, p.mana);
    let html = '<div class="count">' + p.mana + '/' + avail + (p.overloadNext ? ' <small title="Overloaded next turn">🔒' + p.overloadNext + '</small>' : '') + '</div><div class="crystals">';
    for (let i = 0; i < Math.max(RULES.maxMana, slots); i++) {
        let cls = 'off';
        if (i < p.mana) cls = 'full';
        else if (i < avail) cls = 'spent';
        else if (i < p.maxMana) cls = 'locked';
        html += '<div class="crystal ' + cls + '"></div>';
    }
    el.innerHTML = html + '</div>';
}

function renderDeck(el, p) {
    const n = p.deckCount;
    el.classList.toggle('empty', n === 0);
    const layers = Math.min(4, Math.ceil(n / 8));
    let pile = '';
    for (let i = 0; i < Math.max(layers, 1); i++) pile += '<div class="card-back" style="transform:translate(' + (-i * 2) + 'px,' + (-i * 2) + 'px)"></div>';
    el.innerHTML = '<div class="pile">' + pile + '</div><div class="count">' + (n ? n + ' card' + (n > 1 ? 's' : '') : 'Empty! Fatigue ' + (p.fatigue + 1)) + '</div>';
}

function renderEndTurn() {
    const v = UI.view, b = $('end-turn');
    if (v.phase === 'over') { b.className = 'end-turn'; b.textContent = 'RESULTS'; return; }
    if (v.phase !== 'main' || v.current !== UI.me || v.pending) {
        b.className = 'end-turn wait';
        b.textContent = v.phase === 'mulligan' ? 'MULLIGAN' : 'ENEMY TURN';
        return;
    }
    const busy = Engine.legalActions(v, UI.me).some(a => a.type !== 'end');
    b.className = 'end-turn' + (busy ? '' : ' done');
    b.textContent = 'END TURN';
}

// ---------- History log ----------

const Log = {
    clear() { $('log-list').innerHTML = ''; },
    add(html, cls) {
        const list = $('log-list');
        const d = document.createElement('div');
        d.className = 'log-entry' + (cls ? ' ' + cls : '');
        d.innerHTML = html;
        list.appendChild(d);
        while (list.children.length > 80) list.firstChild.remove();
        list.scrollTop = list.scrollHeight;
    },
};

// ---------- Turn timer (the rope) ----------

function updateTimer() {
    const el = $('turn-timer'), v = UI.view;
    const rope = RULES.ropeSeconds * 1000;
    const left = UI.timer ? UI.timer.deadline - Date.now() : Infinity;
    const on = v && v.phase !== 'over' && left > 0 && left <= rope;
    el.classList.toggle('on', !!on);
    if (on) el.firstElementChild.style.width = (100 * left / rope).toFixed(1) + '%';
}
setInterval(updateTimer, 150);

// ---------- Hover zoom ----------

function showZoom(el) {
    const v = UI.view;
    if (!v || Input.mode) return hideZoom();
    const e = Engine.findEntity(v, Number(el.dataset.uid));
    if (!e || e.zone === 'hand') return hideZoom();
    let card = '', notes = '';
    const big = html => html.replace('class="card ', 'class="card big ');
    if (e.zone === 'board') {
        const def = CARDS[e.cardId];
        card = big(cardHTML(def, { atk: e.atk, maxHp: e.maxHp }));
        notes = notesHTML(def, e);
    } else if (e.zone === 'weapon') {
        const def = CARDS[e.cardId];
        card = big(cardHTML(def, { atk: e.atk, durability: e.durability }));
        notes = notesHTML(def, null);
    } else if (e.zone === 'hero') {
        const hero = HEROES[e.heroId];
        card = big(powerCardHTML(e.heroId, v.players[e.owner].power));
        notes = '<div class="note-box"><b>' + esc(hero.name) + '</b>Health ' + e.hp + '/' + e.maxHp + (e.armor ? ', Armor ' + e.armor : '') +
            (e.atk ? ', Attack ' + e.atk : '') + '</div>' + (e.frozen ? '<div class="note-box status"><b>Frozen</b>Loses its next attack.</div>' : '');
    } else if (e.zone === 'power') {
        card = big(powerCardHTML(e.heroId, e));
    } else if (e.zone === 'secret') {
        if (e.hidden) notes = '<div class="note-box"><b>Secret</b>Your opponent has a secret. It triggers during your turn.</div>';
        else { card = big(cardHTML(CARDS[e.cardId], null)); notes = notesHTML(CARDS[e.cardId], null); }
    }
    const z = $('zoom');
    z.innerHTML = card + (notes ? '<div class="notes">' + notes + '</div>' : '');
    const r = el.getBoundingClientRect(), s = $('stage').getBoundingClientRect();
    z.className = 'zoom show ' + (r.left + r.width / 2 > s.left + s.width / 2 ? 'left' : 'right');
    fitCards(z);
}

function hideZoom() { $('zoom').className = 'zoom'; }
