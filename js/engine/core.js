// ==========================================
// core.js - Registries, state helpers, stats and auras, triggers, damage and the death phase
// Pure engine code: no DOM. Runs in the browser and in Node (tests/harness.js).
// The game state is plain JSON (cloned for snapshots and network views), so it never holds
// functions or references to card definitions: entities name their card by cardId.
// ==========================================

const CARDS = {};   // cardId -> card definition (defineCards)
const HEROES = {};  // heroId -> hero definition (defineHeroes)
const DECKS = [];   // deck definitions in menu order (defineDecks)
const GRANTS = {};  // key -> { deathrattle, triggers } a buff gives to another entity (registerGrants)
let grantSeq = 0;

// Thrown when an effect needs a player's choice that hasn't been made yet (see actions.js runAction)
class NeedChoice {
    constructor(player, kind, options) { this.player = player; this.kind = kind; this.options = options; }
}

// ---------- Registries ----------

function defineCards(list) {
    for (const src of list) {
        if (!src || !src.id) throw new Error('Card without an id: ' + JSON.stringify(src));
        if (CARDS[src.id]) console.warn('Card id defined twice: ' + src.id);
        const def = Object.assign({ name: src.id, text: '', rarity: 'common', class: 'neutral', keywords: [], collectible: true, cost: 0 }, src);
        if (!['minion', 'spell', 'weapon', 'location'].includes(def.type)) throw new Error('Card ' + def.id + ' has an unknown type: ' + def.type);
        if (def.type === 'minion') { def.atk = def.atk || 0; def.hp = def.hp || 1; }
        if (def.type === 'weapon') { def.atk = def.atk || 0; def.durability = def.durability || 1; }
        if (def.type === 'location') def.durability = def.durability || 1;
        registerGrants(def);
        CARDS[def.id] = def;
    }
}

function defineHeroes(list) {
    for (const src of list) {
        const hero = Object.assign({ name: src.id, class: 'neutral', hp: RULES.heroHp, art: '', color: '#8a8a8a' }, src);
        hero.power = Object.assign({ name: 'Hero Power', text: '', cost: RULES.heroPowerCost, uses: 1, effects: [] }, src.power);
        walkEffects(hero.power.effects, grantFx);
        HEROES[hero.id] = hero;
    }
}

function defineDecks(list) { for (const d of list) DECKS.push(d); }
function deckById(id) { return DECKS.find(d => d.id === id) || null; }

// True for real card ids only (not 'toString' and other object built-ins); deck lists arrive over the network
function hasCard(id) { return typeof id === 'string' && Object.prototype.hasOwnProperty.call(CARDS, id); }

// A deck's cards as a flat list of ids; `cards` is { cardId: count } or an array of ids
function deckCards(deck) {
    if (Array.isArray(deck.cards)) return deck.cards.slice(0, 200);
    const out = [];
    for (const id of Object.keys(deck.cards)) {
        const n = Math.min(Math.floor(Number(deck.cards[id])) || 0, 60);
        for (let i = 0; i < n; i++) out.push(id);
    }
    return out;
}

// A deck's cards as { cardId: copies }, whichever way the deck lists them
function deckCounts(deck) {
    const out = {};
    for (const id of deckCards(deck)) out[id] = (out[id] || 0) + 1;
    return out;
}

// Problems with a deck (empty list = legal)
function validateDeck(deck) {
    const out = [];
    if (!deck || !deck.cards) return ['Missing deck'];
    const hero = Object.prototype.hasOwnProperty.call(HEROES, deck.hero) ? HEROES[deck.hero] : null;
    if (!hero) out.push('Unknown hero "' + deck.hero + '"');
    const ids = deckCards(deck);
    if (ids.length !== RULES.deckSize) out.push(ids.length + ' cards (needs ' + RULES.deckSize + ')');
    const counts = new Map();
    for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
    for (const [id, n] of counts) {
        const def = hasCard(id) ? CARDS[id] : null;
        if (!def) { out.push('Unknown card "' + id + '"'); continue; }
        if (!def.collectible) out.push(def.name + ' is not collectible');
        const max = def.rarity === 'legendary' ? RULES.maxLegendaryCopies : RULES.maxCopies;
        if (n > max) out.push(n + ' copies of ' + def.name + ' (max ' + max + ')');
        if (hero && def.class !== 'neutral' && def.class !== hero.class) out.push(def.name + ' belongs to another class');
    }
    return out.map(s => (deck.name || deck.id) + ': ' + s);
}

// Checks every deck and every card reference; main.js shows the result on the menu, the tests require it empty
function validateAll() {
    const out = [];
    for (const d of DECKS) out.push(...validateDeck(d));
    const refs = (where, list) => walkEffects(list, fx => {
        for (const key of ['card', 'into']) if (typeof fx[key] === 'string' && !CARDS[fx[key]]) out.push(where + ': unknown card "' + fx[key] + '"');
        if (fx.do && typeof fx.do === 'string' && typeof EFFECTS !== 'undefined' && !EFFECTS[fx.do]) out.push(where + ': unknown effect "' + fx.do + '"');
    });
    for (const id in CARDS) for (const list of effectLists(CARDS[id])) refs(CARDS[id].name, list);
    for (const id in HEROES) refs(HEROES[id].name, HEROES[id].power.effects);
    return out;
}

// Every effect list of a card definition (for walking and validation)
function effectLists(def) {
    const lists = [def.play, def.battlecry, def.combo, def.deathrattle, def.spellburst, def.activate];
    for (const t of [].concat(def.triggers || [])) lists.push(t.effects);
    if (def.secret) lists.push(def.secret.effects);
    for (const o of def.chooseOne || []) lists.push(o.effects);
    return lists.filter(Boolean);
}

// Calls fn on every declarative effect object, including the branches of `if` effects
function walkEffects(list, fn) {
    for (const fx of [].concat(list || [])) {
        if (!fx || typeof fx !== 'object') continue;
        fn(fx);
        if (fx.then) walkEffects(fx.then, fn);
        if (fx.else) walkEffects(fx.else, fn);
        if (fx.deathrattle) walkEffects(fx.deathrattle, fn);
        for (const t of [].concat(fx.triggers || [])) walkEffects(t.effects, fn);
    }
}

// A buff that gives a deathrattle or triggers stores them here under a key, so the enchantment
// in the (JSON) state only holds the key
function grantFx(fx) {
    if (fx.do === 'buff' && (fx.deathrattle || fx.triggers) && !fx.grant) {
        fx.grant = 'g' + (++grantSeq);
        GRANTS[fx.grant] = { deathrattle: fx.deathrattle || null, triggers: fx.triggers ? [].concat(fx.triggers) : [] };
    }
}
function registerGrants(def) { for (const list of effectLists(def)) walkEffects(list, grantFx); }

// A short hash of all definitions; both players must have the same one to play together
function cardsetHash() {
    const src = JSON.stringify([CARDS, HEROES, DECKS, RULES, PROTOCOL_VERSION], (k, v) => typeof v === 'function' ? String(v) : v);
    let h = 0x811c9dc5;
    for (let i = 0; i < src.length; i++) { h ^= src.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
}

// ---------- Random numbers (mulberry32; the state lives in g.rng so replays are exact) ----------

function rngNext(g) {
    let t = (g.rng = (g.rng + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function rngInt(g, n) { return Math.floor(rngNext(g) * n); }
function rngPick(g, arr) { return arr.length ? arr[rngInt(g, arr.length)] : null; }
function shuffleInPlace(g, arr) {
    for (let i = arr.length - 1; i > 0; i--) { const j = rngInt(g, i + 1); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    return arr;
}

// ---------- Per-action runtime (not part of the JSON state) ----------
// queue: triggers waiting to resolve; events: what happened, for the UI; choices: recorded answers for replays

function newRt(g, choices) {
    const rt = { queue: [], events: [], choices: choices || [], cursor: 0, loops: 0 };
    Object.defineProperty(g, '_rt', { value: rt, writable: true, configurable: true, enumerable: false });
    return rt;
}
function rtOf(g) { return g._rt || newRt(g, []); }
function emit(g, ev) { rtOf(g).events.push(ev); }

// Asks player `player` to pick one of `options`; on a replay the recorded answer is returned
function choose(g, player, kind, options) {
    const rt = rtOf(g);
    if (rt.cursor < rt.choices.length) return Math.min(rt.choices[rt.cursor++], options.length - 1);
    throw new NeedChoice(player, kind, options);
}

// ---------- Entities ----------

function makeCard(g, cardId, owner, zone) {
    if (!CARDS[cardId]) throw new Error('Unknown card "' + cardId + '"');
    return { uid: g.nextUid++, cardId, owner, zone, enchants: [], costMod: 0 };
}

function findEntity(g, uid) {
    if (uid == null) return null;
    for (const p of g.players) {
        if (p.hero.uid === uid) return p.hero;
        if (p.power.uid === uid) return p.power;
        if (p.weapon && p.weapon.uid === uid) return p.weapon;
        for (const m of p.board) if (m.uid === uid) return m;
        for (const c of p.hand) if (c.uid === uid) return c;
        for (const s of p.secrets) if (s.uid === uid) return s;
    }
    return null;
}

function isCharacter(e) { return !!e && (e.zone === 'hero' || e.zone === 'board'); }
function isAlive(e) { return isCharacter(e) && e.hp > 0 && !e.destroyed; }
function isOver(g) { return g.phase === 'over'; }

// Everything on the board (minions and locations) in play order (the order triggers and auras resolve in)
function minionsInOrder(g) {
    return g.players[0].board.concat(g.players[1].board).sort((a, b) => a.order - b.order);
}

// The card definition behind an entity or a definition passed directly (heroes have none)
function defOf(x) {
    if (!x) return null;
    if (x.cardId) return CARDS[x.cardId] || null;
    if (x.id && x.type) return x;
    return null;
}

// ---------- Stats ----------

function computeAtk(e) {
    const def = CARDS[e.cardId];
    let a = def.atk || 0;
    for (const en of e.enchants) { if (en.setAtk != null) a = en.setAtk; if (en.atk) a += en.atk; }
    return Math.max(0, a + (e.auraAtk || 0));
}

function computeMaxHp(e) {
    const def = CARDS[e.cardId];
    let h = def.hp || 0;
    for (const en of e.enchants) { if (en.setHp != null) h = en.setHp; if (en.hp) h += en.hp; }
    return Math.max(0, h + (e.auraHp || 0));
}

function mergeKw(kw, add) {
    for (const k in add) {
        if (typeof add[k] === 'number') kw[k] = (kw[k] || 0) + add[k];
        else if (add[k]) kw[k] = true;
    }
    return kw;
}

// Static keywords: the card's own (unless silenced), plus enchantments and auras.
// Divine Shield, Stealth and Reborn are spent, so minions keep them as statuses (shield, stealth, reborn),
// like the one-shot Spellburst slot (spellburst).
function computeKw(e) {
    const def = CARDS[e.cardId];
    const kw = {};
    if (!e.silenced) {
        for (const k of def.keywords) kw[k] = true;
        if (def.spellDamage) kw.spellDamage = def.spellDamage;
    }
    for (const en of e.enchants) if (en.kw) mergeKw(kw, en.kw);
    if (e.auraKw) mergeKw(kw, e.auraKw);
    return kw;
}

function initMinion(g, m) {
    m.enchants = m.enchants || [];
    m.damage = 0; m.attacks = 0; m.sleeping = true; m.frozen = false; m.thawTurn = 0;
    m.silenced = false; m.destroyed = false; m.auraAtk = 0; m.auraHp = 0; m.auraKw = null;
    m.kw = computeKw(m);
    m.shield = !!m.kw.divineShield; m.stealth = !!m.kw.stealth; m.reborn = !!m.kw.reborn;
    m.spellburst = !!CARDS[m.cardId].spellburst;
    m.maxHp = computeMaxHp(m); m.atk = computeAtk(m); m.hp = m.maxHp;
    m.turnPlayed = g.turn;
    delete m.cost; delete m.costMod; delete m.auraCost;
}

// Recomputes auras and every derived number (attack, health, keywords, costs). Called after each effect.
// Losing max Health (an aura or buff going away) only lowers current Health if it is above the new max.
function refresh(g) {
    for (const p of g.players) {
        for (const m of p.board) if (m.zone === 'board') { m.auraAtk = 0; m.auraHp = 0; m.auraKw = null; }
        for (const c of p.hand) c.auraCost = 0;
        p.hero.auraKw = null;
    }
    const sources = minionsInOrder(g).filter(m => !m.silenced && CARDS[m.cardId].aura);
    for (const p of g.players) if (p.weapon && CARDS[p.weapon.cardId].aura) sources.push(p.weapon);
    for (const src of sources) for (const au of [].concat(CARDS[src.cardId].aura)) applyAura(g, src, au);

    for (const p of g.players) {
        for (const m of p.board) {
            if (m.zone !== 'board') continue; // locations have no stats
            const max = computeMaxHp(m);
            if (m.maxHp != null && max < m.maxHp) m.damage = Math.max(0, m.damage - (m.maxHp - max));
            m.maxHp = max; m.hp = m.maxHp - m.damage;
            m.atk = computeAtk(m); m.kw = computeKw(m);
        }
        for (const c of p.hand) {
            const def = CARDS[c.cardId];
            let cost = def.cost + (c.costMod || 0) + (c.auraCost || 0);
            for (const a of p.auras) if (a.cost && matchFilter(g, c, a.filter, { p: p.index })) cost += a.cost;
            c.cost = Math.max(0, cost);
            if (def.type === 'minion') { c.atk = computeAtk(c); c.maxHp = computeMaxHp(c); }
            if (def.type === 'weapon') c.atk = computeAtk(c);
        }
        const w = p.weapon;
        if (w) { w.atk = computeAtk(w); w.kw = computeKw(w); }
        const h = p.hero;
        h.kw = {};
        for (const en of h.enchants) if (en.kw) mergeKw(h.kw, en.kw);
        if (h.auraKw) mergeKw(h.kw, h.auraKw);
        if (w && w.kw.windfury) h.kw.windfury = true;
        h.atk = Math.max(0, (w ? w.atk : 0) + h.tempAtk + h.enchants.reduce((s, en) => s + (en.atk || 0), 0));
        h.hp = h.maxHp - h.damage;
        const pdef = HEROES[p.heroId].power;
        p.power.cost = Math.max(0, pdef.cost + (p.power.costMod || 0));
    }
}

function applyAura(g, src, au) {
    const targets = select(g, au.to || 'otherMyMinions', { p: src.owner, src, def: CARDS[src.cardId] });
    for (const t of targets) {
        if (au.filter && !matchFilter(g, t, au.filter, { p: src.owner, src })) continue;
        if (t.zone === 'board') {
            t.auraAtk += au.atk || 0; t.auraHp += au.hp || 0;
            if (au.keywords) { t.auraKw = t.auraKw || {}; for (const k of au.keywords) t.auraKw[k] = true; }
        } else if (t.zone === 'hand') {
            t.auraCost += au.cost || 0;
        } else if (t.zone === 'hero' && au.keywords) {
            t.auraKw = t.auraKw || {}; for (const k of au.keywords) t.auraKw[k] = true;
        }
    }
}

// Total Spell Damage of a player's side
function spellPower(g, pi) {
    let n = 0;
    for (const m of g.players[pi].board) if (isAlive(m) && m.kw.spellDamage) n += m.kw.spellDamage;
    if (g.players[pi].hero.kw && g.players[pi].hero.kw.spellDamage) n += g.players[pi].hero.kw.spellDamage;
    return n;
}

function maxAttacks(e) { return e.kw && e.kw.windfury ? 2 : 1; }
function canStillAttack(g, e) {
    if (e.attacks >= maxAttacks(e)) return false;
    if (e.zone === 'board' && e.sleeping && !e.kw.charge && !e.kw.rush) return false;
    return true;
}

// ---------- Filters ----------
// A filter is a function (entity, api) => bool or an object such as
// { type: 'spell', tribe: 'beast', class: 'mine', minCost: 1, maxCost: 3, minAtk: 5, maxAtk: 2, damaged: true, keyword: 'taunt', id: 'demo_x', rarity: 'legendary' }.
// It works on entities and on card definitions (random pools).

function matchFilter(g, x, f, ctx) {
    if (!f) return true;
    if (typeof f === 'function') return !!f(x, apiFor(g, ctx || {}));
    const def = defOf(x);
    if (f.type && (!def || def.type !== f.type)) return false;
    if (f.tribe && (!def || def.tribe !== f.tribe)) return false;
    if (f.rarity && (!def || def.rarity !== f.rarity)) return false;
    if (f.id && (!def || def.id !== f.id)) return false;
    if (f.class) {
        const mine = ctx && ctx.p != null ? HEROES[g.players[ctx.p].heroId].class : null;
        const cls = f.class === 'mine' ? mine : f.class;
        if (!def || (def.class !== cls && !(f.class === 'mine' && def.class === 'neutral'))) return false;
    }
    const cost = x.cost != null ? x.cost : def ? def.cost : 0;
    if (f.minCost != null && cost < f.minCost) return false;
    if (f.maxCost != null && cost > f.maxCost) return false;
    const atk = x.atk != null ? x.atk : def ? def.atk || 0 : 0;
    if (f.minAtk != null && atk < f.minAtk) return false;
    if (f.maxAtk != null && atk > f.maxAtk) return false;
    if (f.damaged && !(x.damage > 0)) return false;
    if (f.keyword && !(x.kw && x.kw[f.keyword]) && !(def && def.keywords.includes(f.keyword))) return false;
    if (f.not && matchFilter(g, x, f.not, ctx)) return false;
    return true;
}

// ---------- Triggers ----------
// A trigger: { on: 'turnEnd', who: 'friendly'|'enemy'|'any'|'self', other: true, filter, targetIs, when, effects: [...] }
// Events carry { player, subject, target, source, amount }. `who` compares the event's owner to the trigger holder's.

function holderTriggers(e) {
    if (e.zone === 'secret') return [CARDS[e.cardId].secret];
    if (e.silenced) return [];
    const list = [].concat(CARDS[e.cardId].triggers || []);
    for (const en of e.enchants || []) if (en.grant && GRANTS[en.grant]) list.push(...GRANTS[en.grant].triggers);
    // One-shot slot while its status lasts; `spend` names the status that resolving uses up
    if (e.spellburst) list.push({ on: 'afterSpell', who: 'friendly', spend: 'spellburst', effects: CARDS[e.cardId].spellburst });
    return list;
}

function deathrattlesOf(e) {
    if (e.silenced) return [];
    const lists = [];
    if (CARDS[e.cardId].deathrattle) lists.push(CARDS[e.cardId].deathrattle);
    for (const en of e.enchants || []) if (en.grant && GRANTS[en.grant] && GRANTS[en.grant].deathrattle) lists.push(GRANTS[en.grant].deathrattle);
    return lists;
}

// Minions in play order, then weapons, then the secrets of the player whose turn it isn't
function triggerHolders(g) {
    const out = minionsInOrder(g);
    for (const p of g.players) if (p.weapon) out.push(p.weapon);
    out.push(...g.players[1 - g.current].secrets);
    return out;
}

function eventOwner(ev) { return ev.subject && ev.subject.owner != null ? ev.subject.owner : ev.player; }

function triggerMatches(g, holder, trig, ev) {
    const who = trig.who || (ev.name === 'turnStart' || ev.name === 'turnEnd' ? 'friendly' : 'any');
    const owner = eventOwner(ev);
    if (who === 'self' && ev.subject !== holder) return false;
    if (who === 'friendly' && owner !== holder.owner) return false;
    if (who === 'enemy' && owner === holder.owner) return false;
    if (trig.other && ev.subject === holder) return false;
    const ctx = { p: holder.owner, src: holder, ev };
    if (trig.filter && (!ev.subject || !matchFilter(g, ev.subject, trig.filter, ctx))) return false;
    if (trig.targetIs) {
        const t = ev.target;
        if (!t) return false;
        if (typeof trig.targetIs === 'function') { if (!trig.targetIs(t, apiFor(g, ctx))) return false; }
        else if (!select(g, trig.targetIs, ctx).includes(t)) return false;
    }
    if (trig.when && !checkCond(g, trig.when, ctx)) return false;
    return true;
}

// Queues every trigger that matches the event; they resolve in resolveQueue (after the current step)
function fire(g, name, ev) {
    if (isOver(g)) return;
    ev.name = name;
    const rt = rtOf(g);
    for (const h of triggerHolders(g)) {
        for (const trig of holderTriggers(h)) {
            if (!trig || trig.on !== name || !triggerMatches(g, h, trig, ev)) continue;
            rt.queue.push({ kind: h.zone === 'secret' ? 'secret' : 'trigger', holder: h, trig, ev });
            if (h.zone === 'secret') break;
        }
    }
}

function resolveQueue(g) {
    const rt = rtOf(g);
    while (rt.queue.length && !isOver(g)) {
        if (++rt.loops > RULES.loopLimit) { rt.queue.length = 0; emit(g, { t: 'loop' }); break; }
        const q = rt.queue.shift();
        if (q.kind === 'trigger') {
            if (q.holder.silenced && q.holder.zone === 'board') continue;
            if (q.trig.spend) { if (!q.holder[q.trig.spend]) continue; q.holder[q.trig.spend] = false; }
            emit(g, { t: 'trigger', uid: q.holder.uid });
            runEffects(g, q.trig.effects, { p: q.holder.owner, src: q.holder, def: CARDS[q.holder.cardId], ev: q.ev, isSpell: false });
        } else if (q.kind === 'secret') {
            const p = g.players[q.holder.owner];
            const i = p.secrets.indexOf(q.holder);
            if (i < 0) continue;
            p.secrets.splice(i, 1);
            q.holder.zone = 'grave'; p.grave.push(q.holder.cardId);
            emit(g, { t: 'reveal', p: p.index, uid: q.holder.uid, cardId: q.holder.cardId });
            fire(g, 'secretRevealed', { player: p.index, subject: q.holder });
            runEffects(g, q.trig.effects, { p: p.index, src: q.holder, def: CARDS[q.holder.cardId], ev: q.ev, isSpell: true });
        } else if (q.kind === 'effects') {
            runEffects(g, q.effects, q.ctx);
        } else if (q.kind === 'reborn') {
            const m = summonMinion(g, q.p, q.cardId, q.pos);
            if (m) { m.reborn = false; m.damage = m.maxHp - 1; m.hp = 1; }
        }
        refresh(g);
    }
}

// ---------- Basic operations ----------

// Draws the top card (or the top card matching `filter`); an empty deck deals fatigue damage instead
function drawCard(g, pi, filter) {
    const p = g.players[pi];
    let idx = p.deck.length - 1;
    if (filter) {
        while (idx >= 0 && !matchFilter(g, p.deck[idx], filter, { p: pi })) idx--;
        if (idx < 0) return null;
    }
    if (idx < 0) {
        p.fatigue++;
        emit(g, { t: 'fatigue', p: pi, amount: p.fatigue });
        dealDamage(g, null, p.hero, p.fatigue);
        return null;
    }
    const c = p.deck.splice(idx, 1)[0];
    if (p.hand.length >= RULES.handLimit) {
        c.zone = 'grave'; p.grave.push(c.cardId);
        emit(g, { t: 'burn', p: pi, uid: c.uid, cardId: c.cardId });
        return null;
    }
    c.zone = 'hand';
    p.hand.push(c);
    emit(g, { t: 'draw', p: pi, uid: c.uid, cardId: c.cardId });
    refresh(g);
    fire(g, 'cardDrawn', { player: pi, subject: c });
    return c;
}

// Puts a new copy of a card into a hand (burned if the hand is full)
function addToHand(g, pi, cardId) {
    const p = g.players[pi];
    const c = makeCard(g, cardId, pi, 'hand');
    if (p.hand.length >= RULES.handLimit) {
        c.zone = 'grave'; p.grave.push(cardId);
        emit(g, { t: 'burn', p: pi, uid: c.uid, cardId });
        return null;
    }
    p.hand.push(c);
    emit(g, { t: 'addCard', p: pi, uid: c.uid, cardId });
    refresh(g);
    return c;
}

// Keywords that matter when `src` deals damage: a minion's own, a hero's weapon, or a spell's / power's definition
function sourceKw(g, src) {
    if (!src) return {};
    if (src.zone === 'board') return src.kw || {};
    if (src.zone === 'hero') { const w = g.players[src.owner].weapon; return Object.assign({}, w ? w.kw : {}, src.kw); }
    if (src.zone === 'power') { const kw = {}; for (const k of HEROES[g.players[src.owner].heroId].power.keywords || []) kw[k] = true; return kw; }
    const def = CARDS[src.cardId];
    const kw = {};
    if (def) for (const k of def.keywords) kw[k] = true;
    return kw;
}

function dealDamage(g, src, t, amount) {
    if (!isAlive(t) || !(amount > 0)) return 0;
    if (t.kw && t.kw.immune) { emit(g, { t: 'immune', uid: t.uid }); return 0; }
    if (t.zone === 'board' && t.shield) {
        t.shield = false;
        emit(g, { t: 'shield', uid: t.uid });
        return 0;
    }
    let rest = amount;
    if (t.zone === 'hero' && t.armor > 0) { const a = Math.min(t.armor, rest); t.armor -= a; rest -= a; }
    t.damage += rest;
    t.hp = t.maxHp - t.damage;
    emit(g, { t: 'damage', uid: t.uid, amount, src: src ? src.uid : null, hp: t.hp, armor: t.zone === 'hero' ? t.armor : undefined });
    if (src) {
        const kw = sourceKw(g, src);
        if (src.zone === 'board' && src.stealth) src.stealth = false;
        if (kw.lifesteal) healChar(g, src, g.players[src.owner].hero, amount);
        if (kw.poisonous && t.zone === 'board' && rest > 0) t.destroyed = true;
        if (kw.freeze) freezeChar(g, t);
    }
    fire(g, 'damaged', { subject: t, source: src, amount, player: t.owner });
    return amount;
}

function healChar(g, src, t, amount) {
    if (!isAlive(t) || !(amount > 0)) return 0;
    const h = Math.min(amount, t.damage);
    if (h <= 0) return 0;
    t.damage -= h;
    t.hp = t.maxHp - t.damage;
    emit(g, { t: 'heal', uid: t.uid, amount: h, hp: t.hp });
    fire(g, 'healed', { subject: t, source: src, amount: h, player: t.owner });
    return h;
}

// Frozen characters lose their next attack. A character frozen on its own turn while it can still
// attack thaws at the end of that turn; otherwise it thaws at the end of its owner's next turn.
function freezeChar(g, t) {
    if (!isAlive(t)) return;
    t.frozen = true;
    if (g.current === t.owner) t.thawTurn = canStillAttack(g, t) ? g.turn : g.turn + 2;
    else t.thawTurn = g.turn + 1;
    emit(g, { t: 'freeze', uid: t.uid });
}

function silenceMinion(g, t) {
    if (!t || t.zone !== 'board') return;
    t.enchants = []; t.silenced = true;
    t.shield = false; t.stealth = false; t.reborn = false; t.frozen = false; t.spellburst = false;
    emit(g, { t: 'silence', uid: t.uid });
    refresh(g);
}

// Places an entity on its owner's board (no triggers); false when the board is full
function placeMinion(g, pi, m, pos) {
    const p = g.players[pi];
    if (p.board.length >= RULES.boardLimit) return false;
    if (pos == null || pos < 0 || pos > p.board.length) pos = p.board.length;
    m.owner = pi; m.zone = 'board';
    initMinion(g, m);
    p.board.splice(pos, 0, m);
    m.order = g.nextOrder++;
    emit(g, { t: 'summon', p: pi, uid: m.uid, cardId: m.cardId, pos });
    refresh(g);
    return true;
}

// Places a location on its owner's board: it takes a minion slot but is not a minion (no stats, can't be
// attacked or targeted). It can be activated right away. False when the board is full.
function placeLocation(g, pi, loc, pos) {
    const p = g.players[pi];
    if (p.board.length >= RULES.boardLimit) return false;
    if (pos == null || pos < 0 || pos > p.board.length) pos = p.board.length;
    loc.owner = pi; loc.zone = 'location';
    loc.enchants = []; loc.destroyed = false;
    loc.durability = CARDS[loc.cardId].durability;
    loc.readyTurn = 0;
    delete loc.cost; delete loc.costMod; delete loc.auraCost;
    p.board.splice(pos, 0, loc);
    loc.order = g.nextOrder++;
    emit(g, { t: 'place', p: pi, uid: loc.uid, cardId: loc.cardId, pos });
    refresh(g);
    return true;
}

// Summons a new minion (not played from hand), firing the summon triggers
function summonMinion(g, pi, cardId, pos) {
    if (g.players[pi].board.length >= RULES.boardLimit) return null;
    const m = makeCard(g, cardId, pi, 'board');
    placeMinion(g, pi, m, pos);
    fire(g, 'summoned', { player: pi, subject: m });
    fire(g, 'afterSummon', { player: pi, subject: m });
    return m;
}

function equipWeapon(g, pi, w) {
    const p = g.players[pi];
    if (p.weapon) {
        const old = p.weapon;
        p.weapon = null; old.zone = 'grave'; p.grave.push(old.cardId);
        emit(g, { t: 'death', uid: old.uid, p: pi });
        for (const list of deathrattlesOf(old)) rtOf(g).queue.push({ kind: 'effects', effects: list, ctx: { p: pi, src: old, def: CARDS[old.cardId] } });
    }
    w.zone = 'weapon'; w.owner = pi; w.enchants = w.enchants || []; w.destroyed = false;
    w.durability = CARDS[w.cardId].durability;
    w.atk = computeAtk(w); w.kw = computeKw(w);
    p.weapon = w;
    emit(g, { t: 'equip', p: pi, uid: w.uid, cardId: w.cardId });
    refresh(g);
}

function transformMinion(g, t, intoId) {
    if (!t || t.zone !== 'board') return null;
    const p = g.players[t.owner];
    const i = p.board.indexOf(t);
    if (i < 0) return null;
    const m = makeCard(g, intoId, t.owner, 'board');
    m.zone = 'board';
    initMinion(g, m);
    m.order = g.nextOrder++;
    p.board[i] = m;
    t.zone = 'removed';
    emit(g, { t: 'transform', uid: t.uid, newUid: m.uid, cardId: intoId, p: t.owner, pos: i });
    refresh(g);
    return m;
}

// Returns a minion to its owner's hand as a fresh card (burned if the hand is full)
function returnToHand(g, t) {
    if (!t || t.zone !== 'board') return;
    const p = g.players[t.owner];
    const i = p.board.indexOf(t);
    if (i < 0) return;
    p.board.splice(i, 1);
    t.zone = 'removed';
    emit(g, { t: 'bounce', uid: t.uid, p: t.owner });
    addToHand(g, t.owner, t.cardId);
}

// Adds an enchantment: { atk, hp, setAtk, setHp, keywords: [...], spellDamage, oneTurn, grant }
function addEnchant(g, t, spec, ctx) {
    if (!t) return;
    const en = {};
    const atk = num(g, spec.atk, ctx), hp = num(g, spec.hp, ctx);
    if (atk) en.atk = atk;
    if (hp) en.hp = hp;
    if (spec.setAtk != null) en.setAtk = num(g, spec.setAtk, ctx);
    if (spec.setHp != null) en.setHp = num(g, spec.setHp, ctx);
    if (spec.oneTurn) en.oneTurn = true;
    if (spec.grant) en.grant = spec.grant;
    for (const k of spec.keywords || []) {
        if (k === 'divineShield' && t.zone === 'board') t.shield = true;
        else if (k === 'stealth' && t.zone === 'board') t.stealth = true;
        else if (k === 'reborn' && t.zone === 'board') t.reborn = true;
        else (en.kw = en.kw || {})[k] = true;
    }
    if (spec.spellDamage) (en.kw = en.kw || {}).spellDamage = num(g, spec.spellDamage, ctx);
    if (en.setHp != null && t.zone === 'board') t.damage = 0;
    t.enchants = t.enchants || [];
    t.enchants.push(en);
    emit(g, { t: 'buff', uid: t.uid, atk: en.atk || 0, hp: en.hp || 0 });
    refresh(g);
}

// ---------- Death phase ----------

function checkGameOver(g) {
    if (isOver(g)) return true;
    const d0 = g.players[0].hero.hp <= 0, d1 = g.players[1].hero.hp <= 0;
    if (!d0 && !d1) return false;
    g.phase = 'over';
    g.winner = d0 && d1 ? 'draw' : d0 ? 1 : 0;
    emit(g, { t: 'over', winner: g.winner });
    return true;
}

// Removes every dead minion, used-up location and broken weapon at once, then queues their deathrattles,
// Reborn and "minion died" triggers (in play order). Returns false when nothing died.
function collectDeaths(g) {
    const dying = [];
    for (const p of g.players) for (const m of p.board) {
        if (m.zone === 'location' ? m.durability <= 0 || m.destroyed : m.hp <= 0 || m.destroyed) dying.push(m);
    }
    const locations = new Set(dying.filter(m => m.zone === 'location'));
    const weapons = g.players.map(p => p.weapon).filter(w => w && (w.durability <= 0 || w.destroyed));
    if (!dying.length && !weapons.length) return false;
    dying.sort((a, b) => a.order - b.order);
    const dead = new Set(dying);
    const posOf = new Map();
    for (const m of dying) {
        let pos = 0;
        for (const x of g.players[m.owner].board) { if (x === m) break; if (!dead.has(x)) pos++; }
        posOf.set(m, pos);
    }
    for (const m of dying) {
        const p = g.players[m.owner];
        p.board.splice(p.board.indexOf(m), 1);
        m.zone = 'grave'; p.grave.push(m.cardId);
        emit(g, { t: 'death', uid: m.uid, p: m.owner });
    }
    for (const w of weapons) {
        const p = g.players[w.owner];
        p.weapon = null; w.zone = 'grave'; p.grave.push(w.cardId);
        emit(g, { t: 'death', uid: w.uid, p: w.owner });
    }
    refresh(g);
    const rt = rtOf(g);
    for (const m of dying) {
        const pos = posOf.get(m);
        for (const list of deathrattlesOf(m)) rt.queue.push({ kind: 'effects', effects: list, ctx: { p: m.owner, src: m, def: CARDS[m.cardId], pos } });
        if (locations.has(m)) continue;
        if (m.reborn && !m.silenced) rt.queue.push({ kind: 'reborn', p: m.owner, cardId: m.cardId, pos });
        fire(g, 'minionDied', { player: m.owner, subject: m });
    }
    for (const w of weapons) for (const list of deathrattlesOf(w)) rt.queue.push({ kind: 'effects', effects: list, ctx: { p: w.owner, src: w, def: CARDS[w.cardId] } });
    return true;
}

// Resolves queued triggers and deaths until nothing is left; heroes at 0 Health end the game
// (the dead are still cleared from the final board, but nothing triggers any more)
function deathPhase(g) {
    for (let guard = 0; guard < 500; guard++) {
        resolveQueue(g);
        if (checkGameOver(g)) { collectDeaths(g); return; }
        if (!collectDeaths(g)) return;
    }
}

// One step of an action pipeline: run it, then resolve its triggers and deaths. False once the game is over.
function phaseRun(g, fn) {
    if (isOver(g)) return false;
    fn();
    refresh(g);
    deathPhase(g);
    return !isOver(g);
}

// ---------- Built-in cards ----------

defineCards([
    { id: 'coin', name: 'The Coin', type: 'spell', cost: 0, collectible: false, art: '💰', text: 'Gain 1 Mana Crystal this turn only.',
      play: [{ do: 'mana', amount: 1, kind: 'temp' }] },
]);
