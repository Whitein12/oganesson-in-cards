// ==========================================
// actions.js - New games, turns, the player actions and their legality checks; the Engine facade
// Actions: { type: 'mulligan', replace: [uid] } | { type: 'play', uid, pos, target, choice } |
//          { type: 'attack', attacker, target } | { type: 'power', target } | { type: 'end' } |
//          { type: 'choose', index } | { type: 'concede' }
// Engine.apply(g, player, action) -> { ok, error, events } mutates g (the host's authoritative state).
// ==========================================

// opts: { seed, first: 0|1 (random if omitted), players: [{ name, deck: deckId | deck object }, ...] }
function newGame(opts) {
    const g = { turn: 0, current: 0, first: 0, phase: 'mulligan', winner: null, rng: (opts.seed >>> 0) || 1,
        nextUid: 1, nextOrder: 1, pending: null, mulligan: [false, false], players: [] };
    newRt(g, []);
    const first = opts.first === 0 || opts.first === 1 ? opts.first : rngInt(g, 2);
    for (let i = 0; i < 2; i++) {
        const spec = opts.players[i];
        const deck = typeof spec.deck === 'string' ? deckById(spec.deck) : spec.deck;
        if (!deck) throw new Error('Unknown deck: ' + spec.deck);
        const hero = HEROES[deck.hero];
        if (!hero) throw new Error('Unknown hero: ' + deck.hero);
        const p = { index: i, name: spec.name || 'Player ' + (i + 1), deckId: deck.id || null, heroId: hero.id,
            mana: 0, maxMana: 0, overloadNow: 0, overloadNext: 0, fatigue: 0, cardsPlayed: 0,
            hand: [], deck: [], board: [], secrets: [], grave: [], weapon: null, auras: [] };
        p.hero = { uid: g.nextUid++, zone: 'hero', heroId: hero.id, owner: i, maxHp: hero.hp, damage: 0, hp: hero.hp, armor: 0,
            atk: 0, tempAtk: 0, attacks: 0, frozen: false, thawTurn: 0, enchants: [], kw: {} };
        p.power = { uid: g.nextUid++, zone: 'power', heroId: hero.id, owner: i, uses: 0, cost: hero.power.cost, costMod: 0 };
        g.players.push(p);
    }
    // uids are handed out after the shuffle, so a card's uid says nothing about which card it is
    for (const p of g.players) {
        const deck = typeof opts.players[p.index].deck === 'string' ? deckById(opts.players[p.index].deck) : opts.players[p.index].deck;
        p.deck = shuffleInPlace(g, deckCards(deck)).map(id => makeCard(g, id, p.index, 'deck'));
    }
    g.first = first;
    g.current = first;
    emit(g, { t: 'start', first });
    for (const p of g.players) {
        const n = RULES.startHand[p.index === first ? 0 : 1];
        for (let k = 0; k < n; k++) drawCard(g, p.index);
    }
    refresh(g);
    if (!RULES.mulligan) { g.mulligan = [true, true]; beginGame(g); }
    return g;
}

// After the mulligan: The Coin for the second player, then the first turn
function beginGame(g) {
    g.phase = 'main';
    if (RULES.coin) addToHand(g, 1 - g.first, 'coin');
    g.current = g.first;
    startTurn(g);
}

function startTurn(g) {
    g.turn++;
    const pi = g.current, p = g.players[pi];
    if (g.turn > RULES.maxTurns) {
        g.phase = 'over'; g.winner = 'draw';
        emit(g, { t: 'over', winner: 'draw', reason: 'turns' });
        return;
    }
    p.maxMana = Math.min(RULES.maxMana, p.maxMana + 1);
    p.overloadNow = p.overloadNext; p.overloadNext = 0;
    p.mana = Math.max(0, p.maxMana - p.overloadNow);
    p.power.uses = 0; p.hero.attacks = 0; p.cardsPlayed = 0;
    for (const m of p.board) { m.sleeping = false; m.attacks = 0; }
    emit(g, { t: 'turn', p: pi, turn: g.turn });
    refresh(g);
    if (!phaseRun(g, () => fire(g, 'turnStart', { player: pi }))) return;
    phaseRun(g, () => drawCard(g, pi));
}

// ---------- Applying actions ----------

function applyAction(g, pi, a) {
    const fail = error => ({ ok: false, error, events: [] });
    if (!a || typeof a.type !== 'string') return fail('Bad action.');
    if (pi !== 0 && pi !== 1) return fail('Bad player.');
    if (isOver(g)) return fail('The game is over.');
    if (a.type === 'concede') return runAction(g, pi, { type: 'concede' }, [], 0);
    if (g.phase === 'mulligan') {
        if (a.type !== 'mulligan') return fail('Choose your starting hand first.');
        if (g.mulligan[pi]) return fail('You already chose.');
        return runAction(g, pi, { type: 'mulligan', replace: Array.isArray(a.replace) ? a.replace.slice(0, 10) : [] }, [], 0);
    }
    if (g.pending) {
        if (pi !== g.pending.player) return fail('Waiting for your opponent to choose.');
        if (a.type !== 'choose') return fail('Make your choice first.');
        return resumeChoice(g, a.index);
    }
    if (pi !== g.current) return fail('It is not your turn.');
    const err = checkAction(g, pi, a);
    if (err) return fail(err);
    return runAction(g, pi, cleanAction(a), [], 0);
}

// Keeps only the fields an action type uses (actions arrive over the network)
function cleanAction(a) {
    switch (a.type) {
        case 'play': { const c = { type: 'play', uid: a.uid }; if (a.pos != null) c.pos = a.pos; if (a.target != null) c.target = a.target; if (a.choice != null) c.choice = a.choice; return c; }
        case 'attack': return { type: 'attack', attacker: a.attacker, target: a.target };
        case 'power': return a.target != null ? { type: 'power', target: a.target } : { type: 'power' };
        default: return { type: a.type };
    }
}

// Runs an action from a snapshot. If an effect needs a choice that isn't recorded yet (Discover),
// the partial result stays visible and g.pending remembers how to replay the action with the answer.
// `shown` events were already sent by the earlier partial run, so they are skipped.
function runAction(g, pi, a, choices, shown) {
    const snapshot = JSON.stringify(g);
    const rt = newRt(g, choices);
    try {
        switch (a.type) {
            case 'mulligan': doMulligan(g, pi, a); break;
            case 'concede': doConcede(g, pi); break;
            case 'end': doEndTurn(g, pi); break;
            case 'play': doPlay(g, pi, a); break;
            case 'attack': doAttack(g, pi, a); break;
            case 'power': doPower(g, pi, a); break;
        }
        refresh(g);
        deathPhase(g);
        return { ok: true, events: rt.events.slice(shown) };
    } catch (e) {
        if (e instanceof NeedChoice) {
            g.pending = { player: e.player, kind: e.kind, options: e.options, actor: pi, action: a, choices: choices.slice(), snapshot, shown: rt.events.length };
            return { ok: true, events: rt.events.slice(shown) };
        }
        restoreState(g, snapshot);
        console.error(e);
        return { ok: false, error: 'Engine error: ' + (e && e.message), events: [] };
    }
}

function resumeChoice(g, index) {
    const pend = g.pending;
    const n = pend.options.length;
    if (!Number.isInteger(index) || index < 0 || index >= n) return { ok: false, error: 'Bad choice.', events: [] };
    restoreState(g, pend.snapshot);
    return runAction(g, pend.actor, pend.action, pend.choices.concat([index]), pend.shown);
}

function restoreState(g, json) {
    const s = JSON.parse(json);
    for (const k of Object.keys(g)) delete g[k];
    Object.assign(g, s);
}

function doConcede(g, pi) {
    g.phase = 'over';
    g.pending = null;
    g.winner = 1 - pi;
    emit(g, { t: 'over', winner: g.winner, reason: 'concede', p: pi });
}

// Replaced cards are swapped for new ones in the same slots, then shuffled back into the deck
function doMulligan(g, pi, a) {
    const p = g.players[pi];
    const replace = new Set(a.replace);
    const out = [], drawn = [];
    for (let i = 0; i < p.hand.length; i++) {
        const old = p.hand[i];
        if (!replace.has(old.uid) || !p.deck.length) continue;
        const c = p.deck.pop();
        c.zone = 'hand'; p.hand[i] = c;
        old.zone = 'deck'; out.push(old);
        drawn.push({ uid: c.uid, cardId: c.cardId, replaced: old.uid });
    }
    p.deck.push(...out);
    shuffleInPlace(g, p.deck);
    g.mulligan[pi] = true;
    emit(g, { t: 'mulligan', p: pi, count: out.length, drawn });
    refresh(g);
    if (g.mulligan[0] && g.mulligan[1]) beginGame(g);
}

function doEndTurn(g, pi) {
    if (!phaseRun(g, () => fire(g, 'turnEnd', { player: pi }))) return;
    for (const p of g.players) {
        for (const m of p.board) if (m.enchants.some(en => en.oneTurn)) m.enchants = m.enchants.filter(en => !en.oneTurn);
        p.hero.enchants = p.hero.enchants.filter(en => !en.oneTurn);
        p.hero.tempAtk = 0;
        p.auras = p.auras.filter(au => !au.thisTurn);
    }
    const p = g.players[pi];
    for (const c of [p.hero].concat(p.board)) {
        if (c.frozen && c.thawTurn <= g.turn) { c.frozen = false; emit(g, { t: 'thaw', uid: c.uid }); }
    }
    refresh(g);
    deathPhase(g);
    if (isOver(g)) return;
    emit(g, { t: 'endTurn', p: pi });
    g.current = 1 - pi;
    startTurn(g);
}

// "Your next spell costs less" auras are used up by the card they applied to
function useCostAuras(g, p, card) {
    for (const au of p.auras) if (au.uses && au.cost && matchFilter(g, card, au.filter, { p: p.index })) au.uses--;
    p.auras = p.auras.filter(au => !(au.cost && au.uses <= 0));
}

function doPlay(g, pi, a) {
    const p = g.players[pi];
    const idx = p.hand.findIndex(c => c.uid === a.uid);
    const card = p.hand[idx];
    const def = CARDS[card.cardId];
    const option = def.chooseOne ? def.chooseOne[a.choice] : null;
    const combo = p.cardsPlayed > 0;
    p.mana -= card.cost;
    if (def.overload) p.overloadNext += def.overload;
    useCostAuras(g, p, card);
    p.hand.splice(idx, 1);
    p.cardsPlayed++;
    card.zone = 'play';
    const target = a.target != null ? findEntity(g, a.target) : null;
    const ctx = { p: pi, src: card, target, def, isSpell: def.type === 'spell', combo, choice: a.choice };
    const playEv = { player: pi, subject: card, target };
    emit(g, { t: 'play', p: pi, uid: card.uid, cardId: card.cardId, target: target ? target.uid : null, secret: !!def.secret, choice: a.choice, pos: a.pos });
    refresh(g);
    const main = option ? option.effects : def.type === 'spell' ? def.play : def.battlecry;
    const effects = () => {
        // Catalyst: a minion played next to a friendly Catalyst runs its Battlecry twice (two neighbours don't stack)
        const cat = def.type === 'minion' && main ? select(g, 'adjacent', { p: pi, src: card }).find(m => m.kw.catalyst) : null;
        runEffects(g, main, ctx);
        if (cat) { emit(g, { t: 'trigger', uid: cat.uid }); runEffects(g, main, ctx); }
        if (combo && def.combo) runEffects(g, def.combo, ctx);
    };

    if (def.type === 'minion') {
        if (!phaseRun(g, () => { placeMinion(g, pi, card, a.pos); fire(g, 'cardPlayed', playEv); fire(g, 'summoned', { player: pi, subject: card }); })) return;
        if (!phaseRun(g, effects)) return;
        phaseRun(g, () => { fire(g, 'afterSummon', { player: pi, subject: card }); fire(g, 'afterCardPlayed', playEv); });
    } else if (def.type === 'weapon') {
        if (!phaseRun(g, () => fire(g, 'cardPlayed', playEv))) return;
        if (!phaseRun(g, () => { equipWeapon(g, pi, card); effects(); })) return;
        phaseRun(g, () => fire(g, 'afterCardPlayed', playEv));
    } else if (def.secret) {
        card.zone = 'secret';
        p.secrets.push(card);
        emit(g, { t: 'secret', p: pi, uid: card.uid, cardId: card.cardId });
        if (!phaseRun(g, () => { fire(g, 'cardPlayed', playEv); fire(g, 'spellCast', playEv); })) return;
        phaseRun(g, () => { fire(g, 'afterSpell', playEv); fire(g, 'afterCardPlayed', playEv); });
    } else {
        if (!phaseRun(g, () => { fire(g, 'cardPlayed', playEv); fire(g, 'spellCast', playEv); })) return;
        if (!phaseRun(g, effects)) return;
        card.zone = 'grave';
        p.grave.push(card.cardId);
        phaseRun(g, () => { fire(g, 'afterSpell', playEv); fire(g, 'afterCardPlayed', playEv); });
    }
}

function doAttack(g, pi, a) {
    const att = findEntity(g, a.attacker), def = findEntity(g, a.target);
    att.attacks++;
    if (att.zone === 'board') att.stealth = false;
    emit(g, { t: 'attack', p: pi, src: att.uid, dst: def.uid });
    if (!phaseRun(g, () => fire(g, 'attack', { player: pi, subject: att, target: def }))) return;
    if (!isAlive(att) || !isAlive(def)) return;
    if (!phaseRun(g, () => {
        const back = def.zone === 'board' ? def.atk : 0;
        dealDamage(g, att, def, att.atk);
        if (back > 0) dealDamage(g, def, att, back);
        const w = att.zone === 'hero' ? g.players[pi].weapon : null;
        if (w) { w.durability -= 1; emit(g, { t: 'durability', uid: w.uid, durability: w.durability }); }
    })) return;
    phaseRun(g, () => fire(g, 'afterAttack', { player: pi, subject: att, target: def }));
}

function doPower(g, pi, a) {
    const p = g.players[pi];
    const def = HEROES[p.heroId].power;
    p.mana -= p.power.cost;
    p.power.uses++;
    const target = a.target != null ? findEntity(g, a.target) : null;
    emit(g, { t: 'power', p: pi, uid: p.power.uid, target: target ? target.uid : null });
    const ctx = { p: pi, src: p.power, target, def, isSpell: false, isPower: true };
    if (!phaseRun(g, () => runEffects(g, def.effects, ctx))) return;
    phaseRun(g, () => fire(g, 'heroPower', { player: pi, subject: p.power, target }));
}

// ---------- Legality (pure reads of public / own information, so they also work on views) ----------

function canAct(g, pi) { return g.phase === 'main' && g.current === pi && !g.pending; }

// What playing a card from hand needs: { ok, reason, need (a target), targets: [uid], options: [per Choose One option] }
function playInfo(g, pi, card) {
    const p = g.players[pi];
    const def = CARDS[card.cardId];
    const no = reason => ({ ok: false, reason, need: false, targets: [] });
    if (!def) return no('Unknown card');
    if (!canAct(g, pi)) return no('Not now');
    if (card.cost > p.mana) return no('Not enough mana');
    if (def.type === 'minion' && p.board.length >= RULES.boardLimit) return no('Your board is full');
    if (def.secret) {
        if (p.secrets.length >= RULES.maxSecrets) return no('Too many secrets');
        if (p.secrets.some(s => s.cardId === def.id)) return no('That secret is already active');
    }
    const ctx = { p: pi, src: card, def, combo: p.cardsPlayed > 0 };
    if (def.playIf && !checkCond(g, def.playIf, ctx)) return no('Can\'t be played now');
    const evalTarget = src => {
        const spec = src.target && !(src.targetIf && !checkCond(g, src.targetIf, ctx)) ? src.target : null;
        if (!spec) return { ok: true, need: false, targets: [] };
        const ts = validTargets(g, pi, spec, { isSpell: def.type === 'spell', filter: src.targetFilter, src: card });
        if (!ts.length) return def.type === 'spell' ? { ok: false, reason: 'No valid target', need: true, targets: [] } : { ok: true, need: false, targets: [] };
        return { ok: true, need: true, targets: ts.map(e => e.uid) };
    };
    if (def.chooseOne) {
        const options = def.chooseOne.map(evalTarget);
        const ok = options.some(o => o.ok);
        return { ok, reason: ok ? '' : 'No valid target', need: false, targets: [], options };
    }
    return evalTarget(def);
}

function canAttack(g, pi, e) {
    if (!canAct(g, pi) || !e || e.owner !== pi || !isAlive(e)) return false;
    if (e.frozen || e.atk <= 0 || (e.kw && e.kw.cantAttack)) return false;
    return canStillAttack(g, e);
}

function attackTargets(g, pi, e) {
    if (!canAttack(g, pi, e)) return [];
    const opp = g.players[1 - pi];
    let list = [opp.hero].concat(opp.board).filter(t => isAlive(t) && !(t.zone === 'board' && t.stealth));
    if (e.zone === 'board' && e.sleeping && !e.kw.charge) list = list.filter(t => t.zone === 'board'); // Rush
    const taunts = list.filter(t => t.zone === 'board' && t.kw && t.kw.taunt);
    return taunts.length ? taunts : list;
}

function powerInfo(g, pi) {
    const p = g.players[pi];
    const def = HEROES[p.heroId].power;
    const no = reason => ({ ok: false, reason, need: false, targets: [] });
    if (!canAct(g, pi)) return no('Not now');
    if (p.power.uses >= (def.uses || 1)) return no('Already used this turn');
    if (p.power.cost > p.mana) return no('Not enough mana');
    const summons = [].concat(def.effects || []).some(fx => fx && fx.do === 'summon' && fx.side !== 'enemy');
    if (summons && p.board.length >= RULES.boardLimit) return no('Your board is full');
    if (def.playIf && !checkCond(g, def.playIf, { p: pi, src: p.power, def })) return no('Can\'t be used now');
    if (!def.target) return { ok: true, need: false, targets: [] };
    const ts = validTargets(g, pi, def.target, { isPower: true, filter: def.targetFilter, src: p.power });
    if (!ts.length) return no('No valid target');
    return { ok: true, need: true, targets: ts.map(e => e.uid) };
}

function checkAction(g, pi, a) {
    switch (a.type) {
        case 'end': return null;
        case 'play': {
            const card = g.players[pi].hand.find(c => c.uid === a.uid);
            if (!card) return 'That card is not in your hand.';
            const info = playInfo(g, pi, card);
            if (!info.ok) return info.reason || 'You can\'t play that now.';
            let t = info;
            if (info.options) {
                if (!Number.isInteger(a.choice) || !info.options[a.choice]) return 'Choose one of the options.';
                t = info.options[a.choice];
                if (!t.ok) return t.reason || 'That option can\'t be played.';
            }
            if (t.need && !t.targets.includes(a.target)) return 'Choose a valid target.';
            if (!t.need && a.target != null) return 'That card doesn\'t take a target.';
            if (a.pos != null && !Number.isInteger(a.pos)) return 'Bad position.';
            return null;
        }
        case 'attack': {
            const att = findEntity(g, a.attacker);
            if (!att || att.owner !== pi || !isCharacter(att)) return 'Choose one of your characters to attack with.';
            if (!canAttack(g, pi, att)) return 'That character can\'t attack now.';
            if (!attackTargets(g, pi, att).some(t => t.uid === a.target)) return 'You can\'t attack that target.';
            return null;
        }
        case 'power': {
            const info = powerInfo(g, pi);
            if (!info.ok) return info.reason;
            if (info.need && !info.targets.includes(a.target)) return 'Choose a valid target.';
            if (!info.need && a.target != null) return 'Your Hero Power doesn\'t take a target.';
            return null;
        }
        case 'choose': return 'There is nothing to choose.';
    }
    return 'Unknown action.';
}

// Every legal action for a player (the bots and the tests use this)
function legalActions(g, pi) {
    const out = [];
    if (isOver(g)) return out;
    if (g.phase === 'mulligan') {
        if (!g.mulligan[pi]) {
            out.push({ type: 'mulligan', replace: [] });
            out.push({ type: 'mulligan', replace: g.players[pi].hand.map(c => c.uid) });
        }
        return out;
    }
    if (g.pending) {
        if (g.pending.player === pi) {
            const n = g.pending.options ? g.pending.options.length : g.pending.count;
            for (let i = 0; i < n; i++) out.push({ type: 'choose', index: i });
        }
        return out;
    }
    if (!canAct(g, pi)) return out;
    const p = g.players[pi];
    for (const card of p.hand) {
        const info = playInfo(g, pi, card);
        if (!info.ok) continue;
        const def = CARDS[card.cardId];
        const variants = info.options ? info.options.map((o, i) => [o, i]).filter(v => v[0].ok) : [[info, null]];
        for (const [o, choice] of variants) {
            const base = { type: 'play', uid: card.uid };
            if (choice != null) base.choice = choice;
            if (def.type === 'minion') base.pos = p.board.length;
            if (o.need) for (const t of o.targets) out.push(Object.assign({}, base, { target: t }));
            else out.push(base);
        }
    }
    for (const e of [p.hero].concat(p.board)) for (const t of attackTargets(g, pi, e)) out.push({ type: 'attack', attacker: e.uid, target: t.uid });
    const pw = powerInfo(g, pi);
    if (pw.ok) {
        if (pw.need) for (const t of pw.targets) out.push({ type: 'power', target: t });
        else out.push({ type: 'power' });
    }
    out.push({ type: 'end' });
    return out;
}

// The players who may act right now
function whoActs(g) {
    if (isOver(g)) return [];
    if (g.phase === 'mulligan') return [0, 1].filter(i => !g.mulligan[i]);
    if (g.pending) return [g.pending.player];
    return [g.current];
}

const Engine = {
    newGame, apply: applyAction, viewFor, redactEvents,
    playInfo, canAttack, attackTargets, powerInfo, legalActions, whoActs, validTargets,
    findEntity, isAlive, spellPower, validateDeck, validateAll, deckById, deckCards, cardsetHash,
};
