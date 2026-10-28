// ==========================================
// bot.js - A simple computer player (Practice vs Bot, ?autoplay, the fuzz tests)
// Bot.act(stateOrView, player, { mode: 'greedy' | 'random', rand }) -> the next action, or null when
// the player has nothing to do. It only reads public / own information, so it also plays from a view.
// ==========================================

const Bot = {
    act(g, pi, opts) {
        opts = opts || {};
        const rand = opts.rand || Math.random;
        if (!whoActs(g).includes(pi)) return null;
        return opts.mode === 'random' ? botRandom(g, pi, rand) : botGreedy(g, pi, rand);
    },
};

function botRandom(g, pi, rand) {
    const p = g.players[pi];
    if (g.phase === 'mulligan') return { type: 'mulligan', replace: p.hand.filter(() => rand() < 0.35).map(c => c.uid) };
    const acts = legalActions(g, pi);
    if (!acts.length) return null;
    const busy = acts.filter(a => a.type !== 'end');
    if (!busy.length || (acts.length > busy.length && rand() < 0.08)) return { type: 'end' };
    const a = busy[Math.floor(rand() * busy.length)];
    if (a.type === 'play' && a.pos != null) a.pos = Math.floor(rand() * (p.board.length + 1));
    return a;
}

function botGreedy(g, pi, rand) {
    const p = g.players[pi];
    if (g.phase === 'mulligan') return { type: 'mulligan', replace: p.hand.filter(c => c.cost >= 4).map(c => c.uid) };
    if (g.pending) return { type: 'choose', index: bestOption(g) };
    return botLethal(g, pi) || botPlay(g, pi, rand) || botLocation(g, pi, rand) || botAttack(g, pi) || botPower(g, pi, rand) || { type: 'end' };
}

function bestOption(g) {
    const opts = g.pending.options;
    if (!opts) return 0;
    let best = 0;
    opts.forEach((id, i) => { if ((CARDS[id] || {}).cost > (CARDS[opts[best]] || {}).cost) best = i; });
    return best;
}

const botValue = e => e.atk + e.hp + (e.kw && e.kw.taunt ? 1 : 0);

// Everything that can hit the face this turn: if it's enough, go face
function botLethal(g, pi) {
    const p = g.players[pi], face = g.players[1 - pi].hero;
    let dmg = 0, first = null;
    for (const e of p.board.concat([p.hero])) {
        if (!attackTargets(g, pi, e).includes(face)) continue;
        dmg += e.atk * (maxAttacks(e) - e.attacks);
        first = first || e;
    }
    return first && dmg >= face.hp + face.armor ? { type: 'attack', attacker: first.uid, target: face.uid } : null;
}

// What an effect list does to its chosen target: 'harm', 'help' or 'any' (scripts)
function botIntent(list) {
    let intent = 'any';
    for (const fx of [].concat(list || [])) {
        if (typeof fx === 'function' || !fx || (fx.to && fx.to !== 'target')) continue;
        if (['damage', 'destroy', 'silence', 'freeze', 'transform', 'bounce'].includes(fx.do)) return 'harm';
        if (['heal', 'buff'].includes(fx.do)) intent = 'help';
    }
    return intent;
}

function botTargetAmount(list, kind) {
    for (const fx of [].concat(list || [])) if (fx && fx.do === kind && (!fx.to || fx.to === 'target') && typeof fx.amount === 'number') return fx.amount;
    return null;
}

function botPickTarget(g, pi, list, uids, extra, rand) {
    const ents = uids.map(uid => findEntity(g, uid)).filter(Boolean);
    const enemy = ents.filter(e => e.owner !== pi), mine = ents.filter(e => e.owner === pi);
    const intent = botIntent(list);
    const byValue = arr => arr.slice().sort((a, b) => botValue(b) - botValue(a));
    if (intent === 'harm') {
        if (!enemy.length) return null;
        const minions = enemy.filter(e => e.zone === 'board');
        const dmg = botTargetAmount(list, 'damage');
        if (dmg != null) {
            const killable = minions.filter(e => !e.shield && e.hp <= dmg + extra);
            if (killable.length) return byValue(killable)[0].uid;
            const face = enemy.find(e => e.zone === 'hero');
            if (face) return face.uid;
        }
        return minions.length ? byValue(minions)[0].uid : enemy[0].uid;
    }
    if (intent === 'help') {
        if (!mine.length) return null;
        if (botTargetAmount(list, 'heal') != null) {
            const hurt = mine.filter(e => e.damage > 0).sort((a, b) => b.damage - a.damage);
            return hurt.length ? hurt[0].uid : null;
        }
        const minions = mine.filter(e => e.zone === 'board');
        return minions.length ? byValue(minions)[0].uid : null;
    }
    return uids[Math.floor(rand() * uids.length)];
}

// Untargeted cards that would obviously be wasted (or hurt us) are skipped
function botWorthIt(g, pi, list) {
    const me = g.players[pi], opp = g.players[1 - pi];
    const minions = p => p.board.filter(m => m.zone === 'board').length;
    for (const fx of [].concat(list || [])) {
        if (!fx || typeof fx === 'function') continue;
        if (fx.do === 'damage' && fx.to === 'enemyMinions' && !minions(opp)) return false;
        if (fx.do === 'damage' && fx.to === 'allMinions' && minions(opp) <= minions(me)) return false;
        if (fx.do === 'heal' && fx.to === 'myHero' && me.hero.damage < 3) return false;
        if (fx.do === 'draw' && me.hand.length >= 8) return false;
        if (fx.do === 'summon' && me.board.length >= RULES.boardLimit) return false;
    }
    return true;
}

function botPlay(g, pi, rand) {
    const p = g.players[pi];
    let best = null;
    for (const card of p.hand) {
        const info = playInfo(g, pi, card);
        if (!info.ok) continue;
        const def = CARDS[card.cardId];
        if (card.cardId === 'coin' && !p.hand.some(c => c !== card && c.cost === p.mana + 1)) continue;
        const action = { type: 'play', uid: card.uid };
        let t = info, list = def.type === 'spell' ? def.play : def.battlecry;
        if (info.options) {
            const i = info.options.findIndex((o, k) => o.ok && botWorthIt(g, pi, def.chooseOne[k].effects));
            if (i < 0) continue;
            action.choice = i; t = info.options[i]; list = def.chooseOne[i].effects;
        }
        if (!list && def.combo && p.cardsPlayed > 0) list = def.combo;
        if (def.type === 'minion' || def.type === 'location') action.pos = p.board.length;
        if (t.need) {
            let target = botPickTarget(g, pi, list, t.targets, def.type === 'spell' ? spellPower(g, pi) : 0, rand);
            if (target == null && def.type === 'spell') continue;
            if (target == null) target = t.targets[Math.floor(rand() * t.targets.length)]; // a minion's Battlecry must take a target
            action.target = target;
        } else if (def.type === 'spell' && !def.secret && !botWorthIt(g, pi, list)) continue;
        const score = card.cost * 10 + (def.type === 'minion' ? 5 : 0) + rand();
        if (!best || score > best.score) best = { score, action };
    }
    return best ? best.action : null;
}

function botAttack(g, pi) {
    const p = g.players[pi], face = g.players[1 - pi].hero;
    for (const e of p.board.concat([p.hero])) {
        const ts = attackTargets(g, pi, e);
        if (!ts.length) continue;
        const canFace = ts.includes(face);
        let best = null, bestScore = 0;
        for (const t of ts) {
            if (t.zone !== 'board') continue;
            const kills = !t.shield && (e.atk >= t.hp || (e.kw && e.kw.poisonous));
            const dies = t.atk > 0 && !(e.zone === 'board' && e.shield) && (t.atk >= e.hp || (t.kw && t.kw.poisonous && e.zone === 'board'));
            let s = 0;
            if (kills && !dies) s = 10 + botValue(t);
            else if (kills && dies && botValue(t) > botValue(e)) s = 5 + botValue(t) - botValue(e);
            else if (!canFace) s = 1 + (kills ? 3 : 0) - (dies ? 1 : 0);
            if (e.zone === 'hero' && t.atk >= e.hp + e.armor) s = 0;
            if (s > bestScore) { bestScore = s; best = t; }
        }
        if (best && (!canFace || (bestScore >= 10 && best.atk >= 2))) return { type: 'attack', attacker: e.uid, target: best.uid };
        if (canFace) return { type: 'attack', attacker: e.uid, target: face.uid };
        if (best) return { type: 'attack', attacker: e.uid, target: best.uid };
    }
    return null;
}

// Uses a ready location when its effect looks worth it
function botLocation(g, pi, rand) {
    for (const loc of g.players[pi].board) {
        const info = activateInfo(g, pi, loc);
        if (!info.ok) continue;
        const list = CARDS[loc.cardId].activate;
        if (!info.need) { if (botWorthIt(g, pi, list)) return { type: 'activate', uid: loc.uid }; continue; }
        const target = botPickTarget(g, pi, list, info.targets, 0, rand);
        if (target != null) return { type: 'activate', uid: loc.uid, target };
    }
    return null;
}

function botPower(g, pi, rand) {
    const info = powerInfo(g, pi);
    if (!info.ok) return null;
    if (!info.need) return { type: 'power' };
    const target = botPickTarget(g, pi, HEROES[g.players[pi].heroId].power.effects, info.targets, 0, rand);
    return target == null ? null : { type: 'power', target };
}
