# Oganesson in Cards

A two-player card game in the style of Hearthstone. It runs in the browser with vanilla JavaScript, has no build step and no dependencies, and can be played on one screen, against a bot, over the internet with a room code, or on a local network without internet.

> **Demo build.** The cards, heroes and the two decks in `js/data/` are placeholders that exercise every engine mechanic. Replace them with the real set. See [Card authoring](#card-authoring).

## Rules

| Rule | Value (all in `js/rules.js`) |
|---|---|
| Hero Health | 30 |
| Deck size | 30 cards, max 2 copies (1 for legendaries) |
| Mana | 1 crystal on your first turn, +1 every turn, up to 10 |
| Opening hand | 3 cards going first, 4 + The Coin going second, with a mulligan |
| Hero Power | Once per turn, 2 mana by default (each hero sets its own) |
| Limits | 10 cards in hand (extra draws burn), 7 minions and locations per side, 5 secrets |
| Fatigue | Drawing from an empty deck deals 1, then 2, then 3... damage |
| Turn timer | 90 s for online and LAN games (the rope burns for the last 20 s) |
| Turn limit | The game is a draw after 90 turns |

You can only play cards, attack and use your Hero Power during your own turn.

## Playing

| How | Start it with | Notes |
|---|---|---|
| **Hot-seat** (one screen) | `PlayGame.bat` | A pass screen hides each hand between turns |
| **Practice vs Bot** | `PlayGame.bat` | A simple greedy bot |
| **Online** (room code) | `PlayGame.bat` or GitHub Pages | WebRTC through PeerJS; both players need internet |
| **LAN** (no internet) | `PlayLAN.bat` (needs Node.js) | Friends open the address it prints |

- `PlayGame.bat` serves the folder with Python on <http://localhost:8000>.
- `PlayLAN.bat` runs `server.js` on port 8080, which serves the game to the whole network and relays the moves.
- The page must be served over HTTP; opening `index.html` as a file won't work.

### Collection and decks

**Collection** on the main menu shows every card, with filters for class, mana cost and type, and a search box. To build a deck:

1. Choose **New Deck** and pick a hero.
2. Click cards to add them (right-click, or click a card in the deck list, to take one out). **Auto-fill** completes the deck with random cards.
3. Choose **Save**.

The rules are enforced as you build: 30 cards, at most 2 copies (1 of a legendary), and only neutral cards plus your hero's class cards. Premade decks open read-only; **Make a copy** to change one.

Your decks are saved in this browser and appear in every game mode. In online and LAN games your deck list is sent to the host, which checks it before the game starts.

**Controls**
- Drag a card onto the board, or click it and then click the board. Drop minions between other minions to choose their spot.
- Drag from a minion or your hero onto an enemy to attack.
- Click your Hero Power or one of your locations to use it. Targeted things show an arrow; click or release on a highlighted target.
- Right-click or Esc cancels. Hover anything on the board to see its card.

### Online games

1. One player chooses **Host Online**, picks a deck, and gets a 5-letter code plus an invite link.
2. The other chooses **Join Online** (or opens the link) and enters the code.

The host's browser runs the game; the guest only ever receives what it is allowed to see. If the guest drops, it reconnects by itself (or with **Join** and the same code). If the host closes the page, **Resume** on the host's menu reopens the same room.

Online play uses the free PeerJS signaling server (0.peerjs.com) to connect the two browsers. To use your own, see the comment at the top of `js/net/peer.js`.

### LAN games

1. The host runs `PlayLAN.bat`. The first time, Windows Firewall asks about Node.js: allow it on **Private networks**.
2. The window prints addresses such as `http://192.168.1.23:8080`. The other player opens that address, and the host lobby shows it too.
3. Host: **Host LAN Game**. Guest: **Join LAN Game**, which lists the open games.

### Putting it on GitHub Pages

The game is a static site, so GitHub Pages can serve it as it is.

1. Create a repository and push this folder to it.
2. On GitHub, go to **Settings → Pages**, set **Source** to *Deploy from a branch*, and choose `main` and `/ (root)`.
3. After a minute the game is live at `https://<user>.github.io/<repo>/`. Hot-seat, bot and online games work there.

The LAN server is not available on Pages. It needs `PlayLAN.bat` on a computer in the network.

Both players must run the same version. If the cards differ, the host refuses the guest and says so.

## Card authoring

Cards are JavaScript objects passed to `defineCards([...])`, so a file can hold any number of them. To add a file:

1. Put the file in `js/data/`.
2. Add a `<script>` tag for it in `index.html`, before `decks.js`.
3. Add it to `ENGINE_FILES` in `tests/harness.js`.

Effects are mostly declarative. Anything they can't express can be a function, as shown under [Script API](#script-api).

```js
defineCards([
    { id: 'fire_bolt', name: 'Fire Bolt', type: 'spell', cost: 1, class: 'ember', rarity: 'common', art: '☄️',
      text: 'Deal $2 damage.', target: 'any', play: [{ do: 'damage', to: 'target', amount: 2 }] },

    { id: 'hive_mother', name: 'Hive Mother', type: 'minion', cost: 3, atk: 2, hp: 2, tribe: 'beast', art: '🕷️',
      text: '**Deathrattle:** Summon two 1/1 Hatchlings.',
      deathrattle: [{ do: 'summon', card: 'hatchling', count: 2 }] },

    { id: 'hatchling', name: 'Hatchling', type: 'minion', cost: 1, atk: 1, hp: 1, collectible: false },
]);
```

### Card fields

| Field | Meaning |
|---|---|
| `id` | Unique id; decks and effects use it |
| `name`, `text` | Shown on the card. `**Bold**`; `$3` is a number that Spell Damage raises. Long texts and names shrink (names wrap to two lines) to fit the card |
| `type` | `'minion'`, `'spell'`, `'weapon'` or `'location'` |
| `cost` | Mana cost |
| `atk`, `hp` | Minions |
| `atk`, `durability` | Weapons |
| `durability` | Locations: how many times it can be used |
| `class` | `'neutral'` or a hero's `class`. Class cards only go in that hero's decks |
| `rarity` | `common`, `rare`, `epic` or `legendary` (legendary: 1 copy per deck) |
| `art` | An emoji, or an image path such as `'img/cards/fire_bolt.png'` |
| `tribe` | Free text, such as `'beast'`; filters can check it |
| `keywords` | e.g. `['taunt', 'divineShield']`, see [Keywords](#keywords) |
| `spellDamage` | e.g. `1` for Spell Damage +1 |
| `overload` | Mana Crystals locked next turn |
| `collectible: false` | A token: never in decks or random pools |
| `play` | A spell's effects |
| `battlecry` | A minion's or weapon's effects when played from hand |
| `combo` | Extra effects if another card was played earlier this turn |
| `deathrattle` | Effects when it dies |
| `spellburst` | A minion's effects, once, after you next cast a spell (secrets count). `eventSubject` is the spell |
| `activate` | A location's effects when it is used, see [Locations](#locations) |
| `triggers` | Reactions to game events, see [Triggers](#triggers) |
| `aura` | Continuous bonuses while it is in play, see [Auras](#auras) |
| `secret` | Makes a spell a Secret, see [Secrets](#secrets) |
| `chooseOne` | `[{ name, text, art, target, effects }, ...]`, where the player picks one option |
| `target` | The card asks for a target, see [Targets](#targets) |
| `targetFilter` | Limits the targets, e.g. `{ minAtk: 5 }` or `(e, api) => e.damage > 0` |
| `targetIf` | Only asks for a target when true, e.g. `'combo'` |
| `playIf` | A condition; the card can't be played without it |
| `activateIf` | A condition; the location can't be used without it |

### Keywords

| Keyword | Meaning |
|---|---|
| `taunt` | Enemies must attack it first |
| `charge` | Can attack immediately |
| `rush` | Can attack minions immediately |
| `divineShield` | Ignores the first damage |
| `windfury` | Two attacks per turn |
| `stealth` | Can't be targeted or attacked until it attacks or deals damage |
| `lifesteal` | Damage it deals heals its owner's hero |
| `poisonous` | Destroys any minion it damages |
| `elusive` | Can't be targeted by spells or Hero Powers |
| `reborn` | Comes back once with 1 Health |
| `immune` | Takes no damage |
| `cantAttack` | Can't attack |
| `freeze` | On a minion: freezes any character it damages |
| `catalyst` | Minions you play next to it run their Battlecry (or Choose One option) twice; two Catalyst neighbours don't stack |

Battlecry, Deathrattle, Combo, Overload, Secret, Choose One, Discover and Location are explained on the card automatically.

### Effects

Each effect is `{ do: '<name>', ...options }`. Any effect can also take `times: 3` (repeat it) and `if: <condition>` (only when true).

| Effect | Options |
|---|---|
| `damage` | `to`, `amount` (spells add Spell Damage) |
| `heal` | `to`, `amount` |
| `draw` | `amount` (1), `who` (`'me'` / `'enemy'` / `'both'`), `filter` (draw a matching card) |
| `summon` | `card`, `count` (1), `side` (`'me'` / `'enemy'`) |
| `buff` | `to`, `atk`, `hp`, `keywords`, `spellDamage`, `oneTurn`, `deathrattle: [...]`, `triggers: [...]` |
| `setStats` | `to`, `atk`, `hp` |
| `destroy`, `silence`, `freeze`, `bounce` | `to` (`bounce` returns it to its owner's hand) |
| `transform` | `to`, `into` (card id) |
| `armor` | `amount`, `who` |
| `heroAttack` | `amount` (your hero gets that much Attack this turn) |
| `mana` | `amount`, `kind`: `temp` (this turn), `full`, `empty`, `destroy`, `refill` |
| `addCard` | `card`, or `pool` (random), `count`, `who` |
| `discover` | `pool`, `count` (3): the player picks one of the random cards |
| `discard` | `count`, `who` (random cards from hand) |
| `equip` | `card` (a weapon) |
| `weaponBuff` | `atk`, `durability`, `who` |
| `destroyWeapon` | `who` (`'enemy'` by default) |
| `costMod` | `to` (`'myHand'`), `amount`, `filter` |
| `nextCost` | `amount`, `filter`, `uses` (1): "your next spell costs (2) less" |
| `if` | `cond`, `then: [...]`, `else: [...]` |

A number can also be a function: `amount: api => api.me.hand.length`.

A **pool** is a filter over collectible cards, such as `{ type: 'spell', class: 'mine' }`, or a list of ids.

### Selectors (`to:`)

- **Chosen:** `target`, `self`
- **Heroes:** `myHero`, `enemyHero`, `bothHeroes`
- **Minions:** `myMinions`, `enemyMinions`, `allMinions`, `otherMyMinions`, `otherMinions`, `adjacent`, `targetAdjacent`
- **Characters** (heroes and minions): `myCharacters`, `enemyCharacters`, `allCharacters`
- **Random** (picked again for each repeat): `randomEnemyMinion`, `randomMyMinion`, `randomOtherMyMinion`, `randomMinion`, `randomEnemyCharacter`, `randomCharacter`
- **From the triggering event:** `eventSubject`, `eventTarget`, `eventSource`
- **Locations:** `myLocations`, `enemyLocations`
- **Other:** `myWeapon`, `enemyWeapon`, `myHand`, `enemyHand`

`friendly…` works as well as `my…` (for example `friendlyMinions`). `to` can also be a list of selectors or a function `api => [entities]`.

### Targets

`target:` sets what a card or Hero Power may be aimed at:

| Value | Can target |
|---|---|
| `'any'` | Any character |
| `'minion'` | Any minion |
| `'enemyMinion'` | An enemy minion |
| `'friendlyMinion'` | A friendly minion |
| `'enemy'` | An enemy character (hero or minion) |
| `'friendly'` | A friendly character (hero or minion) |
| `'hero'` | Either hero |
| `'enemyHero'` | The enemy hero |
| `'friendlyHero'` | Your own hero |

Targeting follows the Hearthstone rules:
- **Spells** need a valid target to be played.
- **Battlecries** may be played without one when none exist.
- **Stealthed enemies** can't be chosen.
- **Elusive minions** ignore spells and Hero Powers.

### Filters and conditions

**Filters** are an object such as `{ type, tribe, class: 'mine', rarity, id, minCost, maxCost, minAtk, maxAtk, damaged, keyword, not }`, or a function `(entity, api) => boolean`.

**Conditions** are used by `if`, `when`, `playIf` and `targetIf`. They can be:
- a function `api => boolean`
- `'combo'`
- `{ control: filter, count }`
- `{ holding: filter }`
- `{ damaged: true }` (the target is damaged)
- `{ not: condition }`

### Triggers

```js
triggers: [{ on: 'turnEnd', who: 'friendly', effects: [{ do: 'heal', to: 'myHero', amount: 2 }] }]
```

| Field | Meaning |
|---|---|
| `on` | The event, see the table below |
| `who` | Whose event counts: `'friendly'`, `'enemy'`, `'any'` or `'self'` (it happened to this card). Turn events default to `'friendly'`, the rest to `'any'` |
| `other: true` | Ignores events about this card itself |
| `filter` | Checks the event's subject, e.g. `{ type: 'minion' }` |
| `targetIs` | Checks the event's target (attacks), e.g. `'myHero'` |
| `when` | Any condition |

| Event | Subject (and target) |
|---|---|
| `turnStart`, `turnEnd` | The player |
| `cardPlayed` / `afterCardPlayed` | The card, before / after it resolves |
| `spellCast` / `afterSpell` | The spell |
| `summoned` / `afterSummon` | The minion |
| `minionDied` | The minion |
| `damaged`, `healed` | The character (`event.amount`, `event.source`) |
| `attack` / `afterAttack` | The attacker (target: the defender) |
| `heroPower` | The hero power |
| `locationUsed` | The location (target: its chosen target), after its effect |
| `cardDrawn` | The card |
| `secretRevealed` | The secret |

Triggers wait in a queue and resolve after the current step finishes (in play order), as in Hearthstone. Deaths are handled after that.

### Auras

```js
aura: { to: 'otherMyMinions', atk: 1 }                       // your other minions have +1 Attack
aura: { to: 'myHand', filter: { type: 'spell' }, cost: -1 }  // your spells cost (1) less
aura: { to: 'adjacent', keywords: ['taunt'] }                 // adjacent minions have Taunt
```

An aura can also be a list of these objects. A minion that loses a Health aura only loses Health above its new maximum, so it never dies from it.

### Secrets

```js
secret: { on: 'attack', who: 'enemy', targetIs: 'myHero', effects: [{ do: 'armor', amount: 8 }] }
```

The opponent sees only that a Secret exists. It triggers once, during the opponent's turn, and is then revealed.

### Locations

```js
{ id: 'training_grounds', name: 'Training Grounds', type: 'location', cost: 2, durability: 3, art: '🏟️',
  text: 'Give a friendly minion +1/+1.', target: 'friendlyMinion', activate: [{ do: 'buff', to: 'target', atk: 1, hp: 1 }] }
```

- Playing a location puts it in the minion row, where the player chooses its spot. It takes one of the 7 slots.
- Clicking it runs `activate`. It can be used on the turn it is played.
- Each use costs 1 Durability and closes the location until your `RULES.locationCooldown`-th turn after that (only your own turns count). The default is 2: used on one turn, it stays closed on your next turn and opens on the one after.
- At 0 Durability it is destroyed after its effect resolves.
- `target`, `targetFilter` and `targetIf` belong to the activation, as on a Hero Power. With no valid target the location can't be used.
- A location is not a minion:
  - It has no Attack or Health, can't attack or be attacked, and can't be chosen as a target.
  - Minion selectors, Silence, and summon and death triggers ignore it.
  - To reach it, use `myLocations` / `enemyLocations`, for example `{ do: 'destroy', to: 'enemyLocations' }`.
- Triggers, auras and a deathrattle work on a location as on a minion. A minion summoned by a location appears to its right.

### Script API

Any entry in an effect list can be a function. It receives `api`:

```js
play: [api => {
    const n = api.me.hand.length;
    api.damage(api.select('randomEnemyCharacter'), n);
    if (api.combo) api.draw(1);
}]
```

| Name | What it gives you |
|---|---|
| `me`, `opp` | The two players' state |
| `self`, `target`, `event` | The source card, the chosen target, the triggering event |
| `combo`, `turn`, `isMyTurn` | Game situation |
| `select(sel)` | Entities for a selector |
| `run(effects)` | Runs a list of declarative effects |
| `damage(t, n)`, `heal(t, n)`, `draw(n)`, `summon(id, side)` | Basic actions |
| `buff(t, atk, hp, keywords)`, `destroy(t)`, `silence(t)`, `freeze(t)` | Changes to characters |
| `armor(n)`, `addCard(id, who)`, `transform(t, id)`, `bounce(t)` | More changes |
| `random(list)`, `randomInt(n)` | The game's own random numbers |
| `choose(cardIds)` | Shows the cards like Discover and returns the picked index |
| `spellDamage()`, `card(id)` | Lookups |

Two rules keep online games in sync:
1. Use `api.random` / `api.randomInt`, never `Math.random`.
2. Keep state only in the game itself, never in outside variables.

The host replays an action when a choice is made, and the result must come out the same.

### Heroes and Hero Powers (`js/data/heroes.js`)

```js
defineHeroes([{ id: 'ember', name: 'Ember', class: 'ember', art: '🔥', color: '#d4552b', hp: 30,
    power: { name: 'Spark', cost: 2, art: '✨', text: 'Deal 1 damage.', target: 'any',
             effects: [{ do: 'damage', to: 'target', amount: 1 }] } }]);
```

### Premade decks (`js/data/decks.js`)

```js
defineDecks([{ id: 'aggro', name: 'Aggro', hero: 'ember', cards: { fire_bolt: 2, hive_mother: 2 /* ... 30 in total */ } }]);
```

The main menu lists any problems: a wrong deck size, too many copies, unknown cards, or the wrong class. `node tests/run.js` checks the same things. Players can also build their own decks in the Collection; those live in their browser.

## Tests

```
node tests/run.js         # rules tests + 1000 random bot games (about a minute)
node tests/run.js 200     # fewer games
```

The fuzz games check every rule invariant after every action. They also check that replays are exact, that no hidden information leaks into a player's view, and that every demo card gets played.

There are also debug URLs that watch the bots play, for example `?autoplay=bots&seed=3`; see `js/main.js`.

## Files

See `CLAUDE.md` for the code map.
