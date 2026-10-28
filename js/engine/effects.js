// ==========================================
// effects.js - Effect primitives, selectors, target specs and the card scripting API
// A card's effect list holds declarative objects ({ do: 'damage', to: 'target', amount: 3 }) or
// functions (api => { ... }) for anything the primitives can't express. See README "Card authoring".
// ctx (the context effects run in): { p, src, target, def, isSpell, isPower, combo, choice, ev, pos }
// ==========================================

// A number in an effect can be a function of the api: amount: api => api.me.hand.length
function num(g, v, ctx) {
    if (typeof v === 'function') return Number(v(apiFor(g, ctx))) || 0;
    return Number(v) || 0;
}

// Conditions: a function (api => bool), 'combo', { control: filter, count }, { holding: filter },
// { damaged: true } (the target is damaged), { not: cond }
function checkCond(g, cond, ctx) {
    if (cond == null) return true;
    if (typeof cond === 'function') return !!cond(apiFor(g, ctx));
    if (cond === 'combo') return !!ctx.combo;
    if (typeof cond === 'object') {
        if (cond.not) return !checkCond(g, cond.not, ctx);
        const me = g.players[ctx.p];
        if (cond.control) return me.board.filter(m => isAlive(m) && m !== ctx.src && matchFilter(g, m, cond.control, ctx)).length >= (cond.count || 1);
        if (cond.holding) return me.hand.some(c => c !== ctx.src && matchFilter(g, c, cond.holding, ctx));
        if (cond.damaged) return !!(ctx.target && ctx.target.damage > 0);
    }
    throw new Error('Unknown condition: ' + JSON.stringify(cond));
}

// ---------- Selectors ----------
// Effects pick what they act on with `to:` (a selector name, a list of names, or a function api => entities)

const SELECTOR_ALIASES = {
    friendlyHero: 'myHero', friendlyMinions: 'myMinions', otherFriendlyMinions: 'otherMyMinions',
    friendlyCharacters: 'myCharacters', randomFriendlyMinion: 'randomMyMinion', friendlyWeapon: 'myWeapon',
    allEnemies: 'enemyCharacters', allFriendlies: 'myCharacters',
};

function select(g, sel, ctx) {
    if (sel == null) sel = 'target';
    if (typeof sel === 'function') return [].concat(sel(apiFor(g, ctx)) || []).filter(Boolean);
    if (Array.isArray(sel)) { const out = []; for (const s of sel) for (const e of select(g, s, ctx)) if (!out.includes(e)) out.push(e); return out; }
    sel = SELECTOR_ALIASES[sel] || sel;
    const me = g.players[ctx.p], opp = g.players[1 - ctx.p];
    const live = list => list.filter(isAlive);
    const byOrder = list => list.slice().sort((a, b) => a.order - b.order);
    const src = ctx.src;
    const neighbours = e => {
        if (!e || e.zone !== 'board') return [];
        const b = g.players[e.owner].board, i = b.indexOf(e);
        return live([b[i - 1], b[i + 1]].filter(Boolean));
    };
    const ev = ctx.ev || {};
    switch (sel) {
        case 'target': return ctx.target && (isAlive(ctx.target) || ctx.target.zone === 'hand') ? [ctx.target] : [];
        case 'self': return src ? [src] : [];
        case 'myHero': return [me.hero];
        case 'enemyHero': return [opp.hero];
        case 'bothHeroes': return [me.hero, opp.hero];
        case 'myMinions': return live(me.board);
        case 'enemyMinions': return live(opp.board);
        case 'allMinions': return live(byOrder(me.board.concat(opp.board)));
        case 'otherMyMinions': return live(me.board).filter(m => m !== src);
        case 'otherMinions': return live(byOrder(me.board.concat(opp.board))).filter(m => m !== src);
        case 'myCharacters': return live([me.hero].concat(me.board));
        case 'enemyCharacters': return live([opp.hero].concat(opp.board));
        case 'allCharacters': return live([me.hero, opp.hero].concat(byOrder(me.board.concat(opp.board))));
        case 'adjacent': return neighbours(src);
        case 'targetAdjacent': return neighbours(ctx.target);
        case 'randomEnemyMinion': return pickOne(g, live(opp.board));
        case 'randomMyMinion': return pickOne(g, live(me.board));
        case 'randomOtherMyMinion': return pickOne(g, live(me.board).filter(m => m !== src));
        case 'randomMinion': return pickOne(g, live(byOrder(me.board.concat(opp.board))));
        case 'randomEnemyCharacter': return pickOne(g, live([opp.hero].concat(opp.board)));
        case 'randomCharacter': return pickOne(g, live([me.hero, opp.hero].concat(byOrder(me.board.concat(opp.board)))));
        case 'eventSubject': return ev.subject ? [ev.subject] : [];
        case 'eventTarget': return ev.target ? [ev.target] : [];
        case 'eventSource': return ev.source ? [ev.source] : [];
        case 'myLocations': return me.board.filter(e => e.zone === 'location');
        case 'enemyLocations': return opp.board.filter(e => e.zone === 'location');
        case 'myWeapon': return me.weapon ? [me.weapon] : [];
        case 'enemyWeapon': return opp.weapon ? [opp.weapon] : [];
        case 'myHand': return me.hand.slice();
        case 'enemyHand': return opp.hand.slice();
    }
    throw new Error('Unknown selector "' + sel + '"');
}
function pickOne(g, list) { return list.length ? [rngPick(g, list)] : []; }

// ---------- Chosen targets ----------
// A card / hero power that targets has `target:` 'any' | 'minion' | 'enemyMinion' | 'friendlyMinion' |
// 'enemy' | 'friendly' | 'hero' | 'enemyHero' | 'friendlyHero', or { side, type }, plus optional targetFilter

const TARGET_SPECS = {
    any: { side: 'any', type: 'character' }, character: { side: 'any', type: 'character' },
    minion: { side: 'any', type: 'minion' }, enemyMinion: { side: 'enemy', type: 'minion' },
    friendlyMinion: { side: 'friendly', type: 'minion' }, myMinion: { side: 'friendly', type: 'minion' },
    enemy: { side: 'enemy', type: 'character' }, enemyCharacter: { side: 'enemy', type: 'character' },
    friendly: { side: 'friendly', type: 'character' }, friendlyCharacter: { side: 'friendly', type: 'character' },
    hero: { side: 'any', type: 'hero' }, enemyHero: { side: 'enemy', type: 'hero' },
    friendlyHero: { side: 'friendly', type: 'hero' }, myHero: { side: 'friendly', type: 'hero' },
};

function normalizeSpec(spec) {
    if (typeof spec === 'string') {
        if (!TARGET_SPECS[spec]) throw new Error('Unknown target spec "' + spec + '"');
        return TARGET_SPECS[spec];
    }
    return { side: spec.side || 'any', type: spec.type || 'character' };
}

// Characters player `pi` may choose. opts: { isSpell, isPower, filter, src }. Works on views too.
function validTargets(g, pi, spec, opts) {
    opts = opts || {};
    const s = normalizeSpec(spec);
    const sides = s.side === 'enemy' ? [g.players[1 - pi]] : s.side === 'friendly' ? [g.players[pi]] : [g.players[pi], g.players[1 - pi]];
    const list = [];
    for (const p of sides) {
        if (s.type !== 'minion') list.push(p.hero);
        if (s.type !== 'hero') list.push(...p.board);
    }
    return list.filter(e => {
        if (!isAlive(e)) return false;
        if (e.owner !== pi && e.zone === 'board' && e.stealth) return false;
        if ((opts.isSpell || opts.isPower) && e.kw && e.kw.elusive) return false;
        if (opts.filter && !matchFilter(g, e, opts.filter, { p: pi, src: opts.src })) return false;
        return true;
    });
}

// ---------- Random card pools ----------
// pool: an array of card ids, or a filter over collectible cards ({ type: 'spell', class: 'mine' })

function poolIds(g, pool, ctx) {
    if (Array.isArray(pool)) return pool.slice();
    const out = [];
    for (const id in CARDS) {
        const def = CARDS[id];
        if (!def.collectible) continue;
        if (pool && !matchFilter(g, def, pool, ctx)) continue;
        out.push(id);
    }
    return out;
}

function pickDistinct(g, ids, n) {
    const left = ids.slice(), out = [];
    while (left.length && out.length < n) out.push(left.splice(rngInt(g, left.length), 1)[0]);
    return out;
}

// Where a summon lands: right of the source minion or location, where a dead source stood, or at the right end
function summonPos(g, ctx, side) {
    const src = ctx.src;
    if (src && (src.zone === 'board' || src.zone === 'location') && src.owner === side) return g.players[side].board.indexOf(src) + 1;
    if (src && src.owner === side && ctx.pos != null) return ctx.pos;
    return g.players[side].board.length;
}

function whoPlayers(who, ctx) {
    if (who === 'enemy' || who === 'opponent') return [1 - ctx.p];
    if (who === 'both') return [ctx.p, 1 - ctx.p];
    return [ctx.p];
}

// ---------- Running effects ----------

function runEffects(g, list, ctx) {
    if (!list) return;
    for (const fx of [].concat(list)) {
        if (isOver(g)) return;
        if (typeof fx === 'function') { fx(apiFor(g, ctx)); refresh(g); continue; }
        const times = fx.times != null ? num(g, fx.times, ctx) : 1;
        for (let i = 0; i < times; i++) {
            if (isOver(g)) return;
            if (fx.if != null && !checkCond(g, fx.if, ctx)) break;
            const run = EFFECTS[fx.do];
            if (!run) throw new Error('Unknown effect "' + fx.do + '"');
            run(g, fx, ctx);
            refresh(g);
        }
    }
}

const EFFECTS = {
    // { do: 'damage', to, amount } - spells add Spell Damage
    damage(g, fx, ctx) {
        const n = num(g, fx.amount, ctx) + (ctx.isSpell ? spellPower(g, ctx.p) : 0);
        for (const t of select(g, fx.to, ctx)) dealDamage(g, ctx.src, t, n);
    },
    // { do: 'heal', to, amount }
    heal(g, fx, ctx) {
        const n = num(g, fx.amount, ctx);
        for (const t of select(g, fx.to, ctx)) healChar(g, ctx.src, t, n);
    },
    // { do: 'draw', amount = 1, who: 'me'|'enemy'|'both', filter }
    draw(g, fx, ctx) {
        const n = fx.amount != null ? num(g, fx.amount, ctx) : 1;
        for (const pi of whoPlayers(fx.who, ctx)) for (let i = 0; i < n; i++) drawCard(g, pi, fx.filter);
    },
    // { do: 'summon', card, count = 1, side: 'me'|'enemy' }
    summon(g, fx, ctx) {
        const side = fx.side === 'enemy' ? 1 - ctx.p : ctx.p;
        const n = fx.count != null ? num(g, fx.count, ctx) : 1;
        let pos = summonPos(g, ctx, side);
        for (let i = 0; i < n; i++) if (summonMinion(g, side, fx.card, pos)) pos++;
    },
    // { do: 'buff', to, atk, hp, keywords: [...], spellDamage, oneTurn, deathrattle: [...], triggers: [...] }
    buff(g, fx, ctx) {
        for (const t of select(g, fx.to, ctx)) addEnchant(g, t, fx, ctx);
    },
    // { do: 'setStats', to, atk, hp } - sets attack and/or health (healing the minion fully)
    setStats(g, fx, ctx) {
        for (const t of select(g, fx.to, ctx)) addEnchant(g, t, { setAtk: fx.atk, setHp: fx.hp }, ctx);
    },
    // { do: 'destroy', to }
    destroy(g, fx, ctx) {
        for (const t of select(g, fx.to, ctx)) {
            if (t.zone === 'board' || t.zone === 'location' || t.zone === 'weapon') t.destroyed = true;
            else if (t.zone === 'hero') { t.damage = t.maxHp; t.hp = 0; }
            emit(g, { t: 'destroy', uid: t.uid });
        }
    },
    // { do: 'silence', to }
    silence(g, fx, ctx) { for (const t of select(g, fx.to, ctx)) silenceMinion(g, t); },
    // { do: 'freeze', to }
    freeze(g, fx, ctx) { for (const t of select(g, fx.to, ctx)) freezeChar(g, t); },
    // { do: 'armor', amount, who }
    armor(g, fx, ctx) {
        const n = num(g, fx.amount, ctx);
        for (const pi of whoPlayers(fx.who, ctx)) {
            g.players[pi].hero.armor += n;
            emit(g, { t: 'armor', p: pi, uid: g.players[pi].hero.uid, amount: n, armor: g.players[pi].hero.armor });
        }
    },
    // { do: 'heroAttack', amount } - your hero gets +amount Attack this turn
    heroAttack(g, fx, ctx) {
        const h = g.players[ctx.p].hero;
        h.tempAtk += num(g, fx.amount, ctx);
        emit(g, { t: 'buff', uid: h.uid, atk: num(g, fx.amount, ctx), hp: 0 });
    },
    // { do: 'mana', amount = 1, kind: 'temp' (this turn only) | 'full' | 'empty' | 'destroy' | 'refill', who }
    mana(g, fx, ctx) {
        const n = fx.amount != null ? num(g, fx.amount, ctx) : 1;
        for (const pi of whoPlayers(fx.who, ctx)) {
            const p = g.players[pi];
            const kind = fx.kind || 'temp';
            if (kind === 'temp') p.mana = Math.min(RULES.maxMana, p.mana + n);
            else if (kind === 'full') { p.maxMana = Math.min(RULES.maxMana, p.maxMana + n); p.mana = Math.min(RULES.maxMana, p.mana + n); }
            else if (kind === 'empty') p.maxMana = Math.min(RULES.maxMana, p.maxMana + n);
            else if (kind === 'destroy') { p.maxMana = Math.max(0, p.maxMana - n); p.mana = Math.min(p.mana, p.maxMana); }
            else if (kind === 'refill') p.mana = Math.min(p.maxMana, p.mana + n);
            emit(g, { t: 'mana', p: pi });
        }
    },
    // { do: 'addCard', card | pool, count = 1, who } - pool picks at random
    addCard(g, fx, ctx) {
        const n = fx.count != null ? num(g, fx.count, ctx) : 1;
        for (const pi of whoPlayers(fx.who, ctx)) for (let i = 0; i < n; i++) {
            const id = fx.card || rngPick(g, poolIds(g, fx.pool, ctx));
            if (id) addToHand(g, pi, id);
        }
    },
    // { do: 'discover', pool, count = 3 } - choose one of `count` random cards from the pool
    discover(g, fx, ctx) {
        const options = pickDistinct(g, poolIds(g, fx.pool, ctx), fx.count || 3);
        if (!options.length) return;
        emit(g, { t: 'discover', p: ctx.p, options });
        const pick = choose(g, ctx.p, 'discover', options);
        addToHand(g, ctx.p, options[pick]);
    },
    // { do: 'transform', to, into }
    transform(g, fx, ctx) { for (const t of select(g, fx.to, ctx)) transformMinion(g, t, fx.into); },
    // { do: 'bounce', to } - return to its owner's hand
    bounce(g, fx, ctx) { for (const t of select(g, fx.to, ctx)) returnToHand(g, t); },
    // { do: 'discard', count = 1, who } - random cards from hand
    discard(g, fx, ctx) {
        const n = fx.count != null ? num(g, fx.count, ctx) : 1;
        for (const pi of whoPlayers(fx.who, ctx)) {
            const p = g.players[pi];
            for (let i = 0; i < n; i++) {
                const pool = p.hand.filter(c => c !== ctx.src);
                if (!pool.length) break;
                const c = rngPick(g, pool);
                p.hand.splice(p.hand.indexOf(c), 1);
                c.zone = 'grave'; p.grave.push(c.cardId);
                emit(g, { t: 'discard', p: pi, uid: c.uid, cardId: c.cardId });
            }
        }
    },
    // { do: 'equip', card }
    equip(g, fx, ctx) { equipWeapon(g, ctx.p, makeCard(g, fx.card, ctx.p, 'weapon')); },
    // { do: 'weaponBuff', atk, durability, who }
    weaponBuff(g, fx, ctx) {
        for (const pi of whoPlayers(fx.who, ctx)) {
            const w = g.players[pi].weapon;
            if (!w) continue;
            if (fx.atk) w.enchants.push({ atk: num(g, fx.atk, ctx) });
            if (fx.durability) w.durability += num(g, fx.durability, ctx);
            emit(g, { t: 'buff', uid: w.uid, atk: num(g, fx.atk, ctx), hp: 0 });
        }
    },
    // { do: 'destroyWeapon', who }
    destroyWeapon(g, fx, ctx) {
        for (const pi of whoPlayers(fx.who || 'enemy', ctx)) {
            const w = g.players[pi].weapon;
            if (w) { w.destroyed = true; emit(g, { t: 'destroy', uid: w.uid }); }
        }
    },
    // { do: 'costMod', to: 'myHand', amount, filter } - changes the cost of cards in hand permanently
    costMod(g, fx, ctx) {
        for (const t of select(g, fx.to || 'myHand', ctx)) {
            if (t.zone !== 'hand' || (fx.filter && !matchFilter(g, t, fx.filter, ctx))) continue;
            t.costMod = (t.costMod || 0) + num(g, fx.amount, ctx);
        }
    },
    // { do: 'nextCost', amount: -2, filter, uses = 1, thisTurn = true } - "your next spell costs (2) less"
    nextCost(g, fx, ctx) {
        g.players[ctx.p].auras.push({ cost: num(g, fx.amount, ctx), filter: fx.filter || null, uses: fx.uses || 1, thisTurn: fx.thisTurn !== false });
    },
    // { do: 'if', cond, then: [...], else: [...] }
    if(g, fx, ctx) { runEffects(g, checkCond(g, fx.cond, ctx) ? fx.then : fx.else, ctx); },
};

// ---------- Scripting API ----------
// Functions in effect lists receive this object. Every helper resolves its own triggers later, like the primitives.

function apiFor(g, ctx) {
    const me = g.players[ctx.p], opp = g.players[1 - ctx.p];
    const list = t => typeof t === 'string' || typeof t === 'function' ? select(g, t, ctx) : [].concat(t || []);
    return {
        g, ctx, me, opp, self: ctx.src, target: ctx.target, event: ctx.ev, combo: !!ctx.combo,
        turn: g.turn, isMyTurn: g.current === ctx.p,
        select: sel => select(g, sel, ctx),
        run: effects => runEffects(g, effects, ctx),
        damage: (t, n) => { for (const x of list(t)) dealDamage(g, ctx.src, x, n + (ctx.isSpell ? spellPower(g, ctx.p) : 0)); },
        heal: (t, n) => { for (const x of list(t)) healChar(g, ctx.src, x, n); },
        draw: (n = 1) => { for (let i = 0; i < n; i++) drawCard(g, ctx.p); },
        summon: (cardId, side) => summonMinion(g, side === 'enemy' ? 1 - ctx.p : ctx.p, cardId, summonPos(g, ctx, side === 'enemy' ? 1 - ctx.p : ctx.p)),
        buff: (t, atk, hp, keywords) => { for (const x of list(t)) addEnchant(g, x, { atk, hp, keywords }, ctx); },
        destroy: t => { for (const x of list(t)) EFFECTS.destroy(g, { to: () => [x] }, ctx); },
        silence: t => { for (const x of list(t)) silenceMinion(g, x); },
        freeze: t => { for (const x of list(t)) freezeChar(g, x); },
        armor: n => EFFECTS.armor(g, { amount: n }, ctx),
        addCard: (cardId, who) => addToHand(g, who === 'enemy' ? 1 - ctx.p : ctx.p, cardId),
        transform: (t, cardId) => { for (const x of list(t)) transformMinion(g, x, cardId); },
        bounce: t => { for (const x of list(t)) returnToHand(g, x); },
        random: arr => rngPick(g, arr),
        randomInt: n => rngInt(g, n),
        choose: options => choose(g, ctx.p, 'choice', options),
        spellDamage: () => spellPower(g, ctx.p),
        card: id => CARDS[id],
    };
}
