// ==========================================
// rules.js - Game title and rule constants
// ==========================================

const GAME_TITLE = 'Oganesson in Cards';
const PROTOCOL_VERSION = 3; // bump when the network messages change (session.js)

const RULES = {
    heroHp: 30,            // a hero's starting and max Health (a hero definition can set its own hp)
    deckSize: 30,
    maxMana: 10,           // Mana Crystals cap; you gain one at the start of each of your turns
    handLimit: 10,         // a card drawn into a full hand is burned
    boardLimit: 7,         // minions per side
    startHand: [3, 4],     // opening hand: [player going first, player going second]
    coin: true,            // the player going second gets The Coin after the mulligan
    mulligan: true,
    heroPowerCost: 2,      // used when a hero power doesn't set its own cost
    maxCopies: 2,          // copies of one card in a deck
    maxLegendaryCopies: 1,
    maxSecrets: 5,
    locationCooldown: 2,   // a used location stays closed until this many of its owner's turns later (2 = it skips your next turn)
    turnSeconds: 90,       // online / LAN turn timer (0 = off); hot-seat and bot games have none
    mulliganSeconds: 45,
    ropeSeconds: 20,       // the rope burns during the last N seconds of a turn
    maxTurns: 90,          // after this many turns (both players' turns count) the game is a draw
    loopLimit: 2000,       // trigger resolutions in one action before a runaway chain is stopped
};
