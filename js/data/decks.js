// ==========================================
// decks.js - DEMO decks. A deck: { id, name, hero, cards: { cardId: copies } } with exactly RULES.deckSize cards.
// validateAll() (core.js) checks the size, copy limits, classes and that every card exists.
// ==========================================

defineDecks([
    { id: 'demo_aggro', name: 'Demo Aggro', hero: 'demo_ember', cards: {
        demo_spark_wisp: 1, demo_venom_spitter: 1, demo_bristle_boar: 2, demo_radiant_squire: 2, demo_flame_hurler: 1,
        demo_dagger_juggler: 2, demo_apprentice_mage: 1, demo_fire_bolt: 2, demo_lightning_lash: 2, demo_quick_blade: 2,
        demo_wild_charger: 1, demo_flux_elemental: 2, demo_shadow_prowler: 1, demo_ember_blade: 1, demo_counter_flame: 1, demo_spark_collector: 2,
        demo_storm_hawk: 1, demo_flame_wave: 1, demo_warchief: 1, demo_arcane_insight: 1, demo_ember_dragon: 1, demo_gust: 1,
    } },
    { id: 'demo_control', name: 'Demo Control', hero: 'demo_bulwark', cards: {
        demo_shieldbearer: 2, demo_mist_drake: 1, demo_mend: 1, demo_hush: 1, demo_blood_leech: 2, demo_scholar: 1, demo_alchemist: 2,
        demo_hive_mother: 2, demo_restless_spirit: 1, demo_raging_brute: 1, demo_field_medic: 1, demo_fortify: 2,
        demo_frost_sprite: 1, demo_volatile_imp: 1, demo_drill_sergeant: 1, demo_quake: 1, demo_topple: 1, demo_hex_toad: 1,
        demo_rune_scribe: 1, demo_natures_call: 1, demo_mana_surge: 1, demo_ice_barrier: 1, demo_shield_charge: 1,
        demo_ironhide_ogre: 1, demo_stone_colossus: 1,
    } },
]);
