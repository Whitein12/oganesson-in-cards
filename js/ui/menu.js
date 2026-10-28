// ==========================================
// menu.js - The main menu, game setup (decks, names, room codes), the lobby, settings and rules
// ==========================================

const SETTINGS_KEY = 'ogn_settings';

const Menu = {
    lan: false,        // this page is served by server.js, so LAN games are possible
    statusEl: null,    // the lobby's status line
    screen: null,

    init() {
        Menu.loadSettings();
        LanTransport.available().then(ok => { Menu.lan = ok; if (ok && Menu.screen === 'main') Menu.main(); });
    },

    loadSettings() {
        try { Object.assign(UI.settings, JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}); } catch (e) { /* defaults */ }
    },
    saveSettings() {
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(UI.settings)); } catch (e) { /* storage off */ }
    },
    playerName() { return cleanName(UI.settings.name) || 'Player'; },

    // Replaces the menu screen's content; returns the screen element
    show(html, screen) {
        Menu.screen = screen;
        Menu.statusEl = null;
        showScreen('menu');
        const s = $('screen-menu');
        s.innerHTML = '<div class="atom"><div class="orbit"></div><div class="orbit"></div><div class="orbit"></div></div>' +
            '<div class="menu-wrap">' + html + '</div>' +
            '<div class="footer-note">Demo build: the cards and heroes are placeholders &middot; version ' + esc(Engine.cardsetHash()) + '</div>';
        s.querySelectorAll('[data-back]').forEach(b => b.onclick = () => Menu.main());
        return s;
    },

    logo() {
        return '<div class="logo"><div class="element-tile"><span class="z">118</span><span class="sym">Og</span><span class="el">OGANESSON</span></div>' +
            '<div class="title-text"><div class="t1">Oganesson</div><div class="t2">IN CARDS</div></div></div>';
    },

    main() {
        const save = loadSave();
        const resumable = save && save.g && save.g.phase !== 'over' && (save.kind !== 'host' || save.net !== 'lan' || Menu.lan);
        const problems = Engine.validateAll();
        const btn = (go, title, sub, cls) => '<button class="btn' + (cls ? ' ' + cls : '') + '" type="button" data-go="' + go + '">' + title + (sub ? '<small>' + sub + '</small>' : '') + '</button>';
        const s = Menu.show(Menu.logo() + '<div class="panel"><div class="menu-buttons">' +
            (resumable ? btn('resume', 'Resume ' + esc(saveLabel(save)), 'Turn ' + Math.max(1, Math.ceil(save.g.turn / 2)), 'wide') : '') +
            btn('bot', 'Practice vs Bot', 'Play against the computer') +
            btn('local', 'Hot-seat', 'Two players, one screen') +
            btn('host', 'Host Online', 'Get a room code to share') +
            btn('join', 'Join Online', 'Enter a friend\'s code') +
            (Menu.lan ? btn('lanhost', 'Host LAN Game', 'Local network, no internet') + btn('lanjoin', 'Join LAN Game', 'Games on this network') : '') +
            btn('collection', 'Collection', 'See every card and build your decks', 'wide') +
            btn('rules', 'How to Play', '', 'secondary') + btn('settings', 'Settings', '', 'secondary') +
            '</div>' + (problems.length ? '<div class="problems">' + problems.map(esc).join('<br>') + '</div>' : '') + '</div>', 'main');
        s.querySelectorAll('[data-go]').forEach(b => b.onclick = () => Menu.go(b.dataset.go));
    },

    go(where) {
        if (where === 'resume') return Menu.resume();
        if (where === 'bot') return Menu.setupBot();
        if (where === 'local') return Menu.setupLocal();
        if (where === 'host') return Menu.setupHost('peer');
        if (where === 'join') return Menu.setupJoin('peer', '');
        if (where === 'lanhost') return Menu.setupHost('lan');
        if (where === 'lanjoin') return Menu.setupJoin('lan', '');
        if (where === 'collection') return Coll.open();
        if (where === 'rules') return Menu.rules();
        if (where === 'settings') return Menu.settings();
    },

    // ---------- Deck pickers ----------

    // Tiles for every playable deck (your complete decks first, then the premade ones)
    deckPicker(label, key, withRandom) {
        const tiles = playableDecks().map(d => {
            const hero = HEROES[d.hero];
            return '<div class="deck-tile" data-deck="' + esc(d.id) + '" style="--cls:' + hero.color + '">' +
                '<div class="d-art">' + artHTML(hero.art) + '</div><div class="d-name">' + esc(d.name) + '</div>' +
                '<div class="d-hero">' + esc(hero.name) + (d.custom ? ' &middot; your deck' : '') + '</div>' +
                '<div class="d-power">' + esc(hero.power.name) + ': ' + esc(hero.power.text) + '</div></div>';
        }).join('');
        const random = withRandom ? '<div class="deck-tile" data-deck="random" style="--cls:#6b5a7a"><div class="d-art">🎲</div><div class="d-name">Random</div><div class="d-hero">Any deck</div></div>' : '';
        return '<div class="picker-label">' + esc(label) + '</div><div class="deck-grid" data-picker="' + key + '">' + tiles + random + '</div>';
    },

    // Wires every picker on the screen; returns { key: selected deck id }
    wirePickers(s, initial) {
        const picked = Object.assign({}, initial);
        s.querySelectorAll('[data-picker]').forEach(grid => {
            const key = grid.dataset.picker;
            const select = id => {
                picked[key] = id;
                grid.querySelectorAll('.deck-tile').forEach(t => t.classList.toggle('selected', t.dataset.deck === id));
            };
            grid.querySelectorAll('.deck-tile').forEach(t => t.onclick = () => select(t.dataset.deck));
            select(picked[key] || playableDecks()[0].id);
        });
        return picked;
    },

    // A picked deck as plain data for a session ('random' picks any playable deck)
    deckFor(id) {
        const list = playableDecks();
        const d = id === 'random' ? list[Math.floor(Math.random() * list.length)] : list.find(x => x.id === id) || list[0];
        return deckData(d);
    },

    lastDeck(i) {
        const id = (UI.settings.decks || [])[i];
        const list = playableDecks();
        return list.some(d => d.id === id) ? id : list[Math.min(i, list.length - 1)].id;
    },
    rememberDecks(list) { UI.settings.decks = list; Menu.saveSettings(); },
    deckTip() { return MyDecks.list().length ? '' : '<p class="note">Build your own decks in the Collection.</p>'; },

    // ---------- Setups ----------

    // Shows a notice instead of a setup screen when there is no complete deck to play with
    noDecks() {
        if (playableDecks().length) return false;
        const s = Menu.show('<div class="panel"><h2>No Playable Deck</h2><p class="note">Every deck needs exactly ' + RULES.deckSize +
            ' cards. Build one in the Collection.</p><div class="row"><button class="btn" type="button" id="to-coll">Collection</button>' +
            '<button class="btn secondary" type="button" data-back>Back</button></div></div>', 'setup');
        s.querySelector('#to-coll').onclick = () => Coll.open();
        return true;
    },

    setupBot() {
        if (Menu.noDecks()) return;
        const s = Menu.show('<div class="panel"><h2>Practice vs Bot</h2>' +
            Menu.deckPicker('Your deck', 'mine') + Menu.deckPicker('Bot deck', 'bot', true) + Menu.deckTip() +
            '<div class="row" style="margin-top:calc(var(--u)*2)"><button class="btn" type="button" id="go">Start</button>' +
            '<button class="btn secondary" type="button" data-back>Back</button></div></div>', 'setup');
        const picked = Menu.wirePickers(s, { mine: Menu.lastDeck(0), bot: 'random' });
        s.querySelector('#go').onclick = () => {
            Menu.rememberDecks([picked.mine, Menu.lastDeck(1)]);
            Menu.start(new BotSession({ decks: [Menu.deckFor(picked.mine), Menu.deckFor(picked.bot)], names: [Menu.playerName(), 'Bot'] }));
        };
    },

    setupLocal() {
        if (Menu.noDecks()) return;
        const s = Menu.show('<div class="panel"><h2>Hot-seat</h2>' +
            '<div class="row"><label class="field">Player 1<input class="input" id="n0" maxlength="20" value="' + esc(Menu.playerName()) + '"></label>' +
            '<label class="field">Player 2<input class="input" id="n1" maxlength="20" value="' + esc(UI.settings.name2 || 'Player 2') + '"></label></div>' +
            Menu.deckPicker('Player 1 deck', 'd0') + Menu.deckPicker('Player 2 deck', 'd1') +
            '<div class="row"><label class="toggle"><input type="checkbox" id="pass"' + (UI.settings.passScreen ? ' checked' : '') + '> Hide hands between turns</label></div>' +
            '<div class="row" style="margin-top:calc(var(--u)*1.5)"><button class="btn" type="button" id="go">Start</button>' +
            '<button class="btn secondary" type="button" data-back>Back</button></div></div>', 'setup');
        const picked = Menu.wirePickers(s, { d0: Menu.lastDeck(0), d1: Menu.lastDeck(1) });
        s.querySelector('#go').onclick = () => {
            const n0 = cleanName(s.querySelector('#n0').value) || 'Player 1';
            const n1 = cleanName(s.querySelector('#n1').value) || 'Player 2';
            UI.settings.name = n0; UI.settings.name2 = n1;
            UI.settings.passScreen = s.querySelector('#pass').checked;
            Menu.rememberDecks([picked.d0, picked.d1]);
            Menu.start(new LocalSession({ decks: [Menu.deckFor(picked.d0), Menu.deckFor(picked.d1)], names: [n0, n1 === n0 ? n1 + ' 2' : n1] }));
        };
    },

    setupHost(net) {
        if (Menu.noDecks()) return;
        const title = net === 'lan' ? 'Host a LAN Game' : 'Host an Online Game';
        const s = Menu.show('<div class="panel"><h2>' + title + '</h2>' +
            '<div class="row"><label class="field">Your name<input class="input" id="name" maxlength="20" value="' + esc(Menu.playerName()) + '"></label></div>' +
            Menu.deckPicker('Your deck', 'mine') + Menu.deckTip() +
            '<div class="row" style="margin-top:calc(var(--u)*2)"><button class="btn" type="button" id="go">Create room</button>' +
            '<button class="btn secondary" type="button" data-back>Back</button></div></div>', 'setup');
        const picked = Menu.wirePickers(s, { mine: Menu.lastDeck(0) });
        s.querySelector('#go').onclick = () => {
            UI.settings.name = cleanName(s.querySelector('#name').value) || UI.settings.name;
            Menu.rememberDecks([picked.mine, Menu.lastDeck(1)]);
            Menu.start(new HostSession({ transport: makeTransport(net), net, name: Menu.playerName(), deck: Menu.deckFor(picked.mine) }));
        };
    },

    setupJoin(net, code) {
        if (Menu.noDecks()) return;
        const title = net === 'lan' ? 'Join a LAN Game' : 'Join an Online Game';
        const s = Menu.show('<div class="panel"><h2>' + title + '</h2>' +
            '<div class="row"><label class="field">Your name<input class="input" id="name" maxlength="20" value="' + esc(Menu.playerName()) + '"></label>' +
            '<label class="field">Room code<input class="input code" id="code" maxlength="8" value="' + esc(code || '') + '" placeholder="ABCDE"></label></div>' +
            (net === 'lan' ? '<div class="picker-label">Open games on this network</div><div class="room-list" id="rooms"><div class="note">Looking for games...</div></div>' : '') +
            Menu.deckPicker('Your deck', 'mine') + Menu.deckTip() +
            '<div class="row" style="margin-top:calc(var(--u)*2)"><button class="btn" type="button" id="go">Join</button>' +
            '<button class="btn secondary" type="button" data-back>Back</button></div></div>', 'setup');
        const picked = Menu.wirePickers(s, { mine: Menu.lastDeck(0) });
        const join = c => {
            c = String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
            if (c.length < 3) { uiToast('Enter the room code.', 'info'); return; }
            UI.settings.name = cleanName(s.querySelector('#name').value) || UI.settings.name;
            Menu.rememberDecks([picked.mine, Menu.lastDeck(1)]);
            Menu.start(new GuestSession({ transport: makeTransport(net), net, code: c, name: Menu.playerName(), deck: Menu.deckFor(picked.mine) }));
        };
        s.querySelector('#go').onclick = () => join(s.querySelector('#code').value);
        s.querySelector('#code').onkeydown = e => { if (e.key === 'Enter') join(e.target.value); };
        if (net === 'lan') {
            const refresh = async () => {
                const box = document.getElementById('rooms');
                if (!box) return clearInterval(timer);
                let list = [];
                try { list = await LanTransport.rooms(); } catch (e) { /* server gone */ }
                box.innerHTML = list.length ? list.map(r => '<div class="room"><span><b>' + esc(r.code) + '</b> ' + esc(r.name || '') + '</span>' +
                    '<button class="btn" type="button" data-code="' + esc(r.code) + '">Join</button></div>').join('') : '<div class="note">No open games yet. Ask your friend to host one.</div>';
                box.querySelectorAll('[data-code]').forEach(b => b.onclick = () => join(b.dataset.code));
            };
            const timer = setInterval(refresh, 2000);
            refresh();
        }
    },

    // ---------- Lobby (network games before the first update) ----------

    lobby(session) {
        const host = session.kind === 'host';
        const link = host && session.net === 'peer' ? location.origin + location.pathname + '#join=' + session.code : '';
        const s = Menu.show('<div class="panel">' +
            (host ? '<h2>Your Room Code</h2><div class="big-code">' + esc(session.code) + '</div>' +
                (link ? '<div class="row"><button class="btn secondary" type="button" id="copy">Copy invite link</button></div>' +
                    '<p class="note">Send the code or the link to your friend. They choose Join Online.</p>'
                    : '<p class="note" id="lan-urls">Your friend opens this game from your computer\'s address and chooses Join LAN Game.</p>')
                : '<h2>Joining ' + esc(session.code) + '</h2>') +
            '<p class="note" id="lobby-status"></p><div class="row"><button class="btn secondary" type="button" id="cancel">Cancel</button></div></div>', 'lobby');
        Menu.statusEl = s.querySelector('#lobby-status');
        s.querySelector('#cancel').onclick = () => Menu.leaveGame();
        const copy = s.querySelector('#copy');
        if (copy) copy.onclick = () => {
            const done = () => uiToast('Invite link copied.', 'info');
            if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(link).then(done, () => prompt('Copy this link:', link));
            else prompt('Copy this link:', link);
        };
        if (host && session.net === 'lan') LanTransport.info().then(info => {
            const el = document.getElementById('lan-urls');
            if (el && info && info.urls && info.urls.length) el.innerHTML = 'Your friend opens <b>' + info.urls.map(esc).join('</b> or <b>') + '</b> and chooses Join LAN Game.';
        });
    },

    status(text, kind) {
        if (!Menu.statusEl || !Menu.statusEl.isConnected) return;
        Menu.statusEl.textContent = text || '';
        Menu.statusEl.className = 'note' + (kind ? ' ' + kind : '');
    },

    lobbyFailed() {
        const b = document.getElementById('cancel');
        if (b) b.textContent = 'Back';
    },

    // ---------- Starting and leaving ----------

    start(session) {
        if (UI.session) UI.session.leave();
        UI.gen++;
        Object.assign(UI, { session, view: null, queue: [], busy: false, waiting: false, timer: null, onIdle: null, overReason: '' });
        Overlay.hide();
        Input.cancel();
        hideZoom();
        uiStatus('');
        if (session.kind === 'host' || session.kind === 'guest') Menu.lobby(session);
        session.start();
    },

    leaveGame() {
        const s = UI.session;
        UI.gen++;
        Object.assign(UI, { session: null, view: null, queue: [], busy: false, waiting: false, timer: null, onIdle: null });
        if (s) s.leave();
        Overlay.hide();
        Input.cancel();
        hideZoom();
        uiStatus('');
        Menu.main();
    },

    resume() {
        const s = loadSave();
        if (!s || !s.g) return Menu.main();
        if (s.kind === 'local') Menu.start(new LocalSession(Object.assign({}, s.opts, { g: s.g })));
        else if (s.kind === 'bot') Menu.start(new BotSession(Object.assign({}, s.opts, { g: s.g })));
        else if (s.kind === 'host') Menu.start(new HostSession({ transport: makeTransport(s.net), net: s.net, code: s.code, name: s.name, deck: s.deck, deckId: s.deckId, g: s.g, guest: s.guest }));
    },

    // ---------- Info screens ----------

    rules() {
        Menu.show('<div class="panel"><h2>How to Play</h2><ul class="rules-list">' +
            '<li>Each player has a hero with <b>' + RULES.heroHp + ' Health</b> and a deck of <b>' + RULES.deckSize + ' cards</b>. Bring the enemy hero to 0 to win.</li>' +
            '<li>You get one more <b>Mana Crystal</b> every turn (1 on your first turn, up to ' + RULES.maxMana + '). Cards cost mana.</li>' +
            '<li>You start with ' + RULES.startHand[0] + ' cards (' + RULES.startHand[1] + ' and The Coin if you go second) and may replace any of them.</li>' +
            '<li>You can only play cards, attack and use your <b>Hero Power</b> (once per turn) during your own turn.</li>' +
            '<li>Minions can attack the turn after they are played. Enemies with <b>Taunt</b> must be attacked first.</li>' +
            '<li><b>Locations</b> take a minion\'s spot on the board. Click one to use it: it loses 1 Durability and closes ' + locationCooldownText() + '. At 0 Durability it is destroyed.</li>' +
            '<li>Up to ' + RULES.boardLimit + ' minions and locations per side and ' + RULES.handLimit + ' cards in hand. Drawing from an empty deck causes growing fatigue damage.</li>' +
            '<li><b>Controls:</b> drag a card onto the board (or click it, then click the board). Drag from a minion or your hero to attack. ' +
            'Click your Hero Power or a location to use it. Right-click or Esc cancels. Hover anything to see its card.</li></ul>' +
            '<div class="row" style="margin-top:calc(var(--u)*2)"><button class="btn secondary" type="button" data-back>Back</button></div></div>', 'rules');
    },

    settings() {
        const s = Menu.show('<div class="panel"><h2>Settings</h2>' +
            '<div class="row"><label class="field">Your name<input class="input" id="name" maxlength="20" value="' + esc(UI.settings.name || '') + '"></label></div>' +
            '<div class="row"><label class="toggle"><input type="checkbox" id="fast"' + (UI.settings.fast ? ' checked' : '') + '> Fast animations</label></div>' +
            '<div class="row"><label class="toggle"><input type="checkbox" id="pass"' + (UI.settings.passScreen ? ' checked' : '') + '> Hot-seat: hide hands between turns</label></div>' +
            '<div class="row" style="margin-top:calc(var(--u)*2)"><button class="btn" type="button" id="save">Save</button>' +
            '<button class="btn secondary" type="button" data-back>Back</button></div></div>', 'settings');
        s.querySelector('#save').onclick = () => {
            UI.settings.name = cleanName(s.querySelector('#name').value);
            UI.settings.fast = s.querySelector('#fast').checked;
            UI.settings.passScreen = s.querySelector('#pass').checked;
            Menu.saveSettings();
            Menu.main();
        };
    },
};

function saveLabel(save) {
    if (save.kind === 'local') return 'hot-seat game';
    if (save.kind === 'bot') return 'game vs Bot';
    if (save.kind === 'host') return (save.net === 'lan' ? 'LAN' : 'online') + ' game ' + save.code;
    return 'game';
}
