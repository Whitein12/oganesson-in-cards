// ==========================================
// fuzz.test.js - Seeded bot-vs-bot games (random and greedy) with invariants checked after every action,
// replay determinism, view redaction, and coverage of every demo card.
// Usage: node tests/fuzz.test.js [games]
// ==========================================

const { load, assert, runTests, seededRand } = require('./harness');

function makeSuite(games) {
    const E = load();
    const { Engine, Bot, CARDS, DECKS, RULES } = E;
    const tests = [];
    const test = (name, fn) => tests.push({ name, fn });

    function checkInvariants(g, where) {
        const uids = new Set();
        const seen = e => { assert(!uids.has(e.uid), where + ': duplicate uid ' + e.uid); uids.add(e.uid); };
        for (const p of g.players) {
            assert(p.hand.length <= RULES.handLimit, where + ': hand over the limit');
            assert(p.board.length <= RULES.boardLimit, where + ': board over the limit');
            assert(p.secrets.length <= RULES.maxSecrets, where + ': too many secrets');
            assert(p.mana >= 0 && p.mana <= RULES.maxMana, where + ': mana out of range ' + p.mana);
            assert(p.maxMana >= 0 && p.maxMana <= RULES.maxMana, where + ': max mana out of range');
            assert(p.hero.hp <= p.hero.maxHp && p.hero.damage >= 0 && p.hero.armor >= 0, where + ': bad hero health');
            seen(p.hero); seen(p.power);
            if (p.weapon) { seen(p.weapon); assert(p.weapon.zone === 'weapon' && (g.pending || p.weapon.durability > 0), where + ': bad weapon'); }
            for (const c of p.hand) { seen(c); assert(c.zone === 'hand' && c.owner === p.index, where + ': bad hand card'); }
            for (const c of p.deck) { seen(c); assert(c.zone === 'deck' && c.owner === p.index, where + ': bad deck card'); }
            for (const s of p.secrets) { seen(s); assert(s.zone === 'secret', where + ': bad secret'); }
            for (const m of p.board) {
                seen(m);
                assert(m.zone === 'board' && m.owner === p.index, where + ': bad minion');
                assert(m.hp === m.maxHp - m.damage && m.damage >= 0, where + ': bad minion health');
                if (!g.pending) assert(m.hp > 0 && !m.destroyed, where + ': dead minion left on the board');
            }
        }
        assert(JSON.stringify(JSON.parse(JSON.stringify(g))) === JSON.stringify(g), where + ': state is not plain JSON');
    }

    function checkView(g, viewer, where) {
        const v = Engine.viewFor(g, viewer);
        const opp = v.players[1 - viewer];
        assert(!('rng' in v), where + ': rng in view');
        assert(opp.hand.every(c => c.hidden && c.cardId === undefined), where + ': opponent hand leaked');
        assert(opp.secrets.every(s => s.hidden && s.cardId === undefined), where + ': opponent secret leaked');
        assert(v.players.every(p => p.deck === undefined), where + ': deck leaked');
        if (v.pending) assert(!('snapshot' in v.pending) && (v.pending.player === viewer || v.pending.options === null), where + ': pending leaked');
        return v;
    }

    // Plays one game; returns { g, log, played } (log = the actions, for replays)
    function playGame(seed, modes) {
        const rand = seededRand(seed * 7919 + 13);
        const decks = [DECKS[seed % DECKS.length].id, DECKS[(seed >> 1) % DECKS.length].id];
        const g = Engine.newGame({ seed, players: [{ name: 'P1', deck: decks[0] }, { name: 'P2', deck: decks[1] }] });
        const log = [];
        const played = new Set();
        checkInvariants(g, 'seed ' + seed + ' start');
        for (let step = 0; g.phase !== 'over'; step++) {
            assert(step < 4000, 'seed ' + seed + ': game did not end');
            const pi = Engine.whoActs(g)[0];
            // player 1 sometimes decides from its redacted view, like a network guest
            const source = pi === 1 && step % 3 === 0 ? checkView(g, 1, 'seed ' + seed) : g;
            const a = Bot.act(source, pi, { mode: modes[pi], rand });
            assert(a, 'seed ' + seed + ': bot returned no action');
            const r = Engine.apply(g, pi, a);
            assert(r.ok, 'seed ' + seed + ' step ' + step + ': legal action rejected ' + JSON.stringify(a) + ': ' + r.error);
            for (const ev of r.events) if (ev.t === 'play' || ev.t === 'summon' || ev.t === 'addCard' || ev.t === 'equip') played.add(ev.cardId);
            log.push([pi, a]);
            checkInvariants(g, 'seed ' + seed + ' step ' + step);
        }
        return { g, log, played };
    }

    test('random and greedy bot games keep every invariant and finish', () => {
        const played = new Set();
        let turns = 0, draws = 0;
        const wins = [0, 0];
        for (let seed = 1; seed <= games; seed++) {
            const modes = seed % 3 === 0 ? ['greedy', 'greedy'] : seed % 3 === 1 ? ['random', 'random'] : ['greedy', 'random'];
            const r = playGame(seed, modes);
            for (const id of r.played) played.add(id);
            turns += r.g.turn;
            if (r.g.winner === 'draw') draws++; else wins[r.g.winner]++;
        }
        console.log('       ' + games + ' games, avg ' + (turns / games).toFixed(1) + ' turns, wins ' + wins.join('/') + ', draws ' + draws);
        const missing = Object.keys(CARDS).filter(id => CARDS[id].collectible && DECKS.some(d => d.cards[id]) && !played.has(id));
        assert(!missing.length, 'demo cards never played: ' + missing.join(', '));
    });

    test('replaying the same seed and actions gives the same game', () => {
        for (const seed of [5, 17, 42, 99]) {
            const a = playGame(seed, ['random', 'greedy']);
            const decks = [DECKS[seed % DECKS.length].id, DECKS[(seed >> 1) % DECKS.length].id];
            const g = Engine.newGame({ seed, players: [{ name: 'P1', deck: decks[0] }, { name: 'P2', deck: decks[1] }] });
            for (const [pi, act] of a.log) assert(Engine.apply(g, pi, act).ok, 'replay rejected an action');
            assert(JSON.stringify(g) === JSON.stringify(a.g), 'seed ' + seed + ': replay differs');
        }
    });

    test('greedy beats random most of the time', () => {
        let greedyWins = 0;
        const n = Math.max(20, Math.floor(games / 10));
        for (let seed = 1000; seed < 1000 + n; seed++) {
            const r = playGame(seed, seed % 2 ? ['greedy', 'random'] : ['random', 'greedy']);
            if (r.g.winner === (seed % 2 ? 0 : 1)) greedyWins++;
        }
        console.log('       greedy won ' + greedyWins + '/' + n);
        assert(greedyWins >= n * 0.6, 'the greedy bot should usually win');
    });

    return tests;
}

module.exports = games => runTests('fuzz', makeSuite(games || 300));
if (require.main === module) module.exports(Number(process.argv[2]) || 300).then(f => { process.exitCode = f ? 1 : 0; });
