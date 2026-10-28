# CLAUDE.md

**Oganesson in Cards** is a two-player, Hearthstone-style card game in vanilla JavaScript. It uses DOM and CSS (no canvas), with no dependencies and no build step. The only third-party file is `lib/peerjs.min.js` (PeerJS 1.5.5, vendored). The rules are in `js/rules.js`: 30 Health, 30-card decks, mana 1→10, a Hero Power, and players act only on their own turn.

The cards, heroes and decks in `js/data/` are **placeholders**. The user will supply the real set. README.md "Card authoring" is the reference for the card format; keep it in sync when the engine changes.

## Running

- `PlayGame.bat`: Python file server on port 8000 with `Cache-Control: no-cache`, so edited files show up on refresh. Covers hot-seat, vs Bot and online play.
- `PlayLAN.bat`: `node server.js 8080 --open`. Serves the game and relays LAN games, no internet needed.
- GitHub Pages works as is (static site; `.nojekyll`).
- The page must be served over HTTP.
- `node tests/run.js [games]` runs the rules tests and the fuzz games. Run it after any engine or card change.
- Debug URLs (see `js/main.js`):
  - `?autoplay=bots&seed=N&stopAt=T&turbo=1` makes the bots play each other.
  - `?autoplay=host|guest&net=peer|lan&code=X&turbo=1` has a bot play each side of a network game.
  - Results go to the console, the page title and `#debug-result`.

## Architecture

- **The engine is pure.** `js/engine/*` has no DOM and runs in Node through `tests/harness.js` (a `vm` context).
- **The state is plain JSON.** It is cloned for snapshots and network views, so it must never hold functions or references to card definitions. Entities name their card by `cardId`, and an entity is the same object as it moves between zones (keeping its `uid`).
- **Randomness is seeded** and lives in `g.rng`. Never use `Math.random` or `Date` inside the engine or card scripts.
- **The host is authoritative.** The host (or local session) holds the real state. `Engine.apply(g, player, action)` validates and runs an action, then returns `{ ok, error, events }`. Players only ever see `viewFor(g, player)` and `redactEvents(events, player)` (`view.js`), which strip the opponent's hand and secrets, deck order, the RNG and replay data.
- **Discover and choices use deterministic replay.** Every action starts from a JSON snapshot. `choose()` (core.js) returns a recorded answer, or throws `NeedChoice`. In that case `g.pending` stores the action, the answers so far, the snapshot and the number of events already shown. A `choose` action restores the snapshot and replays with one more answer (`runAction` / `resumeChoice` in actions.js). Choose One doesn't need this: its option index travels with the `play` action.
- **Resolution follows Hearthstone's phase order.** `phaseRun(g, fn)` runs a step, then `deathPhase`, which:
  1. resolves the trigger queue (`fire` only queues),
  2. removes all dead minions and broken weapons together,
  3. queues their deathrattles, Reborn and `minionDied`,
  4. repeats until stable.

  The pipelines in actions.js (`doPlay`, `doAttack`, `doPower`, `doActivate`, `doEndTurn`, `startTurn`) are sequences of `phaseRun`.
- **Derived numbers come from `refresh(g)`**, called after every effect: auras, attack, max Health, keywords, hand costs. Minions store `damage`, so hp = maxHp − damage, and losing max Health only clamps current Health. Divine Shield, Stealth and Reborn are spendable statuses (`shield`, `stealth`, `reborn`) rather than keywords. So is the one-shot Spellburst slot (`spellburst`): while it is set, `holderTriggers` adds its trigger, and `resolveQueue` clears it when the trigger runs.
- **Locations share `p.board` with minions**, so they take a slot and keep their position, but their zone is `'location'`. `isCharacter` / `isAlive` exclude them, so selectors, targets and attacks skip them. They have `durability` and `readyTurn` (open when `g.turn >= readyTurn`) and no stats. `doActivate` uses one; `collectDeaths` removes it at 0 Durability.
- **Legality helpers only read public or own information** (`playInfo`, `canAttack`, `attackTargets`, `powerInfo`, `activateInfo`, `legalActions`), so they work on views. The UI and the bot use them on the player's view.
- **Decks are plain data** everywhere outside the menus: `{ id, name, hero, cards: { cardId: copies } }` (`deckData()`). Players' own decks live in localStorage (`MyDecks`, collection.js). The menus offer `playableDecks()` (own decks first, then the premade `DECKS`). Sessions get deck objects, and a guest sends its deck in `hello`, where the host runs `sanitizeDeck` and then `Engine.validateDeck`.
- **The UI is a queue.** `uiPush({ view, events, me, timer, reset })` queues an update. `uiShow` plays the events as animations on the current DOM (`anim.js`), then renders the new view (`board.js`, elements keyed by uid via `syncChildren`), then `afterRender` shows the state overlays (mulligan, Discover, waiting, game over). In hot-seat, a change of `me` splits the events at the `turn` event and shows the pass screen. `UI.gen` stops stale animation loops when a session ends.

## Code layout

Every script is a plain global script loaded by `<script>` tags in `index.html` (order: rules, engine, data, net, ui, main). The engine files are also listed in `tests/harness.js` `ENGINE_FILES`, so **a new data or engine file needs both entries**. Load order only matters for code that runs at load time (`defineCards` and the like need core.js first).

| File | Role |
|---|---|
| `js/rules.js` | `GAME_TITLE`, `PROTOCOL_VERSION`, `RULES` (every number of the rules) |
| `js/engine/core.js` | Registries (`CARDS`, `HEROES`, `DECKS`, `GRANTS`; `defineCards` / `defineHeroes` / `defineDecks`, `validateDeck`, `validateAll`, `cardsetHash`); RNG; the per-action runtime `g._rt` (non-enumerable: trigger queue, events, recorded choices); entities and stats (`refresh`, auras, `computeKw`); filters; triggers (`fire`, `resolveQueue`, `triggerHolders`); basic operations (`drawCard`, `dealDamage`, `healChar`, `freezeChar`, `summonMinion`, `equipWeapon`, `transformMinion`, `returnToHand`, `addEnchant`); the death phase; built-in cards (The Coin) |
| `js/engine/effects.js` | `EFFECTS` (one entry per effect), selectors (`select`, `SELECTOR_ALIASES`), target specs (`validTargets`), random pools, `runEffects`, `checkCond`, the script API (`apiFor`) |
| `js/engine/view.js` | `viewFor`, `redactEvents`: what one player may see |
| `js/engine/actions.js` | `newGame`, turns, `applyAction` → `runAction` (snapshot, replay), the `do*` pipelines, legality helpers, `whoActs`, the `Engine` facade |
| `js/engine/bot.js` | `Bot.act(view, player, { mode: 'greedy' / 'random' })` |
| `js/data/keywords.js` | Keyword names and tooltip text |
| `js/data/heroes.js`, `cards_demo.js`, `decks.js` | DEMO content |
| `js/net/peer.js` | `PeerTransport` (PeerJS, peer id `ogn-<code>`, one guest at a time, `busy` reject, `dropPeer`) |
| `js/net/lan.js` | `LanTransport` (WebSocket to server.js), `makeTransport(net)` |
| `js/net/session.js` | `LocalSession`, `BotSession`, `HostSession` (validates guest decks and actions, turn timer, heartbeat, rematch, autosave), `GuestSession` (token per room code, auto-reconnect); `sanitizeDeck`; the message protocol is listed at the top |
| `server.js` | Zero-dependency Node static server and RFC 6455 WebSocket relay with rooms; `/rooms`, `/lan-info` |
| `js/ui/cards.js` | Markup builders (`cardHTML`, `minionInner`, `heroInner`...), `fitCards` (shrinks long card names and texts; call it after inserting card HTML into the page), `esc` (escape every player-supplied string: names come over the network), keyword notes |
| `js/ui/collection.js` | `MyDecks` (localStorage `ogn_decks`), `allDecks` / `findDeck` / `playableDecks` / `deckData`, and `Coll`: the Collection screen (`#screen-collection`) with filters, the deck builder (limits, curve, auto-fill, copy, delete) and its own modal dialogs |
| `js/ui/board.js` | `UI` state, the update queue, rendering, state overlays, the game menu, log, rope timer, hover zoom |
| `js/ui/anim.js` | Event animations and history log text (only shows what the redacted events contain) |
| `js/ui/input.js` | Pointer interaction: drag or click cards, minion placement, the targeting arrow, Choose One, glows |
| `js/ui/menu.js` | Main menu, setup screens, deck pickers, lobby, settings, rules, resume |
| `js/main.js` | Boot, `#join=CODE` links, `?autoplay` debug modes |
| `tests/` | `harness.js`, `mechanics.test.js` (one scenario per rule, with test-only cards), `fuzz.test.js` (bot games plus invariants, replay determinism and redaction), `run.js` |

## Adding mechanics

1. Add a new effect as an entry in `EFFECTS`, a new selector in `select`, a new trigger event as a `fire(g, 'name', {...})` call at the right point of a pipeline, and a new keyword in `computeKw` users plus `KEYWORDS`.
2. Add a scenario to `tests/mechanics.test.js`.
3. Add a line to README "Card authoring".

## Gotchas

- **The stage is 100u tall and 160u–213u wide** (`--u` and `#stage` in style.css). Place things relative to the edges or `50%` (the centre), never at a fixed distance from the left edge for something meant to be centred.
- **Hand cards keep their hover area still.** The `.hand-card` wrapper is the hover area and stays in its fan position; only the `.card` inside lifts. Don't move the wrapper on hover, or the card flickers when the pointer is near its edge.
- **`p.board` is not only minions.** Code that loops over it for minion stats or statuses must check `zone === 'board'` (locations have no hp, atk or kw).
- **CSS class names are global.** Board classes such as `.hero`, `.power`, `.deck`, `.minion`, `.card` and `.art` style absolutely positioned game pieces. Menu markup must use its own names (the deck tiles use `d-*`).
- **Emoji art must exist in Windows 10's Segoe UI Emoji.** Avoid Emoji 13+ such as 🥷 and 🪙, which render as boxes.
- **Network messages must stay JSON.** Views are what the guest renders, so they must stay small and secret-free (the fuzz test checks this).
