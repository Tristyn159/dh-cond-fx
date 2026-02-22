/**
 * config.js — v1.2.0
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export const MODULE_ID      = 'daggerheart-cond-fx';
export const SETTINGS_KEY   = 'conditionalEffects';
export const FLAG_ASSIGNED  = 'assignedEffects';
export const FLAG_ACTOR     = 'actorEffects';
export const SCENE_FLAG     = 'sceneOverrides';
export const FLAG_PC_TOGGLES = 'pcToggles'; // Key for the Scene flag

export const APPLICABLE_ITEM_TYPES = ['weapon', 'armor', 'domainCard', 'feature'];
export const ADV_MODE = { NORMAL: 0, ADVANTAGE: 1, DISADVANTAGE: -1 };

export const STATUSES = [
    { id: 'vulnerable',  label: 'Vulnerable'  },
    { id: 'hidden',      label: 'Hidden'       },
    { id: 'restrained',  label: 'Restrained'   },
    { id: 'deathMove',   label: 'Death Move'   },
    { id: 'defeated',    label: 'Defeated'     },
    { id: 'unconscious', label: 'Unconscious'  },
    { id: 'dead',        label: 'Dead'         },
    { id: 'blessed',     label: 'Blessed'      },
    { id: 'cursed',      label: 'Cursed'       },
    { id: 'poisoned',    label: 'Poisoned'     },
    { id: 'prone',       label: 'Prone'        },
    { id: 'stunned',     label: 'Stunned'      },
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
    { id: 'always',    label: 'Always (unconditional)'       },
    { id: 'status',    label: 'Subject has Status/Condition' },
    { id: 'attribute', label: 'Subject Attribute Value'      },
    /**{ id: 'range',     label: 'Attack Range'                 },  -- need to fix*/
    { id: 'weapon',    label: 'Weapon Slot'                  },
];

export const EFFECT_TYPES = [
    { id: 'damage_bonus',     label: 'Damage Bonus (dice and/or flat)'   },
    { id: 'damage_reduction', label: 'Damage Threshold Bonus (major / severe)' },
    { id: 'defense_bonus',    label: 'Defense / Evasion Bonus (flat)'    },
    { id: 'status_on_hit',    label: 'Apply Status to Target on Hit'     },
    { id: 'roll_bonus',       label: 'Roll Bonus (flat)'                 },
    { id: 'advantage',        label: 'Grant Advantage'                   },
    { id: 'disadvantage',     label: 'Force Disadvantage'                },
];

export const DAMAGE_TYPES = [
    { id: 'physical',        label: 'Physical'                 },
    { id: 'magical',         label: 'Magical'                  },
    { id: 'primaryWeapon',   label: 'Primary Weapon'           },
    { id: 'secondaryWeapon', label: 'Secondary Weapon'         },
    { id: 'any',             label: 'Any (physical + magical)' },
];

/**export const RANGE_TYPES = [
    { id: 'melee',  label: 'Melee'  },
    { id: 'ranged', label: 'Ranged' },
    { id: 'any',    label: 'Any'    },
]; -- need to fix and add other ranges*/

export const WEAPON_SLOTS = [
    { id: 'primary',   label: 'Primary'   },
    { id: 'secondary', label: 'Secondary' },
    { id: 'any',       label: 'Any'       },
];

export function defaultEffect() {
    return {
        id:          foundry.utils.randomID(),
        name:        'New Conditional Effect',
        description: '',
        enabled:     true,
        beneficial:  true,
        condition: {
            type:       'always',
            subject:    'target',
            status:     'vulnerable',
            attribute:  'hope',
            operator:   '>=',
            value:      1,
            /**range:      'any',*/
            weaponSlot: 'any',
        },
        effect: {
            type:          'damage_bonus',
            damageType:    'physical',
            dice:          '',
            bonus:         0,
            rollBonus:     0,
            thresholdMajor:  0,
            thresholdSevere: 0,
            defenseBonus:  0,
            statusToApply: 'vulnerable',
        },
    };
}

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

export async function clearSceneOverrides() {
    if (game.scenes.active) await game.scenes.active.unsetFlag(MODULE_ID, SCENE_FLAG);
}

export function isEffectActive(effect) {
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
    /**if (condition.type === 'range')  return `Range: ${RANGE_TYPES.find(r => r.id === condition.range)?.label ?? condition.range}`;*/
    if (condition.type === 'weapon') return `Slot: ${WEAPON_SLOTS.find(w => w.id === condition.weaponSlot)?.label ?? condition.weaponSlot}`;
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
    if (effect.type === 'damage_reduction') {
        const maj = effect.thresholdMajor  ?? 0;
        const sev = effect.thresholdSevere ?? 0;
        return `Threshold +${maj} major / +${sev} severe`;
    }
    if (effect.type === 'defense_bonus')    return `Evasion ${(effect.defenseBonus ?? 0) >= 0 ? '+' : ''}${effect.defenseBonus ?? 0}`;
    if (effect.type === 'status_on_hit') {
        const s = STATUSES.find(s => s.id === effect.statusToApply)?.label ?? effect.statusToApply;
        return `Apply: ${s}`;
    }
    if (effect.type === 'roll_bonus')    return `Roll ${effect.rollBonus >= 0 ? '+' : ''}${effect.rollBonus}`;
    if (effect.type === 'advantage')    return 'Advantage';
    if (effect.type === 'disadvantage') return 'Disadvantage';
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
        const overrides = getSceneOverrides();
        const pcToggles = getPcToggles(); // Get active PC toggles
        const effects = getAllEffects().map(e => ({
            ...e,
            conditionSummary: summarizeCondition(e.condition),
            effectSummary:    summarizeEffect(e.effect),
            beneficialLabel:  e.beneficial ? 'Beneficial' : 'Detrimental',
            beneficialIcon:   e.beneficial ? 'fa-shield-heart dce-beneficial' : 'fa-skull-crossbones dce-detrimental',
            effectiveEnabled: isEffectActive(e),
            overrideValue:    Object.prototype.hasOwnProperty.call(overrides, e.id) ? overrides[e.id] : null,
            overrideEnabled:  overrides[e.id] === true,
            overrideDisabled: overrides[e.id] === false,
            overridePC:       pcToggles.includes(e.id), // Pass to template
        }));
        return { effects, isEmpty: effects.length === 0, activeTab: this._activeTab,
                 sceneName: game.scenes.active?.name ?? 'No Active Scene' };
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

        // Scene override buttons
        el.querySelectorAll('[data-action="overrideEnable"]').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.preventDefault();
                const { effectId } = btn.closest('[data-effect-id]').dataset;
                const cur = getSceneOverrides()[effectId];
                await setSceneOverride(effectId, cur === true ? null : true);
                this.render();
            });
        });

        el.querySelectorAll('[data-action="overrideDisable"]').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.preventDefault();
                const { effectId } = btn.closest('[data-effect-id]').dataset;
                const cur = getSceneOverrides()[effectId];
                await setSceneOverride(effectId, cur === false ? null : false);
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
        return {
            effect, effectId: this.effectId,
            statuses: STATUSES, attributes: ATTRIBUTES, operators: OPERATORS,
            conditionTypes: CONDITION_TYPES, effectTypes: EFFECT_TYPES,
            damageTypes: DAMAGE_TYPES,/** rangeTypes: RANGE_TYPES,*/ weaponSlots: WEAPON_SLOTS,
            showSubject:         cond.type === 'status' || cond.type === 'attribute',
            showStatus:          cond.type === 'status',
            showAttribute:       cond.type === 'attribute',
            /**showRange:           cond.type === 'range',*/
            showWeaponSlot:      cond.type === 'weapon',
            showDamageBonus:     eff.type  === 'damage_bonus',
            showDamageReduction: eff.type  === 'damage_reduction',
            showDefenseBonus:    eff.type  === 'defense_bonus',
            showStatusOnHit:     eff.type  === 'status_on_hit',
            showRollBonus:       eff.type  === 'roll_bonus',
            enabledStr:          String(effect.enabled),
            beneficialStr:       String(effect.beneficial),
        };
    }

    _onRender(_context, _options) {
        const el = this.element;
        el.querySelector('[name="condition.type"]')?.addEventListener('change', () => this._updateVisibility());
        el.querySelector('[name="effect.type"]')?.addEventListener('change',  () => this._updateVisibility());
        this._updateVisibility();

        const beneficialInput = el.querySelector('[name="beneficial"]');
        el.querySelectorAll('.dce-polarity-btn[data-polarity]').forEach(btn => {
            btn.addEventListener('click', () => {
                const val = btn.dataset.polarity;
                if (beneficialInput) beneficialInput.value = val;
                el.querySelectorAll('.dce-polarity-btn').forEach(b => b.classList.remove('active-beneficial', 'active-detrimental'));
                btn.classList.add(val === 'true' ? 'active-beneficial' : 'active-detrimental');
            });
        });

        el.addEventListener('submit', async e => {
            e.preventDefault();
            const fd  = new FormData(el);
            const raw = foundry.utils.expandObject(Object.fromEntries(fd.entries()));
            raw.enabled    = raw.enabled    === 'true' || raw.enabled    === true;
            raw.beneficial = raw.beneficial === 'true' || raw.beneficial === true;
            if (raw.condition) raw.condition.value       = Number(raw.condition.value       ?? 0);
            if (raw.effect)    raw.effect.bonus            = Number(raw.effect.bonus            ?? 0);
            if (raw.effect)    raw.effect.rollBonus        = Number(raw.effect.rollBonus        ?? 0);
            if (raw.effect)    raw.effect.thresholdMajor   = Number(raw.effect.thresholdMajor   ?? 0);
            if (raw.effect)    raw.effect.thresholdSevere  = Number(raw.effect.thresholdSevere  ?? 0);
            if (raw.effect)    raw.effect.defenseBonus     = Number(raw.effect.defenseBonus     ?? 0);
            if (this.effectId) await updateEffect(this.effectId, raw);
            else await createEffect(raw);
            this._onSave?.();
            this.close();
        });
    }

    _updateVisibility() {
        const condType = this.element.querySelector('[name="condition.type"]')?.value;
        const effType  = this.element.querySelector('[name="effect.type"]')?.value;
        this._toggle('.dce-field-subject',          condType === 'status' || condType === 'attribute');
        this._toggle('.dce-field-status',           condType === 'status');
        this._toggle('.dce-field-attribute',        condType === 'attribute');
        /**this._toggle('.dce-field-range',            condType === 'range');*/
        this._toggle('.dce-field-weapon-slot',      condType === 'weapon');
        this._toggle('.dce-field-damage-bonus',     effType  === 'damage_bonus');
        this._toggle('.dce-field-damage-reduction', effType  === 'damage_reduction');
        this._toggle('.dce-field-defense-bonus',    effType  === 'defense_bonus');
        this._toggle('.dce-field-status-on-hit',    effType  === 'status_on_hit');
        this._toggle('.dce-field-roll-bonus',       effType  === 'roll_bonus');
    }

    _toggle(selector, visible) {
        const el = this.element.querySelector(selector);
        if (el) el.classList.toggle('dce-hidden', !visible);
    }
}
