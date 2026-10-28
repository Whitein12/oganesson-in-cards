// ==========================================
// mechanics.test.js - One focused scenario per rule / keyword, on boards built with test-only cards
// ==========================================

const { load, assert, eq, runTests } = require('./harness');

function makeSuite() {
    const E = load();
    const { Engine, RULES } = E;

    E.defineHeroes([{ id: 't_hero', name: 'Tester', class: 'neutral',
        power: { name: 'Ping', cost: 2, text: 'Deal 1 damage.', target: 'any', effects: [{ do: 'damage', to: 'target', amount: 1 }] } }]);
    E.defineCards([
        { id: 't_filler', type: 'minion', cost: 9, atk: 1, hp: 1 },
        { id: 't_22', type: 'minion', cost: 1, atk: 2, hp: 2 },
        { id: 't_33', type: 'minion', cost: 3, atk: 3, hp: 3 },
        { id: 't_taunt', type: 'minion', cost: 1, atk: 1, hp: 3, keywords: ['taunt'] },
        { id: 't_stealth_taunt', type: 'minion', cost: 1, atk: 1, hp: 3, keywords: ['taunt', 'stealth'] },
        { id: 't_shield', type: 'minion', cost: 1, atk: 1, hp: 1, keywords: ['divineShield'] },
        { id: 't_poison', type: 'minion', cost: 1, atk: 1, hp: 3, keywords: ['poisonous'] },
        { id: 't_lifesteal', type: 'minion', cost: 1, atk: 3, hp: 3, keywords: ['lifesteal'] },
        { id: 't_wind', type: 'minion', cost: 1, atk: 2, hp: 5, keywords: ['windfury'] },
        { id: 't_charge', type: 'minion', cost: 1, atk: 2, hp: 1, keywords: ['charge'] },
        { id: 't_rush', type: 'minion', cost: 1, atk: 2, hp: 2, keywords: ['rush'] },
        { id: 't_cant', type: 'minion', cost: 1, atk: 4, hp: 4, keywords: ['cantAttack'] },
        { id: 't_elusive', type: 'minion', cost: 1, atk: 2, hp: 2, keywords: ['elusive'] },
        { id: 't_stealth', type: 'minion', cost: 1, atk: 2, hp: 2, keywords: ['stealth'] },
        { id: 't_freezer', type: 'minion', cost: 1, atk: 1, hp: 4, keywords: ['freeze'] },
        { id: 't_dr', type: 'minion', cost: 1, atk: 1, hp: 1, deathrattle: [{ do: 'summon', card: 't_22', count: 2 }] },
        { id: 't_aura', type: 'minion', cost: 1, atk: 1, hp: 1, aura: { to: 'otherMyMinions', atk: 1, hp: 1 } },
        { id: 't_reborn', type: 'minion', cost: 1, atk: 2, hp: 2, keywords: ['reborn'] },
        { id: 't_sd', type: 'minion', cost: 1, atk: 0, hp: 2, spellDamage: 1 },
        { id: 't_brute', type: 'minion', cost: 1, atk: 1, hp: 6, triggers: [{ on: 'damaged', who: 'self', effects: [{ do: 'buff', to: 'self', atk: 1 }] }] },
        { id: 't_endheal', type: 'minion', cost: 1, atk: 1, hp: 1, triggers: [{ on: 'turnEnd', who: 'friendly', effects: [{ do: 'heal', to: 'myHero', amount: 2 }] }] },
        { id: 't_burst', type: 'minion', cost: 1, atk: 1, hp: 3, spellburst: [{ do: 'armor', amount: 2 }] },
        { id: 't_cat', type: 'minion', cost: 1, atk: 0, hp: 3, keywords: ['catalyst'] },
        { id: 't_bc', type: 'minion', cost: 1, atk: 1, hp: 1, battlecry: [{ do: 'armor', amount: 2 }] },
        { id: 't_combo', type: 'minion', cost: 0, atk: 1, hp: 1, target: 'any', targetIf: 'combo', combo: [{ do: 'damage', to: 'target', amount: 2 }] },
        { id: 't_bolt', type: 'spell', cost: 1, target: 'any', play: [{ do: 'damage', to: 'target', amount: 3 }] },
        { id: 't_overload', type: 'spell', cost: 1, overload: 2, play: [{ do: 'armor', amount: 1 }] },
        { id: 't_discover', type: 'spell', cost: 0, play: [
            { do: 'damage', to: 'enemyHero', amount: 1 },
            { do: 'discover', pool: ['t_22', 't_33', 't_taunt', 't_shield', 't_rush'] },
            { do: 'damage', to: 'enemyHero', amount: 1 } ] },
        { id: 't_secret', type: 'spell', cost: 1, secret: { on: 'attack', who: 'enemy', targetIs: 'myHero', effects: [{ do: 'armor', amount: 5 }] } },
        { id: 't_weapon', type: 'weapon', cost: 1, atk: 3, durability: 2 },
        { id: 't_choose', type: 'spell', cost: 0, chooseOne: [
            { name: 'Armor', text: 'Gain 3 Armor.', effects: [{ do: 'armor', amount: 3 }] },
            { name: 'Draw', text: 'Draw a card.', effects: [{ do: 'draw', amount: 1 }] } ] },
        { id: 't_silence', type: 'spell', cost: 0, target: 'minion', play: [{ do: 'silence', to: 'target' }] },
        { id: 't_transform', type: 'spell', cost: 0, target: 'minion', play: [{ do: 'transform', to: 'target', into: 't_22' }] },
        { id: 't_bounce', type: 'spell', cost: 0, target: 'minion', play: [{ do: 'bounce', to: 'target' }] },
        { id: 't_aoe', type: 'spell', cost: 0, play: [{ do: 'damage', to: 'allMinions', amount: 2 }] },
        { id: 't_buffall', type: 'spell', cost: 0, target: 'minion', play: [{ do: 'buff', to: 'target', atk: 2, hp: 2, keywords: ['taunt'] }] },
        { id: 't_grant', type: 'spell', cost: 0, target: 'friendlyMinion', play: [{ do: 'buff', to: 'target', deathrattle: [{ do: 'summon', card: 't_33' }] }] },
        { id: 't_script', type: 'spell', cost: 0, play: [api => api.damage(api.opp.hero, api.me.hand.length)] },
        { id: 't_both', type: 'spell', cost: 0, play: [api => api.damage([api.me.hero, api.opp.hero], 50)] },
        { id: 't_nextcost', type: 'spell', cost: 0, play: [{ do: 'nextCost', amount: -2, filter: { type: 'spell' } }] },
        { id: 't_watch', type: 'minion', cost: 1, atk: 0, hp: 5, triggers: [
            { on: 'summoned', effects: [{ do: 'armor', amount: 1 }] }, { on: 'minionDied', effects: [{ do: 'armor', amount: 10 }] }] },
        { id: 't_loc', type: 'location', cost: 1, durability: 2, activate: [{ do: 'armor', amount: 2 }] },
        { id: 't_loc_buff', type: 'location', cost: 1, durability: 3, target: 'friendlyMinion', activate: [{ do: 'buff', to: 'target', atk: 1, hp: 1 }] },
        { id: 't_loc_summon', type: 'location', cost: 1, durability: 3, activate: [{ do: 'summon', card: 't_22' }] },
    ]);

    const TDECK = n => ({ id: 't_deck', name: 'Test', hero: 't_hero', cards: { t_filler: n } });

    // A game on player 0's first turn with the given hands and (awake) boards and 10 mana each
    function setup(o = {}) {
        const g = Engine.newGame({ seed: o.seed || 7, first: 0, players: [{ name: 'A', deck: TDECK(30) }, { name: 'B', deck: TDECK(30) }] });
        act(g, 0, { type: 'mulligan', replace: [] });
        act(g, 1, { type: 'mulligan', replace: [] });
        for (const i of [0, 1]) {
            const p = g.players[i];
            p.hand = ((o.hands || [])[i] || []).map(id => E.makeCard(g, id, i, 'hand'));
            p.board = [];
            for (const id of (o.boards || [])[i] || []) {
                const m = E.makeCard(g, id, i, 'board');
                if (E.CARDS[id].type === 'location') E.placeLocation(g, i, m);
                else { E.placeMinion(g, i, m); m.sleeping = false; }
            }
            p.mana = p.maxMana = o.mana != null ? o.mana : 10;
        }
        E.refresh(g);
        return g;
    }
    function act(g, pi, a) {
        const r = Engine.apply(g, pi, a);
        if (!r.ok) throw new Error('Action failed (' + r.error + '): ' + JSON.stringify(a));
        return r;
    }
    function bad(g, pi, a) {
        const r = Engine.apply(g, pi, a);
        assert(!r.ok, 'expected this action to fail: ' + JSON.stringify(a));
        return r.error;
    }
    const B = (g, i, k) => g.players[i].board[k];
    const H = (g, i) => g.players[i].hero;
    const card = (g, i, id) => g.players[i].hand.find(c => c.cardId === id);
    const end = g => act(g, g.current, { type: 'end' });
    const attack = (g, a, t) => act(g, a.owner, { type: 'attack', attacker: a.uid, target: t.uid });
    const play = (g, i, id, extra) => act(g, i, Object.assign({ type: 'play', uid: card(g, i, id).uid }, extra || {}));

    const tests = [];
    const test = (name, fn) => tests.push({ name, fn });

    test('demo decks and cards are valid', () => {
        const problems = E.validateAll().filter(p => !p.startsWith('Test'));
        eq(problems.length, 0, problems.join('; '));
    });

    test('deck validation copes with hostile deck lists', () => {
        const cards = JSON.parse('{"toString": 2, "__proto__": 1, "constructor": 1, "demo_fire_bolt": 1000000000}');
        const problems = E.validateDeck({ name: 'Bad', hero: 'demo_ember', cards });
        assert(problems.some(p => p.includes('Unknown card "toString"')), 'toString is not a card');
        assert(problems.some(p => p.includes('Unknown card "__proto__"')), '__proto__ is not a card');
        assert(problems.some(p => p.includes('copies of Fire Bolt')), 'absurd counts are capped and reported');
        assert(E.validateDeck({ name: 'Bad', hero: 'toString', cards: {} }).some(p => p.includes('Unknown hero')), 'toString is not a hero');
        eq(E.deckCounts({ cards: ['a', 'b', 'a'] }).a, 2);
        eq(E.deckCounts({ cards: { a: 2, b: 1 } }).b, 1);
    });

    test('opening hands, mulligan, The Coin and mana growth', () => {
        const g = Engine.newGame({ seed: 3, first: 0, players: [{ deck: 'demo_aggro' }, { deck: 'demo_control' }] });
        eq(g.phase, 'mulligan'); eq(g.players[0].hand.length, 3); eq(g.players[1].hand.length, 4);
        const before = g.players[0].hand.map(c => c.uid);
        act(g, 0, { type: 'mulligan', replace: [before[0], before[2]] });
        eq(g.players[0].hand.length, 3); eq(g.players[0].deck.length, 27);
        assert(!g.players[0].hand.some(c => c.uid === before[0]), 'replaced card left the hand');
        eq(g.players[0].hand[1].uid, before[1], 'kept card stays in its slot');
        bad(g, 0, { type: 'end' });
        act(g, 1, { type: 'mulligan', replace: [] });
        eq(g.phase, 'main'); eq(g.current, 0); eq(g.turn, 1);
        eq(g.players[0].mana, 1); eq(g.players[0].hand.length, 4);
        assert(g.players[1].hand.some(c => c.cardId === 'coin'), 'second player has The Coin');
        for (let i = 0; i < 25; i++) end(g);
        eq(g.players[0].maxMana, 10); eq(g.players[1].maxMana, 10);
    });

    test('only the current player can act', () => {
        const g = setup({ hands: [['t_22'], ['t_22']] });
        bad(g, 1, { type: 'end' });
        bad(g, 1, { type: 'play', uid: card(g, 1, 't_22').uid });
        play(g, 0, 't_22');
        end(g);
        bad(g, 0, { type: 'end' });
        act(g, 1, { type: 'end' });
    });

    test('The Coin gives one mana this turn only', () => {
        const g = setup({ hands: [['coin']], mana: 0 });
        play(g, 0, 'coin');
        eq(g.players[0].mana, 1);
        end(g); end(g);
        eq(g.players[0].mana, 1, 'next turn uses the normal crystals');
    });

    test('Taunt forces attacks; a stealthed Taunt does not', () => {
        const g = setup({ boards: [['t_22', 't_22'], ['t_taunt']] });
        bad(g, 0, { type: 'attack', attacker: B(g, 0, 0).uid, target: H(g, 1).uid });
        attack(g, B(g, 0, 0), B(g, 1, 0));
        const h = setup({ boards: [['t_22'], ['t_stealth_taunt']] });
        attack(h, B(h, 0, 0), H(h, 1));
        eq(H(h, 1).hp, 28);
    });

    test('Divine Shield ignores the first damage', () => {
        const g = setup({ boards: [['t_22'], ['t_shield']] });
        attack(g, B(g, 0, 0), B(g, 1, 0));
        eq(B(g, 1, 0).shield, false); eq(B(g, 1, 0).hp, 1); eq(B(g, 0, 0).hp, 1);
    });

    test('Poisonous destroys damaged minions', () => {
        const g = setup({ boards: [['t_poison'], ['t_33']] });
        attack(g, B(g, 0, 0), B(g, 1, 0));
        eq(g.players[1].board.length, 0); eq(g.players[0].board.length, 0);
    });

    test('Lifesteal heals the hero', () => {
        const g = setup({ boards: [['t_lifesteal'], []] });
        H(g, 0).damage = 5; E.refresh(g);
        attack(g, B(g, 0, 0), H(g, 1));
        eq(H(g, 0).hp, 28); eq(H(g, 1).hp, 27);
    });

    test('Windfury attacks twice, others once', () => {
        const g = setup({ boards: [['t_wind', 't_22'], []] });
        attack(g, B(g, 0, 0), H(g, 1)); attack(g, B(g, 0, 0), H(g, 1));
        bad(g, 0, { type: 'attack', attacker: B(g, 0, 0).uid, target: H(g, 1).uid });
        attack(g, B(g, 0, 1), H(g, 1));
        bad(g, 0, { type: 'attack', attacker: B(g, 0, 1).uid, target: H(g, 1).uid });
        eq(H(g, 1).hp, 24);
    });

    test('Summoning sickness, Charge and Rush', () => {
        const g = setup({ hands: [['t_22', 't_charge', 't_rush'], []], boards: [[], ['t_33']] });
        play(g, 0, 't_22'); play(g, 0, 't_charge'); play(g, 0, 't_rush');
        bad(g, 0, { type: 'attack', attacker: B(g, 0, 0).uid, target: H(g, 1).uid });
        attack(g, B(g, 0, 1), H(g, 1));
        bad(g, 0, { type: 'attack', attacker: B(g, 0, 2).uid, target: H(g, 1).uid });
        attack(g, B(g, 0, 2), B(g, 1, 0));
    });

    test("Can't Attack", () => {
        const g = setup({ boards: [['t_cant'], []] });
        bad(g, 0, { type: 'attack', attacker: B(g, 0, 0).uid, target: H(g, 1).uid });
    });

    test('Freeze skips the next attack (frozen on own turn after attacking)', () => {
        const g = setup({ boards: [['t_22'], ['t_freezer']] });
        attack(g, B(g, 0, 0), B(g, 1, 0));
        assert(B(g, 0, 0).frozen, 'attacker frozen');
        end(g); end(g);
        assert(B(g, 0, 0).frozen, 'still frozen on the next own turn');
        bad(g, 0, { type: 'attack', attacker: B(g, 0, 0).uid, target: H(g, 1).uid });
        end(g);
        assert(!B(g, 0, 0).frozen, 'thawed at the end of that turn');
        end(g);
        attack(g, B(g, 0, 0), H(g, 1));
    });

    test('Freeze skips the next attack (frozen on the enemy turn)', () => {
        const g = setup({ boards: [['t_22'], ['t_freezer']] });
        end(g);
        attack(g, B(g, 1, 0), B(g, 0, 0));
        assert(B(g, 0, 0).frozen);
        end(g);
        bad(g, 0, { type: 'attack', attacker: B(g, 0, 0).uid, target: H(g, 1).uid });
        end(g);
        assert(!B(g, 0, 0).frozen);
    });

    test('Stealth blocks targeting and attacks, and breaks after attacking', () => {
        const g = setup({ hands: [['t_bolt'], []], boards: [['t_22', 't_stealth'], ['t_stealth']] });
        bad(g, 0, { type: 'play', uid: card(g, 0, 't_bolt').uid, target: B(g, 1, 0).uid });
        bad(g, 0, { type: 'attack', attacker: B(g, 0, 0).uid, target: B(g, 1, 0).uid });
        attack(g, B(g, 0, 1), H(g, 1));
        eq(B(g, 0, 1).stealth, false);
    });

    test('Elusive: no spells or hero powers, attacks are fine', () => {
        const g = setup({ hands: [['t_bolt'], []], boards: [['t_22'], ['t_elusive']] });
        bad(g, 0, { type: 'play', uid: card(g, 0, 't_bolt').uid, target: B(g, 1, 0).uid });
        bad(g, 0, { type: 'power', target: B(g, 1, 0).uid });
        attack(g, B(g, 0, 0), B(g, 1, 0));
    });

    test('Fatigue grows by one each empty draw', () => {
        const g = setup();
        g.players[0].deck = [];
        end(g); end(g);
        eq(H(g, 0).hp, 29);
        end(g); end(g);
        eq(H(g, 0).hp, 27);
    });

    test('Drawing into a full hand burns the card', () => {
        const g = setup({ hands: [Array(10).fill('t_22'), []] });
        const deck = g.players[0].deck.length;
        const r = end(g) && act(g, 1, { type: 'end' });
        eq(g.players[0].hand.length, 10); eq(g.players[0].deck.length, deck - 1);
        assert(r.events.some(e => e.t === 'burn' && e.p === 0), 'burn event');
    });

    test('Board limit of 7', () => {
        const g = setup({ hands: [['t_22', 't_bolt'], []], boards: [['t_dr', 't_22', 't_22', 't_22', 't_22', 't_22', 't_22'], []] });
        bad(g, 0, { type: 'play', uid: card(g, 0, 't_22').uid });
        play(g, 0, 't_bolt', { target: B(g, 0, 0).uid });
        eq(g.players[0].board.length, 7, 'one deathrattle token fits, the second does not');
    });

    test('Deathrattle summons where the minion died', () => {
        const g = setup({ hands: [['t_bolt'], []], boards: [['t_33', 't_dr', 't_33'], []] });
        const dr = B(g, 0, 1);
        play(g, 0, 't_bolt', { target: dr.uid });
        eq(g.players[0].board.map(m => m.cardId).join(), 't_33,t_22,t_22,t_33');
    });

    test('Auras: bonus while the source lives; losing Health does not kill', () => {
        const g = setup({ hands: [['t_bolt'], []], boards: [['t_aura', 't_22'], []] });
        const m = B(g, 0, 1);
        eq(m.atk, 3); eq(m.maxHp, 3);
        m.damage = 2; E.refresh(g);
        eq(m.hp, 1);
        play(g, 0, 't_bolt', { target: B(g, 0, 0).uid });
        eq(g.players[0].board.length, 1); eq(m.atk, 2); eq(m.maxHp, 2); eq(m.hp, 1);
    });

    test('Silence removes buffs, keywords and deathrattles', () => {
        const g = setup({ hands: [['t_buffall', 't_silence', 't_bolt'], []], boards: [['t_dr'], []] });
        const m = B(g, 0, 0);
        play(g, 0, 't_buffall', { target: m.uid });
        eq(m.atk, 3); assert(m.kw.taunt);
        play(g, 0, 't_silence', { target: m.uid });
        eq(m.atk, 1); eq(m.maxHp, 1); assert(!m.kw.taunt);
        play(g, 0, 't_bolt', { target: m.uid });
        eq(g.players[0].board.length, 0, 'no deathrattle after silence');
    });

    test('Reborn comes back once with 1 Health', () => {
        const g = setup({ hands: [['t_bolt', 't_bolt'], []], boards: [[], ['t_reborn']] });
        play(g, 0, 't_bolt', { target: B(g, 1, 0).uid });
        eq(g.players[1].board.length, 1); eq(B(g, 1, 0).hp, 1); eq(B(g, 1, 0).reborn, false);
        play(g, 0, 't_bolt', { target: B(g, 1, 0).uid });
        eq(g.players[1].board.length, 0);
    });

    test('Spell Damage boosts spells, not hero powers', () => {
        const g = setup({ hands: [['t_bolt'], []], boards: [['t_sd'], []] });
        play(g, 0, 't_bolt', { target: H(g, 1).uid });
        eq(H(g, 1).hp, 26);
        act(g, 0, { type: 'power', target: H(g, 1).uid });
        eq(H(g, 1).hp, 25);
    });

    test('Overload locks crystals next turn', () => {
        const g = setup({ hands: [['t_overload'], []] });
        play(g, 0, 't_overload');
        end(g); end(g);
        eq(g.players[0].maxMana, 10); eq(g.players[0].mana, 8); eq(g.players[0].overloadNow, 2);
        end(g); end(g);
        eq(g.players[0].mana, 10);
    });

    test('Combo only after another card this turn', () => {
        const g = setup({ hands: [['t_combo', 't_combo'], []] });
        const first = g.players[0].hand[0].uid;
        bad(g, 0, { type: 'play', uid: first, target: H(g, 1).uid });
        act(g, 0, { type: 'play', uid: first });
        eq(H(g, 1).hp, 30);
        play(g, 0, 't_combo', { target: H(g, 1).uid });
        eq(H(g, 1).hp, 28);
    });

    test('Spellburst triggers once, after your own spell', () => {
        const g = setup({ hands: [['t_bolt', 't_bolt'], ['t_bolt']], boards: [['t_burst'], []] });
        end(g);
        play(g, 1, 't_bolt', { target: H(g, 0).uid });
        eq(H(g, 0).armor, 0, 'enemy spells do not count'); eq(B(g, 0, 0).spellburst, true);
        end(g);
        play(g, 0, 't_bolt', { target: H(g, 1).uid });
        eq(H(g, 0).armor, 2); eq(B(g, 0, 0).spellburst, false);
        play(g, 0, 't_bolt', { target: H(g, 1).uid });
        eq(H(g, 0).armor, 2, 'used up');
    });

    test('Spellburst: secrets count, Silence removes it', () => {
        const g = setup({ hands: [['t_secret'], []], boards: [['t_burst'], []] });
        play(g, 0, 't_secret');
        eq(H(g, 0).armor, 2);
        const h = setup({ hands: [['t_silence', 't_bolt'], []], boards: [['t_burst'], []] });
        play(h, 0, 't_silence', { target: B(h, 0, 0).uid });
        play(h, 0, 't_bolt', { target: H(h, 1).uid });
        eq(H(h, 0).armor, 0); eq(B(h, 0, 0).spellburst, false);
    });

    test('Catalyst doubles the Battlecry of minions played next to it, every time', () => {
        const g = setup({ hands: [['t_bc', 't_bc', 't_bc'], []], boards: [['t_cat'], []] });
        play(g, 0, 't_bc', { pos: 0 });
        eq(H(g, 0).armor, 4);
        play(g, 0, 't_bc', { pos: 2 });
        eq(H(g, 0).armor, 8, 'not used up');
        play(g, 0, 't_bc', { pos: 0 });
        eq(H(g, 0).armor, 10, 'not next to it');
    });

    test('Catalyst: two neighbours do not stack; Silence removes it', () => {
        const g = setup({ hands: [['t_bc'], []], boards: [['t_cat', 't_cat'], []] });
        play(g, 0, 't_bc', { pos: 1 });
        eq(H(g, 0).armor, 4);
        const h = setup({ hands: [['t_silence', 't_bc'], []], boards: [['t_cat'], []] });
        play(h, 0, 't_silence', { target: B(h, 0, 0).uid });
        play(h, 0, 't_bc', { pos: 1 });
        eq(H(h, 0).armor, 2);
    });

    test('Locations: usable when played, closed for your next turn, open on the one after, break at 0 Durability', () => {
        const g = setup({ hands: [['t_loc'], []], boards: [['t_22'], []] });
        play(g, 0, 't_loc', { pos: 0 });
        const loc = B(g, 0, 0);
        eq(loc.zone, 'location'); eq(g.players[0].board.length, 2, 'takes a board slot');
        act(g, 0, { type: 'activate', uid: loc.uid });
        eq(H(g, 0).armor, 2); eq(loc.durability, 1);
        bad(g, 0, { type: 'activate', uid: loc.uid });
        end(g);
        bad(g, 1, { type: 'activate', uid: loc.uid });
        end(g);
        bad(g, 0, { type: 'activate', uid: loc.uid });
        eq(loc.durability, 1, 'still closed on your next turn');
        end(g); end(g);
        act(g, 0, { type: 'activate', uid: loc.uid });
        eq(H(g, 0).armor, 4);
        eq(g.players[0].board.map(m => m.cardId).join(), 't_22', 'destroyed at 0 Durability');
        assert(g.players[0].grave.includes('t_loc'), 'in the graveyard');
    });

    test('Locations are not minions: no attacks, targets, minion effects or minion triggers', () => {
        const g = setup({ hands: [['t_bolt', 't_aoe', 't_silence'], []], boards: [['t_22'], ['t_loc', 't_22']] });
        const loc = B(g, 1, 0);
        bad(g, 0, { type: 'attack', attacker: B(g, 0, 0).uid, target: loc.uid });
        bad(g, 0, { type: 'play', uid: card(g, 0, 't_bolt').uid, target: loc.uid });
        bad(g, 0, { type: 'play', uid: card(g, 0, 't_silence').uid, target: loc.uid });
        assert(!Engine.legalActions(g, 0).some(a => a.target === loc.uid), 'never a legal target');
        play(g, 0, 't_aoe');
        eq(g.players[1].board.map(m => m.cardId).join(), 't_loc', 'AoE skips it'); eq(loc.durability, 2);
        const h = setup({ hands: [['t_22'], []], boards: [['t_loc', 't_22', 't_22', 't_22', 't_22', 't_22', 't_22'], []] });
        bad(h, 0, { type: 'play', uid: card(h, 0, 't_22').uid });
        const w = setup({ hands: [['t_loc'], []], boards: [['t_watch'], []] });
        play(w, 0, 't_loc');
        act(w, 0, { type: 'activate', uid: B(w, 0, 1).uid });
        end(w); end(w); end(w); end(w);
        act(w, 0, { type: 'activate', uid: B(w, 0, 1).uid });
        eq(w.players[0].board.length, 1);
        eq(H(w, 0).armor, 4, 'no summon or death triggers');
    });

    test('Location targets and summons', () => {
        const g = setup({ hands: [['t_22'], []], boards: [['t_loc_buff'], ['t_33']] });
        const loc = B(g, 0, 0);
        assert(!Engine.activateInfo(g, 0, loc).ok, 'no friendly minion to target');
        play(g, 0, 't_22');
        bad(g, 0, { type: 'activate', uid: loc.uid });
        bad(g, 0, { type: 'activate', uid: loc.uid, target: B(g, 1, 0).uid });
        act(g, 0, { type: 'activate', uid: loc.uid, target: B(g, 0, 1).uid });
        eq(B(g, 0, 1).atk, 3); eq(B(g, 0, 1).maxHp, 3);
        const s = setup({ boards: [['t_33', 't_loc_summon', 't_33'], []] });
        act(s, 0, { type: 'activate', uid: B(s, 0, 1).uid });
        eq(s.players[0].board.map(m => m.cardId).join(), 't_33,t_loc_summon,t_22,t_33', 'summoned right of the location');
        const full = setup({ boards: [['t_loc_summon', 't_22', 't_22', 't_22', 't_22', 't_22', 't_22'], []] });
        bad(full, 0, { type: 'activate', uid: B(full, 0, 0).uid });
    });

    test('Discover pauses the action and replays it deterministically', () => {
        const g = setup({ hands: [['t_discover'], []] });
        const r1 = play(g, 0, 't_discover');
        assert(g.pending, 'pending choice'); eq(g.pending.player, 0); eq(g.pending.options.length, 3);
        eq(H(g, 1).hp, 29, 'the part before the choice already happened');
        eq(new Set(g.pending.options).size, 3, 'distinct options');
        assert(r1.events.some(e => e.t === 'discover'), 'discover event');
        const v1 = Engine.viewFor(g, 1);
        eq(v1.pending.options, null, 'opponent does not see the options'); assert(!('snapshot' in v1.pending));
        bad(g, 0, { type: 'end' });
        bad(g, 1, { type: 'choose', index: 0 });
        const options = g.pending.options.slice();
        const copy = JSON.parse(JSON.stringify(g));
        const r2 = act(g, 0, { type: 'choose', index: 1 });
        eq(g.pending, null); eq(H(g, 1).hp, 28, 'both damages once');
        assert(g.players[0].hand.some(c => c.cardId === options[1]), 'picked card in hand');
        eq(r2.events.filter(e => e.t === 'damage').length, 1, 'events already shown are not repeated');
        eq(r2.events.filter(e => e.t === 'discover').length, 0);
        const r3 = Engine.apply(copy, 0, { type: 'choose', index: 1 });
        assert(r3.ok);
        eq(JSON.stringify(copy), JSON.stringify(g), 'the same choice gives the same state');
    });

    test('Secrets trigger only on the opponent\'s turn', () => {
        const g = setup({ hands: [['t_secret'], []], boards: [['t_22'], ['t_33']] });
        play(g, 0, 't_secret');
        eq(g.players[0].secrets.length, 1);
        assert(Engine.viewFor(g, 1).players[0].secrets[0].hidden, 'hidden from the opponent');
        attack(g, B(g, 0, 0), H(g, 1));
        eq(g.players[0].secrets.length, 1);
        end(g);
        const r = attack(g, B(g, 1, 0), H(g, 0));
        eq(g.players[0].secrets.length, 0); eq(H(g, 0).armor, 2); eq(H(g, 0).hp, 30);
        assert(r.events.some(e => e.t === 'reveal'), 'reveal event');
    });

    test('Weapons: hero attacks, durability, minions hit back', () => {
        const g = setup({ hands: [['t_weapon'], []], boards: [[], ['t_33']] });
        play(g, 0, 't_weapon');
        eq(H(g, 0).atk, 3);
        attack(g, H(g, 0), B(g, 1, 0));
        eq(g.players[1].board.length, 0); eq(H(g, 0).hp, 27); eq(g.players[0].weapon.durability, 1);
        bad(g, 0, { type: 'attack', attacker: H(g, 0).uid, target: H(g, 1).uid });
        end(g); end(g);
        attack(g, H(g, 0), H(g, 1));
        eq(g.players[0].weapon, null); eq(H(g, 0).atk, 0); eq(H(g, 1).hp, 27);
    });

    test('Armor absorbs damage first', () => {
        const g = setup({ hands: [['t_bolt'], []] });
        H(g, 1).armor = 5;
        play(g, 0, 't_bolt', { target: H(g, 1).uid });
        eq(H(g, 1).armor, 2); eq(H(g, 1).hp, 30);
    });

    test('Choose One', () => {
        const g = setup({ hands: [['t_choose', 't_choose'], []] });
        bad(g, 0, { type: 'play', uid: g.players[0].hand[0].uid });
        play(g, 0, 't_choose', { choice: 0 });
        eq(H(g, 0).armor, 3);
        const hand = g.players[0].hand.length;
        play(g, 0, 't_choose', { choice: 1 });
        eq(g.players[0].hand.length, hand, 'played one, drew one');
    });

    test('Hero Power: once per turn, costs mana', () => {
        const g = setup();
        act(g, 0, { type: 'power', target: H(g, 1).uid });
        eq(H(g, 1).hp, 29); eq(g.players[0].mana, 8);
        bad(g, 0, { type: 'power', target: H(g, 1).uid });
        bad(g, 0, { type: 'power' });
        end(g); end(g);
        act(g, 0, { type: 'power', target: H(g, 1).uid });
    });

    test('Damage and end-of-turn triggers', () => {
        const g = setup({ hands: [['t_aoe'], []], boards: [['t_brute', 't_endheal'], ['t_22']] });
        attack(g, B(g, 0, 0), B(g, 1, 0));
        eq(B(g, 0, 0).atk, 2);
        H(g, 0).damage = 5; E.refresh(g);
        end(g);
        eq(H(g, 0).hp, 27);
    });

    test('Transform and Bounce', () => {
        const g = setup({ hands: [['t_transform', 't_bounce'], []], boards: [[], ['t_33', 't_33']] });
        const old = B(g, 1, 0).uid;
        play(g, 0, 't_transform', { target: old });
        eq(B(g, 1, 0).cardId, 't_22'); assert(B(g, 1, 0).uid !== old);
        play(g, 0, 't_bounce', { target: B(g, 1, 1).uid });
        eq(g.players[1].board.length, 1);
        assert(g.players[1].hand.some(c => c.cardId === 't_33'), 'returned to hand');
    });

    test('AoE kills together, then deathrattles resolve', () => {
        const g = setup({ hands: [['t_aoe'], []], boards: [['t_dr', 't_22'], ['t_dr']] });
        play(g, 0, 't_aoe');
        eq(g.players[0].board.map(m => m.cardId).join(), 't_22,t_22');
        eq(g.players[1].board.map(m => m.cardId).join(), 't_22,t_22');
    });

    test('A buff can grant a deathrattle', () => {
        const g = setup({ hands: [['t_grant', 't_bolt'], []], boards: [['t_22'], []] });
        play(g, 0, 't_grant', { target: B(g, 0, 0).uid });
        play(g, 0, 't_bolt', { target: B(g, 0, 0).uid });
        eq(g.players[0].board.map(m => m.cardId).join(), 't_33');
    });

    test('Script effects get the API', () => {
        const g = setup({ hands: [['t_script', 't_22', 't_22'], []] });
        play(g, 0, 't_script');
        eq(H(g, 1).hp, 28);
    });

    test('Cost auras and "next spell" discounts', () => {
        const g = setup({ hands: [['t_bolt', 't_nextcost', 't_22'], []], boards: [['demo_rune_scribe'], []] });
        eq(card(g, 0, 't_bolt').cost, 0); eq(card(g, 0, 't_22').cost, 1);
        g.players[0].board = []; E.refresh(g);
        eq(card(g, 0, 't_bolt').cost, 1);
        play(g, 0, 't_nextcost');
        eq(card(g, 0, 't_bolt').cost, 0);
        play(g, 0, 't_bolt', { target: H(g, 1).uid });
        eq(g.players[0].auras.length, 0, 'discount used up');
    });

    test('Game over: hero death, a draw, concede', () => {
        const g = setup({ hands: [['t_bolt'], []] });
        H(g, 1).damage = 28; E.refresh(g);
        const r = play(g, 0, 't_bolt', { target: H(g, 1).uid });
        eq(g.phase, 'over'); eq(g.winner, 0); assert(r.events.some(e => e.t === 'over'));
        bad(g, 1, { type: 'end' });
        const d = setup({ hands: [['t_both'], []] });
        play(d, 0, 't_both');
        eq(d.winner, 'draw');
        const c = setup();
        act(c, 1, { type: 'concede' });
        eq(c.winner, 0);
    });

    test('Too many turns is a draw', () => {
        const old = RULES.maxTurns;
        RULES.maxTurns = 6;
        try {
            const g = setup();
            for (let i = 0; i < 10 && g.phase !== 'over'; i++) end(g);
            eq(g.phase, 'over'); eq(g.winner, 'draw');
        } finally { RULES.maxTurns = old; }
    });

    test('Views hide the hidden information', () => {
        const g = setup({ hands: [['t_secret', 't_22'], ['t_33']] });
        play(g, 0, 't_secret');
        const v = Engine.viewFor(g, 1);
        assert(!('rng' in v), 'rng hidden');
        assert(v.players[0].hand.every(c => c.hidden && !c.cardId), 'opponent hand hidden');
        assert(v.players[0].secrets.every(s => s.hidden && !s.cardId), 'opponent secrets hidden');
        assert(!v.players[0].deck && !v.players[1].deck, 'decks removed');
        eq(v.players[1].hand[0].cardId, 't_33', 'own hand visible');
        const json = JSON.stringify(v);
        assert(!json.includes('t_secret'), 'secret id not leaked');
        const evs = Engine.redactEvents([{ t: 'draw', p: 0, uid: 5, cardId: 'x' }, { t: 'draw', p: 1, uid: 6, cardId: 'y' }], 1);
        eq(evs[0].cardId, null); eq(evs[1].cardId, 'y');
    });

    test('Legality helpers agree with apply on views', () => {
        const g = setup({ hands: [['t_bolt', 't_22', 't_loc'], []], boards: [['t_22', 't_loc_buff'], ['t_taunt', 't_loc']] });
        const v = Engine.viewFor(g, 0);
        const acts = Engine.legalActions(v, 0);
        assert(acts.length > 3);
        assert(acts.some(a => a.type === 'activate'), 'location activations are listed');
        for (const a of acts) {
            const copy = JSON.parse(JSON.stringify(g));
            const r = Engine.apply(copy, 0, a);
            assert(r.ok, 'legal on the view but rejected: ' + JSON.stringify(a) + ' ' + r.error);
        }
    });

    return tests;
}

module.exports = () => runTests('mechanics', makeSuite());
if (require.main === module) module.exports().then(f => { process.exitCode = f ? 1 : 0; });
