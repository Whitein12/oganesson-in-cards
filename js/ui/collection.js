// ==========================================
// collection.js - The collection (every collectible card, with filters) and the deck builder.
// Your own decks are saved in this browser (localStorage 'ogn_decks'); the premade decks come from js/data/decks.js.
// The menus offer decks through playableDecks(); sessions and the network get plain copies from deckData().
// ==========================================

const DECKS_KEY = 'ogn_decks';

const MyDecks = {
    list() {
        try {
            const list = JSON.parse(localStorage.getItem(DECKS_KEY));
            return Array.isArray(list) ? list.filter(d => d && d.id && d.hero && d.cards) : [];
        } catch (e) { return []; }
    },
    save(list) {
        try { localStorage.setItem(DECKS_KEY, JSON.stringify(list)); }
        catch (e) { uiToast('The browser did not let the game save your decks.'); }
    },
    put(deck) {
        const list = MyDecks.list();
        const i = list.findIndex(d => d.id === deck.id);
        if (i >= 0) list[i] = deck; else list.push(deck);
        MyDecks.save(list);
    },
    remove(id) { MyDecks.save(MyDecks.list().filter(d => d.id !== id)); },
};

// Your decks first, then the premade ones
function allDecks() { return MyDecks.list().map(d => Object.assign({ custom: true }, d)).concat(DECKS); }
function findDeck(id) { return allDecks().find(d => d.id === id) || null; }
function playableDecks() { return allDecks().filter(d => !Engine.validateDeck(d).length); }
function deckData(deck) { return { id: deck.id, name: deck.name, hero: deck.hero, cards: deckCounts(deck) }; }
function deckTotal(cards) { return Object.values(cards).reduce((a, b) => a + b, 0); }
function maxCopies(def) { return def.rarity === 'legendary' ? RULES.maxLegendaryCopies : RULES.maxCopies; }
function newDeckId() { return 'my_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function classLabel(cls) { return cls.charAt(0).toUpperCase() + cls.slice(1); }

const Coll = {
    filter: { cls: 'all', cost: 'all', type: 'all', text: '' },
    deck: null,       // the deck being edited ({ id, name, hero, cards }), or null while browsing
    readOnly: false,  // looking at a premade deck
    saved: false,     // the deck being edited is one of your saved decks
    dirty: false,

    open() {
        Object.assign(Coll, { deck: null, readOnly: false, saved: false, dirty: false });
        Object.assign(Coll.filter, { cls: 'all', cost: 'all', type: 'all', text: '' });
        showScreen('collection');
        const s = $('screen-collection');
        s.innerHTML =
            '<div class="coll-main">' +
                '<div class="coll-bar"><button class="btn secondary coll-back" type="button" id="coll-back">Menu</button>' +
                '<div class="coll-title">Collection</div><div class="chips" id="coll-cls"></div>' +
                '<input class="input coll-search" id="coll-search" placeholder="Search cards" maxlength="30"></div>' +
                '<div class="coll-bar"><span class="coll-label">Mana</span><div class="chips" id="coll-cost"></div>' +
                '<span class="coll-label">Type</span><div class="chips" id="coll-type"></div><span class="coll-count" id="coll-count"></span></div>' +
                '<div class="coll-hint" id="coll-hint"></div>' +
                '<div class="coll-grid" id="coll-grid"></div>' +
            '</div><div class="coll-side" id="coll-side"></div><div class="coll-preview" id="coll-preview"></div>';
        $('coll-back').onclick = () => Coll.leave();
        $('coll-search').oninput = e => { Coll.filter.text = e.target.value.trim(); Coll.renderGrid(); };
        const grid = $('coll-grid');
        grid.onclick = e => { const c = e.target.closest('.coll-card'); if (c) Coll.add(c.dataset.id); };
        grid.oncontextmenu = e => { const c = e.target.closest('.coll-card'); if (c) { e.preventDefault(); Coll.remove(c.dataset.id); } };
        Coll.render();
    },

    render() { Coll.renderChips(); Coll.renderGrid(); Coll.renderSide(); },

    // ---------- Filters and the card grid ----------

    renderChips() {
        const f = Coll.filter;
        const deckCls = Coll.deck ? HEROES[Coll.deck.hero].class : null;
        const classes = [['all', 'All']];
        for (const h of Object.values(HEROES)) {
            if (h.class === 'neutral' || classes.some(c => c[0] === h.class) || (deckCls && h.class !== deckCls)) continue;
            classes.push([h.class, classLabel(h.class)]);
        }
        classes.push(['neutral', 'Neutral']);
        const costs = [['all', 'All']];
        for (let i = 0; i <= 7; i++) costs.push([i, i === 7 ? '7+' : String(i)]);
        const chips = (id, items, current, set) => {
            const box = $(id);
            box.innerHTML = items.map(([v, label]) => '<button type="button" class="chip' + (v === current ? ' on' : '') + '">' + esc(label) + '</button>').join('');
            box.querySelectorAll('.chip').forEach((b, i) => b.onclick = () => { set(items[i][0]); Coll.renderChips(); Coll.renderGrid(); });
        };
        chips('coll-cls', classes, f.cls, v => { f.cls = v; });
        chips('coll-cost', costs, f.cost, v => { f.cost = v; });
        chips('coll-type', [['all', 'All'], ['minion', 'Minions'], ['spell', 'Spells'], ['weapon', 'Weapons']], f.type, v => { f.type = v; });
    },

    visibleCards() {
        const f = Coll.filter;
        const deckCls = Coll.deck ? HEROES[Coll.deck.hero].class : null;
        const text = f.text.toLowerCase();
        return Object.values(CARDS).filter(d => d.collectible &&
            (!deckCls || d.class === 'neutral' || d.class === deckCls) &&
            (f.cls === 'all' || d.class === f.cls) &&
            (f.cost === 'all' || (f.cost === 7 ? d.cost >= 7 : d.cost === f.cost)) &&
            (f.type === 'all' || d.type === f.type) &&
            (!text || [d.name, d.text.replace(/\*\*|\$/g, ''), d.tribe || '', d.keywords.join(' ')].join(' ').toLowerCase().includes(text))
        ).sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
    },

    renderGrid() {
        const list = Coll.visibleCards();
        const grid = $('coll-grid');
        grid.innerHTML = list.length
            ? list.map(d => '<div class="coll-card" data-id="' + esc(d.id) + '">' + cardHTML(d, null) + '</div>').join('')
            : '<div class="note coll-empty">No cards match these filters.</div>';
        fitCards(grid);
        $('coll-count').textContent = list.length + (list.length === 1 ? ' card' : ' cards');
        $('coll-hint').textContent = !Coll.deck ? 'Pick one of your decks on the right, or make a new one, to start building.'
            : Coll.readOnly ? 'This is a premade deck. Make a copy to change it.'
            : 'Click a card to add it to the deck, right-click it (or click it in the list) to take it out.';
        Coll.markCounts();
    },

    // Copies in the deck under each card; cards at their limit are dimmed
    markCounts() {
        for (const el of $('coll-grid').querySelectorAll('.coll-card')) {
            const def = CARDS[el.dataset.id];
            const n = Coll.deck ? Coll.deck.cards[def.id] || 0 : 0;
            el.classList.toggle('maxed', !!Coll.deck && n >= maxCopies(def));
            let badge = el.querySelector('.coll-n');
            if (n) {
                if (!badge) { badge = document.createElement('div'); badge.className = 'coll-n'; el.appendChild(badge); }
                badge.textContent = n + ' / ' + maxCopies(def);
            } else if (badge) badge.remove();
        }
    },

    // ---------- The side panel: your decks, or the deck being edited ----------

    renderSide() {
        $('coll-preview').className = 'coll-preview';
        if (Coll.deck) Coll.renderEditor(); else Coll.renderDecks();
    },

    renderDecks() {
        const mine = MyDecks.list();
        const tile = (d, custom) => {
            const hero = HEROES[d.hero] || { name: '?', art: '?', color: '#888' };
            const n = deckTotal(deckCounts(d));
            const ok = !Engine.validateDeck(d).length;
            return '<div class="mini-deck' + (ok ? '' : ' incomplete') + '" data-deck="' + esc(d.id) + '" data-custom="' + (custom ? 1 : 0) + '" style="--cls:' + hero.color + '">' +
                '<span class="md-art">' + artHTML(hero.art) + '</span><span class="md-name">' + esc(d.name) + '<small>' + esc(hero.name) + '</small></span>' +
                (ok ? '' : '<span class="md-count">' + n + '/' + RULES.deckSize + '</span>') + '</div>';
        };
        const side = $('coll-side');
        side.innerHTML = '<div class="side-title">My Decks</div>' +
            (mine.length ? '<div class="deck-tiles">' + mine.map(d => tile(d, true)).join('') + '</div>' : '<div class="note">No decks yet.</div>') +
            '<button class="btn" type="button" id="coll-new">New Deck</button>' +
            '<div class="side-title">Premade Decks</div><div class="deck-tiles">' + DECKS.map(d => tile(d, false)).join('') + '</div>';
        $('coll-new').onclick = () => Coll.pickHero();
        side.querySelectorAll('.mini-deck').forEach(t => t.onclick = () => {
            const custom = t.dataset.custom === '1';
            const d = custom ? MyDecks.list().find(x => x.id === t.dataset.deck) : deckById(t.dataset.deck);
            if (d) Coll.edit(d, !custom, custom);
        });
    },

    renderEditor() {
        const d = Coll.deck, hero = HEROES[d.hero];
        const total = deckTotal(d.cards);
        const ids = Object.keys(d.cards).filter(hasCard)
            .sort((a, b) => CARDS[a].cost - CARDS[b].cost || CARDS[a].name.localeCompare(CARDS[b].name));
        const problems = Engine.validateDeck(d).filter(p => !/ cards \(needs /.test(p)).map(p => p.replace(/^[^:]*: /, ''));
        const side = $('coll-side');
        side.innerHTML =
            '<div class="ed-head" style="--cls:' + hero.color + '"><span class="md-art">' + artHTML(hero.art) + '</span>' +
            (Coll.readOnly ? '<div class="ed-title">' + esc(d.name) + '</div>' : '<input class="input ed-title" id="ed-name" maxlength="24" value="' + esc(d.name) + '">') + '</div>' +
            '<div class="ed-info"><span>' + esc(hero.name) + ' &middot; ' + esc(hero.power.name) + '</span><b class="' + (total === RULES.deckSize ? 'full' : '') + '">' + total + ' / ' + RULES.deckSize + '</b></div>' +
            Coll.curveHTML(d) +
            '<div class="ed-list" id="ed-list">' + (ids.length ? ids.map(id => Coll.rowHTML(id, d.cards[id])).join('') : '<div class="note">Click cards on the left to add them.</div>') + '</div>' +
            (problems.length ? '<div class="problems">' + problems.map(esc).join('<br>') + '</div>' : '') +
            '<div class="ed-buttons">' + (Coll.readOnly
                ? '<button class="btn" type="button" id="ed-copy">Make a copy</button><button class="btn secondary" type="button" id="ed-close">Close</button>'
                : '<button class="btn" type="button" id="ed-save">Save</button><button class="btn secondary" type="button" id="ed-fill"' + (total >= RULES.deckSize ? ' disabled' : '') + '>Auto-fill</button>' +
                  '<button class="btn secondary" type="button" id="ed-cancel">Cancel</button>' +
                  (Coll.saved ? '<button class="btn danger" type="button" id="ed-delete">Delete</button>' : '')) + '</div>';
        const on = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = fn; };
        on('ed-copy', () => Coll.copy());
        on('ed-close', () => Coll.closeEditor());
        on('ed-save', () => Coll.save());
        on('ed-fill', () => Coll.autofill());
        on('ed-cancel', () => Coll.cancel());
        on('ed-delete', () => Coll.del());
        const name = document.getElementById('ed-name');
        if (name) name.oninput = () => { d.name = name.value; Coll.dirty = true; };
        side.querySelectorAll('.ed-row').forEach(row => {
            row.onclick = () => Coll.remove(row.dataset.id);
            row.onmouseenter = () => Coll.preview(row.dataset.id, row);
            row.onmouseleave = () => { $('coll-preview').className = 'coll-preview'; };
        });
    },

    rowHTML(id, n) {
        const def = CARDS[id];
        return '<div class="ed-row r-' + esc(def.rarity) + '" data-id="' + esc(id) + '" style="--cls:' + classColor(def.class) + '">' +
            '<span class="ed-cost">' + def.cost + '</span><span class="ed-name">' + esc(def.name) + '</span>' +
            '<span class="ed-n">' + (n > 1 ? '&times;' + n : def.rarity === 'legendary' ? '&#9733;' : '') + '</span></div>';
    },

    curveHTML(d) {
        const counts = [0, 0, 0, 0, 0, 0, 0, 0];
        for (const id of Object.keys(d.cards)) if (hasCard(id)) counts[Math.min(7, CARDS[id].cost)] += d.cards[id];
        const max = Math.max(1, ...counts);
        return '<div class="curve">' + counts.map((n, i) => '<div class="curve-col"><div class="curve-n">' + (n || '') + '</div>' +
            '<div class="curve-track"><div class="curve-bar" style="height:' + (100 * n / max).toFixed(0) + '%"></div></div>' +
            '<div class="curve-cost">' + (i === 7 ? '7+' : i) + '</div></div>').join('') + '</div>';
    },

    // The full card beside a row of the deck list
    preview(id, row) {
        const p = $('coll-preview');
        p.innerHTML = cardHTML(CARDS[id], null);
        p.className = 'coll-preview show';
        fitCards(p);
        const s = $('stage').getBoundingClientRect(), r = row.getBoundingClientRect(), side = $('coll-side').getBoundingClientRect();
        const h = p.offsetHeight;
        p.style.left = (side.left - s.left - p.offsetWidth - 14) + 'px';
        p.style.top = Math.max(8, Math.min(s.height - h - 8, r.top - s.top + r.height / 2 - h / 2)) + 'px';
    },

    // ---------- Editing ----------

    edit(deck, readOnly, saved) {
        Coll.deck = { id: deck.id, name: deck.name, hero: deck.hero, cards: deckCounts(deck) };
        Object.assign(Coll, { readOnly: !!readOnly, saved: !!saved, dirty: false });
        Coll.filter.cls = 'all';
        Coll.render();
    },

    add(id) {
        const d = Coll.deck;
        if (!d) return uiToast('Pick or make a deck on the right first.', 'info');
        if (Coll.readOnly) return uiToast('Premade decks can\'t be changed. Make a copy first.', 'info');
        const def = CARDS[id];
        const n = d.cards[id] || 0;
        if (n >= maxCopies(def)) return uiToast(def.rarity === 'legendary' ? 'A deck can only have one copy of a legendary card.' : 'A deck can have at most ' + RULES.maxCopies + ' copies of a card.', 'info');
        if (deckTotal(d.cards) >= RULES.deckSize) return uiToast('The deck already has ' + RULES.deckSize + ' cards.', 'info');
        d.cards[id] = n + 1;
        Coll.dirty = true;
        Coll.renderSide();
        Coll.markCounts();
    },

    remove(id) {
        const d = Coll.deck;
        if (!d || Coll.readOnly || !d.cards[id]) return;
        if (--d.cards[id] <= 0) delete d.cards[id];
        Coll.dirty = true;
        Coll.renderSide();
        Coll.markCounts();
    },

    // Fills the deck up to its size with random cards it may hold
    autofill() {
        const d = Coll.deck, cls = HEROES[d.hero].class;
        const pool = Object.values(CARDS).filter(c => c.collectible && (c.class === 'neutral' || c.class === cls));
        while (deckTotal(d.cards) < RULES.deckSize) {
            const free = pool.filter(c => (d.cards[c.id] || 0) < maxCopies(c));
            if (!free.length) break;
            const c = free[Math.floor(Math.random() * free.length)];
            d.cards[c.id] = (d.cards[c.id] || 0) + 1;
        }
        Coll.dirty = true;
        Coll.renderSide();
        Coll.markCounts();
    },

    save() {
        const d = Coll.deck;
        d.name = String(d.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24) || 'My Deck';
        MyDecks.put(deckData(d));
        const total = deckTotal(d.cards);
        uiToast(total === RULES.deckSize ? 'Deck saved.' : 'Deck saved. It needs ' + RULES.deckSize + ' cards before you can play with it.', 'info');
        Coll.closeEditor();
    },

    copy() {
        const d = Coll.deck;
        Coll.edit({ id: newDeckId(), name: ('Copy of ' + d.name).slice(0, 24), hero: d.hero, cards: d.cards }, false, false);
        Coll.dirty = true;
    },

    async cancel() {
        if (Coll.dirty && !(await Coll.ask('Throw away your changes to this deck?', 'Discard'))) return;
        Coll.closeEditor();
    },

    async del() {
        if (!(await Coll.ask('Delete "' + Coll.deck.name + '"? This can\'t be undone.', 'Delete'))) return;
        MyDecks.remove(Coll.deck.id);
        Coll.closeEditor();
    },

    closeEditor() {
        Object.assign(Coll, { deck: null, readOnly: false, saved: false, dirty: false });
        Coll.render();
    },

    async leave() {
        if (Coll.deck && Coll.dirty && !(await Coll.ask('Leave without saving this deck?', 'Leave'))) return;
        Coll.deck = null;
        Menu.main();
    },

    // ---------- Dialogs ----------

    pickHero() {
        const m = Coll.modal('<h2>Choose a Hero</h2><div class="deck-grid">' + Object.values(HEROES).map(h =>
            '<div class="deck-tile" data-hero="' + esc(h.id) + '" style="--cls:' + h.color + '"><div class="d-art">' + artHTML(h.art) + '</div>' +
            '<div class="d-name">' + esc(h.name) + '</div><div class="d-power">' + esc(h.power.name) + ': ' + esc(h.power.text) + '</div></div>').join('') +
            '</div><div class="row" style="margin-top:calc(var(--u)*2)"><button class="btn secondary" type="button" data-close>Cancel</button></div>');
        m.querySelectorAll('[data-hero]').forEach(t => t.onclick = () => {
            Coll.closeModal();
            const h = HEROES[t.dataset.hero];
            Coll.edit({ id: newDeckId(), name: ('My ' + h.name + ' Deck').slice(0, 24), hero: h.id, cards: {} }, false, false);
        });
    },

    ask(text, yes) {
        return new Promise(resolve => {
            const m = Coll.modal('<h2>' + esc(text) + '</h2><div class="row"><button class="btn" type="button" id="ask-yes">' + esc(yes) + '</button>' +
                '<button class="btn secondary" type="button" id="ask-no">Cancel</button></div>');
            m.querySelector('#ask-yes').onclick = () => { Coll.closeModal(); resolve(true); };
            m.querySelector('#ask-no').onclick = () => { Coll.closeModal(); resolve(false); };
        });
    },

    modal(html) {
        Coll.closeModal();
        const m = document.createElement('div');
        m.className = 'coll-modal';
        m.innerHTML = '<div class="panel">' + html + '</div>';
        $('screen-collection').appendChild(m);
        m.querySelectorAll('[data-close]').forEach(b => b.onclick = () => Coll.closeModal());
        return m;
    },

    closeModal() {
        const m = document.querySelector('#screen-collection .coll-modal');
        if (m) m.remove();
    },
};

window.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || $('screen-collection').classList.contains('hidden')) return;
    if (document.querySelector('#screen-collection .coll-modal')) Coll.closeModal();
    else if (Coll.deck) { if (Coll.readOnly) Coll.closeEditor(); else Coll.cancel(); }
    else Coll.leave();
});
