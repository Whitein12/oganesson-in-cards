// ==========================================
// heroes.js - DEMO heroes (placeholders until the real heroes and hero powers arrive)
// A hero: { id, name, class, hp (default RULES.heroHp), art (emoji or image path), color,
//           power: { name, cost (default 2), text, art, target, targetFilter, effects: [...] } }
// A deck picks its hero; cards of a class can only go in decks of a hero with that class.
// ==========================================

defineHeroes([
    { id: 'demo_ember', name: 'Ember', class: 'ember', art: '🔥', color: '#d4552b',
      power: { name: 'Spark', cost: 2, art: '✨', text: 'Deal 1 damage.', target: 'any',
               effects: [{ do: 'damage', to: 'target', amount: 1 }] } },
    { id: 'demo_bulwark', name: 'Bulwark', class: 'bulwark', art: '🏰', color: '#3f78c0',
      power: { name: 'Reinforce', cost: 2, art: '⚔️', text: 'Summon a 1/1 Recruit.',
               effects: [{ do: 'summon', card: 'demo_recruit' }] } },
]);
