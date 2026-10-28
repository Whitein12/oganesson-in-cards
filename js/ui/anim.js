// ==========================================
// anim.js - Plays a batch of engine events on the table before the new view is drawn
// (attack lunges, damage and heal numbers, shield pops, deaths, card reveals, the turn banner)
// and writes the history log. Animations only show what the event list says, and the event list
// is already redacted for this player, so nothing hidden can leak here.
// ==========================================

const Anim = {
    // `next` is the view that follows these events (names of entities that didn't exist before)
    async run(events, next) {
        for (const ev of events) {
            try { logEvent(ev, next); } catch (e) { console.warn(e); }
            await animEvent(ev);
        }
    },
};

function animSpeed() { return UI.settings.turbo ? 25 : UI.settings.fast ? 2.4 : 1; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms / animSpeed())); }
function uidEl(uid) { return uid == null ? null : document.querySelector('#table [data-uid="' + uid + '"]'); }
function heroEl(p) { return UI.view ? uidEl(UI.view.players[p].hero.uid) : null; }
function isLocalGame() { return !!(UI.session && (UI.session.kind === 'local' || UI.session.spectate)); }
function playerName(p) { return p === UI.me && !isLocalGame() ? 'You' : UI.view.players[p].name; }

function stagePoint(el) {
    const s = $('stage').getBoundingClientRect(), r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2 - s.left, y: r.top + r.height / 2 - s.top };
}

function floatText(el, text, cls) {
    if (!el) return;
    const p = stagePoint(el);
    const d = document.createElement('div');
    d.className = 'float-num ' + cls;
    d.textContent = text;
    d.style.left = p.x + 'px';
    d.style.top = p.y + 'px';
    d.style.animationDuration = (1.1 / animSpeed()) + 's';
    $('fx-layer').appendChild(d);
    setTimeout(() => d.remove(), 1200 / animSpeed());
}

function restartClass(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 650);
}

// Updates a stat gem in place while the events play (the full render comes after)
function setGem(el, kind, value, cls) {
    const g = el && el.querySelector('.gem.' + kind);
    if (!g) return;
    g.textContent = value;
    if (cls) g.classList.add(cls);
}

function banner(text, small) {
    const b = $('banner');
    b.textContent = text;
    b.className = 'banner';
    void b.offsetWidth;
    b.className = 'banner show' + (small ? ' small' : '');
    b.style.animationDuration = (1.3 / animSpeed()) + 's';
}

async function revealCard(cardId, label) {
    const d = document.createElement('div');
    d.className = 'reveal';
    d.style.animationDuration = (1.1 / animSpeed()) + 's';
    const card = cardId && CARDS[cardId]
        ? cardHTML(CARDS[cardId], null).replace('class="card ', 'class="card big ')
        : '<div class="card-back" style="width:calc(var(--u)*20);height:calc(var(--u)*27.5);font-size:calc(var(--u)*5)">?</div>';
    d.innerHTML = '<div class="label">' + esc(label) + '</div>' + card;
    $('fx-layer').appendChild(d);
    fitCards(d);
    await sleep(1100);
    d.remove();
}

async function lunge(src, dst) {
    if (!src || !dst) return sleep(150);
    const a = stagePoint(src), b = stagePoint(dst);
    const dx = (b.x - a.x) * 0.8, dy = (b.y - a.y) * 0.8;
    src.style.zIndex = 50;
    const anim = src.animate([
        { transform: 'translate(0, 0) scale(1)' },
        { transform: 'translate(0, 0) scale(1.12)', offset: 0.25 },
        { transform: 'translate(' + dx + 'px, ' + dy + 'px) scale(1.12)', offset: 0.6 },
        { transform: 'translate(0, 0) scale(1)' },
    ], { duration: 520 / animSpeed(), easing: 'ease-in-out' });
    anim.finished.then(() => { src.style.zIndex = ''; }, () => {});
    await sleep(320); // the moment of impact: damage numbers follow
}

async function animEvent(ev) {
    const me = UI.me;
    const spectate = !!(UI.session && UI.session.spectate);
    switch (ev.t) {
        case 'turn':
            banner(ev.p === me && !spectate ? 'Your Turn' : UI.view.players[ev.p].name + '\'s Turn', ev.p !== me);
            await sleep(ev.p === me ? 900 : 600);
            break;
        case 'play':
            if (ev.p !== me || spectate) await revealCard(ev.cardId, ev.secret ? 'Secret' : playerName(ev.p) + ' played');
            break;
        case 'power':
            if (ev.p !== me || spectate) { restartClass(uidEl(ev.uid), 'flash'); await sleep(450); }
            break;
        case 'activate': {
            const el = uidEl(ev.uid);
            restartClass(el, 'flash');
            setGem(el, 'dur', ev.durability, 'damaged');
            await sleep(ev.p !== me || spectate ? 450 : 200);
            break;
        }
        case 'attack': await lunge(uidEl(ev.src), uidEl(ev.dst)); break;
        case 'damage': {
            const el = uidEl(ev.uid);
            floatText(el, '-' + ev.amount, 'dmg');
            restartClass(el, 'shake');
            if (ev.hp != null) setGem(el, 'hp', ev.hp, 'damaged');
            if (ev.armor != null) setGem(el, 'armor', ev.armor);
            await sleep(170);
            break;
        }
        case 'heal': {
            const el = uidEl(ev.uid);
            floatText(el, '+' + ev.amount, 'heal');
            if (ev.hp != null) setGem(el, 'hp', ev.hp);
            await sleep(150);
            break;
        }
        case 'armor': floatText(uidEl(ev.uid), '+' + ev.amount + ' Armor', 'armor'); await sleep(250); break;
        case 'shield': {
            const el = uidEl(ev.uid);
            if (el) el.classList.remove('shield');
            floatText(el, 'Blocked!', 'info');
            await sleep(200);
            break;
        }
        case 'immune': floatText(uidEl(ev.uid), 'Immune', 'info'); await sleep(200); break;
        case 'death': {
            const el = uidEl(ev.uid);
            if (el) { el.style.animationDuration = (0.45 / animSpeed()) + 's'; el.classList.add('dying'); }
            await sleep(330);
            break;
        }
        case 'destroy': restartClass(uidEl(ev.uid), 'flash'); await sleep(150); break;
        case 'reveal': await revealCard(ev.cardId, 'Secret revealed!'); break;
        case 'burn': await revealCard(ev.cardId, (ev.p === me && !isLocalGame() ? 'Your' : UI.view.players[ev.p].name + '\'s') + ' hand is full - burned'); break;
        case 'discard': await revealCard(ev.cardId, playerName(ev.p) + ' discarded'); break;
        case 'fatigue': floatText(heroEl(ev.p), 'Fatigue ' + ev.amount, 'info'); await sleep(450); break;
        case 'trigger': restartClass(uidEl(ev.uid), 'flash'); await sleep(150); break;
        case 'freeze': { const el = uidEl(ev.uid); if (el) el.classList.add('frozen'); floatText(el, 'Frozen', 'info'); await sleep(160); break; }
        case 'thaw': { const el = uidEl(ev.uid); if (el) el.classList.remove('frozen'); break; }
        case 'silence': floatText(uidEl(ev.uid), 'Silenced', 'info'); await sleep(220); break;
        case 'buff': restartClass(uidEl(ev.uid), 'flash'); await sleep(110); break;
        case 'transform': restartClass(uidEl(ev.uid), 'flash'); await sleep(250); break;
        case 'bounce': { const el = uidEl(ev.uid); if (el) el.classList.add('dying'); await sleep(260); break; }
        case 'discover': if (ev.p !== me) floatText(heroEl(ev.p), 'Discovering...', 'info'); break;
        case 'over':
            UI.overReason = ev.reason === 'concede' ? playerName(ev.p) + ' conceded.' : ev.reason === 'turns' ? 'The turn limit was reached.' : '';
            await sleep(500);
            break;
        case 'loop': uiToast('A runaway chain of effects was stopped.'); break;
        case 'summon': case 'place': case 'draw': case 'addCard': case 'equip': await sleep(40); break;
    }
}

function entityName(e) {
    if (e.zone === 'hero') return HEROES[e.heroId].name;
    if (e.zone === 'power') return HEROES[e.heroId].power.name;
    if (e.cardId && CARDS[e.cardId]) return CARDS[e.cardId].name;
    return 'a card';
}

function logEvent(ev, next) {
    const v = UI.view;
    const who = p => esc(playerName(p));
    const side = p => (p === UI.me ? 'me' : 'opp');
    const name = uid => {
        for (const view of [v, next]) {
            const e = view && Engine.findEntity(view, uid);
            if (e && (e.cardId || e.heroId)) return '<b>' + esc(entityName(e)) + '</b>';
        }
        return 'something';
    };
    const card = id => '<b>' + esc(CARDS[id] ? CARDS[id].name : '?') + '</b>';
    switch (ev.t) {
        case 'turn': Log.add('Turn ' + Math.ceil(ev.turn / 2) + ': ' + who(ev.p), 'sys'); break;
        case 'mulligan': Log.add(who(ev.p) + ' replaced ' + ev.count + ' card' + (ev.count === 1 ? '' : 's'), side(ev.p)); break;
        case 'play':
            Log.add(who(ev.p) + ' played ' + (ev.secret && !ev.cardId ? 'a <b>Secret</b>' : card(ev.cardId)) + (ev.target != null ? ' on ' + name(ev.target) : ''), side(ev.p));
            break;
        case 'attack': Log.add(name(ev.src) + ' attacked ' + name(ev.dst), side(ev.p)); break;
        case 'power': Log.add(who(ev.p) + ' used <b>' + esc(HEROES[v.players[ev.p].heroId].power.name) + '</b>' + (ev.target != null ? ' on ' + name(ev.target) : ''), side(ev.p)); break;
        case 'activate': Log.add(who(ev.p) + ' used ' + card(ev.cardId) + (ev.target != null ? ' on ' + name(ev.target) : ''), side(ev.p)); break;
        case 'reveal': Log.add('Secret revealed: ' + card(ev.cardId), side(ev.p)); break;
        case 'burn': Log.add(who(ev.p) + ' burned ' + card(ev.cardId) + ' (hand full)', side(ev.p)); break;
        case 'discard': Log.add(who(ev.p) + ' discarded ' + card(ev.cardId), side(ev.p)); break;
        case 'fatigue': Log.add(who(ev.p) + ' took ' + ev.amount + ' fatigue damage', side(ev.p)); break;
        case 'over': Log.add(ev.winner === 'draw' ? 'The game is a draw' : who(ev.winner) + ' won!', 'sys'); break;
    }
}
