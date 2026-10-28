// ==========================================
// keywords.js - Keyword names and the tooltip text shown on zoomed cards
// The keys are what cards use in `keywords: [...]`; the last group are card slots, not keywords.
// ==========================================

const KEYWORDS = {
    taunt: { name: 'Taunt', text: 'Enemies must attack this minion.' },
    charge: { name: 'Charge', text: 'Can attack immediately.' },
    rush: { name: 'Rush', text: 'Can attack minions immediately.' },
    divineShield: { name: 'Divine Shield', text: 'The first time this takes damage, ignore it.' },
    windfury: { name: 'Windfury', text: 'Can attack twice each turn.' },
    stealth: { name: 'Stealth', text: 'Can\'t be attacked or targeted until it attacks or deals damage.' },
    lifesteal: { name: 'Lifesteal', text: 'Damage dealt also heals your hero.' },
    poisonous: { name: 'Poisonous', text: 'Destroy any minion damaged by this.' },
    elusive: { name: 'Elusive', text: 'Can\'t be targeted by spells or Hero Powers.' },
    reborn: { name: 'Reborn', text: 'Resurrects with 1 Health the first time it dies.' },
    immune: { name: 'Immune', text: 'Takes no damage.' },
    cantAttack: { name: 'Can\'t Attack', text: 'This minion can\'t attack.' },
    freeze: { name: 'Freeze', text: 'Frozen characters lose their next attack. A minion with Freeze freezes any character it damages.' },
    catalyst: { name: 'Catalyst', text: 'Minions you play next to this run their Battlecry twice.' },
    spellDamage: { name: 'Spell Damage', text: 'Your spells deal extra damage.' },
    silence: { name: 'Silence', text: 'Removes all card text, buffs and keywords from a minion.' },
    battlecry: { name: 'Battlecry', text: 'Does something when you play it from your hand.' },
    deathrattle: { name: 'Deathrattle', text: 'Does something when it dies.' },
    combo: { name: 'Combo', text: 'A bonus if you already played a card this turn.' },
    spellburst: { name: 'Spellburst', text: 'Does something once, the next time you cast a spell.' },
    overload: { name: 'Overload', text: 'You have fewer Mana Crystals to spend next turn.' },
    secret: { name: 'Secret', text: 'Hidden until it triggers on your opponent\'s turn.' },
    discover: { name: 'Discover', text: 'Choose one of three cards to add to your hand.' },
    chooseOne: { name: 'Choose One', text: 'Pick one of the effects when you play it.' },
    location: { name: 'Location', text: 'Takes a minion\'s place on the board. Click it to use its effect: it loses 1 Durability and closes until your 2nd turn after that. It is destroyed at 0 Durability.' },
    trigger: { name: 'Trigger', text: 'Reacts to something happening in the game.' },
    aura: { name: 'Aura', text: 'Affects other cards while this is in play.' },
};
