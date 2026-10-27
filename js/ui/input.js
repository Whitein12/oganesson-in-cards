// ==========================================
// input.js - Pointer play on the table. Drag a card onto the board (or click it, then click the board),
// drop minions between other minions, aim the arrow at a target for attacks, targeted spells,
// Battlecries and the hero power (drag-and-release or click-then-click). Right-click or Esc cancels.
// Also the glows: playable cards, ready attackers, a usable hero power.
// ==========================================

const Input = {
    mode: null,       // null | 'card' (holding a hand card) | 'target' (aiming the arrow)
    card: null,       // the hand card being played
    def: null,        // its definition
    info: null,       // Engine.playInfo for it
    handEl: null,     // its .hand-card element
    ghost: null,      // the copy that follows the pointer
    holder: null,     // the placeholder minion on the board
    srcEl: null,      // where the arrow starts
    targets: [],      // uids the arrow may pick
    onPick: null,     // what picking a target does
    pressed: false,   // the button is down
    moved: false,     // the pointer moved since the button went down
    start: null,      // { x, y } where it went down
    pointer: null,    // the last pointer position (client coordinates)
    ignoreUp: false,  // the press was already handled

    init() {
        const table = $('table');
        table.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        table.addEventListener('contextmenu', e => { e.preventDefault(); Input.cancel(); });
        window.addEventListener('keydown', e => {
            if (e.key !== 'Escape') return;
            if (Input.mode) Input.cancel();
            else if (Overlay.kind === 'menu') Overlay.hide('menu');
            else if (!Overlay.kind && UI.session) showGameMenu();
        });
        table.addEventListener('mouseover', e => {
            const el = e.target.closest('[data-uid]');
            if (el && !el.classList.contains('hand-card')) showZoom(el);
        });
        table.addEventListener('mouseout', e => {
            const el = e.target.closest('[data-uid]');
            if (el && !el.contains(e.relatedTarget)) hideZoom();
        });
        $('end-turn').addEventListener('click', onEndTurn);
        $('menu-btn').addEventListener('click', showGameMenu);
    },

    // Drops whatever is being played or aimed and clears the visuals
    cancel() {
        if (Input.handEl) Input.handEl.classList.remove('selected', 'dragging');
        if (Input.srcEl) Input.srcEl.classList.remove('selected');
        document.querySelectorAll('#table .targetable, #table .target-hover').forEach(el => el.classList.remove('targetable', 'target-hover'));
        if (Input.ghost) { Input.ghost.remove(); Input.ghost = null; }
        if (Input.holder) { Input.holder.remove(); Input.holder = null; }
        $('arrow-path').classList.remove('on', 'ok');
        $('my-board').classList.remove('drop-zone');
        if (Overlay.kind === 'choose') Overlay.hide('choose');
        Object.assign(Input, { mode: null, card: null, def: null, info: null, handEl: null, srcEl: null, targets: [], onPick: null });
    },

    // Glows for what the player can do right now
    refresh() {
        const v = UI.view;
        if (!v) return;
        const active = canInteract();
        const me = v.players[UI.me];
        for (const w of document.querySelectorAll('#my-hand .hand-card')) {
            const card = me.hand.find(c => c.uid === Number(w.dataset.uid));
            const el = w.firstElementChild;
            if (!card || !el) continue;
            const ok = active && Engine.playInfo(v, UI.me, card).ok;
            el.classList.toggle('playable', ok);
            el.classList.toggle('combo-ready', ok && !!(CARDS[card.cardId] || {}).combo && me.cardsPlayed > 0);
        }
        for (const e of [me.hero].concat(me.board)) {
            const el = uidEl(e.uid);
            if (el) el.classList.toggle('ready', active && Engine.canAttack(v, UI.me, e));
        }
        const pw = uidEl(me.power.uid);
        if (pw) pw.classList.toggle('ready', active && Engine.powerInfo(v, UI.me).ok);
        renderEndTurn();
    },
};

function canInteract() {
    const v = UI.view;
    return !!v && !!UI.session && !UI.session.spectate && v.phase === 'main' && v.current === UI.me && !v.pending &&
        !UI.busy && !UI.waiting && (!Overlay.kind || Overlay.kind === 'choose');
}

function inHandZone(clientY) {
    const s = $('stage').getBoundingClientRect();
    return (clientY - s.top) / s.height > 0.8;
}

function uidUnder(x, y) {
    const hit = document.elementFromPoint(x, y);
    const el = hit && hit.closest('#table [data-uid]');
    return el ? Number(el.dataset.uid) : null;
}

// Board index a minion dropped at clientX would take
function boardPos(clientX) {
    let pos = 0;
    for (const el of $('my-board').children) {
        if (el === Input.holder || el.classList.contains('dying')) continue;
        const r = el.getBoundingClientRect();
        if (clientX > r.left + r.width / 2) pos++;
    }
    return pos;
}

function showHolder(pos) {
    const row = $('my-board');
    if (!Input.holder) {
        Input.holder = document.createElement('div');
        Input.holder.className = 'minion placeholder';
        Input.holder.innerHTML = '<div class="body"><div class="art">' + artHTML(Input.def.art) + '</div></div>';
    }
    const real = Array.from(row.children).filter(el => el !== Input.holder);
    const ref = real[pos] || null;
    if (Input.holder.parentNode !== row || Input.holder.nextSibling !== ref) row.insertBefore(Input.holder, ref);
    return Input.holder;
}

function hideHolder() { if (Input.holder) { Input.holder.remove(); Input.holder = null; } }

function onPointerDown(e) {
    if (e.button !== 0) return;
    hideZoom();
    Input.pressed = true;
    Input.moved = false;
    Input.start = { x: e.clientX, y: e.clientY };
    Input.pointer = { x: e.clientX, y: e.clientY };
    const el = e.target.closest('[data-uid]');

    if (Input.mode === 'target') {
        // the second click of click-then-click aiming
        const uid = el ? Number(el.dataset.uid) : null;
        Input.ignoreUp = true;
        if (uid != null && Input.targets.includes(uid)) pickTarget(uid);
        else if (!el || !(el === Input.srcEl || el.contains(Input.srcEl))) Input.cancel();
        return;
    }
    if (Input.mode === 'card') {
        // a card picked up with a click: this click puts it down
        if (el && el.classList.contains('hand-card')) {
            const same = Number(el.dataset.uid) === Input.card.uid;
            Input.cancel();
            if (same) { Input.ignoreUp = true; return; }
        } else {
            Input.ignoreUp = true;
            dropCard(e.clientX, e.clientY);
            return;
        }
    }
    if (!el) return;
    const ent = UI.view && Engine.findEntity(UI.view, Number(el.dataset.uid));
    if (!ent || ent.owner !== UI.me) return;
    if (!canInteract()) {
        if (UI.view.phase === 'main' && UI.view.current !== UI.me && !(UI.session && UI.session.spectate)) uiToast('Wait for your turn.', 'info');
        Input.ignoreUp = true;
        return;
    }
    if (el.classList.contains('hand-card')) grabCard(el, ent);
    else if (ent.zone === 'board' || ent.zone === 'hero') startAttack(el, ent);
    else if (ent.zone === 'power') usePower(el);
}

function onPointerMove(e) {
    Input.pointer = { x: e.clientX, y: e.clientY };
    if (Input.pressed && Input.start && Math.hypot(e.clientX - Input.start.x, e.clientY - Input.start.y) > 8) Input.moved = true;
    if (Input.mode === 'card') moveCard(e.clientX, e.clientY);
    else if (Input.mode === 'target') aim(e.clientX, e.clientY);
}

function onPointerUp(e) {
    const wasPressed = Input.pressed;
    Input.pressed = false;
    if (Input.ignoreUp) { Input.ignoreUp = false; return; }
    if (!wasPressed) return;
    if (Input.mode === 'card' && Input.moved) dropCard(e.clientX, e.clientY);
    else if (Input.mode === 'target' && Input.moved) {
        const uid = uidUnder(e.clientX, e.clientY);
        if (uid != null && Input.targets.includes(uid)) pickTarget(uid);
        else if (!Input.srcEl || !Input.srcEl.contains(document.elementFromPoint(e.clientX, e.clientY))) Input.cancel();
    }
    // a click without moving keeps the card / the arrow; the next click finishes it
}

function onEndTurn() {
    if (UI.view && UI.view.phase === 'over') { if (!Overlay.kind) showGameOver(UI.view); return; }
    if (!canInteract()) return;
    Input.cancel();
    uiSend({ type: 'end' });
}

// ---------- Playing cards ----------

function grabCard(el, card) {
    const info = Engine.playInfo(UI.view, UI.me, card);
    if (!info.ok) { uiToast(info.reason, 'info'); Input.ignoreUp = true; return; }
    Input.mode = 'card';
    Input.card = card;
    Input.def = CARDS[card.cardId];
    Input.info = info;
    Input.handEl = el;
    el.classList.add('selected');
    // targeted spells aim straight from the (lifted) card in hand
    if (Input.def.type === 'spell' && !Input.def.chooseOne && info.need) {
        const action = { type: 'play', uid: card.uid };
        startTargeting(el.firstElementChild || el, info.targets, uid => uiSend(Object.assign(action, { target: uid })));
    }
}

function moveCard(x, y) {
    const overBoard = !inHandZone(y);
    if (Input.pressed && Input.moved) {
        if (!Input.ghost) {
            Input.ghost = document.createElement('div');
            Input.ghost.className = 'drag-ghost';
            Input.ghost.innerHTML = Input.handEl.innerHTML;
            $('stage').appendChild(Input.ghost);
            Input.handEl.classList.add('dragging');
        }
        const s = $('stage').getBoundingClientRect();
        Input.ghost.style.left = (x - s.left) + 'px';
        Input.ghost.style.top = (y - s.top) + 'px';
    }
    if (Input.def.type === 'minion') {
        $('my-board').classList.toggle('drop-zone', overBoard);
        if (overBoard) showHolder(boardPos(x)); else hideHolder();
    }
}

function dropCard(x, y) {
    if (inHandZone(y)) { Input.cancel(); return; }
    const action = { type: 'play', uid: Input.card.uid };
    if (Input.def.type === 'minion') action.pos = boardPos(x);
    if (Input.ghost) { Input.ghost.remove(); Input.ghost = null; }
    $('my-board').classList.remove('drop-zone');
    if (Input.def.chooseOne) return chooseOneThen(action);
    finishPlay(action, Input.info);
}

// Sends the play, or first aims at a target (a placed minion keeps its placeholder as the arrow's start)
function finishPlay(action, t) {
    if (t.need) {
        const src = Input.def.type === 'minion' ? showHolder(action.pos) : Input.handEl;
        startTargeting(src, t.targets, uid => uiSend(Object.assign(action, { target: uid })));
        return;
    }
    Input.cancel();
    uiSend(action);
}

function chooseOneThen(action) {
    const def = Input.def, info = Input.info, card = Input.card;
    const o = Overlay.show('choose', '<h1>Choose One</h1><div class="choice-row">' + def.chooseOne.map((opt, i) =>
        '<div class="choice" data-i="' + i + '" style="' + (info.options[i].ok ? '' : 'opacity:0.45') + '">' +
        cardHTML(def, card, { name: opt.name, text: opt.text, art: opt.art }) + '</div>').join('') +
        '</div><button class="btn secondary" type="button">Cancel</button>', 'clear');
    fitCards(o);
    o.querySelectorAll('.choice').forEach(el => el.onclick = () => {
        const i = Number(el.dataset.i);
        if (!info.options[i].ok) { uiToast(info.options[i].reason || 'You can\'t choose that now.', 'info'); return; }
        Overlay.hide('choose');
        action.choice = i;
        finishPlay(action, info.options[i]);
    });
    o.querySelector('.btn').onclick = () => Input.cancel();
}

// ---------- Attacks and the hero power ----------

function startAttack(el, ent) {
    const targets = Engine.attackTargets(UI.view, UI.me, ent).map(t => t.uid);
    if (!targets.length) { uiToast(attackProblem(ent), 'info'); Input.ignoreUp = true; return; }
    el.classList.add('selected');
    startTargeting(el, targets, uid => uiSend({ type: 'attack', attacker: ent.uid, target: uid }));
}

function attackProblem(e) {
    const kw = e.kw || {};
    if (e.frozen) return 'Frozen characters can\'t attack.';
    if (kw.cantAttack) return 'This minion can\'t attack.';
    if (e.atk <= 0) return e.zone === 'hero' ? 'Your hero has no Attack.' : 'This minion has no Attack.';
    if (e.attacks >= (kw.windfury ? 2 : 1)) return 'Already attacked this turn.';
    if (e.zone === 'board' && e.sleeping && kw.rush) return 'Rush minions can only attack minions on the turn they are played.';
    if (e.zone === 'board' && e.sleeping) return 'Minions can\'t attack the turn they come into play.';
    return 'Nothing to attack.';
}

function usePower(el) {
    const info = Engine.powerInfo(UI.view, UI.me);
    if (!info.ok) { uiToast(info.reason, 'info'); Input.ignoreUp = true; return; }
    if (!info.need) { Input.ignoreUp = true; uiSend({ type: 'power' }); return; }
    el.classList.add('selected');
    startTargeting(el, info.targets, uid => uiSend({ type: 'power', target: uid }));
}

// ---------- The targeting arrow ----------

function startTargeting(srcEl, targets, onPick) {
    Input.mode = 'target';
    Input.srcEl = srcEl;
    Input.targets = targets;
    Input.onPick = onPick;
    for (const uid of targets) { const el = uidEl(uid); if (el) el.classList.add('targetable'); }
    $('arrow-path').classList.add('on');
    if (Input.pointer) aim(Input.pointer.x, Input.pointer.y);
}

function aim(x, y) {
    if (!Input.srcEl || !Input.srcEl.isConnected) return;
    const s = $('stage').getBoundingClientRect();
    const a = stagePoint(Input.srcEl);
    const bx = x - s.left, by = y - s.top;
    const cx = (a.x + bx) / 2, cy = Math.min(a.y, by) - Math.abs(bx - a.x) * 0.25 - 20;
    const path = $('arrow-path');
    path.setAttribute('d', 'M ' + a.x + ' ' + a.y + ' Q ' + cx + ' ' + cy + ' ' + bx + ' ' + by);
    const uid = uidUnder(x, y);
    const ok = uid != null && Input.targets.includes(uid);
    path.classList.toggle('ok', ok);
    document.querySelectorAll('#table .target-hover').forEach(el => { if (Number(el.dataset.uid) !== uid) el.classList.remove('target-hover'); });
    if (ok) uidEl(uid).classList.add('target-hover');
}

function pickTarget(uid) {
    const pick = Input.onPick;
    Input.cancel();
    if (pick) pick(uid);
}
