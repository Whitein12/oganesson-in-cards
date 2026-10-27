// ==========================================
// cards.js - Markup for cards, card backs, minions, heroes, hero powers, weapons and secrets,
// plus the keyword / status notes shown next to a zoomed card
// ==========================================

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function classColor(cls) {
    if (cls && cls !== 'neutral') for (const id in HEROES) if (HEROES[id].class === cls) return HEROES[id].color;
    return '#8b7d6b';
}

// art is an emoji (or any short text) or an image path such as 'img/cards/fireball.png'
function artHTML(art) {
    if (!art) return '';
    if (/^[\w./-]+\.(png|jpe?g|gif|webp|svg)$/i.test(art)) return '<img src="' + esc(art) + '" alt="" draggable="false">';
    return esc(art);
}

// **bold**, $N (a number that Spell Damage raises), new lines
function cardTextHTML(text, spellDmg) {
    let s = esc(text || '');
    s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    s = s.replace(/\$(\d+)/g, (m, n) => spellDmg ? '<span class="boosted">' + (Number(n) + spellDmg) + '</span>' : n);
    return s.replace(/\n/g, '<br>');
}

function gemHTML(kind, val, extra) { return '<div class="gem ' + kind + (extra ? ' ' + extra : '') + '">' + val + '</div>'; }

// A full card. inst (optional) is the card in hand, which may have a changed cost or buffed stats.
// opts: { spellDamage, extraClass, name, text, art } (the last three override, for Choose One options)
function cardHTML(def, inst, opts) {
    opts = opts || {};
    if (!def) return '<div class="card"><div class="c-name">Unknown card</div></div>';
    const cost = inst && inst.cost != null ? inst.cost : def.cost;
    const costCls = cost < def.cost ? 'cheap' : cost > def.cost ? 'pricey' : '';
    let stats = '';
    if (def.type === 'minion') {
        const atk = inst && inst.atk != null ? inst.atk : def.atk;
        const hp = inst && inst.maxHp != null ? inst.maxHp : def.hp;
        stats = gemHTML('atk', atk, atk > def.atk ? 'buffed' : '') + gemHTML('hp', hp, hp > def.hp ? 'buffed' : '');
    } else if (def.type === 'weapon') {
        const atk = inst && inst.atk != null ? inst.atk : def.atk;
        stats = gemHTML('atk', atk, atk > def.atk ? 'buffed' : '') + gemHTML('dur', inst && inst.durability != null ? inst.durability : def.durability);
    }
    const label = def.tribe || (def.secret ? 'Secret' : '');
    return '<div class="card t-' + def.type + ' r-' + esc(def.rarity) + (opts.extraClass ? ' ' + opts.extraClass : '') + '" style="--cls:' + classColor(def.class) + '">' +
        '<div class="c-art">' + artHTML(opts.art || def.art) + '</div>' +
        '<div class="c-name"><span>' + esc(opts.name || def.name) + '</span></div><div class="c-gem"></div>' +
        '<div class="c-text"><div>' + cardTextHTML(opts.text != null ? opts.text : def.text, opts.spellDamage) + '</div></div>' +
        (label ? '<div class="c-tribe">' + esc(label) + '</div>' : '') +
        gemHTML('cost', cost, costCls) + stats + '</div>';
}

// A hero power shown as a card (zoom)
function powerCardHTML(heroId, power) {
    const hero = HEROES[heroId];
    const p = hero.power;
    return '<div class="card t-spell r-common" style="--cls:' + hero.color + '">' +
        '<div class="c-art">' + artHTML(p.art || hero.art) + '</div><div class="c-name"><span>' + esc(p.name) + '</span></div>' +
        '<div class="c-text"><div>' + cardTextHTML(p.text) + '</div></div><div class="c-tribe">Hero Power</div>' +
        gemHTML('cost', power ? power.cost : p.cost) + '</div>';
}

// Shrinks card names and texts that don't fit their boxes. Call it once the cards are on the page
// (sizes can't be measured before), after every innerHTML that contains cards.
function fitCards(root) {
    if (!root) return;
    for (const box of root.querySelectorAll('.c-text')) {
        const inner = box.firstElementChild;
        if (!inner) continue;
        box.style.fontSize = '';
        const cs = getComputedStyle(box);
        const room = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
        for (let size = 1.08; inner.offsetHeight > room + 0.5 && size > 0.6; ) {
            size -= 0.05;
            box.style.fontSize = 'calc(var(--cu) * ' + size.toFixed(2) + ')';
        }
    }
    for (const name of root.querySelectorAll('.c-name')) {
        const inner = name.firstElementChild;
        if (!inner) continue;
        const setSize = size => { name.style.fontSize = 'calc(var(--cu) * ' + size.toFixed(2) + ')'; };
        name.style.fontSize = '';
        name.classList.remove('wrap');
        const cs = getComputedStyle(name);
        const room = name.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        let size = 1.15;
        while (inner.offsetWidth > room + 0.5 && size > 0.85) setSize(size -= 0.05);
        if (inner.offsetWidth <= room + 0.5) continue;
        // still too long for one line: use two lines in the banner
        name.classList.add('wrap');
        size = 1.0;
        setSize(size);
        while ((inner.offsetHeight > name.clientHeight + 0.5 || inner.scrollWidth > room + 0.5) && size > 0.55) setSize(size -= 0.05);
    }
}

function cardBackHTML() { return '<div class="card-back">Og</div>'; }

function minionClasses(m) {
    const def = CARDS[m.cardId] || {};
    let c = 'minion';
    if (m.kw && m.kw.taunt) c += ' taunt';
    if (m.shield) c += ' shield';
    if (m.frozen) c += ' frozen';
    if (m.stealth) c += ' stealth';
    if (m.silenced) c += ' silenced';
    if (m.kw && m.kw.immune) c += ' immune';
    if (def.rarity === 'legendary') c += ' legendary';
    return c;
}

function hasGrant(m, kind) { return (m.enchants || []).some(en => en.grant && GRANTS[en.grant] && (kind === 'deathrattle' ? GRANTS[en.grant].deathrattle : GRANTS[en.grant].triggers.length)); }

function minionInner(m) {
    const def = CARDS[m.cardId] || {};
    const kw = m.kw || {};
    const icons = [];
    if (!m.silenced && (def.deathrattle || hasGrant(m, 'deathrattle'))) icons.push('💀');
    if (!m.silenced && (def.triggers || hasGrant(m, 'triggers'))) icons.push('⚡');
    if (!m.silenced && def.aura) icons.push('✨');
    if (kw.poisonous) icons.push('☠️');
    if (kw.lifesteal) icons.push('❤️');
    if (kw.windfury) icons.push('🌀');
    if (kw.spellDamage) icons.push('🔷');
    if (kw.freeze) icons.push('❄️');
    if (kw.catalyst) icons.push('⚗️');
    if (m.reborn) icons.push('👻');
    if (m.spellburst) icons.push('🔮');
    const atkCls = m.atk > def.atk ? 'buffed' : m.atk < def.atk ? 'damaged' : '';
    const hpCls = m.damage > 0 ? 'damaged' : m.maxHp > def.hp ? 'buffed' : '';
    const zzz = m.sleeping && !kw.charge && !kw.rush ? '<div class="zzz">z<small>z</small></div>' : '';
    return '<div class="body"><div class="art">' + artHTML(def.art) + '</div></div>' +
        gemHTML('atk', m.atk, atkCls) + gemHTML('hp', m.hp, hpCls) +
        (icons.length ? '<div class="icons">' + icons.join('') + '</div>' : '') + zzz;
}

function heroInner(hero) {
    const def = HEROES[hero.heroId] || {};
    return '<div class="art">' + artHTML(def.art) + '</div>' +
        (hero.atk > 0 ? gemHTML('atk', hero.atk) : '') +
        (hero.armor > 0 ? gemHTML('armor', hero.armor) : '') +
        gemHTML('hp', hero.hp, hero.damage > 0 ? 'damaged' : '');
}

function powerInner(power) {
    const hero = HEROES[power.heroId];
    return '<div class="art">' + artHTML(hero.power.art || '✦') + '</div>' + gemHTML('cost', power.cost, power.cost < hero.power.cost ? 'cheap' : '');
}

function weaponInner(w) {
    const def = CARDS[w.cardId] || {};
    return '<div class="art">' + artHTML(def.art) + '</div>' + gemHTML('atk', w.atk, w.atk > def.atk ? 'buffed' : '') +
        gemHTML('dur', w.durability, w.durability < def.durability ? 'damaged' : '');
}

function secretHTML(s) {
    const def = s.cardId ? CARDS[s.cardId] : null;
    const cls = def ? def.class : s.cls;
    return '<div class="secret-gem" style="--cls:' + classColor(cls) + '"><span>?</span></div>';
}

// Keyword ids a card mentions, for the notes beside a zoomed card
function cardKeywordIds(def) {
    const ids = [];
    const add = k => { if (KEYWORDS[k] && !ids.includes(k)) ids.push(k); };
    for (const k of def.keywords || []) add(k);
    if (def.spellDamage) add('spellDamage');
    if (def.battlecry) add('battlecry');
    if (def.deathrattle) add('deathrattle');
    if (def.combo) add('combo');
    if (def.spellburst) add('spellburst');
    if (def.overload) add('overload');
    if (def.secret) add('secret');
    if (def.chooseOne) add('chooseOne');
    for (const list of effectLists(def)) walkEffects(list, fx => { if (['discover', 'silence', 'freeze'].includes(fx.do)) add(fx.do); });
    return ids;
}

function notesHTML(def, entity) {
    const out = [];
    for (const k of def ? cardKeywordIds(def) : []) {
        let text = KEYWORDS[k].text;
        if (k === 'spellDamage') text = 'Your spells deal +' + def.spellDamage + ' damage.';
        if (k === 'overload') text = 'You have ' + def.overload + ' fewer Mana Crystal' + (def.overload > 1 ? 's' : '') + ' next turn.';
        out.push('<div class="note-box"><b>' + esc(KEYWORDS[k].name) + '</b>' + esc(text) + '</div>');
    }
    if (entity) {
        const st = [];
        if (entity.frozen) st.push(['Frozen', 'Loses its next attack.']);
        if (entity.silenced) st.push(['Silenced', 'Its card text has been removed.']);
        if (entity.sleeping && !(entity.kw && (entity.kw.charge || entity.kw.rush))) st.push(['Just played', 'Can attack next turn.']);
        const bonus = (entity.enchants || []).reduce((a, en) => [a[0] + (en.atk || 0), a[1] + (en.hp || 0)], [0, 0]);
        if (bonus[0] || bonus[1]) st.push(['Buffed', (bonus[0] >= 0 ? '+' : '') + bonus[0] + '/' + (bonus[1] >= 0 ? '+' : '') + bonus[1] + ' from effects.']);
        if (entity.auraAtk || entity.auraHp) st.push(['Aura', '+' + (entity.auraAtk || 0) + '/+' + (entity.auraHp || 0) + ' while the aura lasts.']);
        if ((entity.enchants || []).some(en => en.grant)) st.push(['Granted', 'Has extra text from another card.']);
        for (const [n, t] of st) out.push('<div class="note-box status"><b>' + n + '</b>' + t + '</div>');
    }
    return out.join('');
}
