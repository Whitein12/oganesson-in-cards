// ==========================================
// harness.js - Loads the engine and the card data into a Node vm context (the same plain scripts the page loads)
// and offers small helpers for building test boards.
// ==========================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ENGINE_FILES = [
    'js/rules.js', 'js/engine/core.js', 'js/engine/effects.js', 'js/engine/view.js', 'js/engine/actions.js', 'js/engine/bot.js',
    'js/data/keywords.js', 'js/data/heroes.js', 'js/data/cards_demo.js', 'js/data/decks.js',
];

// A fresh engine: { RULES, CARDS, HEROES, DECKS, Engine, Bot, ...every global function }
function load() {
    const ctx = vm.createContext({ console });
    for (const f of ENGINE_FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
    const consts = vm.runInContext('({ RULES, CARDS, HEROES, DECKS, GRANTS, KEYWORDS, EFFECTS, Engine, Bot, NeedChoice })', ctx);
    return Object.assign(ctx, consts);
}

function assert(cond, msg) { if (!cond) throw new Error('Assertion failed: ' + (msg || '')); }
function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'Values differ') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); }

// Seeded random numbers for bots (separate from the game's own RNG)
function seededRand(seed) {
    let s = seed >>> 0 || 1;
    return () => {
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), s | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Runs registered tests; returns the number of failures
async function runTests(name, tests) {
    let failed = 0;
    for (const t of tests) {
        try { await t.fn(); console.log('  ok   ' + t.name); }
        catch (e) { failed++; console.log('  FAIL ' + t.name + '\n       ' + (e && e.stack || e).toString().split('\n').slice(0, 4).join('\n       ')); }
    }
    console.log(name + ': ' + (tests.length - failed) + '/' + tests.length + ' passed');
    return failed;
}

module.exports = { load, assert, eq, seededRand, runTests, ROOT };
