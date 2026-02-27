/**
 * config.js — v1.2.0
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export const MODULE_ID      = 'daggerheart-cond-fx';
export const SETTINGS_KEY   = 'conditionalEffects';
export const FLAG_ASSIGNED  = 'assignedEffects';
export const FLAG_ACTOR     = 'actorEffects';
export const SCENE_FLAG       = 'sceneOverrides';   // Legacy — kept for migration
export const FLAG_SCENE_OFF   = 'sceneDisabled';    // Array of effect IDs force-disabled in this scene
export const FLAG_PC_TOGGLES  = 'pcToggles';        // Key for the Scene flag (PCs)
export const FLAG_NPC_TOGGLES = 'npcToggles';       // Key for the Scene flag (Adversaries)

export const APPLICABLE_ITEM_TYPES = ['weapon', 'armor', 'domainCard', 'feature'];
export const ADV_MODE = { NORMAL: 0, ADVANTAGE: 1, DISADVANTAGE: -1 };

export const STATUSES = [
    // ── Daggerheart-specific statuses ────────────────────────────────────────
    { id: 'dead',         label: 'Dead'          },
    { id: 'deathMove',    label: 'Death Move'    },
    { id: 'defeated',     label: 'Defeated'      },
    { id: 'hidden',       label: 'Hidden'        },
    { id: 'restrained',   label: 'Restrained'    },
    { id: 'unconscious',  label: 'Unconscious'   },
    { id: 'vulnerable',   label: 'Vulnerable'    },
    // ── Foundry core statuses (IDs verified via actor.statuses console dump) ─
    { id: 'bleeding',     label: 'Bleeding'      },
    { id: 'bless',        label: 'Blessed'       },
    { id: 'blind',        label: 'Blind'         },
    { id: 'burning',      label: 'Burning'       },
    { id: 'burrow',       label: 'Burrowing'     },
    { id: 'coldShield',   label: 'Ice Shield'    },
    { id: 'corrode',      label: 'Corroding'     },
    { id: 'curse',        label: 'Cursed'        },
    { id: 'deaf',         label: 'Deaf'          },
    { id: 'degen',        label: 'Degenerating'  },
    { id: 'disease',      label: 'Diseased'      },
    { id: 'downgrade',    label: 'Weakened'       },
    { id: 'eye',          label: 'Marked'        },
    { id: 'fear',         label: 'Frightened'    },
    { id: 'fireShield',   label: 'Fire Shield'   },
    { id: 'fly',          label: 'Flying'        },
    { id: 'frozen',       label: 'Frozen'        },
    { id: 'holyShield',   label: 'Holy Shield'   },
    { id: 'hover',        label: 'Hovering'      },
    { id: 'invisible',    label: 'Invisible'     },
    { id: 'magicShield',  label: 'Magic Shield'  },
    { id: 'paralysis',    label: 'Paralyzed'     },
    { id: 'poison',       label: 'Poisoned'      },
    { id: 'prone',        label: 'Prone'         },
    { id: 'regen',        label: 'Regenerating'  },
    { id: 'restrain',     label: 'Restrained (Core)' },
    { id: 'shock',        label: 'Shocked'       },
    { id: 'silence',      label: 'Silenced'      },
    { id: 'sleep',        label: 'Asleep'        },
    { id: 'stun',         label: 'Stunned'       },
    { id: 'target',       label: 'Targeted'      },
    { id: 'upgrade',      label: 'Empowered'     },
];

export const ATTRIBUTES = [
    { id: 'hope',          label: 'Hope (current)'        },
    { id: 'hope_pct',      label: 'Hope (% of max)'       },
    { id: 'stress',        label: 'Stress (current)'      },
    { id: 'stress_pct',    label: 'Stress (% of max)'     },
    { id: 'hitPoints',     label: 'Hit Points (current)'  },
    { id: 'hitPoints_max', label: 'Hit Points (max)'      },
    { id: 'hitPoints_pct', label: 'Hit Points (% of max)' },
    { id: 'evasion',       label: 'Evasion'               },
    { id: 'proficiency',   label: 'Proficiency'           },
    { id: 'armorScore',    label: 'Armor Score'           },
    { id: 'agility',       label: 'Agility'               },
    { id: 'strength',      label: 'Strength'              },
    { id: 'finesse',       label: 'Finesse'               },
    { id: 'instinct',      label: 'Instinct'              },
    { id: 'presence',      label: 'Presence'              },
    { id: 'knowledge',     label: 'Knowledge'             },
];

export const OPERATORS = [
    { id: '>=', label: '>= (at least)'    },
    { id: '<=', label: '<= (at most)'     },
    { id: '==', label: '= (equal to)'     },
    { id: '>',  label: '> (greater than)' },
    { id: '<',  label: '< (less than)'    },
];

export const CONDITION_TYPES = [
    { id: 'always',      label: 'Always (unconditional)'       },
    { id: 'status',      label: 'Subject has Status/Condition' },
    { id: 'attribute',   label: 'Subject Attribute Value'      },
    { id: 'range',       label: 'Proximity / Range'             },
    { id: 'weapon',      label: 'Weapon Slot'                  },
    { id: 'damage_type', label: 'Incoming Damage Type'         },
    // ── Trigger-based conditionals (set by events) ─────────────────────────
    { id: 'took_threshold',      label: 'When Subject Takes Damage Threshold' },
    { id: 'inflicted_threshold', label: 'When Subject Inflicts Damage Threshold' },
    { id: 'rolled_fear',         label: 'When Subject Rolls with Fear' },
    { id: 'rolled_critical',     label: 'When Subject Rolls a Critical Success' },
    { id: 'spent_hope',          label: 'When Subject Spends Hope' },
    { id: 'armor_slot_marked',   label: 'When Subject Marks an Armor Slot' },
    { id: 'no_armor_remaining',  label: 'Subject Has No Armor Remaining' },
];

export const DAMAGE_THRESHOLDS = [
    { id: 'minor',  label: 'Minor'  },
    { id: 'major',  label: 'Major'  },
    { id: 'severe', label: 'Severe' },
];

export const DURATION_MODES = [
    { id: 'permanent',     label: 'Permanent' },
    { id: 'once',          label: 'Once (consumed on first use)' },
    { id: 'uses',          label: 'Limited Uses' },
    { id: 'next_roll',     label: 'Next Roll Only' },
    { id: 'next_damage',   label: 'Next Hit/Damage Only' },
    { id: 'end_of_combat', label: 'Until End of Combat' },
    { id: 'countdown',     label: 'Countdown (ticks down on events)' },
];

export const COUNTDOWN_TICK_EVENTS = [
    { id: 'round_start',  label: 'Each Round (start of turn)' },
    { id: 'on_roll',      label: 'Each Roll' },
    { id: 'on_attacked',  label: 'Each Time Attacked' },
    { id: 'on_damage',    label: 'Each Time Damaged' },
];

export const EFFECT_TYPES = [
    { id: 'damage_bonus',      label: 'Damage Bonus (dice and/or flat)'              },
    { id: 'damage_multiplier', label: 'Damage Multiplier (multiply damage taken)'    },
    { id: 'damage_reduction',  label: 'Damage Threshold Bonus (major / severe)'      },
    { id: 'defense_bonus',     label: 'Evasion / Difficulty Bonus (flat)'             },
    { id: 'proficiency_bonus', label: 'Proficiency Bonus (while condition met)'      },
    { id: 'status_on_hit',     label: 'Apply Status to Target on Hit'                },
    { id: 'stress_on_hit',     label: 'Apply Stress to Target on Hit'                },
    { id: 'apply_status',      label: 'Apply Status to Subject (while condition met)'},
    { id: 'roll_bonus',        label: 'Roll Bonus (flat)'                            },
    { id: 'advantage',         label: 'Grant Advantage'                              },
    { id: 'disadvantage',      label: 'Force Disadvantage'                           },
];

export const DAMAGE_TYPES = [
    { id: 'physical',        label: 'Physical'                 },
    { id: 'magical',         label: 'Magical'                  },
    { id: 'primaryWeapon',   label: 'Primary Weapon'           },
    { id: 'secondaryWeapon', label: 'Secondary Weapon'         },
    { id: 'any',             label: 'Any (physical + magical)' },
];

export const INCOMING_DAMAGE_TYPES = [
    { id: 'physical', label: 'Physical' },
    { id: 'magical',  label: 'Magical'  },
    { id: 'any',      label: 'Any'      },
];

export const RANGE_TYPES = [
    { id: 'melee',     label: 'Melee'      },
    { id: 'veryClose', label: 'Very Close'  },
    { id: 'close',     label: 'Close'       },
    { id: 'far',       label: 'Far'         },
    { id: 'veryFar',   label: 'Very Far'    },
];

export const RANGE_MODES = [
    { id: 'within',    label: 'Within Range (at or closer)' },
    { id: 'at',        label: 'At Range (exact band)'       },
    { id: 'beyond',    label: 'Further Than'                 },
];

export const RANGE_SUBJECTS = [
    { id: 'target',   label: 'Current Target(s)' },
    { id: 'attacker', label: 'Attacker'           },
    { id: 'friends',  label: 'Friendly Tokens'    },
    { id: 'enemies',  label: 'Hostile Tokens'     },
];

export const WEAPON_SLOTS = [
    { id: 'primary',   label: 'Primary'   },
    { id: 'secondary', label: 'Secondary' },
    { id: 'any',       label: 'Any'       },
];

export const TRAITS = [
    { id: 'any',       label: 'Any Trait'  },
    { id: 'agility',   label: 'Agility'    },
    { id: 'strength',  label: 'Strength'   },
    { id: 'finesse',   label: 'Finesse'    },
    { id: 'instinct',  label: 'Instinct'   },
    { id: 'presence',  label: 'Presence'   },
    { id: 'knowledge', label: 'Knowledge'  },
];

export const ACTION_ROLL_TYPES = [
    { id: 'any',      label: 'Any Roll'      },
    { id: 'action',   label: 'Action Roll'   },
    { id: 'reaction', label: 'Reaction Roll' },
];

export const APPLY_TARGETS = [
    { id: 'self',     label: 'Self (when you act)' },
    { id: 'incoming', label: 'Incoming (when targeted)' },
];

/** Resolve applyTo from new field or legacy beneficial boolean (config-side mirror of main.js _getApplyTo) */
export function resolveApplyTo(ce) {
    if (ce.effect?.applyTo) return ce.effect.applyTo;
    const aeTypes = ['defense_bonus', 'damage_reduction', 'proficiency_bonus'];
    if (aeTypes.includes(ce.effect?.type)) return 'self';
    return ce.beneficial !== false ? 'self' : 'incoming';
}

export function defaultEffect() {
    return {
        id:          foundry.utils.randomID(),
        name:        'New Conditional Effect',
        description: '',
        enabled:     true,
        duration: {
            mode: 'permanent',
            uses: 1,
            countdownTicks: 3,
            countdownTickOn: 'round_start',
        },
        condition: {
            type:               'always',
            subject:            'target',
            status:             'vulnerable',
            attribute:          'hope',
            operator:           '>=',
            value:              1,
            range:              'close',
            rangeMode:          'within',
            rangeSubject:       'target',
            rangeCount:         1,
            weaponSlot:         'any',
            incomingDamageType: 'any',
            threshold:          'major',
        },
        effect: {
            type:              'damage_bonus',
            applyTo:           'self',
            damageType:        'physical',
            incomingDamageType: 'any',
            dice:              '',
            bonus:             0,
            rollBonus:         0,
            thresholdMajor:    0,
            thresholdSevere:   0,
            defenseBonus:      0,
            statusToApply:     'vulnerable',
            applyStatus:       'vulnerable',
            damageMultiplier:  2,
            traitFilter:       'any',
            actionTypeFilter:  'any',
            proficiencyBonus:  1,
            stressAmount:      1,
            chainEffectIds:    [],
        },
    };
}

// ─── Effect Presets Library ───────────────────────────────────────────────────

export const EFFECT_PRESETS = [
    {
        category: 'Status-Based',
        presets: [
            {
                name: 'Vulnerable — Advantage on Attacks',
                description: 'Grant advantage on attack rolls against a Vulnerable target.',
                icon: 'fa-crosshairs',
                data: {
                    name: 'Vulnerable — Advantage on Attacks',
                    description: 'Attacks against a Vulnerable target have advantage.',
                    condition: { type: 'status', subject: 'target', status: 'vulnerable' },
                    effect: { type: 'advantage', applyTo: 'self' },
                    duration: { mode: 'permanent' },
                },
            },
            {
                name: 'Hidden — Disadvantage on Attacks',
                description: 'Force disadvantage on attacks against a Hidden target.',
                icon: 'fa-eye-slash',
                data: {
                    name: 'Hidden — Disadvantage on Attacks',
                    description: 'Attacks against a Hidden target have disadvantage.',
                    condition: { type: 'status', subject: 'self', status: 'hidden' },
                    effect: { type: 'disadvantage', applyTo: 'incoming' },
                    duration: { mode: 'permanent' },
                },
            },
            {
                name: 'Blessed — Threshold +2',
                description: 'While Blessed, increase damage thresholds by +2 Major/Severe.',
                icon: 'fa-hand-sparkles',
                data: {
                    name: 'Blessed — Threshold +2',
                    description: 'Blessed increases damage thresholds by +2.',
                    condition: { type: 'status', subject: 'self', status: 'bless' },
                    effect: { type: 'damage_reduction', applyTo: 'self', thresholdMajor: 2, thresholdSevere: 2 },
                    duration: { mode: 'permanent' },
                },
            },
            {
                name: 'Poisoned — Extra Damage Taken',
                description: 'While Poisoned, incoming damage is multiplied by 1.5×.',
                icon: 'fa-skull-crossbones',
                data: {
                    name: 'Poisoned — Extra Damage Taken',
                    description: 'Poisoned targets take 1.5× incoming damage.',
                    condition: { type: 'status', subject: 'self', status: 'poison' },
                    effect: { type: 'damage_multiplier', damageMultiplier: 1.5, incomingDamageType: 'any' },
                    duration: { mode: 'permanent' },
                },
            },
            {
                name: 'Weakened — Roll Penalty',
                description: 'While Weakened, subtract 2 from all rolls.',
                icon: 'fa-arrow-down',
                data: {
                    name: 'Weakened — Roll Penalty',
                    description: 'Weakened imposes -2 to all rolls.',
                    condition: { type: 'status', subject: 'self', status: 'downgrade' },
                    effect: { type: 'roll_bonus', applyTo: 'self', rollBonus: -2 },
                    duration: { mode: 'permanent' },
                },
            },
        ],
    },
    {
        category: 'Attribute-Based',
        presets: [
            {
                name: 'Low HP Rage — +1d6 Damage',
                description: 'When below 25% HP, gain +1d6 damage on attacks.',
                icon: 'fa-fire',
                data: {
                    name: 'Low HP Rage',
                    description: 'Below 25% HP: +1d6 damage bonus.',
                    condition: { type: 'attribute', subject: 'self', attribute: 'hitPoints_pct', operator: '<=', value: 25 },
                    effect: { type: 'damage_bonus', applyTo: 'self', dice: '1d6', bonus: 0, damageType: 'any' },
                    duration: { mode: 'permanent' },
                },
            },
            {
                name: 'Desperate Stand — Advantage',
                description: 'At 1 HP, gain advantage on all rolls.',
                icon: 'fa-shield-halved',
                data: {
                    name: 'Desperate Stand',
                    description: 'At 1 HP: advantage on all rolls.',
                    condition: { type: 'attribute', subject: 'self', attribute: 'hitPoints', operator: '<=', value: 1 },
                    effect: { type: 'advantage', applyTo: 'self' },
                    duration: { mode: 'permanent' },
                },
            },
            {
                name: 'Hope Surge — +2 to Rolls',
                description: 'While Hope is at 5+, gain +2 to all rolls.',
                icon: 'fa-sun',
                data: {
                    name: 'Hope Surge',
                    description: 'High Hope (5+): +2 to all rolls.',
                    condition: { type: 'attribute', subject: 'self', attribute: 'hope', operator: '>=', value: 5 },
                    effect: { type: 'roll_bonus', applyTo: 'self', rollBonus: 2 },
                    duration: { mode: 'permanent' },
                },
            },
            {
                name: 'Stress Cascade — Disadvantage',
                description: 'At 5+ Stress, suffer disadvantage on all rolls.',
                icon: 'fa-brain',
                data: {
                    name: 'Stress Cascade',
                    description: 'High Stress (5+): disadvantage on all rolls.',
                    condition: { type: 'attribute', subject: 'self', attribute: 'stress', operator: '>=', value: 5 },
                    effect: { type: 'disadvantage', applyTo: 'self' },
                    duration: { mode: 'permanent' },
                },
            },
            {
                name: 'No Armor — Evasion Penalty',
                description: 'With no armor remaining, Evasion is reduced by 2.',
                icon: 'fa-shield',
                data: {
                    name: 'No Armor — Evasion Penalty',
                    description: 'No armor remaining: -2 Evasion.',
                    condition: { type: 'no_armor_remaining', subject: 'self' },
                    effect: { type: 'defense_bonus', applyTo: 'self', defenseBonus: -2 },
                    duration: { mode: 'permanent' },
                },
            },
        ],
    },
    {
        category: 'Trigger-Based',
        presets: [
            {
                name: 'Fear-Fueled — +1d4 Damage',
                description: 'After rolling with Fear, deal +1d4 extra damage on the next hit.',
                icon: 'fa-ghost',
                data: {
                    name: 'Fear-Fueled',
                    description: 'Rolled with Fear: +1d4 on next damage.',
                    condition: { type: 'rolled_fear', subject: 'self' },
                    effect: { type: 'damage_bonus', applyTo: 'self', dice: '1d4', bonus: 0, damageType: 'any' },
                    duration: { mode: 'next_damage' },
                },
            },
            {
                name: 'Critical Momentum — Apply Vulnerable',
                description: 'On a Critical Success, apply Vulnerable to the target.',
                icon: 'fa-star',
                data: {
                    name: 'Critical Momentum',
                    description: 'On Critical: target becomes Vulnerable.',
                    condition: { type: 'rolled_critical', subject: 'self' },
                    effect: { type: 'status_on_hit', applyTo: 'self', statusToApply: 'vulnerable' },
                    duration: { mode: 'once' },
                },
            },
            {
                name: 'Hope Spent — +1 Roll Bonus',
                description: 'After spending Hope, gain +1 to the next roll.',
                icon: 'fa-hand-holding-heart',
                data: {
                    name: 'Hope Spent — +1 Roll Bonus',
                    description: 'After spending Hope: +1 to next roll.',
                    condition: { type: 'spent_hope', subject: 'self' },
                    effect: { type: 'roll_bonus', applyTo: 'self', rollBonus: 1 },
                    duration: { mode: 'next_roll' },
                },
            },
            {
                name: 'Armor Break — Evasion -1',
                description: 'When an armor slot is marked, reduce Evasion by 1 until end of combat.',
                icon: 'fa-shield-virus',
                data: {
                    name: 'Armor Break — Evasion -1',
                    description: 'Armor slot marked: -1 Evasion until combat ends.',
                    condition: { type: 'armor_slot_marked', subject: 'self' },
                    effect: { type: 'defense_bonus', applyTo: 'self', defenseBonus: -1 },
                    duration: { mode: 'end_of_combat' },
                },
            },
            {
                name: 'Took Major Damage — Stress',
                description: 'When taking Major damage, apply 1 Stress to the target on next hit.',
                icon: 'fa-bolt',
                data: {
                    name: 'Took Major — Stress on Hit',
                    description: 'After taking Major damage: apply 1 Stress on next hit.',
                    condition: { type: 'took_threshold', subject: 'self', threshold: 'major' },
                    effect: { type: 'stress_on_hit', applyTo: 'self', stressAmount: 1 },
                    duration: { mode: 'once' },
                },
            },
        ],
    },
    {
        category: 'Combat Utility',
        presets: [
            {
                name: 'Aura of Protection — Evasion +1',
                description: 'Unconditional +1 Evasion bonus (assign to armor).',
                icon: 'fa-shield-heart',
                data: {
                    name: 'Aura of Protection',
                    description: 'Unconditional +1 to Evasion.',
                    condition: { type: 'always' },
                    effect: { type: 'defense_bonus', applyTo: 'self', defenseBonus: 1 },
                    duration: { mode: 'permanent' },
                },
            },
            {
                name: 'Enchanted Weapon — +1d4 Magic Damage',
                description: 'Unconditional +1d4 magical damage bonus (assign to weapon).',
                icon: 'fa-wand-sparkles',
                data: {
                    name: 'Enchanted Weapon',
                    description: '+1d4 magical damage.',
                    condition: { type: 'always' },
                    effect: { type: 'damage_bonus', applyTo: 'self', dice: '1d4', bonus: 0, damageType: 'magical' },
                    duration: { mode: 'permanent' },
                },
            },
            {
                name: 'Proficiency +1',
                description: 'Unconditional +1 to Proficiency (assign to weapon or feature).',
                icon: 'fa-dumbbell',
                data: {
                    name: 'Proficiency +1',
                    description: '+1 to Proficiency.',
                    condition: { type: 'always' },
                    effect: { type: 'proficiency_bonus', proficiencyBonus: 1 },
                    duration: { mode: 'permanent' },
                },
            },
            {
                name: 'Countdown — 3 Round Buff',
                description: 'Advantage on all rolls for 3 rounds (countdown).',
                icon: 'fa-hourglass-half',
                data: {
                    name: '3-Round Advantage',
                    description: 'Advantage for 3 rounds.',
                    condition: { type: 'always' },
                    effect: { type: 'advantage', applyTo: 'self' },
                    duration: { mode: 'countdown', countdownTicks: 3, countdownTickOn: 'round_start' },
                },
            },
        ],
    },
];

// ─── Settings CRUD ────────────────────────────────────────────────────────────

export function getAllEffects() { return game.settings.get(MODULE_ID, SETTINGS_KEY) ?? []; }
export function getEffectById(id) { return getAllEffects().find(e => e.id === id) ?? null; }
export async function saveAllEffects(effects) { await game.settings.set(MODULE_ID, SETTINGS_KEY, effects); }

export async function createEffect(data) {
    const effects = getAllEffects();
    const e = foundry.utils.mergeObject(defaultEffect(), data ?? {}, { inplace: false });
    e.id = foundry.utils.randomID();
    effects.push(e);
    await saveAllEffects(effects);
    return e;
}

export async function updateEffect(id, changes) {
    const effects = getAllEffects();
    const idx = effects.findIndex(e => e.id === id);
    if (idx < 0) return null;
    effects[idx] = foundry.utils.mergeObject(effects[idx], changes, { inplace: false });
    await saveAllEffects(effects);
    return effects[idx];
}

export async function deleteEffect(id) { await saveAllEffects(getAllEffects().filter(e => e.id !== id)); }

export function getSceneOverrides() { return game.scenes.active?.getFlag(MODULE_ID, SCENE_FLAG) ?? {}; }

export async function setSceneOverride(effectId, value) {
    if (!game.scenes.active) return;
    const overrides = foundry.utils.deepClone(getSceneOverrides());
    if (value === null) delete overrides[effectId];
    else overrides[effectId] = value;
    await game.scenes.active.setFlag(MODULE_ID, SCENE_FLAG, overrides);
}

/**
 * Gets the list of effect IDs force-disabled in this scene.
 */
export function getSceneDisabled() {
    return game.scenes.active?.getFlag(MODULE_ID, FLAG_SCENE_OFF) ?? [];
}

/**
 * Toggles force-disable for an effect in this scene.
 */
export async function setSceneDisabled(effectId, disabled) {
    if (!game.scenes.active) return;
    let list = [...getSceneDisabled()];
    if (disabled) {
        if (!list.includes(effectId)) list.push(effectId);
    } else {
        list = list.filter(id => id !== effectId);
    }
    await game.scenes.active.setFlag(MODULE_ID, FLAG_SCENE_OFF, list);
}

/**
 * Gets the list of effect IDs toggled on for all PCs in the active scene.
 */
export function getPcToggles() {
    return game.scenes.active?.getFlag(MODULE_ID, FLAG_PC_TOGGLES) ?? [];
}

/**
 * Toggles a scene-wide effect for PCs.
 */
export async function setPcToggle(effectId, enabled) {
    if (!game.scenes.active) return;
    let toggles = [...getPcToggles()];
    if (enabled) {
        if (!toggles.includes(effectId)) toggles.push(effectId);
    } else {
        toggles = toggles.filter(id => id !== effectId);
    }
    await game.scenes.active.setFlag(MODULE_ID, FLAG_PC_TOGGLES, toggles);
}

/**
 * Gets the list of effect IDs toggled on for all adversaries in the active scene.
 */
export function getNpcToggles() {
    return game.scenes.active?.getFlag(MODULE_ID, FLAG_NPC_TOGGLES) ?? [];
}

/**
 * Toggles a scene-wide effect for adversaries.
 */
export async function setNpcToggle(effectId, enabled) {
    if (!game.scenes.active) return;
    let toggles = [...getNpcToggles()];
    if (enabled) {
        if (!toggles.includes(effectId)) toggles.push(effectId);
    } else {
        toggles = toggles.filter(id => id !== effectId);
    }
    await game.scenes.active.setFlag(MODULE_ID, FLAG_NPC_TOGGLES, toggles);
}

export async function clearSceneOverrides() {
    if (!game.scenes.active) return;
    // Use a single update() call to clear all override flags atomically.
    // Sequential unsetFlag() calls can race and leave stale flags behind.
    await game.scenes.active.update({
        [`flags.${MODULE_ID}`]: {
            [`-=${SCENE_FLAG}`]:       null,
            [`-=${FLAG_SCENE_OFF}`]:   null,
            [`-=${FLAG_PC_TOGGLES}`]:  null,
            [`-=${FLAG_NPC_TOGGLES}`]: null,
        },
    });
}

export function isEffectActive(effect) {
    // Scene-disabled always wins
    const disabled = getSceneDisabled();
    if (disabled.includes(effect.id)) return false;
    // Legacy scene overrides (On/Off) — kept for backward compat until cleared
    const overrides = getSceneOverrides();
    if (Object.prototype.hasOwnProperty.call(overrides, effect.id)) return overrides[effect.id];
    return effect.enabled;
}

// ─── Settings registration ────────────────────────────────────────────────────

export function registerSettings() {
    game.settings.register(MODULE_ID, SETTINGS_KEY, { scope: 'world', config: false, type: Array, default: [] });
    game.settings.registerMenu(MODULE_ID, 'managerMenu', {
        name: 'Conditional Effects Manager', label: 'Open Manager',
        hint: 'Create and manage conditional effects.',
        icon: 'fas fa-wand-magic-sparkles', type: ConditionalEffectsManager, restricted: true,
    });
}

// ─── Summary helpers ──────────────────────────────────────────────────────────

export function summarizeCondition(condition) {
    if (!condition) return '—';
    if (condition.type === 'always') return 'Always';
    const subject = condition.subject === 'target' ? 'Target' : 'Self';
    if (condition.type === 'status') {
        const s = STATUSES.find(s => s.id === condition.status)?.label ?? condition.status;
        return `${subject}: ${s}`;
    }
    if (condition.type === 'attribute') {
        const a = ATTRIBUTES.find(a => a.id === condition.attribute)?.label ?? condition.attribute;
        return `${subject} ${a} ${condition.operator} ${condition.value}`;
    }
    if (condition.type === 'range') {
        const mode  = RANGE_MODES.find(m => m.id === condition.rangeMode)?.label ?? condition.rangeMode ?? 'Within';
        const band  = RANGE_TYPES.find(r => r.id === condition.range)?.label ?? condition.range;
        const subj  = condition.rangeSubject ?? 'target';
        if (subj === 'target')   return `${mode}: ${band} — Target`;
        if (subj === 'attacker') return `${mode}: ${band} — Attacker`;
        const label = subj === 'friends' ? 'Friends' : 'Enemies';
        const count = condition.rangeCount ?? 1;
        return `${mode}: ${band} — ${count}+ ${label}`;
    }
    if (condition.type === 'damage_type') {
        const dt = INCOMING_DAMAGE_TYPES.find(d => d.id === condition.incomingDamageType)?.label ?? condition.incomingDamageType;
        return `Incoming: ${dt} damage`;
    }
    if (condition.type === 'weapon') return `Slot: ${WEAPON_SLOTS.find(w => w.id === condition.weaponSlot)?.label ?? condition.weaponSlot}`;
    if (condition.type === 'took_threshold') {
        const th = DAMAGE_THRESHOLDS.find(t => t.id === condition.threshold)?.label ?? condition.threshold;
        return `${subject}: Took ${th} damage`;
    }
    if (condition.type === 'inflicted_threshold') {
        const th = DAMAGE_THRESHOLDS.find(t => t.id === condition.threshold)?.label ?? condition.threshold;
        return `${subject}: Inflicted ${th} damage`;
    }
    if (condition.type === 'rolled_fear') return `${subject}: Rolled with Fear`;
    if (condition.type === 'rolled_critical') return `${subject}: Rolled Critical`;
    if (condition.type === 'spent_hope') return `${subject}: Spent Hope`;
    if (condition.type === 'armor_slot_marked') return `${subject}: Marked Armor Slot`;
    if (condition.type === 'no_armor_remaining') {
        const subject = condition.subject === 'target' ? 'Target' : 'Self';
        return `${subject}: No Armor Remaining`;
    }
    return '—';
}

export function summarizeEffect(effect) {
    if (!effect) return '—';
    if (effect.type === 'damage_bonus') {
        const parts = [];
        if (effect.dice?.trim()) parts.push(effect.dice.trim());
        if (effect.bonus > 0)    parts.push(`+${effect.bonus}`);
        else if (effect.bonus < 0) parts.push(`${effect.bonus}`);
        const dmg = DAMAGE_TYPES.find(d => d.id === effect.damageType)?.label ?? effect.damageType;
        return `${parts.join('') || '0'} ${dmg} dmg`;
    }
    if (effect.type === 'damage_multiplier') {
        const dt = INCOMING_DAMAGE_TYPES.find(d => d.id === effect.incomingDamageType)?.label ?? (effect.incomingDamageType ?? 'Any');
        return `×${effect.damageMultiplier ?? 2} ${dt} damage taken`;
    }
    if (effect.type === 'damage_reduction') {
        const maj = effect.thresholdMajor  ?? 0;
        const sev = effect.thresholdSevere ?? 0;
        return `Threshold +${maj} major / +${sev} severe`;
    }
    if (effect.type === 'defense_bonus')    return `Evasion/Difficulty ${(effect.defenseBonus ?? 0) >= 0 ? '+' : ''}${effect.defenseBonus ?? 0}`;
    if (effect.type === 'status_on_hit') {
        const s = STATUSES.find(s => s.id === effect.statusToApply)?.label ?? effect.statusToApply;
        return `Apply: ${s}`;
    }
    if (effect.type === 'apply_status') {
        const s = STATUSES.find(s => s.id === effect.applyStatus)?.label ?? effect.applyStatus;
        return `Status: ${s} (while active)`;
    }
    if (effect.type === 'proficiency_bonus') {
        const b = effect.proficiencyBonus ?? 1;
        return `Proficiency ${b >= 0 ? '+' : ''}${b}`;
    }
    if (effect.type === 'stress_on_hit') {
        return `Apply: ${effect.stressAmount ?? 1} Stress`;
    }
    if (effect.type === 'roll_bonus' || effect.type === 'advantage' || effect.type === 'disadvantage') {
        let base;
        if (effect.type === 'roll_bonus') base = `Roll ${effect.rollBonus >= 0 ? '+' : ''}${effect.rollBonus}`;
        else if (effect.type === 'advantage') base = 'Advantage';
        else base = 'Disadvantage';
        const qualifiers = [];
        if (effect.traitFilter && effect.traitFilter !== 'any') {
            qualifiers.push(TRAITS.find(t => t.id === effect.traitFilter)?.label ?? effect.traitFilter);
        }
        if (effect.actionTypeFilter && effect.actionTypeFilter !== 'any') {
            qualifiers.push(ACTION_ROLL_TYPES.find(a => a.id === effect.actionTypeFilter)?.label ?? effect.actionTypeFilter);
        }
        return qualifiers.length ? `${base} (${qualifiers.join(', ')})` : base;
    }
    return '—';
}

// ─── Manager Application ──────────────────────────────────────────────────────

export class ConditionalEffectsManager extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: 'dce-manager', classes: ['dce-manager'],
        window: { title: 'Conditional Effects Manager', icon: 'fas fa-wand-magic-sparkles', resizable: true },
        position: { width: 820, height: 580 },
    };
    static PARTS = { main: { template: `modules/${MODULE_ID}/templates/manager.hbs` } };

    _activeTab = 'effects';

    async _prepareContext(_options) {
        const sceneDisabled = getSceneDisabled();
        const pcToggles = getPcToggles();
        const npcToggles = getNpcToggles();
        const effects = getAllEffects().map(e => ({
            ...e,
            conditionSummary: summarizeCondition(e.condition),
            effectSummary:    summarizeEffect(e.effect),
            applyToLabel:     resolveApplyTo(e) === 'self' ? 'Self' : 'Incoming',
            applyToIcon:      resolveApplyTo(e) === 'self' ? 'fa-user dce-beneficial' : 'fa-bullseye dce-detrimental',
            effectiveEnabled: isEffectActive(e),
            overrideOff:      sceneDisabled.includes(e.id),
            overridePC:       pcToggles.includes(e.id),
            overrideNPC:      npcToggles.includes(e.id),
        }));
        return { effects, isEmpty: effects.length === 0, activeTab: this._activeTab,
                 sceneName: game.scenes.active?.name ?? 'No Active Scene',
                 presetCategories: EFFECT_PRESETS };
    }

    _onRender(_context, _options) {
        const el = this.element;

        el.querySelectorAll('.dce-tab-btn[data-tab]').forEach(btn => {
            btn.addEventListener('click', () => { this._activeTab = btn.dataset.tab; this.render(); });
        });

        el.querySelectorAll('.dce-effect-row[data-effect-id]').forEach(row => {
            row.addEventListener('dragstart', event => {
                event.dataTransfer.effectAllowed = 'copy';
                event.dataTransfer.setData('text/plain', JSON.stringify({ type: 'dce-conditional-effect', effectId: row.dataset.effectId }));
            });
        });

        el.querySelector('[data-action="newEffect"]')?.addEventListener('click', e => {
            e.preventDefault();
            new ConditionalEffectConfig(null, { onSave: () => this.render() }).render(true);
        });

        el.querySelectorAll('[data-action="editEffect"]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.preventDefault();
                const { effectId } = btn.closest('[data-effect-id]').dataset;
                new ConditionalEffectConfig(effectId, { onSave: () => this.render() }).render(true);
            });
        });

        el.querySelectorAll('[data-action="toggleEffect"]').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.preventDefault();
                const { effectId } = btn.closest('[data-effect-id]').dataset;
                const effect = getAllEffects().find(e => e.id === effectId);
                if (effect) { await updateEffect(effectId, { enabled: !effect.enabled }); this.render(); }
            });
        });

        el.querySelectorAll('[data-action="deleteEffect"]').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.preventDefault();
                const { effectId } = btn.closest('[data-effect-id]').dataset;
                const confirmed = await foundry.applications.api.DialogV2.confirm({
                    window: { title: 'Delete Conditional Effect' },
                    content: '<p>Delete this effect? Items that reference it will lose it.</p>',
                    yes: { label: 'Delete', icon: 'fas fa-trash', callback: () => true },
                    no:  { label: 'Cancel', callback: () => false },
                });
                if (!confirmed) return;
                await deleteEffect(effectId);
                this.render();
            });
        });

        // Delete All effects (double-confirm)
        el.querySelector('[data-action="deleteAllEffects"]')?.addEventListener('click', async e => {
            e.preventDefault();
            const count = getAllEffects().length;
            if (!count) return;
            const first = await foundry.applications.api.DialogV2.confirm({
                window: { title: 'Delete All Effects' },
                content: `<p>This will permanently delete all <strong>${count}</strong> conditional effect(s) and remove them from every item and actor.</p><p>Continue?</p>`,
                yes: { label: 'Delete All', icon: 'fas fa-trash' },
                no:  { label: 'Cancel' },
            });
            if (!first) return;
            const second = await foundry.applications.api.DialogV2.confirm({
                window: { title: 'Are you sure?' },
                content: `<p>This <strong>cannot be undone</strong>. All ${count} effect(s) will be permanently deleted.</p><p>Are you absolutely sure?</p>`,
                yes: { label: 'Yes, delete everything', icon: 'fas fa-exclamation-triangle' },
                no:  { label: 'Cancel' },
            });
            if (!second) return;
            await saveAllEffects([]);
            ui.notifications.info(`Deleted all ${count} conditional effect(s).`);
            this.render();
        });

        // Scene override buttons
        el.querySelectorAll('[data-action="overrideDisable"]').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.preventDefault();
                const { effectId } = btn.closest('[data-effect-id]').dataset;
                const sceneDisabled = getSceneDisabled();
                await setSceneDisabled(effectId, !sceneDisabled.includes(effectId));
                this.render();
            });
        });

        el.querySelector('[data-action="clearOverrides"]')?.addEventListener('click', async e => {
            e.preventDefault();
            await clearSceneOverrides();
            this.render();
        });


        el.querySelectorAll('[data-action="togglePcGlobal"]').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.preventDefault();
                const { effectId } = btn.closest('[data-effect-id]').dataset;
                const pcToggles = getPcToggles();
                await setPcToggle(effectId, !pcToggles.includes(effectId));
                this.render();
            });
        });

        el.querySelectorAll('[data-action="toggleNpcGlobal"]').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.preventDefault();
                const { effectId } = btn.closest('[data-effect-id]').dataset;
                const npcToggles = getNpcToggles();
                await setNpcToggle(effectId, !npcToggles.includes(effectId));
                this.render();
            });
        });

        el.querySelectorAll('[data-action="applyActorPicker"]').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.preventDefault();
                const { effectId } = btn.closest('[data-effect-id]').dataset;
                await this._openActorPickerDialog(effectId);
            });
        });

        // Preset creation
        el.querySelectorAll('[data-action="createFromPreset"]').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.preventDefault();
                const card = btn.closest('.dce-preset-card');
                const catIdx = Number(card.dataset.presetCategory);
                const preIdx = Number(card.dataset.presetIndex);
                const preset = EFFECT_PRESETS[catIdx]?.presets?.[preIdx];
                if (!preset) return;
                const newEffect = await createEffect(preset.data);
                ui.notifications.info(`Created effect: "${newEffect.name}"`);
                this._activeTab = 'effects';
                this.render();
            });
        });
    }

    // ── Actor Picker dialog (for "All" button in Scene Overrides) ────────────
    async _openActorPickerDialog(effectId) {
        const scene = game.scenes.active;
        if (!scene) { ui.notifications.warn('No active scene.'); return; }

        const effect = getAllEffects().find(e => e.id === effectId);
        if (!effect) return;

        // Collect unique actors from scene tokens (deduplicate by actor UUID)
        const actorMap = new Map();
        for (const tokenDoc of scene.tokens) {
            const actor = tokenDoc.actor;
            if (!actor) continue;
            const key = actor.uuid;
            if (!actorMap.has(key)) {
                actorMap.set(key, {
                    uuid: key,
                    name: tokenDoc.name,
                    img:  tokenDoc.texture?.src ?? actor.img ?? 'icons/svg/mystery-man.svg',
                    alreadyHas: (actor.getFlag(MODULE_ID, FLAG_ACTOR) ?? []).includes(effectId),
                });
            }
        }
        const actors = Array.from(actorMap.values())
            .sort((a, b) => a.name.localeCompare(b.name));

        if (!actors.length) {
            ui.notifications.warn('No actors found on the active scene.');
            return;
        }

        // Build checkbox HTML — all checked by default
        const rows = actors.map(a => `
            <label class="dce-actor-pick-row">
                <input type="checkbox" class="dce-actor-cb" data-actor-uuid="${a.uuid}" checked>
                <img src="${a.img}" width="30" height="30">
                <span class="dce-actor-pick-name">${a.name}</span>
                ${a.alreadyHas ? '<span class="dce-actor-pick-tag">already assigned</span>' : ''}
            </label>
        `).join('');

        const content = `
            <p class="dce-hint" style="margin-bottom:8px;">
                <i class="fas fa-circle-info"></i>
                Checked actors will receive <strong>${effect.name}</strong>. Uncheck to exclude.
            </p>
            <div class="dce-actor-pick-controls">
                <button type="button" class="dce-btn-link" data-pick-action="all">Select All</button>
                <button type="button" class="dce-btn-link" data-pick-action="none">Select None</button>
            </div>
            <div class="dce-actor-pick-list">${rows}</div>
        `;

        const selectedUuids = await foundry.applications.api.DialogV2.confirm({
            window: { title: `Assign: ${effect.name}`, icon: 'fas fa-list-check' },
            content,
            yes: {
                label: 'Assign',
                icon: 'fas fa-check',
                callback: (event, button, dialog) => {
                    const root = button.closest('.window-content') ?? button.form ?? dialog;
                    const checked = root.querySelectorAll('input.dce-actor-cb:checked');
                    return Array.from(checked).map(cb => cb.dataset.actorUuid);
                },
            },
            no: { label: 'Cancel' },
            render: (event, html) => {
                // Wire up Select All / Select None buttons
                const root = html instanceof HTMLElement ? html : html.element ?? html;
                root.querySelector('[data-pick-action="all"]')?.addEventListener('click', () => {
                    root.querySelectorAll('input.dce-actor-cb').forEach(cb => cb.checked = true);
                });
                root.querySelector('[data-pick-action="none"]')?.addEventListener('click', () => {
                    root.querySelectorAll('input.dce-actor-cb').forEach(cb => cb.checked = false);
                });
            },
        });

        if (!selectedUuids || !selectedUuids.length) return;

        // Assign effect to each selected actor via FLAG_ACTOR
        let assigned = 0;
        for (const uuid of selectedUuids) {
            const actor = await fromUuid(uuid);
            if (!actor) continue;
            const existing = actor.getFlag(MODULE_ID, FLAG_ACTOR) ?? [];
            if (!existing.includes(effectId)) {
                await actor.setFlag(MODULE_ID, FLAG_ACTOR, [...existing, effectId]);
                assigned++;
            }
        }

        if (assigned > 0) {
            ui.notifications.info(`Assigned "${effect.name}" to ${assigned} actor(s).`);
        } else {
            ui.notifications.info(`All selected actors already had "${effect.name}".`);
        }
        this.render();
    }
}

// ─── Config Application ───────────────────────────────────────────────────────

export class ConditionalEffectConfig extends HandlebarsApplicationMixin(ApplicationV2) {
    constructor(effectId, options = {}) {
        super(options);
        this.effectId = effectId ?? null;
        this._onSave  = options.onSave ?? null;
    }

    static DEFAULT_OPTIONS = {
        id: 'dce-effect-config', classes: ['dce-effect-config'], tag: 'form',
        window: { title: 'Configure Conditional Effect', icon: 'fas fa-magic', resizable: false },
        position: { width: 520, height: 'auto' },
    };
    static PARTS = { main: { template: `modules/${MODULE_ID}/templates/effect-config.hbs` } };

    get title() { return this.effectId ? 'Edit Conditional Effect' : 'New Conditional Effect'; }

    async _prepareContext(_options) {
        const existing = this.effectId ? getEffectById(this.effectId) : null;
        const effect   = existing ?? defaultEffect();
        const cond = effect.condition;
        const eff  = effect.effect;
        const dur  = effect.duration ?? { mode: 'permanent', uses: 1 };
        const chainIds = new Set(eff.chainEffectIds ?? []);
        const chainableEffects = getAllEffects()
            .filter(e => e.id !== this.effectId) // Don't allow self-chain
            .map(e => ({ id: e.id, name: e.name, selected: chainIds.has(e.id) }));
        const hasChains = chainableEffects.some(e => e.selected);
        return {
            effect, effectId: this.effectId,
            chainableEffects, hasChains,
            statuses: STATUSES, attributes: ATTRIBUTES, operators: OPERATORS,
            conditionTypes: CONDITION_TYPES, effectTypes: EFFECT_TYPES,
            damageTypes: DAMAGE_TYPES, incomingDamageTypes: INCOMING_DAMAGE_TYPES,
            rangeTypes: RANGE_TYPES, rangeModes: RANGE_MODES, rangeSubjects: RANGE_SUBJECTS,
            weaponSlots: WEAPON_SLOTS,
            damageThresholds: DAMAGE_THRESHOLDS,
            durationModes: DURATION_MODES,
            countdownTickEvents: COUNTDOWN_TICK_EVENTS,
            traits: TRAITS, actionRollTypes: ACTION_ROLL_TYPES,
            applyTargets: APPLY_TARGETS,
            showApplyTo:          eff.type === 'damage_bonus' || eff.type === 'roll_bonus' || eff.type === 'advantage' || eff.type === 'disadvantage' || eff.type === 'defense_bonus' || eff.type === 'damage_reduction' || eff.type === 'status_on_hit' || eff.type === 'stress_on_hit',
            showSubject:          cond.type === 'status' || cond.type === 'attribute' || cond.type === 'took_threshold' || cond.type === 'inflicted_threshold' || cond.type === 'rolled_fear' || cond.type === 'rolled_critical' || cond.type === 'spent_hope' || cond.type === 'armor_slot_marked' || cond.type === 'no_armor_remaining',
            showStatus:           cond.type === 'status',
            showAttribute:        cond.type === 'attribute',
            showRange:            cond.type === 'range',
            showRangeCount:       cond.type === 'range' && (cond.rangeSubject === 'friends' || cond.rangeSubject === 'enemies'),
            showWeaponSlot:       cond.type === 'weapon',
            showIncomingDamageType: cond.type === 'damage_type',
            showThreshold:        cond.type === 'took_threshold' || cond.type === 'inflicted_threshold',
            showDurationUses:     dur.mode === 'uses',
            showCountdown:        dur.mode === 'countdown',
            showDamageBonus:      eff.type  === 'damage_bonus',
            showDamageMultiplier: eff.type  === 'damage_multiplier',
            showDamageReduction:  eff.type  === 'damage_reduction',
            showDefenseBonus:     eff.type  === 'defense_bonus',
            showStatusOnHit:      eff.type  === 'status_on_hit',
            showApplyStatus:      eff.type  === 'apply_status',
            showRollBonus:        eff.type  === 'roll_bonus',
            showRollFilters:      eff.type === 'roll_bonus' || eff.type === 'advantage' || eff.type === 'disadvantage',
            showProficiencyBonus: eff.type === 'proficiency_bonus',
            showStressOnHit:      eff.type === 'stress_on_hit',
            enabledStr:          String(effect.enabled),
            durationMode:        String(dur.mode ?? 'permanent'),
            durationUses:        Number(dur.uses ?? 1),
        };
    }

    _onRender(_context, _options) {
        const el = this.element;
        el.querySelector('[name="condition.type"]')?.addEventListener('change', () => this._updateVisibility());
        el.querySelector('[name="condition.rangeSubject"]')?.addEventListener('change', () => this._updateVisibility());
        el.querySelector('[name="effect.type"]')?.addEventListener('change',  () => this._updateVisibility());
        el.querySelector('[name="duration.mode"]')?.addEventListener('change',  () => this._updateVisibility());
        this._updateVisibility();

        // ── Chain Effects picker button ───────────────────────────────────────
        el.querySelector('[data-action="openChainPicker"]')?.addEventListener('click', () => {
            this._openChainPickerDialog();
        });

        // ── Chain tag X-button delegation ─────────────────────────────────────
        el.querySelector('[data-chain-container]')?.addEventListener('click', e => {
            const removeBtn = e.target.closest('[data-action="removeChain"]');
            if (!removeBtn) return;
            const tag = removeBtn.closest('.dce-chain-tag');
            if (!tag) return;
            tag.remove();
            const container = el.querySelector('[data-chain-container]');
            if (!container.querySelector('.dce-chain-tag')) {
                container.insertAdjacentHTML('beforeend', '<em class="dce-chain-empty">No chained effects</em>');
            }
        });

        el.addEventListener('submit', async e => {
            e.preventDefault();
            const fd  = new FormData(el);
            // Chain IDs come from hidden inputs inside chain tags — getAll collects them all
            const chainIds = fd.getAll('effect.chainEffectIds').filter(Boolean);
            fd.delete('effect.chainEffectIds');
            const raw = foundry.utils.expandObject(Object.fromEntries(fd.entries()));
            if (raw.effect) raw.effect.chainEffectIds = chainIds;
            raw.enabled    = raw.enabled    === 'true' || raw.enabled    === true;
            if (raw.duration) {
                raw.duration.uses = Number(raw.duration.uses ?? 1);
                raw.duration.mode = String(raw.duration.mode ?? 'permanent');
                raw.duration.countdownTicks = Number(raw.duration.countdownTicks ?? 3);
                raw.duration.countdownTickOn = String(raw.duration.countdownTickOn ?? 'round_start');
            }
            if (raw.condition) raw.condition.value       = Number(raw.condition.value       ?? 0);
            if (raw.condition) raw.condition.rangeCount  = Number(raw.condition.rangeCount  ?? 1);
            if (raw.effect)    raw.effect.bonus            = Number(raw.effect.bonus            ?? 0);
            if (raw.effect)    raw.effect.rollBonus        = Number(raw.effect.rollBonus        ?? 0);
            if (raw.effect)    raw.effect.thresholdMajor   = Number(raw.effect.thresholdMajor   ?? 0);
            if (raw.effect)    raw.effect.thresholdSevere  = Number(raw.effect.thresholdSevere  ?? 0);
            if (raw.effect)    raw.effect.defenseBonus     = Number(raw.effect.defenseBonus     ?? 0);
            if (raw.effect)    raw.effect.damageMultiplier = Number(raw.effect.damageMultiplier ?? 2);
            if (raw.effect)    raw.effect.proficiencyBonus = Number(raw.effect.proficiencyBonus ?? 1);
            if (raw.effect)    raw.effect.stressAmount     = Number(raw.effect.stressAmount     ?? 1);

            // Bug #6: Validate dice formula if provided
            if (raw.effect?.dice?.trim()) {
                try {
                    const testRoll = new Roll(raw.effect.dice.trim());
                    testRoll.evaluate({ async: false });
                } catch (err) {
                    ui.notifications.error(`Invalid dice formula: "${raw.effect.dice}". Use formats like "1d6", "2d4+1", etc.`);
                    return;
                }
            }

            // Bug #8: Warn if apply_status is combined with a non-permanent duration
            if (raw.effect?.type === 'apply_status' && raw.duration?.mode && raw.duration.mode !== 'permanent') {
                ui.notifications.warn('Note: "Apply Status" effects ignore duration — status is applied while condition is true and removed when false. Duration set to Permanent.');
                raw.duration.mode = 'permanent';
            }

            if (this.effectId) await updateEffect(this.effectId, raw);
            else await createEffect(raw);
            this._onSave?.();
            this.close();
        });
    }

    _updateVisibility() {
        const condType = this.element.querySelector('[name="condition.type"]')?.value;
        const effType  = this.element.querySelector('[name="effect.type"]')?.value;
        const durMode  = this.element.querySelector('[name="duration.mode"]')?.value;
        this._toggle('.dce-field-subject',             condType === 'status' || condType === 'attribute' || condType === 'took_threshold' || condType === 'inflicted_threshold' || condType === 'rolled_fear' || condType === 'rolled_critical' || condType === 'spent_hope' || condType === 'armor_slot_marked' || condType === 'no_armor_remaining');
        this._toggle('.dce-field-status',              condType === 'status');
        this._toggle('.dce-field-attribute',           condType === 'attribute');
        this._toggle('.dce-field-range',               condType === 'range');
        const rangeSubject = this.element.querySelector('[name="condition.rangeSubject"]')?.value;
        this._toggle('.dce-field-range-count',         condType === 'range' && (rangeSubject === 'friends' || rangeSubject === 'enemies'));
        this._toggle('.dce-field-weapon-slot',         condType === 'weapon');
        this._toggle('.dce-field-incoming-damage-type', condType === 'damage_type');
        this._toggle('.dce-field-threshold',           condType === 'took_threshold' || condType === 'inflicted_threshold');
        this._toggle('.dce-field-duration-uses',       durMode === 'uses');
        this._toggle('.dce-field-countdown',           durMode === 'countdown');
        this._toggle('.dce-field-damage-bonus',        effType  === 'damage_bonus');
        this._toggle('.dce-field-damage-multiplier',   effType  === 'damage_multiplier');
        this._toggle('.dce-field-damage-reduction',    effType  === 'damage_reduction');
        this._toggle('.dce-field-defense-bonus',       effType  === 'defense_bonus');
        this._toggle('.dce-field-status-on-hit',       effType  === 'status_on_hit');
        this._toggle('.dce-field-apply-status',        effType  === 'apply_status');
        this._toggle('.dce-field-roll-bonus',          effType  === 'roll_bonus');
        this._toggle('.dce-field-roll-filters',        effType  === 'roll_bonus' || effType === 'advantage' || effType === 'disadvantage');
        this._toggle('.dce-field-proficiency-bonus',   effType  === 'proficiency_bonus');
        this._toggle('.dce-field-stress-on-hit',       effType  === 'stress_on_hit');
        this._toggle('.dce-field-applyto',             effType === 'damage_bonus' || effType === 'roll_bonus' || effType === 'advantage' || effType === 'disadvantage' || effType === 'defense_bonus' || effType === 'damage_reduction' || effType === 'status_on_hit' || effType === 'stress_on_hit');
    }

    _toggle(selector, visible) {
        const el = this.element.querySelector(selector);
        if (el) el.classList.toggle('dce-hidden', !visible);
    }

    async _openChainPickerDialog() {
        const allEffects = getAllEffects().filter(e => e.id !== this.effectId);
        if (!allEffects.length) {
            ui.notifications.warn('No other effects to chain. Create more effects first.');
            return;
        }

        // Read currently chained IDs from hidden inputs in the DOM
        const currentChainIds = new Set(
            [...this.element.querySelectorAll('[data-chain-container] input[name="effect.chainEffectIds"]')]
                .map(inp => inp.value)
        );

        // Build checkbox list HTML
        const rows = allEffects.map(eff => {
            const checked = currentChainIds.has(eff.id) ? 'checked' : '';
            return `<label class="dce-chain-pick-row">
                <input type="checkbox" class="dce-chain-cb" value="${eff.id}" ${checked}>
                <span class="dce-chain-pick-name">${eff.name}</span>
            </label>`;
        }).join('');

        const content = `
            <div class="dce-chain-pick-controls">
                <button type="button" class="dce-btn-link" data-pick-action="all">Select All</button>
                <button type="button" class="dce-btn-link" data-pick-action="none">Select None</button>
            </div>
            <div class="dce-chain-pick-list">${rows}</div>
        `;

        const selectedIds = await foundry.applications.api.DialogV2.confirm({
            window: { title: 'Chain Effects', icon: 'fas fa-link' },
            content,
            yes: {
                label: 'Save Chains',
                icon: 'fas fa-link',
                callback: (event, button, dialog) => {
                    const root = button.closest('.window-content') ?? button.form ?? dialog;
                    const checked = root.querySelectorAll('input.dce-chain-cb:checked');
                    return Array.from(checked).map(cb => cb.value);
                },
            },
            no: { label: 'Cancel', icon: 'fas fa-times' },
            render: (event, html) => {
                const root = html instanceof HTMLElement ? html : html.element ?? html;
                root.querySelector('[data-pick-action="all"]')?.addEventListener('click', () => {
                    root.querySelectorAll('input.dce-chain-cb').forEach(cb => cb.checked = true);
                });
                root.querySelector('[data-pick-action="none"]')?.addEventListener('click', () => {
                    root.querySelectorAll('input.dce-chain-cb').forEach(cb => cb.checked = false);
                });
            },
        });

        // If cancelled (false or null), do nothing
        if (!selectedIds) return;

        // Build effect name lookup
        const effectMap = new Map(allEffects.map(e => [e.id, e.name]));

        // Update the tag container in the DOM
        const container = this.element.querySelector('[data-chain-container]');
        container.innerHTML = '';

        for (const id of selectedIds) {
            const name = effectMap.get(id) ?? 'Unknown';
            const tag = document.createElement('span');
            tag.className = 'dce-chain-tag';
            tag.dataset.chainId = id;
            tag.innerHTML = `<input type="hidden" name="effect.chainEffectIds" value="${id}">`
                + `${name}`
                + `<button type="button" class="dce-chain-tag-remove" data-action="removeChain" title="Remove chain">`
                + `<i class="fas fa-xmark"></i></button>`;
            container.appendChild(tag);
        }

        // Show placeholder if none selected
        if (!selectedIds.length) {
            container.innerHTML = '<em class="dce-chain-empty">No chained effects</em>';
        }
    }
}

// ─── Active Assignments Viewer ───────────────────────────────────────────────

export class ActiveAssignmentsViewer extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: 'dce-assignments', classes: ['dce-assignments'],
        window: { title: 'Active Assignments', icon: 'fas fa-diagram-project', resizable: true },
        position: { width: 620, height: 520 },
    };
    static PARTS = { main: { template: `modules/${MODULE_ID}/templates/active-assignments.hbs` } };

    /** @type {number[]} Hook IDs to unregister on close */
    _hookIds = [];

    _isSupportedActorType(actor) {
        return actor?.type === 'character' || actor?.type === 'adversary';
    }

    _collectViewerActors() {
        const actorsByUuid = new Map();
        const pushActor = actor => {
            if (!this._isSupportedActorType(actor)) return;
            if (!actor?.uuid) return;
            if (!actorsByUuid.has(actor.uuid)) actorsByUuid.set(actor.uuid, actor);
        };

        // World actors (linked documents)
        for (const actor of game.actors ?? []) pushActor(actor);

        // Active-scene token actors (captures unlinked/synthetic adversaries)
        for (const tokenDoc of game.scenes.active?.tokens ?? []) {
            pushActor(tokenDoc.actor);
        }

        return [...actorsByUuid.values()];
    }

    _resolveActorFromElement(el) {
        const container = el?.closest('[data-actor-uuid]');
        if (!container) return null;

        const actorUuid = container.dataset.actorUuid;
        if (actorUuid) {
            try {
                const actor = fromUuidSync(actorUuid);
                if (actor) return actor;
            } catch {
                // Fall through to legacy ID lookup
            }
        }

        const actorId = container.dataset.actorId;
        return actorId ? game.actors.get(actorId) : null;
    }

    async _prepareContext(_options) {
        const allEffects   = getAllEffects();
        const effectMap    = new Map(allEffects.map(e => [e.id, e]));
        const pcToggles    = new Set(getPcToggles());
        const npcToggles   = new Set(getNpcToggles());
        const sceneDisabled = new Set(getSceneDisabled());

        const actors = [];

        for (const actor of this._collectViewerActors()) {
            const sources = [];

            // 1. Scene-wide toggles
            const sceneToggles = actor.type === 'character' ? pcToggles : npcToggles;
            const toggleLabel  = actor.type === 'character' ? 'PCs' : 'Foes';
            for (const effectId of sceneToggles) {
                const e = effectMap.get(effectId);
                if (!e) continue;
                sources.push(this._buildSourceRow(e, {
                    sourceType:  'scene',
                    sourceId:    'scene',
                    sourceIcon:  'fa-map',
                    sourceLabel: `Scene Override (${toggleLabel})`,
                    sourceTooltip: `Applied via Scene Overrides → ${toggleLabel}`,
                    sourceClickable: false,
                    sceneDisabled: sceneDisabled.has(effectId),
                }));
            }

            // 2. Item-assigned effects
            for (const item of actor.items) {
                if (!APPLICABLE_ITEM_TYPES.includes(item.type)) continue;
                const ids = item.getFlag(MODULE_ID, FLAG_ASSIGNED) ?? [];
                for (const effectId of ids) {
                    const e = effectMap.get(effectId);
                    if (!e) continue;
                    const itemActive = this._isItemActive(item);
                    const typeLabel  = this._itemTypeLabel(item.type);
                    const activeTag  = itemActive ? '' : ', unequipped';
                    sources.push(this._buildSourceRow(e, {
                        sourceType:  'item',
                        sourceId:    item.id,
                        sourceIcon:  this._itemTypeIcon(item.type),
                        sourceLabel: `${item.name} (${typeLabel}${activeTag})`,
                        sourceTooltip: `Assigned to ${typeLabel}: "${item.name}"${activeTag}`,
                        sourceClickable: true,
                        sceneDisabled: sceneDisabled.has(effectId),
                    }));
                }
            }

            // 3. Actor-level (direct) assignments
            const actorIds = actor.getFlag(MODULE_ID, FLAG_ACTOR) ?? [];
            for (const effectId of actorIds) {
                const e = effectMap.get(effectId);
                if (!e) continue;
                sources.push(this._buildSourceRow(e, {
                    sourceType:  'actor',
                    sourceId:    actor.id,
                    sourceIcon:  'fa-user',
                    sourceLabel: 'Actor (direct)',
                    sourceTooltip: 'Assigned directly to actor',
                    sourceClickable: false,
                    sceneDisabled: sceneDisabled.has(effectId),
                }));
            }

            if (sources.length === 0) continue;

            actors.push({
                actorId:      actor.id,
                actorUuid:    actor.uuid,
                name:         actor.name,
                typeLabel:    actor.type === 'character' ? 'Character' : 'Adversary',
                actorIcon:    actor.type === 'character' ? 'fa-user' : 'fa-skull',
                effectCount:  sources.length,
                singleEffect: sources.length === 1,
                sources,
            });
        }

        // Sort: characters first, then adversaries, alphabetical within each
        actors.sort((a, b) => {
            if (a.typeLabel !== b.typeLabel) return a.typeLabel === 'Character' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        return { actors, isEmpty: actors.length === 0 };
    }

    _buildSourceRow(effect, source) {
        return {
            effectId:         effect.id,
            effectName:       effect.name,
            conditionSummary: summarizeCondition(effect.condition),
            effectSummary:    summarizeEffect(effect.effect),
            applyToIcon:      resolveApplyTo(effect) === 'self' ? 'fa-user dce-beneficial' : 'fa-bullseye dce-detrimental',
            ...source,
        };
    }

    _isItemActive(item) {
        switch (item.type) {
            case 'weapon':
            case 'armor':      return item.system.equipped === true;
            case 'domainCard': return item.system.inVault === false;
            case 'feature':    return true;
            default:           return false;
        }
    }

    _itemTypeLabel(type) {
        switch (type) {
            case 'weapon':     return 'Weapon';
            case 'armor':      return 'Armor';
            case 'domainCard': return 'Domain Card';
            case 'feature':    return 'Feature';
            default:           return type;
        }
    }

    _itemTypeIcon(type) {
        switch (type) {
            case 'weapon':     return 'fa-sword';
            case 'armor':      return 'fa-shield-halved';
            case 'domainCard': return 'fa-scroll';
            case 'feature':    return 'fa-star';
            default:           return 'fa-cube';
        }
    }

    _onRender(_context, _options) {
        const el = this.element;

        // Open actor sheet
        el.querySelectorAll('[data-action="openActorSheet"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const actor = this._resolveActorFromElement(btn);
                actor?.sheet.render(true);
            });
        });

        // Open source item sheet
        el.querySelectorAll('[data-action="openSourceSheet"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const row     = btn.closest('.dce-assignments-row');
                const itemId  = row?.dataset.sourceId;
                if (!itemId) return;
                const actor = this._resolveActorFromElement(btn);
                const item  = actor?.items.get(itemId);
                item?.sheet.render(true);
            });
        });

        // Remove assignment
        el.querySelectorAll('[data-action="removeAssignment"]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const row        = btn.closest('.dce-assignments-row');
                const effectId   = row?.dataset.effectId;
                const sourceType = row?.dataset.sourceType;
                const sourceId   = row?.dataset.sourceId;
                const actor      = this._resolveActorFromElement(btn);
                if (!effectId || !sourceType) return;

                if (sourceType === 'scene') {
                    // Determine if PCs or Foes by checking which set has it
                    if (pcToggles_has(effectId))  await setPcToggle(effectId, false);
                    if (npcToggles_has(effectId)) await setNpcToggle(effectId, false);
                } else if (sourceType === 'item') {
                    const item  = actor?.items.get(sourceId);
                    if (item) {
                        const updated = (item.getFlag(MODULE_ID, FLAG_ASSIGNED) ?? []).filter(id => id !== effectId);
                        await item.setFlag(MODULE_ID, FLAG_ASSIGNED, updated);
                    }
                } else if (sourceType === 'actor') {
                    if (actor) {
                        const updated = (actor.getFlag(MODULE_ID, FLAG_ACTOR) ?? []).filter(id => id !== effectId);
                        await actor.setFlag(MODULE_ID, FLAG_ACTOR, updated);
                    }
                }

                this.render();
            });
        });

        // Remove ALL assignments
        el.querySelector('[data-action="removeAllAssignments"]')?.addEventListener('click', async () => {
            const confirmed = await foundry.applications.api.DialogV2.confirm({
                window: { title: 'Remove All Assignments', icon: 'fas fa-trash' },
                content: '<p>This will remove <strong>all</strong> effect assignments from every actor, item, and scene override. The effect definitions themselves will not be deleted.</p><p>Are you sure?</p>',
                yes: { label: 'Remove All', icon: 'fas fa-trash' },
                no:  { label: 'Cancel', icon: 'fas fa-times' },
            });
            if (!confirmed) return;

            // 1. Clear all scene overrides (PC toggles + NPC toggles)
            const pcIds  = getPcToggles();
            const npcIds = getNpcToggles();
            for (const id of pcIds)  await setPcToggle(id, false);
            for (const id of npcIds) await setNpcToggle(id, false);

            // 2. Clear item-assigned effects from all actors
            for (const actor of this._collectViewerActors()) {
                for (const item of actor.items) {
                    const ids = item.getFlag(MODULE_ID, FLAG_ASSIGNED) ?? [];
                    if (ids.length) await item.setFlag(MODULE_ID, FLAG_ASSIGNED, []);
                }

                // 3. Clear actor-level (direct) assignments
                const actorIds = actor.getFlag(MODULE_ID, FLAG_ACTOR) ?? [];
                if (actorIds.length) await actor.setFlag(MODULE_ID, FLAG_ACTOR, []);
            }

            ui.notifications.info('All effect assignments have been removed.');
            this.render();
        });

        // Register live-update hooks
        this._registerRefreshHooks();
    }

    _registerRefreshHooks() {
        // Clear any previous hooks (in case of re-render)
        this._unregisterRefreshHooks();

        const refresh = foundry.utils.debounce(() => {
            if (this.rendered) this.render();
        }, 250);

        this._hookIds.push(Hooks.on('updateActor', refresh));
        this._hookIds.push(Hooks.on('updateItem', refresh));
        this._hookIds.push(Hooks.on('updateToken', refresh));
        this._hookIds.push(Hooks.on('updateScene', refresh));
        this._hookIds.push(Hooks.on('createItem', refresh));
        this._hookIds.push(Hooks.on('deleteItem', refresh));
    }

    _unregisterRefreshHooks() {
        for (const id of this._hookIds) Hooks.off(id);
        this._hookIds = [];
    }

    close(options) {
        this._unregisterRefreshHooks();
        return super.close(options);
    }
}

// Helpers for scene toggle checks (avoid importing mutable state)
function pcToggles_has(effectId) { return getPcToggles().includes(effectId); }
function npcToggles_has(effectId) { return getNpcToggles().includes(effectId); }
