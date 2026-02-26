/**
 * main.js — v1.2.0
 */

import {
    MODULE_ID, FLAG_ASSIGNED, FLAG_ACTOR, FLAG_PC_TOGGLES, FLAG_NPC_TOGGLES, FLAG_SCENE_OFF,
    APPLICABLE_ITEM_TYPES, ADV_MODE,
    getAllEffects, STATUSES, ATTRIBUTES, DAMAGE_TYPES, INCOMING_DAMAGE_TYPES, RANGE_TYPES,
    TRAITS, ACTION_ROLL_TYPES,
    registerSettings, summarizeCondition, summarizeEffect,
    ConditionalEffectsManager, ActiveAssignmentsViewer, isEffectActive,
    getPcToggles, getNpcToggles, getSceneDisabled,
} from './config.js';

import {
    DEBUG_CATEGORIES,
    registerDebugSettings,
    restoreDebugState,
    openDebugDialog,
    logDebug,
    logWarn,
    logError,
} from './debug.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// ─── Per-actor transient state flags ─────────────────────────────────────────
//
// We store per-actor state in flags so it persists for the owning user and
// survives refreshes:
//   flags.[MODULE_ID].durationState: { [effectId]: { mode, remaining, expiresAt? } }
//   flags.[MODULE_ID].triggers: { rolledFear?, tookThreshold?, inflictedThreshold? }

const FLAG_DURATION_STATE = 'durationState';
const FLAG_TRIGGERS = 'triggers';

// When damage is applied, the target actor's takeDamage() hook does not include
// source info. We bridge that by caching (targetActorId -> attackerUuid) for a
// brief window during applyDamage.
const _pendingDamageSources = new Map(); // actorId -> [{ attackerUuid, ts }, ...]

// ─── Init / Ready ─────────────────────────────────────────────────────────────

Hooks.once('init', () => {
    registerDebugSettings();
    logDebug(DEBUG_CATEGORIES.CORE, 'Initialising');
    registerSettings();
});

Hooks.once('ready', async () => {
    restoreDebugState();
    await foundry.applications.handlebars.loadTemplates([
        `modules/${MODULE_ID}/templates/manager.hbs`,
        `modules/${MODULE_ID}/templates/effect-config.hbs`,
        `modules/${MODULE_ID}/templates/item-effects.hbs`,
        `modules/${MODULE_ID}/templates/actor-effects.hbs`,
        `modules/${MODULE_ID}/templates/palette.hbs`,
        `modules/${MODULE_ID}/templates/active-assignments.hbs`,
    ]);
    _registerItemSheetHooks();
    _registerActorSheetHooks();
    _registerRollHooks();
    _registerEvasionSyncHooks();
    _registerThresholdSyncHooks();
    _registerProficiencySyncHooks();
    _registerStatusSyncHooks();
    _registerSceneFlagSyncHook();   // single unified hook for scene override changes
    _registerProximityHooks();      // re-sync when tokens move (range conditions)
    _registerDaggerheartMenuHook();

    // Sync evasion AEs and status AEs for all currently-loaded actors on world load.
    for (const actor of game.actors) {
        _syncEvasionActiveEffects(actor);
        _syncThresholdActiveEffects(actor);
        _syncProficiencyActiveEffects(actor);
        _syncStatusActiveEffects(actor);
    }

    const dhMenu = ui.daggerheartMenu ?? Object.values(ui).find(a => a?.constructor?.tabName === 'daggerheartMenu');
    if (dhMenu?.element) _injectDaggerheartMenuSection(dhMenu, dhMenu.element);
    logDebug(DEBUG_CATEGORIES.CORE, 'Ready');
});

// ─── Evaluator ────────────────────────────────────────────────────────────────

function _getActorConditionalEffects(actor) {
    if (!actor) return [];
    const allEffects = getAllEffects();
    if (!allEffects.length) return [];

    // Scene-disabled effects are force-blocked for everyone
    const sceneDisabled = new Set(getSceneDisabled());

    const assignedIds = new Set(); // Use a Set to prevent duplicate effects

    // Scene-wide toggles — apply to ALL actors of that type regardless of manual assignment
    if (actor.type === 'character') {
        const pcToggles = getPcToggles();
        pcToggles.forEach(id => assignedIds.add(id));
    }
    if (actor.type === 'adversary') {
        const npcToggles = getNpcToggles();
        npcToggles.forEach(id => assignedIds.add(id));
    }

    // Item-assigned effects
    for (const item of actor.items) {
        if (!APPLICABLE_ITEM_TYPES.includes(item.type)) continue;
        if (!_isItemActive(item)) continue;
        const ids = item.getFlag(MODULE_ID, FLAG_ASSIGNED) ?? [];
        ids.forEach(id => assignedIds.add(id));
    }

    // Actor-level effects (assigned directly to the actor)
    const actorIds = actor.getFlag(MODULE_ID, FLAG_ACTOR) ?? [];
    actorIds.forEach(id => assignedIds.add(id));

    if (assignedIds.size === 0) return [];

    // Filter: must be assigned, must be globally enabled, must NOT be scene-disabled
    return allEffects.filter(e =>
        assignedIds.has(e.id) && e.enabled && !sceneDisabled.has(e.id)
    );
}

// ─── Duration / Trigger helpers ─────────────────────────────────────────────

function _nowMs() { return Date.now(); }

function _getDurationState(actor) {
    return actor?.getFlag(MODULE_ID, FLAG_DURATION_STATE) ?? {};
}

async function _setDurationState(actor, state) {
    if (!actor) return;
    await actor.setFlag(MODULE_ID, FLAG_DURATION_STATE, state);
}

function _getTriggers(actor) {
    return actor?.getFlag(MODULE_ID, FLAG_TRIGGERS) ?? {};
}

async function _setTriggers(actor, triggers) {
    if (!actor) return;
    await actor.setFlag(MODULE_ID, FLAG_TRIGGERS, triggers);
}

function _isExpiredByCombatMarker(marker, combat) {
    if (!marker) return false;
    if (!combat) return true; // if it requires combat, treat as expired outside combat
    if (marker.combatId && marker.combatId !== combat.id) return true;
    if (marker.mode === 'end_of_combat') return false; // expires when combat ends (handled by hook)
    return false;
}

function _canApplyByDuration(actor, effect) {
    const dur = effect.duration ?? { mode: 'permanent' };
    const mode = dur.mode ?? 'permanent';
    const state = _getDurationState(actor);
    const entry = state?.[effect.id];

    // For end_of_combat mode, we need combat to be active
    if (mode === 'end_of_combat') {
        const combat = game.combat ?? null;
        if (!combat) {
            // No active combat - effect cannot apply
            return false;
        }
        // If we have an entry, check it's for the current combat
        if (entry) {
            return entry.combatId === combat.id;
        }
        // No entry yet but combat is active - effect can apply (will be tracked on first use)
        return true;
    }

    // No entry means unused/untracked for other modes
    if (!entry) return true;

    // Limited uses
    if (entry.mode === 'once' || entry.mode === 'uses' || entry.mode === 'next_roll' || entry.mode === 'next_damage') {
        return Number(entry.remaining ?? 0) > 0;
    }

    // Legacy check for any stored end_of_combat entries
    if (entry.mode === 'end_of_combat') {
        const combat = game.combat ?? null;
        return combat && entry.combatId === combat.id;
    }

    // Countdown mode — remaining ticks > 0
    if (entry.mode === 'countdown') {
        return Number(entry.remaining ?? 0) > 0;
    }

    return true;
}

/**
 * Track the combat ID for an end_of_combat duration effect.
 * Called when the effect's AE is first created during combat.
 */
async function _trackCombatDuration(actor, effect) {
    const combat = game.combat;
    if (!combat) return;
    
    const state = foundry.utils.deepClone(_getDurationState(actor));
    state[effect.id] = { mode: 'end_of_combat', combatId: combat.id };
    await _setDurationState(actor, state);
    logDebug(DEBUG_CATEGORIES.CORE, `Tracking combat duration for "${effect.name}" on ${actor.name} (combat ${combat.id})`);
}

function _isReusableDurationMode(mode) {
    return mode === 'once' || mode === 'uses' || mode === 'next_roll' || mode === 'next_damage' || mode === 'countdown';
}

function _isExhaustedReusableDurationEntry(entry) {
    if (!entry?.mode) return false;
    if (!_isReusableDurationMode(entry.mode)) return false;
    return Number(entry.remaining ?? 0) <= 0;
}

async function _resetExhaustedDurationStateForAeType(actor, effectType, inScopeEffectIds, conditionById, previousConditionById = null) {
    if (!actor?.id) return;

    const state = foundry.utils.deepClone(_getDurationState(actor));
    if (!state || typeof state !== 'object') return;

    const effectsById = new Map(getAllEffects().map(e => [e.id, e]));
    let changed = false;

    for (const [effectId, entry] of Object.entries(state)) {
        if (!_isExhaustedReusableDurationEntry(entry)) continue;

        const def = effectsById.get(effectId);
        if (!def) {
            delete state[effectId];
            changed = true;
            continue;
        }

        // Only reset the relevant AE-backed type here.
        if (!(def.beneficial && def.effect?.type === effectType)) continue;

        const inScope = inScopeEffectIds.has(effectId);
        if (!inScope) {
            // Unassigned/unequipped/scene-disabled/etc. Rearm on future reassignment.
            delete state[effectId];
            changed = true;
            logDebug(DEBUG_CATEGORIES.CORE, `Cleared exhausted duration for "${def.name}" (no longer in scope)`);
            continue;
        }

        const conditionMet = conditionById.get(effectId);
        if (conditionMet === false) {
            // Condition dropped after exhaustion; rearm for the next time it becomes true.
            delete state[effectId];
            changed = true;
            logDebug(DEBUG_CATEGORIES.CORE, `Cleared exhausted duration for "${def.name}" (condition now false)`);
        }
    }

    if (changed) await _setDurationState(actor, state);
}

/**
 * Track the previous condition state for each actor so we can detect condition transitions.
 * Key: `${actorId}:${effectType}:${effectId}`, Value: boolean (previous conditionMet)
 */
const _previousConditionState = new Map();

/**
 * Build a key for the previous condition state map.
 */
function _conditionStateKey(actorId, effectType, effectId) {
    return `${actorId}:${effectType}:${effectId}`;
}

/**
 * Update the condition state tracking for next sync comparison.
 */
function _updateConditionStateTracking(actorId, effectType, conditionById) {
    for (const [effectId, conditionMet] of conditionById) {
        const key = _conditionStateKey(actorId, effectType, effectId);
        _previousConditionState.set(key, conditionMet);
    }
}

/**
 * Reset exhausted duration state when a condition transitions from false to true.
 * This handles the "re-arm" scenario: effect was used, condition dropped, condition restored.
 * 
 * UPDATED APPROACH: We also reset if there's an exhausted entry but NO existing AE.
 * This catches the case where the effect was consumed while condition stayed true.
 */
async function _resetExhaustedDurationOnConditionRestore(actor, effectType, conditionById, existingAESourceIds) {
    if (!actor?.id) return;

    const state = foundry.utils.deepClone(_getDurationState(actor));
    if (!state || typeof state !== 'object') return;

    const effectsById = new Map(getAllEffects().map(e => [e.id, e]));
    let changed = false;

    for (const [effectId, entry] of Object.entries(state)) {
        if (!_isExhaustedReusableDurationEntry(entry)) continue;

        const def = effectsById.get(effectId);
        if (!def) continue;

        // Only handle the relevant AE-backed type.
        if (!(def.beneficial && def.effect?.type === effectType)) continue;

        const conditionNow = conditionById.get(effectId);
        if (conditionNow !== true) continue; // Only care if condition is currently true

        // Check if condition was previously false (or unknown)
        const key = _conditionStateKey(actor.id, effectType, effectId);
        const conditionBefore = _previousConditionState.get(key);

        // Reset if:
        // 1. Condition transitioned from false to true, OR
        // 2. Condition is true but there's no existing AE (effect was consumed while condition stayed true,
        //    and now we need to check if user wants to re-arm by toggling condition)
        const hasExistingAE = existingAESourceIds?.has(effectId) ?? false;
        
        if (conditionBefore === false || !hasExistingAE) {
            delete state[effectId];
            changed = true;
            logDebug(DEBUG_CATEGORIES.CORE, `Reset exhausted duration for "${def.name}" on ${actor.name} (condition: ${conditionBefore} → ${conditionNow}, hasAE: ${hasExistingAE})`);
        }
    }

    if (changed) await _setDurationState(actor, state);
}

/**
 * For attribute-based conditions (hope, stress, hitPoints), consume duration by
 * dropping the attribute value to 1 below the threshold. This causes the condition
 * to become false, which removes the AE naturally. When the attribute rises again,
 * the condition becomes true and the effect re-applies automatically.
 * 
 * @param {Actor} actor - The actor whose attribute to modify
 * @param {object} effect - The conditional effect definition
 * @param {object} cond - The condition object (already verified as type='attribute', subject='self')
 * @returns {boolean} - True if handled, false if not applicable
 */
async function _consumeDurationByDroppingAttribute(actor, effect, cond) {
    const attr = cond.attribute;
    const op = cond.operator;
    const threshold = Number(cond.value ?? 0);
    
    // Only handle the "resource" attributes that can be modified: hope, stress, hitPoints
    // We need to know the system path for each
    const attrConfig = {
        hope:      { path: 'system.resources.hope.value',      canDecrease: true },
        stress:    { path: 'system.resources.stress.value',    canDecrease: true },
        hitPoints: { path: 'system.resources.hitPoints.value', canDecrease: true },
    };
    
    const config = attrConfig[attr];
    if (!config) {
        // Not a modifiable attribute (evasion, proficiency, traits, etc.)
        logDebug(DEBUG_CATEGORIES.CORE, `[DropAttr] "${effect.name}" - attribute "${attr}" is not modifiable, falling back to duration state`);
        return false;
    }
    
    // Calculate the new value that would make the condition false
    let newValue;
    switch (op) {
        case '>=':
            // condition: value >= threshold. To make false: value = threshold - 1
            newValue = threshold - 1;
            break;
        case '>':
            // condition: value > threshold. To make false: value = threshold
            newValue = threshold;
            break;
        case '<=':
            // condition: value <= threshold. To make false: value = threshold + 1
            newValue = threshold + 1;
            break;
        case '<':
            // condition: value < threshold. To make false: value = threshold
            newValue = threshold;
            break;
        case '==':
            // condition: value == threshold. To make false: value = threshold - 1 (or +1)
            newValue = threshold - 1;
            break;
        default:
            logDebug(DEBUG_CATEGORIES.CORE, `[DropAttr] "${effect.name}" - unknown operator "${op}", falling back to duration state`);
            return false;
    }
    
    // Ensure we don't go below 0
    newValue = Math.max(0, newValue);
    
    // Get current value
    const currentValue = foundry.utils.getProperty(actor, config.path);
    if (currentValue === undefined || currentValue === null) {
        logDebug(DEBUG_CATEGORIES.CORE, `[DropAttr] "${effect.name}" - could not read current value at "${config.path}", falling back to duration state`);
        return false;
    }
    
    // Only update if the new value is actually different and would invalidate the condition
    if (newValue === currentValue) {
        logDebug(DEBUG_CATEGORIES.CORE, `[DropAttr] "${effect.name}" - new value ${newValue} equals current value, nothing to do`);
        return true; // Still "handled" - condition should already be false
    }
    
    logDebug(DEBUG_CATEGORIES.CORE, `[DropAttr] "${effect.name}" on ${actor.name}: dropping ${attr} from ${currentValue} to ${newValue} (threshold=${threshold}, op=${op})`);
    
    // Update the actor's attribute
    const updateData = {};
    foundry.utils.setProperty(updateData, config.path, newValue);
    
    try {
        await actor.update(updateData);
        logDebug(DEBUG_CATEGORIES.CORE, `[DropAttr] "${effect.name}" on ${actor.name}: successfully dropped ${attr} to ${newValue}`);
        return true;
    } catch (err) {
        logWarn(DEBUG_CATEGORIES.CORE, `[DropAttr] Failed to update ${attr} for "${effect.name}" on ${actor.name}`, err);
        return false;
    }
}

async function _consumeDuration(actor, effect, applicationKind) {
    // applicationKind: 'roll' | 'damage' | 'take_damage' | 'other'
    const dur = effect.duration ?? { mode: 'permanent' };
    const mode = String(dur.mode ?? 'permanent');
    if (mode === 'permanent') return;

    // apply_status is AE-backed and intended to track condition truth directly.
    // Other AE-backed types (defense/threshold) do consume by duration and are
    // reconciled by sync loops.
    if (effect.effect?.type === 'apply_status') return;

    // next_roll / next_damage only consume on the right kind.
    if (mode === 'next_roll' && applicationKind !== 'roll') return;
    if (mode === 'next_damage' && applicationKind !== 'damage') return;

    // Check if this is an attribute-based condition that we can handle by dropping the attribute
    const cond = effect.condition;
    if (cond?.type === 'attribute' && cond?.subject === 'self') {
        const handled = await _consumeDurationByDroppingAttribute(actor, effect, cond);
        if (handled) return; // Successfully handled by dropping attribute
    }

    // Fall back to duration state tracking for non-attribute conditions
    const state = foundry.utils.deepClone(_getDurationState(actor));
    const existing = state[effect.id];

    // Uses-style modes
    if (mode === 'once' || mode === 'next_roll' || mode === 'next_damage') {
        const remaining = Number(existing?.remaining ?? 1) - 1;
        state[effect.id] = { mode, remaining: Math.max(remaining, 0) };
        await _setDurationState(actor, state);
        return;
    }
    if (mode === 'uses') {
        const start = Number(dur.uses ?? 1);
        const remaining = Number(existing?.remaining ?? start) - 1;
        state[effect.id] = { mode, remaining: Math.max(remaining, 0) };
        await _setDurationState(actor, state);
        return;
    }

    // Combat-based expiry mode
    if (mode === 'end_of_combat') {
        const combat = game.combat ?? null;
        if (!combat) {
            // No combat context; degrade to once (effect applies once then done).
            const remaining = Number(existing?.remaining ?? 1) - 1;
            state[effect.id] = { mode: 'once', remaining: Math.max(remaining, 0) };
            await _setDurationState(actor, state);
            return;
        }
        state[effect.id] = { mode, combatId: combat.id };
        await _setDurationState(actor, state);
        return;
    }
}

/**
 * Tick all countdown-duration effects on an actor for a given event type.
 * When a countdown reaches 0, the effect is exhausted and the sync loops
 * will remove the corresponding AE on next pass.
 */
async function _tickCountdowns(actor, tickEvent) {
    if (!actor?.id) return;
    const effects = _getActorConditionalEffects(actor);
    const state = foundry.utils.deepClone(_getDurationState(actor));
    let changed = false;

    for (const effect of effects) {
        const dur = effect.duration ?? {};
        if (dur.mode !== 'countdown') continue;
        if ((dur.countdownTickOn ?? 'round_start') !== tickEvent) continue;

        // Initialise the countdown entry if not yet present
        if (!state[effect.id]) {
            state[effect.id] = { mode: 'countdown', remaining: Number(dur.countdownTicks ?? 3) };
            changed = true;
        }

        const entry = state[effect.id];
        if (entry.mode !== 'countdown') continue;
        const remaining = Number(entry.remaining ?? 0);
        if (remaining <= 0) continue; // already exhausted

        const newRemaining = remaining - 1;
        entry.remaining = newRemaining;
        changed = true;
        logDebug(DEBUG_CATEGORIES.CORE, `Countdown tick "${effect.name}" on ${actor.name}: ${remaining} → ${newRemaining} (event: ${tickEvent})`);
    }

    if (changed) {
        await _setDurationState(actor, state);
        // Trigger syncs so AE-backed effects reflect the new state
        _syncEvasionActiveEffects(actor);
        _syncThresholdActiveEffects(actor);
        _syncProficiencyActiveEffects(actor);
        _syncStatusActiveEffects(actor);
    }
}

/**
 * Process chained effects when a parent effect fires.
 * Chained effects inherit the same context (actor, target, action) and are
 * evaluated independently. Chains are depth-limited to prevent infinite loops.
 */
async function _processChainedEffects(actor, parentEffect, ctx, applicationKind, _depth = 0) {
    const MAX_CHAIN_DEPTH = 3;
    if (_depth >= MAX_CHAIN_DEPTH) return;
    const chainIds = parentEffect.effect?.chainEffectIds;
    if (!Array.isArray(chainIds) || !chainIds.length) return;

    const allEffects = getAllEffects();
    for (const chainId of chainIds) {
        const chainedEffect = allEffects.find(e => e.id === chainId);
        if (!chainedEffect) continue;
        if (!isEffectActive(chainedEffect)) continue;
        if (!_canApplyByDuration(actor, chainedEffect)) continue;
        if (!_evaluateCondition(chainedEffect.condition, ctx)) continue;

        logDebug(DEBUG_CATEGORIES.CORE, `Chain: "${parentEffect.name}" → "${chainedEffect.name}" on ${actor.name} (depth ${_depth + 1})`);

        // Apply the chained effect based on its type
        const eff = chainedEffect.effect;
        if (eff.type === 'roll_bonus' || eff.type === 'advantage' || eff.type === 'disadvantage') {
            if (ctx.action?.roll) _applyRollEffect(chainedEffect, ctx.action);
        }
        // Chained status application — auto-applied with a log notification
        if (eff.type === 'apply_status' || eff.type === 'status_on_hit') {
            const statusId = eff.type === 'apply_status' ? eff.applyStatus : eff.statusToApply;
            if (statusId) {
                const target = ctx.target ?? ctx.self;
                if (target) {
                    await target.toggleStatusEffect(statusId, { active: true });
                    logDebug(DEBUG_CATEGORIES.CORE, `Chain applied status "${statusId}" to ${target.name}`);
                }
            }
        }
        // Chained stress application
        if (eff.type === 'stress_on_hit') {
            const stressAmt = Number(eff.stressAmount ?? 1);
            const target = ctx.target ?? ctx.self;
            if (target) {
                const current = target.system?.resources?.stress?.value ?? 0;
                const max = target.system?.resources?.stress?.max ?? 6;
                const newVal = Math.min(current + stressAmt, max);
                if (newVal !== current) {
                    await target.update({ 'system.resources.stress.value': newVal });
                    logDebug(DEBUG_CATEGORIES.CORE, `Chain applied ${stressAmt} Stress to ${target.name}`);
                }
            }
        }

        _consumeDuration(actor, chainedEffect, applicationKind);
        _consumeTriggerIfNeeded(actor, chainedEffect);

        // Recurse for nested chains
        await _processChainedEffects(actor, chainedEffect, ctx, applicationKind, _depth + 1);
    }
}

async function _markTrigger(actor, type, payload) {
    const triggers = foundry.utils.deepClone(_getTriggers(actor));
    triggers[type] = foundry.utils.mergeObject(triggers[type] ?? {}, payload ?? {}, { inplace: false });
    triggers[type].ts = _nowMs();
    await _setTriggers(actor, triggers);
}

async function _clearTrigger(actor, type, key = null) {
    const triggers = foundry.utils.deepClone(_getTriggers(actor));
    if (!(type in triggers)) return;
    if (key && typeof triggers[type] === 'object') {
        delete triggers[type][key];
        // keep ts
    } else {
        delete triggers[type];
    }
    await _setTriggers(actor, triggers);
}

function _isTriggerConditionType(type) {
    return type === 'rolled_fear' || type === 'took_threshold' || type === 'inflicted_threshold' || type === 'rolled_critical' || type === 'spent_hope' || type === 'armor_slot_marked';
}

function _consumeTriggerIfNeeded(actor, effect) {
    const ct = effect?.condition?.type;
    if (!_isTriggerConditionType(ct)) return;
    // Fire and forget; we don't want to block roll/damage hooks.
    if (ct === 'rolled_fear') _clearTrigger(actor, 'rolledFear');
    if (ct === 'rolled_critical') _clearTrigger(actor, 'rolledCritical');
    if (ct === 'spent_hope') _clearTrigger(actor, 'spentHope');
    if (ct === 'armor_slot_marked') _clearTrigger(actor, 'armorSlotMarked');
    if (ct === 'took_threshold') _clearTrigger(actor, 'tookThreshold', effect.condition.threshold ?? 'major');
    if (ct === 'inflicted_threshold') _clearTrigger(actor, 'inflictedThreshold', effect.condition.threshold ?? 'major');
}

// ─── Evasion Active Effect Sync ──────────────────────────────────────────────
//
// For defense_bonus effects, we create real Foundry ActiveEffects on the actor.
// Characters use key 'system.evasion'; adversaries use key 'system.difficulty'.
// The system's own AE pipeline handles the math cleanly during prepareData().
// We identify our AEs by flag: flags.[MODULE_ID].sourceEffectId = <condEffectId>.
//
// A per-actor debounce prevents duplicate async operations when multiple hooks
// fire in quick succession (e.g. equip triggers updateItem + updateActor).

const _evasionSyncPending = new Set();
const _evasionSyncDirty = new Set();

async function _syncEvasionActiveEffects(actor) {
    if (!actor?.id || !actor.isOwner) return;
    // Characters have 'evasion', adversaries have 'difficulty' — both represent the defense target
    const hasEvasion    = 'evasion'    in (actor.system ?? {});
    const hasDifficulty = 'difficulty' in (actor.system ?? {});
    if (!hasEvasion && !hasDifficulty) return;
    const defenseKey   = hasEvasion ? 'system.evasion' : 'system.difficulty';
    const defenseLabel = hasEvasion ? 'Evasion' : 'Difficulty';

    // Coalesce rapid updates without allowing overlapping async sync runs.
    if (_evasionSyncPending.has(actor.id)) {
        _evasionSyncDirty.add(actor.id);
        return;
    }
    _evasionSyncPending.add(actor.id);

    try {
        do {
            _evasionSyncDirty.delete(actor.id);
            // Collapse bursty hook activity.
            await Promise.resolve();

            try {
                const condEffects = _getActorConditionalEffects(actor);
                const evasionEffects = condEffects.filter(ce =>
                    ce.beneficial && ce.effect.type === 'defense_bonus'
                );

                const evasionInScopeIds = new Set(evasionEffects.map(ce => ce.id));
                const evasionConditionById = new Map();
                for (const ce of evasionEffects) {
                    evasionConditionById.set(
                        ce.id,
                        _evaluateCondition(ce.condition, { self: actor, target: null, action: null })
                    );
                }

                // Find existing dce evasion AEs on this actor FIRST (before reset checks)
                const existing = actor.effects.filter(ae =>
                    ae.getFlag(MODULE_ID, 'sourceEffectId') !== undefined &&
                    ae.getFlag(MODULE_ID, 'evasionAE') === true
                );
                const existingSourceIds = new Set(existing.map(ae => ae.getFlag(MODULE_ID, 'sourceEffectId')));

                // Check for condition transitions (false -> true) and reset exhausted duration
                await _resetExhaustedDurationOnConditionRestore(actor, 'defense_bonus', evasionConditionById, existingSourceIds);

                await _resetExhaustedDurationStateForAeType(
                    actor,
                    'defense_bonus',
                    evasionInScopeIds,
                    evasionConditionById
                );

                // Build the set of condEffect IDs that should have an AE right now.
                const desired = new Map(); // condEffectId -> bonus value
                for (const ce of evasionEffects) {
                    if (!_canApplyByDuration(actor, ce)) continue;
                    if (!evasionConditionById.get(ce.id)) continue;
                    const bonus = Number(ce.effect.defenseBonus ?? 0);
                    if (!bonus) continue;
                    desired.set(ce.id, { bonus, name: ce.name });
                }

                const toDelete = [];
                const toCreate = new Map(desired); // will prune as we find matches

                for (const ae of existing) {
                    const sourceId = ae.getFlag(MODULE_ID, 'sourceEffectId');
                    if (desired.has(sourceId)) {
                        // AE exists and should exist — check value is still correct.
                        const expectedBonus = desired.get(sourceId).bonus;
                        const currentBonus = Number(ae.changes?.[0]?.value ?? 0);
                        if (currentBonus !== expectedBonus) {
                            // Value changed — delete and recreate.
                            toDelete.push(ae.id);
                        } else {
                            // Already correct — don't recreate.
                            toCreate.delete(sourceId);
                        }
                    } else {
                        // AE exists but condition no longer met — delete.
                        toDelete.push(ae.id);
                    }
                }

                if (toDelete.length) {
                    try {
                        await actor.deleteEmbeddedDocuments('ActiveEffect', toDelete);
                        logDebug(DEBUG_CATEGORIES.EVASION_AE, `Deleted ${toDelete.length} ${defenseLabel.toLowerCase()} AE(s) from ${actor.name}`);
                    } catch (err) {
                        const msg = String(err?.message ?? err);
                        if (msg.includes('does not exist')) {
                            logWarn(
                                DEBUG_CATEGORIES.EVASION_AE,
                                `Stale ${defenseLabel.toLowerCase()} AE delete on ${actor.name}; scheduling resync`,
                                err
                            );
                            _evasionSyncDirty.add(actor.id);
                        } else {
                            throw err;
                        }
                    }
                }

                if (toCreate.size) {
                    const aeData = [];
                    for (const [sourceId, { bonus, name }] of toCreate) {
                        aeData.push({
                            name: `${name} (${defenseLabel})`,
                            img: 'icons/magic/defensive/shield-barrier-blue.webp',
                            transfer: false,
                            flags: {
                                [MODULE_ID]: {
                                    sourceEffectId: sourceId,
                                    evasionAE: true,
                                },
                            },
                            changes: [{
                                key:   defenseKey,
                                mode:  CONST.ACTIVE_EFFECT_MODES.ADD,
                                value: String(bonus),
                            }],
                        });
                        
                        // Track combat ID for end_of_combat effects
                        const ce = evasionEffects.find(e => e.id === sourceId);
                        if (ce?.duration?.mode === 'end_of_combat' && game.combat) {
                            await _trackCombatDuration(actor, ce);
                        }
                    }
                    await actor.createEmbeddedDocuments('ActiveEffect', aeData);
                    logDebug(DEBUG_CATEGORIES.EVASION_AE, `Created ${aeData.length} ${defenseLabel.toLowerCase()} AE(s) on ${actor.name}`);
                }

                // Stamp pre-existing end_of_combat AEs that were active before combat started.
                // If combat is active and an end_of_combat effect already has its AE from before
                // combat, _trackCombatDuration was never called. Fix that now.
                if (game.combat) {
                    const currentState = _getDurationState(actor);
                    for (const ce of evasionEffects) {
                        if (ce.duration?.mode !== 'end_of_combat') continue;
                        // Only stamp if: condition is met, AE exists (in desired), but no durationState entry yet
                        if (!evasionConditionById.get(ce.id)) continue;
                        if (!desired.has(ce.id)) continue; // AE should exist
                        const entry = currentState[ce.id];
                        if (!entry) {
                            // AE is live but not tracked — stamp it now
                            await _trackCombatDuration(actor, ce);
                        }
                    }
                }

                // Update condition state tracking for next sync
                _updateConditionStateTracking(actor.id, 'defense_bonus', evasionConditionById);
            } catch (err) {
                logError(`Error syncing evasion AEs for ${actor.name}`, err);
            }
        } while (_evasionSyncDirty.has(actor.id));
    } finally {
        _evasionSyncPending.delete(actor.id);
        _evasionSyncDirty.delete(actor.id);
    }
}

// ─── Threshold Active Effect Sync ───────────────────────────────────────────
//
// For damage_reduction effects, we create ActiveEffects on the actor that add to
// system.damageThresholds.major / system.damageThresholds.severe.
//
// This replaces the previous prepareDerivedData monkey-patch approach and makes
// threshold modifiers stable across equip/unequip and other recalculations.
//
// We identify our AEs by flags:
//   flags.[MODULE_ID].sourceEffectId = <condEffectId>
//   flags.[MODULE_ID].thresholdAE   = true

const _thresholdSyncPending = new Set();
const _thresholdSyncDirty = new Set();

async function _syncThresholdActiveEffects(actor) {
    if (!actor?.id || !actor.isOwner) return;
    if (!('damageThresholds' in (actor.system ?? {}))) return;

    // Coalesce rapid updates without allowing overlapping async sync runs.
    if (_thresholdSyncPending.has(actor.id)) {
        _thresholdSyncDirty.add(actor.id);
        return;
    }
    _thresholdSyncPending.add(actor.id);

    try {
        do {
            _thresholdSyncDirty.delete(actor.id);
            // Collapse bursty hook activity.
            await Promise.resolve();

            try {
                const condEffects = _getActorConditionalEffects(actor);
                const thresholdEffects = condEffects.filter(ce =>
                    ce.beneficial && ce.effect.type === 'damage_reduction'
                );

                const thresholdInScopeIds = new Set(thresholdEffects.map(ce => ce.id));
                const thresholdConditionById = new Map();
                for (const ce of thresholdEffects) {
                    thresholdConditionById.set(
                        ce.id,
                        _evaluateCondition(ce.condition, { self: actor, target: null, action: null })
                    );
                }

                // Find existing dce threshold AEs on this actor FIRST (before reset checks)
                const existing = actor.effects.filter(ae =>
                    ae.getFlag(MODULE_ID, 'sourceEffectId') !== undefined &&
                    ae.getFlag(MODULE_ID, 'thresholdAE') === true
                );
                const existingSourceIds = new Set(existing.map(ae => ae.getFlag(MODULE_ID, 'sourceEffectId')));

                // Check for condition transitions (false -> true) and reset exhausted duration
                await _resetExhaustedDurationOnConditionRestore(actor, 'damage_reduction', thresholdConditionById, existingSourceIds);

                await _resetExhaustedDurationStateForAeType(
                    actor,
                    'damage_reduction',
                    thresholdInScopeIds,
                    thresholdConditionById
                );

                // Build the set of condEffect IDs that should have a threshold AE right now.
                const desired = new Map(); // condEffectId -> { major, severe, name }
                for (const ce of thresholdEffects) {
                    if (!_canApplyByDuration(actor, ce)) continue;
                    if (!thresholdConditionById.get(ce.id)) continue;
                    const major = Number(ce.effect.thresholdMajor ?? 0);
                    const severe = Number(ce.effect.thresholdSevere ?? 0);
                    if (!major && !severe) continue;
                    desired.set(ce.id, { major, severe, name: ce.name });
                }

                const toDelete = [];
                const toCreate = new Map(desired);

                const _readThresholdChange = (ae, key) => {
                    const c = (ae.changes ?? []).find(x => x.key === key);
                    return Number(c?.value ?? 0);
                };

                for (const ae of existing) {
                    const sourceId = ae.getFlag(MODULE_ID, 'sourceEffectId');
                    if (desired.has(sourceId)) {
                        const expected = desired.get(sourceId);
                        const currentMajor = _readThresholdChange(ae, 'system.damageThresholds.major');
                        const currentSevere = _readThresholdChange(ae, 'system.damageThresholds.severe');
                        if (currentMajor !== expected.major || currentSevere !== expected.severe) {
                            toDelete.push(ae.id);
                        } else {
                            toCreate.delete(sourceId);
                        }
                    } else {
                        toDelete.push(ae.id);
                    }
                }

                if (toDelete.length) {
                    try {
                        await actor.deleteEmbeddedDocuments('ActiveEffect', toDelete);
                        logDebug(DEBUG_CATEGORIES.THRESHOLDS, `Deleted ${toDelete.length} threshold AE(s) from ${actor.name}`);
                    } catch (err) {
                        const msg = String(err?.message ?? err);
                        if (msg.includes('does not exist')) {
                            logWarn(
                                DEBUG_CATEGORIES.THRESHOLDS,
                                `Stale threshold AE delete on ${actor.name}; scheduling resync`,
                                err
                            );
                            _thresholdSyncDirty.add(actor.id);
                        } else {
                            throw err;
                        }
                    }
                }

                if (toCreate.size) {
                    const aeData = [];
                    for (const [sourceId, { major, severe, name }] of toCreate) {
                        const changes = [];
                        if (major) {
                            changes.push({
                                key: 'system.damageThresholds.major',
                                mode: CONST.ACTIVE_EFFECT_MODES.ADD,
                                value: String(major),
                            });
                        }
                        if (severe) {
                            changes.push({
                                key: 'system.damageThresholds.severe',
                                mode: CONST.ACTIVE_EFFECT_MODES.ADD,
                                value: String(severe),
                            });
                        }

                        aeData.push({
                            name: `${name} (Thresholds)`,
                            img: 'icons/skills/melee/shield-block-gray-orange.webp',
                            transfer: false,
                            flags: {
                                [MODULE_ID]: {
                                    sourceEffectId: sourceId,
                                    thresholdAE: true,
                                },
                            },
                            changes,
                        });
                        
                        // Track combat ID for end_of_combat effects
                        const ce = thresholdEffects.find(e => e.id === sourceId);
                        if (ce?.duration?.mode === 'end_of_combat' && game.combat) {
                            await _trackCombatDuration(actor, ce);
                        }
                    }

                    await actor.createEmbeddedDocuments('ActiveEffect', aeData);
                    logDebug(DEBUG_CATEGORIES.THRESHOLDS, `Created ${aeData.length} threshold AE(s) on ${actor.name}`);
                }

                // Stamp pre-existing end_of_combat AEs that were active before combat started.
                // If combat is active and an end_of_combat effect already has its AE from before
                // combat, _trackCombatDuration was never called. Fix that now.
                if (game.combat) {
                    const currentState = _getDurationState(actor);
                    for (const ce of thresholdEffects) {
                        if (ce.duration?.mode !== 'end_of_combat') continue;
                        // Only stamp if: condition is met, AE exists (in desired), but no durationState entry yet
                        if (!thresholdConditionById.get(ce.id)) continue;
                        if (!desired.has(ce.id)) continue; // AE should exist
                        const entry = currentState[ce.id];
                        if (!entry) {
                            // AE is live but not tracked — stamp it now
                            await _trackCombatDuration(actor, ce);
                        }
                    }
                }

                // Update condition state tracking for next sync
                _updateConditionStateTracking(actor.id, 'damage_reduction', thresholdConditionById);
            } catch (err) {
                logError(`Error syncing threshold AEs for ${actor.name}`, err);
            }
        } while (_thresholdSyncDirty.has(actor.id));
    } finally {
        _thresholdSyncPending.delete(actor.id);
        _thresholdSyncDirty.delete(actor.id);
    }
}

// ─── Proficiency Active Effect Sync ──────────────────────────────────────────
//
// For proficiency_bonus effects, we create real Foundry ActiveEffects on the actor
// (with changes: [{ key:'system.proficiency', mode: ADD, value: N }])
// so the system's own AE pipeline handles the math cleanly during prepareData().
// We identify our AEs by flag: flags.[MODULE_ID].sourceEffectId + proficiencyAE: true.

const _profSyncPending = new Set();
const _profSyncDirty = new Set();

async function _syncProficiencyActiveEffects(actor) {
    if (!actor?.id || !actor.isOwner) return;
    if (!('proficiency' in (actor.system ?? {}))) return;

    if (_profSyncPending.has(actor.id)) {
        _profSyncDirty.add(actor.id);
        return;
    }
    _profSyncPending.add(actor.id);

    try {
        do {
            _profSyncDirty.delete(actor.id);
            await Promise.resolve();

            try {
                const condEffects = _getActorConditionalEffects(actor);
                const profEffects = condEffects.filter(ce =>
                    ce.beneficial && ce.effect.type === 'proficiency_bonus'
                );

                const profInScopeIds = new Set(profEffects.map(ce => ce.id));
                const profConditionById = new Map();
                for (const ce of profEffects) {
                    profConditionById.set(
                        ce.id,
                        _evaluateCondition(ce.condition, { self: actor, target: null, action: null })
                    );
                }

                const existing = actor.effects.filter(ae =>
                    ae.getFlag(MODULE_ID, 'sourceEffectId') !== undefined &&
                    ae.getFlag(MODULE_ID, 'proficiencyAE') === true
                );
                const existingSourceIds = new Set(existing.map(ae => ae.getFlag(MODULE_ID, 'sourceEffectId')));

                await _resetExhaustedDurationOnConditionRestore(actor, 'proficiency_bonus', profConditionById, existingSourceIds);
                await _resetExhaustedDurationStateForAeType(actor, 'proficiency_bonus', profInScopeIds, profConditionById);

                const desired = new Map();
                for (const ce of profEffects) {
                    if (!_canApplyByDuration(actor, ce)) continue;
                    if (!profConditionById.get(ce.id)) continue;
                    const bonus = Number(ce.effect.proficiencyBonus ?? 0);
                    if (!bonus) continue;
                    desired.set(ce.id, { bonus, name: ce.name });
                }

                const toDelete = [];
                const toCreate = new Map(desired);

                for (const ae of existing) {
                    const sourceId = ae.getFlag(MODULE_ID, 'sourceEffectId');
                    if (desired.has(sourceId)) {
                        const expectedBonus = desired.get(sourceId).bonus;
                        const currentBonus = Number(ae.changes?.[0]?.value ?? 0);
                        if (currentBonus !== expectedBonus) {
                            toDelete.push(ae.id);
                        } else {
                            toCreate.delete(sourceId);
                        }
                    } else {
                        toDelete.push(ae.id);
                    }
                }

                if (toDelete.length) {
                    try {
                        await actor.deleteEmbeddedDocuments('ActiveEffect', toDelete);
                        logDebug(DEBUG_CATEGORIES.CORE, `Deleted ${toDelete.length} proficiency AE(s) from ${actor.name}`);
                    } catch (err) {
                        const msg = String(err?.message ?? err);
                        if (msg.includes('does not exist')) {
                            _profSyncDirty.add(actor.id);
                        } else {
                            throw err;
                        }
                    }
                }

                if (toCreate.size) {
                    const aeData = [];
                    for (const [sourceId, { bonus, name }] of toCreate) {
                        aeData.push({
                            name: `${name} (Proficiency)`,
                            img: 'icons/skills/melee/weapons-crossed-swords-yellow.webp',
                            transfer: false,
                            flags: {
                                [MODULE_ID]: {
                                    sourceEffectId: sourceId,
                                    proficiencyAE: true,
                                },
                            },
                            changes: [{
                                key:   'system.proficiency',
                                mode:  CONST.ACTIVE_EFFECT_MODES.ADD,
                                value: String(bonus),
                            }],
                        });

                        const ce = profEffects.find(e => e.id === sourceId);
                        if (ce?.duration?.mode === 'end_of_combat' && game.combat) {
                            await _trackCombatDuration(actor, ce);
                        }
                    }
                    await actor.createEmbeddedDocuments('ActiveEffect', aeData);
                    logDebug(DEBUG_CATEGORIES.CORE, `Created ${aeData.length} proficiency AE(s) on ${actor.name}`);
                }

                if (game.combat) {
                    const currentState = _getDurationState(actor);
                    for (const ce of profEffects) {
                        if (ce.duration?.mode !== 'end_of_combat') continue;
                        if (!profConditionById.get(ce.id)) continue;
                        if (!desired.has(ce.id)) continue;
                        const entry = currentState[ce.id];
                        if (!entry) {
                            await _trackCombatDuration(actor, ce);
                        }
                    }
                }

                _updateConditionStateTracking(actor.id, 'proficiency_bonus', profConditionById);
            } catch (err) {
                logError(`Error syncing proficiency AEs for ${actor.name}`, err);
            }
        } while (_profSyncDirty.has(actor.id));
    } finally {
        _profSyncPending.delete(actor.id);
        _profSyncDirty.delete(actor.id);
    }
}

// ─── Status Active Effect Sync ───────────────────────────────────────────────
//
// For apply_status effects, we create real Foundry status ActiveEffects on the actor
// so the system's own status pipeline handles them cleanly.
// We identify our AEs by flag: flags.[MODULE_ID].sourceEffectId + statusAE: true.
// When the condition is no longer met, the AE is DELETED (not disabled).

const _statusSyncPending = new Set();
const _statusSyncDirty = new Set();

async function _syncStatusActiveEffects(actor) {
    if (!actor?.id || !actor.isOwner) return;

    // Coalesce rapid updates without allowing overlapping async sync runs.
    if (_statusSyncPending.has(actor.id)) {
        _statusSyncDirty.add(actor.id);
        return;
    }
    _statusSyncPending.add(actor.id);

    try {
        do {
            _statusSyncDirty.delete(actor.id);
            // Collapse bursty hook activity.
            await Promise.resolve();

            try {
                const condEffects = _getActorConditionalEffects(actor);

                // Build the set of apply_status condEffects that should be active right now.
                // key = condEffectId, value = { statusId, name }
                const desired = new Map();
                for (const ce of condEffects) {
                    if (ce.effect.type !== 'apply_status') continue;
                    if (!_evaluateCondition(ce.condition, { self: actor, target: null, action: null })) continue;
                    const statusId = ce.effect.applyStatus;
                    if (!statusId) continue;
                    desired.set(ce.id, { statusId, name: ce.name });
                }

                // Find existing dce status AEs on this actor.
                const existing = actor.effects.filter(ae =>
                    ae.getFlag(MODULE_ID, 'sourceEffectId') !== undefined &&
                    ae.getFlag(MODULE_ID, 'statusAE') === true
                );

                const toDelete = [];
                const toCreate = new Map(desired);

                for (const ae of existing) {
                    const sourceId = ae.getFlag(MODULE_ID, 'sourceEffectId');
                    if (desired.has(sourceId)) {
                        // AE exists and should exist — check the status ID is still correct.
                        const expectedStatusId = desired.get(sourceId).statusId;
                        const currentStatusId = ae.statuses?.first() ?? ae.getFlag(MODULE_ID, 'statusId');
                        if (currentStatusId !== expectedStatusId) {
                            // Status changed — delete and recreate.
                            toDelete.push(ae.id);
                        } else {
                            // Already correct — don't recreate.
                            toCreate.delete(sourceId);
                        }
                    } else {
                        // AE exists but condition no longer met — delete.
                        toDelete.push(ae.id);
                    }
                }

                if (toDelete.length) {
                    try {
                        await actor.deleteEmbeddedDocuments('ActiveEffect', toDelete);
                        logDebug(DEBUG_CATEGORIES.STATUS_AE, `Deleted ${toDelete.length} status AE(s) from ${actor.name}`);
                    } catch (err) {
                        const msg = String(err?.message ?? err);
                        if (msg.includes('does not exist')) {
                            logWarn(
                                DEBUG_CATEGORIES.STATUS_AE,
                                `Stale status AE delete on ${actor.name}; scheduling resync`,
                                err
                            );
                            _statusSyncDirty.add(actor.id);
                        } else {
                            throw err;
                        }
                    }
                }

                if (toCreate.size) {
                    const aeData = [];
                    for (const [sourceId, { statusId, name }] of toCreate) {
                        // Build a status AE the same way the system does via toggleStatusEffect.
                        // We use fromStatusEffect to get the correct icon/name/statuses data,
                        // then merge our tracking flags in.
                        let statusAEData;
                        try {
                            const proto = await ActiveEffect.fromStatusEffect(statusId);
                            statusAEData = proto.toObject();
                        } catch (err) {
                            // Fallback if fromStatusEffect fails — build a minimal status AE manually.
                            logWarn(DEBUG_CATEGORIES.STATUS_AE, `fromStatusEffect failed for "${statusId}", using fallback`, err);
                            statusAEData = {
                                name: statusId,
                                statuses: [statusId],
                                img: 'icons/magic/life/heart-cross-blue.webp',
                            };
                        }

                        // Override name to include our effect name for clarity, and inject flags.
                        statusAEData.name = `${name} (${statusAEData.name ?? statusId})`;
                        statusAEData.transfer = false;
                        statusAEData.flags = foundry.utils.mergeObject(statusAEData.flags ?? {}, {
                            [MODULE_ID]: {
                                sourceEffectId: sourceId,
                                statusAE: true,
                                statusId: statusId,
                            },
                        });

                        aeData.push(statusAEData);
                    }
                    await actor.createEmbeddedDocuments('ActiveEffect', aeData);
                    logDebug(DEBUG_CATEGORIES.STATUS_AE, `Created ${aeData.length} status AE(s) on ${actor.name}`);
                }
            } catch (err) {
                logError(`Error syncing status AEs for ${actor.name}`, err);
            }
        } while (_statusSyncDirty.has(actor.id));
    } finally {
        _statusSyncPending.delete(actor.id);
        _statusSyncDirty.delete(actor.id);
    }
}

function _registerStatusSyncHooks() {
    // Item equip/unequip, vault state change, or armor marks change
    Hooks.on('updateItem', (item, diff) => {
        const parent = item?.parent;
        if (!(parent instanceof Actor)) return;
        const equippedChanged = foundry.utils.getProperty(diff, 'system.equipped') !== undefined;
        const inVaultChanged  = foundry.utils.getProperty(diff, 'system.inVault')  !== undefined;
        const marksChanged    = foundry.utils.getProperty(diff, 'system.marks.value') !== undefined;
        if (equippedChanged || inVaultChanged || marksChanged) _syncStatusActiveEffects(parent);
    });

    // Actor update — attribute conditions may flip.
    Hooks.on('updateActor', (actor, diff) => {
        if (!foundry.utils.getProperty(diff, 'system')) return;
        _syncStatusActiveEffects(actor);
    });

    // Status conditions applied/removed — status-type conditions may flip.
    Hooks.on('createActiveEffect', (ae) => {
        const actor = ae.parent;
        if (!(actor instanceof Actor)) return;
        if (ae.getFlag(MODULE_ID, 'statusAE')) return;
        _syncStatusActiveEffects(actor);
    });
    Hooks.on('deleteActiveEffect', (ae) => {
        const actor = ae.parent;
        if (!(actor instanceof Actor)) return;
        if (ae.getFlag(MODULE_ID, 'statusAE')) return;
        _syncStatusActiveEffects(actor);
    });

    // Flag changes on actor
    Hooks.on('updateActor', (actor, diff) => {
        if (!foundry.utils.getProperty(diff, `flags.${MODULE_ID}`)) return;
        _syncStatusActiveEffects(actor);
    });

    // Flag changes on items
    Hooks.on('updateItem', (item, diff) => {
        const parent = item?.parent;
        if (!(parent instanceof Actor)) return;
        if (!foundry.utils.getProperty(diff, `flags.${MODULE_ID}`)) return;
        _syncStatusActiveEffects(parent);
    });
}

function _registerEvasionSyncHooks() {
    // Item equip/unequip, vault state change, or armor marks change
    Hooks.on('updateItem', (item, diff) => {
        const parent = item?.parent;
        if (!(parent instanceof Actor)) return;
        const equippedChanged = foundry.utils.getProperty(diff, 'system.equipped') !== undefined;
        const inVaultChanged  = foundry.utils.getProperty(diff, 'system.inVault')  !== undefined;
        const marksChanged    = foundry.utils.getProperty(diff, 'system.marks.value') !== undefined;
        if (equippedChanged || inVaultChanged || marksChanged) _syncEvasionActiveEffects(parent);
    });

    // Actor update — resource/attribute conditions (hope, stress, HP, etc.) may flip.
    Hooks.on('updateActor', (actor, diff) => {
        if (!foundry.utils.getProperty(diff, 'system')) return;
        _syncEvasionActiveEffects(actor);
    });

    // Status conditions applied/removed — status-type conditions may flip.
    Hooks.on('createActiveEffect', (ae) => {
        const actor = ae.parent;
        if (!(actor instanceof Actor)) return;
        // Don't re-trigger on our own AE creations (no sourceEffectId guard needed
        // because _syncEvasionActiveEffects debounces and the AE won't affect desired).
        if (ae.getFlag(MODULE_ID, 'evasionAE')) return;
        _syncEvasionActiveEffects(actor);
    });
    Hooks.on('deleteActiveEffect', (ae) => {
        const actor = ae.parent;
        if (!(actor instanceof Actor)) return;
        if (ae.getFlag(MODULE_ID, 'evasionAE')) return;
        _syncEvasionActiveEffects(actor);
    });

    // Flag changes on actor (condEffect assigned/removed at actor level).
    Hooks.on('updateActor', (actor, diff) => {
        if (!foundry.utils.getProperty(diff, `flags.${MODULE_ID}`)) return;
        _syncEvasionActiveEffects(actor);
    });

    // Flag changes on items (condEffect assigned/removed from an item).
    Hooks.on('updateItem', (item, diff) => {
        const parent = item?.parent;
        if (!(parent instanceof Actor)) return;
        if (!foundry.utils.getProperty(diff, `flags.${MODULE_ID}`)) return;
        _syncEvasionActiveEffects(parent);
    });
}

function _registerThresholdSyncHooks() {
    // Item equip/unequip, vault state change, or armor marks change — may change
    // which items are "active" or flip armor-related conditions.
    Hooks.on('updateItem', (item, diff) => {
        const parent = item?.parent;
        if (!(parent instanceof Actor)) return;
        const equippedChanged = foundry.utils.getProperty(diff, 'system.equipped') !== undefined;
        const inVaultChanged  = foundry.utils.getProperty(diff, 'system.inVault')  !== undefined;
        const marksChanged    = foundry.utils.getProperty(diff, 'system.marks.value') !== undefined;
        if (equippedChanged || inVaultChanged || marksChanged) _syncThresholdActiveEffects(parent);
    });

    // Actor update — resource/attribute conditions (hope, stress, HP, etc.) may flip.
    Hooks.on('updateActor', (actor, diff) => {
        if (!foundry.utils.getProperty(diff, 'system')) return;
        _syncThresholdActiveEffects(actor);
    });

    // Status conditions applied/removed — status-type conditions may flip.
    Hooks.on('createActiveEffect', (ae) => {
        const actor = ae.parent;
        if (!(actor instanceof Actor)) return;
        if (ae.getFlag(MODULE_ID, 'thresholdAE')) return;
        _syncThresholdActiveEffects(actor);
    });
    Hooks.on('deleteActiveEffect', (ae) => {
        const actor = ae.parent;
        if (!(actor instanceof Actor)) return;
        if (ae.getFlag(MODULE_ID, 'thresholdAE')) return;
        _syncThresholdActiveEffects(actor);
    });

    // Flag changes on actor (condEffect assigned/removed at actor level).
    Hooks.on('updateActor', (actor, diff) => {
        if (!foundry.utils.getProperty(diff, `flags.${MODULE_ID}`)) return;
        _syncThresholdActiveEffects(actor);
    });

    // Flag changes on items (condEffect assigned/removed from an item).
    Hooks.on('updateItem', (item, diff) => {
        const parent = item?.parent;
        if (!(parent instanceof Actor)) return;
        if (!foundry.utils.getProperty(diff, `flags.${MODULE_ID}`)) return;
        _syncThresholdActiveEffects(parent);
    });
}

function _registerProficiencySyncHooks() {
    Hooks.on('updateItem', (item, diff) => {
        const parent = item?.parent;
        if (!(parent instanceof Actor)) return;
        const equippedChanged = foundry.utils.getProperty(diff, 'system.equipped') !== undefined;
        const inVaultChanged  = foundry.utils.getProperty(diff, 'system.inVault')  !== undefined;
        const marksChanged    = foundry.utils.getProperty(diff, 'system.marks.value') !== undefined;
        if (equippedChanged || inVaultChanged || marksChanged) _syncProficiencyActiveEffects(parent);
    });
    Hooks.on('updateActor', (actor, diff) => {
        if (!foundry.utils.getProperty(diff, 'system')) return;
        _syncProficiencyActiveEffects(actor);
    });
    Hooks.on('createActiveEffect', (ae) => {
        const actor = ae.parent;
        if (!(actor instanceof Actor)) return;
        if (ae.getFlag(MODULE_ID, 'proficiencyAE')) return;
        _syncProficiencyActiveEffects(actor);
    });
    Hooks.on('deleteActiveEffect', (ae) => {
        const actor = ae.parent;
        if (!(actor instanceof Actor)) return;
        if (ae.getFlag(MODULE_ID, 'proficiencyAE')) return;
        _syncProficiencyActiveEffects(actor);
    });
    Hooks.on('updateActor', (actor, diff) => {
        if (!foundry.utils.getProperty(diff, `flags.${MODULE_ID}`)) return;
        _syncProficiencyActiveEffects(actor);
    });
    Hooks.on('updateItem', (item, diff) => {
        const parent = item?.parent;
        if (!(parent instanceof Actor)) return;
        if (!foundry.utils.getProperty(diff, `flags.${MODULE_ID}`)) return;
        _syncProficiencyActiveEffects(parent);
    });
}

// ─── Unified Scene-Flag Sync Hook ─────────────────────────────────────────────
//
// A single updateScene listener that detects changes to pcToggles, npcToggles,
// and sceneDisabled — including flag *deletions* (Clear All Overrides) which use
// the `-=flagKey` syntax in the Foundry diff object.

function _registerSceneFlagSyncHook() {
    Hooks.on('updateScene', (scene, diff) => {
        if (!scene.active) return;

        // Get the module's flag diff object (if any flags changed at all)
        const moduleDiff = foundry.utils.getProperty(diff, `flags.${MODULE_ID}`);
        if (!moduleDiff || typeof moduleDiff !== 'object') return;

        // Check for both set (flagKey) and delete (-=flagKey) operations
        const keys = Object.keys(moduleDiff);
        const pcChanged  = keys.includes(FLAG_PC_TOGGLES)  || keys.includes(`-=${FLAG_PC_TOGGLES}`);
        const npcChanged = keys.includes(FLAG_NPC_TOGGLES)  || keys.includes(`-=${FLAG_NPC_TOGGLES}`);
        const offChanged = keys.includes(FLAG_SCENE_OFF)    || keys.includes(`-=${FLAG_SCENE_OFF}`);

        if (!pcChanged && !npcChanged && !offChanged) return;

        logDebug(DEBUG_CATEGORIES.CORE,
            `Scene flags changed — pc:${pcChanged} npc:${npcChanged} off:${offChanged}; syncing actors`);

        for (const actor of game.actors) {
            const isPC  = actor.type === 'character';
            const isNPC = actor.type === 'adversary';
            if (offChanged || (pcChanged && isPC) || (npcChanged && isNPC)) {
                _syncEvasionActiveEffects(actor);
                _syncThresholdActiveEffects(actor);
                _syncProficiencyActiveEffects(actor);
                _syncStatusActiveEffects(actor);
            }
        }
    });
}

function _isItemActive(item) {
    switch (item.type) {
        case 'weapon':
        case 'armor':     return item.system.equipped === true;
        case 'domainCard': return item.system.inVault === false;
        case 'feature':   return true;
        default:          return false;
    }
}

// ── Proximity / Range condition evaluation ──────────────────────────────────

/**
 * Ordered range band IDs from closest to farthest.
 * Used for "at" mode to determine the lower-bound band.
 */
const _RANGE_BAND_ORDER = ['melee', 'veryClose', 'close', 'far', 'veryFar'];

/**
 * Get the system's range measurement settings (distance thresholds per band).
 * Falls back to sensible defaults if the system settings aren't available.
 */
function _getRangeMeasurements() {
    const defaults = { melee: 5, veryClose: 15, close: 30, far: 60 };
    try {
        const rangeMeasurement = game.settings.get(
            CONFIG.DH.id,
            CONFIG.DH.SETTINGS.gameSettings.variantRules
        )?.rangeMeasurement;
        if (!rangeMeasurement || typeof rangeMeasurement !== 'object') return defaults;
        return { ...defaults, ...rangeMeasurement };
    } catch {
        return defaults;
    }
}

/**
 * Get the max distance (in feet) for a given range band.
 * For veryFar, returns Infinity since there's no upper bound.
 */
function _getRangeDistance(band, measurements) {
    if (band === 'veryFar') return Infinity;
    const value = Number(measurements?.[band]);
    return Number.isFinite(value) ? value : Infinity;
}

/**
 * Resolve the token placeable representing the "self" actor for range checks.
 * Works for both linked world actors and synthetic token actors.
 */
function _getOwnerTokenForRange(self) {
    if (!canvas?.ready || !self) return null;

    // Synthetic token actors are parented to their TokenDocument.
    const parent = self.parent;
    if (parent?.documentName === 'Token') return parent.object ?? null;

    // If the user currently controls a token for this actor, prefer that one.
    const controlled = canvas.tokens.controlled.find(t =>
        t.actor?.uuid === self.uuid || t.actor?.id === self.id
    );
    if (controlled) return controlled;

    // Include both linked and unlinked active tokens; prefer the active scene.
    const tokenDocs = self.getActiveTokens?.(false, true) ?? [];
    const onScene = tokenDocs.find(td => td.scene?.id === canvas.scene?.id);
    return onScene?.object ?? tokenDocs[0]?.object ?? null;
}

/**
 * Check whether a given distance meets the range condition for a specific mode + band.
 *
 * @param {number} distance     - Measured distance in feet
 * @param {string} mode         - 'within', 'at', or 'beyond'
 * @param {string} band         - Range band ID (melee, veryClose, close, far, veryFar)
 * @param {object} measurements - System range measurement settings
 * @returns {boolean}
 */
function _distanceMatchesRange(distance, mode, band, measurements) {
    const threshold = _getRangeDistance(band, measurements);

    if (mode === 'within') {
        // At or closer — distance must be <= the band's threshold
        return distance <= threshold;
    }

    if (mode === 'beyond') {
        // Further than — distance must be > the band's threshold
        return distance > threshold;
    }

    // "at" mode — distance is within this band but not within the next-closer band
    const bandIdx = _RANGE_BAND_ORDER.indexOf(band);
    const lowerBand = bandIdx > 0 ? _RANGE_BAND_ORDER[bandIdx - 1] : null;
    const lowerThreshold = lowerBand ? _getRangeDistance(lowerBand, measurements) : 0;
    return distance > lowerThreshold && distance <= threshold;
}

/**
 * Evaluate a proximity / range condition by measuring actual token distances on the canvas.
 *
 * @param {object} condition - The condition object from the effect
 * @param {Actor}  self      - The owner actor
 * @param {Actor|null} target - The contextual target actor (if available)
 * @param {object|null} action - The contextual action payload (if available)
 * @returns {boolean}
 */
function _evaluateRangeCondition(condition, self, target = null, action = null) {
    // Canvas must be ready and the actor must have a placed token
    if (!canvas?.ready) return false;
    const ownerToken = _getOwnerTokenForRange(self);
    if (!ownerToken) return false;

    const mode    = condition.rangeMode    ?? 'within';
    const band    = condition.range        ?? 'close';
    const subject = condition.rangeSubject ?? 'target';
    const count   = Math.max(1, Number(condition.rangeCount ?? 1));
    const measurements = _getRangeMeasurements();

    // Build the set of candidate tokens to check against
    let candidates;
    if (subject === 'target') {
        // Foundry T-key targets
        candidates = [...(game.user.targets ?? [])].map(t => t.object ?? t).filter(Boolean);

        // Fallback: use contextual target actor if no user targets are set.
        if (!candidates.length && target?.getActiveTokens) {
            const targetTokenDocs = target.getActiveTokens(false, true) ?? [];
            const targetOnScene = targetTokenDocs.find(td => td.scene?.id === canvas.scene?.id);
            const targetToken = targetOnScene?.object ?? targetTokenDocs[0]?.object ?? null;
            if (targetToken) candidates = [targetToken];
        }

        // Last fallback: resolve target actor IDs from action payloads used by some roll paths.
        if (!candidates.length && Array.isArray(action?.targets)) {
            candidates = action.targets
                .map(t => {
                    const actorId = t?.actorId ?? t?.actor?.id ?? null;
                    if (!actorId) return null;
                    const actor = game.actors?.get(actorId);
                    if (!actor?.getActiveTokens) return null;
                    const docs = actor.getActiveTokens(false, true) ?? [];
                    const onScene = docs.find(td => td.scene?.id === canvas.scene?.id);
                    return onScene?.object ?? docs[0]?.object ?? null;
                })
                .filter(Boolean);
        }
    } else if (subject === 'friends') {
        // Friendly disposition (1), exclude self
        candidates = canvas.tokens.placeables.filter(t =>
            t.document.disposition === 1 && t.id !== ownerToken.id
        );
    } else if (subject === 'enemies') {
        // Hostile disposition (-1), exclude self
        candidates = canvas.tokens.placeables.filter(t =>
            t.document.disposition === -1 && t.id !== ownerToken.id
        );
    } else {
        return false;
    }

    if (candidates.length === 0) return false;

    // For "target" subject: ALL targets must meet the condition
    if (subject === 'target') {
        return candidates.every(candidateToken => {
            const dist = Number(ownerToken.distanceTo(candidateToken));
            if (!Number.isFinite(dist)) return false;
            return _distanceMatchesRange(dist, mode, band, measurements);
        });
    }

    // For "friends" / "enemies": count how many meet the condition
    let matching = 0;
    for (const candidateToken of candidates) {
        const dist = Number(ownerToken.distanceTo(candidateToken));
        if (!Number.isFinite(dist)) continue;
        if (_distanceMatchesRange(dist, mode, band, measurements)) {
            matching++;
            if (matching >= count) return true; // early exit
        }
    }
    return false;
}

function _evaluateCondition(condition, { self, target, action, incomingDamageTypes }) {
    if (condition.type === 'always') return true;

    if (condition.type === 'damage_type') {
        // Only valid when incomingDamageTypes is provided (i.e., at preTakeDamage time)
        if (!incomingDamageTypes) return false;
        const wanted = condition.incomingDamageType ?? 'any';
        if (wanted === 'any') return true;
        return incomingDamageTypes.has(wanted);
    }

    if (condition.type === 'range') {
        return _evaluateRangeCondition(condition, self, target, action);
    }

    if (condition.type === 'weapon') {
        if (condition.weaponSlot === 'any') return true;
        const item = action?.item ?? null;
        if (!item) return true;
        // Primary = first equipped weapon; secondary = second
        const equipped = self?.items?.filter(i => i.type === 'weapon' && i.system.equipped) ?? [];
        const slot = equipped.indexOf(item);
        if (condition.weaponSlot === 'primary')   return slot === 0;
        if (condition.weaponSlot === 'secondary') return slot === 1;
        return true;
    }

    // Trigger-based conditions
    if (condition.type === 'rolled_fear') {
        const subject = condition.subject === 'target' ? target : self;
        if (!subject) return false;
        const t = _getTriggers(subject);
        return Boolean(t.rolledFear);
    }
    if (condition.type === 'took_threshold') {
        const subject = condition.subject === 'target' ? target : self;
        if (!subject) return false;
        const th = condition.threshold ?? 'major';
        const t = _getTriggers(subject);
        return Boolean(t.tookThreshold?.[th]);
    }
    if (condition.type === 'inflicted_threshold') {
        const subject = condition.subject === 'target' ? target : self;
        if (!subject) return false;
        const th = condition.threshold ?? 'major';
        const t = _getTriggers(subject);
        return Boolean(t.inflictedThreshold?.[th]);
    }
    if (condition.type === 'rolled_critical') {
        const subject = condition.subject === 'target' ? target : self;
        if (!subject) return false;
        const t = _getTriggers(subject);
        return Boolean(t.rolledCritical);
    }
    if (condition.type === 'spent_hope') {
        const subject = condition.subject === 'target' ? target : self;
        if (!subject) return false;
        const t = _getTriggers(subject);
        return Boolean(t.spentHope);
    }
    if (condition.type === 'armor_slot_marked') {
        const subject = condition.subject === 'target' ? target : self;
        if (!subject) return false;
        const t = _getTriggers(subject);
        return Boolean(t.armorSlotMarked);
    }
    if (condition.type === 'no_armor_remaining') {
        const subject = condition.subject === 'target' ? target : self;
        if (!subject) return false;
        const armor = subject.system?.resources?.armor;
        if (!armor || armor.max === 0) return false;
        return armor.value >= armor.max;
    }

    const subject = condition.subject === 'target' ? target : self;
    if (!subject) return false;

    if (condition.type === 'status') {
        return subject.statuses?.has(condition.status) ?? false;
    }

    if (condition.type === 'attribute') {
        const value = _getAttributeValue(subject, condition.attribute);
        if (value === null || value === undefined) return false;
        const threshold = Number(condition.value);
        switch (condition.operator) {
            case '>=': return value >= threshold;
            case '<=': return value <= threshold;
            case '==': return value === threshold;
            case '>':  return value >  threshold;
            case '<':  return value <  threshold;
            default:   return false;
        }
    }
    return false;
}

function _getAttributeValue(actor, attributeId) {
    const s = actor.system;
    switch (attributeId) {
        case 'hope':          return s.resources?.hope?.value      ?? null;
        case 'hope_pct':      { const h = s.resources?.hope;      return h?.max ? Math.round((h.value / h.max) * 100) : null; }
        case 'stress':        return s.resources?.stress?.value    ?? null;
        case 'stress_pct':    { const st = s.resources?.stress;   return st?.max ? Math.round((st.value / st.max) * 100) : null; }
        case 'hitPoints':     return s.resources?.hitPoints?.value ?? null;
        case 'hitPoints_max': return s.resources?.hitPoints?.max   ?? null;
        case 'hitPoints_pct': { const hp = s.resources?.hitPoints; return hp?.max ? Math.round((hp.value / hp.max) * 100) : null; }
        case 'evasion':       return s.evasion                     ?? null;
        case 'proficiency':   return s.proficiency                 ?? null;
        // Use the character's current armor resource value for armor checks
        case 'armorScore':    return s.resources?.armor?.value     ?? s.armorScore ?? null;
        case 'agility':       return s.traits?.agility?.value      ?? null;
        case 'strength':      return s.traits?.strength?.value     ?? null;
        case 'finesse':       return s.traits?.finesse?.value      ?? null;
        case 'instinct':      return s.traits?.instinct?.value     ?? null;
        case 'presence':      return s.traits?.presence?.value     ?? null;
        case 'knowledge':     return s.traits?.knowledge?.value    ?? null;
        default:              return null;
    }
}

function _getTargetActors() {
    return [...(game.user.targets ?? [])].map(t => t.actor).filter(Boolean);
}

// ─── Proximity / Range re-sync hooks ──────────────────────────────────────────

/**
 * Check if any effect assigned to an actor uses a range condition.
 */
function _actorHasRangeCondition(actor) {
    const effects = _getActorConditionalEffects(actor);
    return effects.some(e => e.condition?.type === 'range');
}

/**
 * Re-sync all actors on the active scene that have range-based conditions.
 * Called when tokens move or combat starts.
 */
function _proximitySync() {
    if (!canvas?.ready) return;
    const scene = canvas.scene;
    if (!scene) return;

    for (const tokenDoc of scene.tokens) {
        const actor = tokenDoc.actor;
        if (!actor) continue;
        if (!_actorHasRangeCondition(actor)) continue;
        _syncEvasionActiveEffects(actor);
        _syncThresholdActiveEffects(actor);
        _syncProficiencyActiveEffects(actor);
        _syncStatusActiveEffects(actor);
    }
}

const _debouncedProximitySync = foundry.utils.debounce(_proximitySync, 300);

function _registerProximityHooks() {
    // When any token finishes moving, re-sync range-conditioned effects
    Hooks.on('updateToken', (tokenDoc, diff) => {
        if (!('x' in diff || 'y' in diff)) return;
        _debouncedProximitySync();
    });

    // Also re-sync when targets change (T-key targeting)
    Hooks.on('targetToken', () => {
        _debouncedProximitySync();
    });
}

// ─── Daggerheart Menu ─────────────────────────────────────────────────────────

function _registerDaggerheartMenuHook() {
    Hooks.on('renderDaggerheartMenu', _injectDaggerheartMenuSection);
    Hooks.on('renderApplication', (app, html) => {
        if (app?.constructor?.tabName === 'daggerheartMenu') _injectDaggerheartMenuSection(app, html);
    });
}

function _injectDaggerheartMenuSection(app, html) {
    const rootEl = html instanceof jQuery ? html[0] : html;
    if (!rootEl) return;
    if (rootEl.querySelector('.dce-menu-section')) return;

    const section = document.createElement('fieldset');
    section.classList.add('dce-menu-section');
    section.innerHTML = `
        <legend><i class="fas fa-wand-magic-sparkles"></i> Conditional Effects</legend>
        <p class="dce-menu-hint">Create effects and drag them onto item or character sheets.</p>
        <div class="dce-menu-btns">
            <button type="button" class="dce-menu-btn" data-dce-action="openManager">
                <i class="fas fa-list-ul"></i> Manager
            </button>
            <button type="button" class="dce-menu-btn" data-dce-action="openPalette">
                <i class="fas fa-hand-holding-magic"></i> Effect Palette
            </button>
            <button type="button" class="dce-menu-btn" data-dce-action="openAssignments">
                <i class="fas fa-diagram-project"></i> Active Assignments
            </button>
            <button type="button" class="dce-menu-btn" data-dce-action="openDebug">
                <i class="fas fa-bug"></i> Debug
            </button>
        </div>
    `;

    const target = rootEl.querySelector('.window-content') ?? rootEl.querySelector('div') ?? rootEl;
    target.appendChild(section);

    section.querySelector('[data-dce-action="openManager"]')?.addEventListener('click', () => {
        new ConditionalEffectsManager().render(true);
    });
    section.querySelector('[data-dce-action="openPalette"]')?.addEventListener('click', () => {
        new ConditionalEffectsPalette().render(true);
    });
    section.querySelector('[data-dce-action="openAssignments"]')?.addEventListener('click', () => {
        new ActiveAssignmentsViewer().render(true);
    });

    section.querySelector('[data-dce-action="openDebug"]')?.addEventListener('click', () => {
        openDebugDialog();
    });
}

// ─── Item Sheet Hooks ─────────────────────────────────────────────────────────

function _registerItemSheetHooks() {
    Hooks.on('renderItemSheet',       _onRenderItemSheet);
    Hooks.on('renderWeaponSheet',     _onRenderItemSheet);
    Hooks.on('renderArmorSheet',      _onRenderItemSheet);
    Hooks.on('renderDomainCardSheet', _onRenderItemSheet);
    Hooks.on('renderFeatureSheet',    _onRenderItemSheet);
}

async function _onRenderItemSheet(app, html, _context, _options) {
    const rootEl = html instanceof jQuery ? html[0] : html;
    const item   = app.document ?? app.object;
    if (!item || !(item instanceof Item)) return;
    if (!APPLICABLE_ITEM_TYPES.includes(item.type)) return;
    if (!item.isOwner) return;

    rootEl.querySelector('.dce-item-section')?.remove();

    const assignedIds     = item.getFlag(MODULE_ID, FLAG_ASSIGNED) ?? [];
    const globalEffects   = getAllEffects();
    const assignedEffects = assignedIds
        .map(id => globalEffects.find(e => e.id === id))
        .filter(Boolean)
        .map(e => ({
            ...e,
            conditionSummary: summarizeCondition(e.condition),
            effectSummary:    summarizeEffect(e.effect),
            beneficialIcon:   e.beneficial ? 'fa-shield-heart dce-beneficial' : 'fa-skull-crossbones dce-detrimental',
        }));

    const sectionHtml = await renderTemplate(`modules/${MODULE_ID}/templates/item-effects.hbs`, { assignedEffects });
    const target = rootEl.querySelector('.window-content form')
        ?? rootEl.querySelector('form')
        ?? rootEl.querySelector('.window-content')
        ?? rootEl;
    target.insertAdjacentHTML('beforeend', sectionHtml);

    // Indicator icon in item sheet header
    _injectItemHeaderIndicator(rootEl, assignedIds.length > 0);

    const dropZone = rootEl.querySelector('.dce-drop-zone');
    if (dropZone) {
        dropZone.addEventListener('dragover', event => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
            dropZone.classList.add('dce-drag-over');
        });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dce-drag-over'));
        dropZone.addEventListener('drop', async event => {
            event.preventDefault();
            dropZone.classList.remove('dce-drag-over');
            const data = _tryParseTransfer(event);
            if (data?.type !== 'dce-conditional-effect') return;
            const existing = item.getFlag(MODULE_ID, FLAG_ASSIGNED) ?? [];
            if (existing.includes(data.effectId)) {
                ui.notifications.warn('This effect is already assigned to this item.');
                return;
            }
            await item.setFlag(MODULE_ID, FLAG_ASSIGNED, [...existing, data.effectId]);
            app.render();
        });
    }

    rootEl.querySelectorAll('.dce-remove-effect[data-effect-id]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const updated = (item.getFlag(MODULE_ID, FLAG_ASSIGNED) ?? []).filter(id => id !== btn.dataset.effectId);
            await item.setFlag(MODULE_ID, FLAG_ASSIGNED, updated);
            app.render();
        });
    });
}

function _injectItemHeaderIndicator(rootEl, hasEffects) {
    rootEl.querySelector('.dce-header-indicator')?.remove();
    if (!hasEffects) return;
    const header = rootEl.querySelector('.window-header') ?? rootEl.querySelector('header');
    if (!header) return;
    const indicator = document.createElement('span');
    indicator.className = 'dce-header-indicator';
    indicator.title     = 'Has Conditional Effects';
    indicator.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i>';
    header.appendChild(indicator);
}

// ─── Actor Sheet Hooks ────────────────────────────────────────────────────────

function _registerActorSheetHooks() {
    Hooks.on('renderActorSheet',           _onRenderActorSheet);
    Hooks.on('renderCharacterSheet',       _onRenderActorSheet);
    Hooks.on('renderDHCharacterSheet',     _onRenderActorSheet);
    Hooks.on('renderAdversarySheet',       _onRenderAdversarySheet);
}

async function _onRenderActorSheet(app, html, _context, _options) {
    const rootEl = html instanceof jQuery ? html[0] : html;
    const actor  = app.document ?? app.object ?? app.actor;
    if (!actor || !(actor instanceof Actor)) return;
    if (!actor.isOwner) return;

    // Inject into actor sheet item rows (indicator icons)
    _injectActorItemRowIndicators(rootEl, actor);

    // Inject actor-level effects section into features tab
    await _injectActorEffectsSection(rootEl, actor, app);
}

async function _onRenderAdversarySheet(app, html, _context, _options) {
    const rootEl = html instanceof jQuery ? html[0] : html;
    const actor  = app.document ?? app.object ?? app.actor;
    if (!actor || !(actor instanceof Actor)) return;
    if (!actor.isOwner) return;

    // Inject into the features tab on the adversary sheet
    await _injectAdversaryEffectsSection(rootEl, actor, app);
}

function _injectActorItemRowIndicators(rootEl, actor) {
    rootEl.querySelectorAll('.dce-item-row-indicator').forEach(el => el.remove());
    const globalEffects = getAllEffects();

    for (const item of actor.items) {
        const assignedIds = item.getFlag(MODULE_ID, FLAG_ASSIGNED) ?? [];
        if (!assignedIds.length) continue;

        // Try to find the row in the actor sheet — look for data-item-id or data-document-id
        const row = rootEl.querySelector(`[data-item-id="${item.id}"], [data-document-id="${item.id}"]`);
        if (!row) continue;

        const indicator = document.createElement('span');
        indicator.className = 'dce-item-row-indicator';
        indicator.title     = `${assignedIds.length} conditional effect(s)`;
        indicator.innerHTML = '<i class="fas fa-wand-magic-sparkles"></i>';
        row.appendChild(indicator);
    }
}

async function _injectActorEffectsSection(rootEl, actor, app) {
    rootEl.querySelector('.dce-actor-section')?.remove();

    // Inject into the character sidebar.
    //
    // Daggerheart default sheets: experience-section lives inside an <aside> sidebar.
    // Sleek UI sheets: sidebar markup uses a `.sidebar-content` container.
    const featuresTab = rootEl.querySelector('.experience-section')?.closest('aside')
        ?? rootEl.querySelector('.character-sidebar-sheet')
        ?? rootEl.querySelector('.sidebar-content')
        ?? rootEl.querySelector('aside');
    if (!featuresTab) return;

    const actorIds      = actor.getFlag(MODULE_ID, FLAG_ACTOR) ?? [];
    const globalEffects = getAllEffects();
    const assignedEffects = actorIds
        .map(id => globalEffects.find(e => e.id === id))
        .filter(Boolean)
        .map(e => ({
            ...e,
            conditionSummary: summarizeCondition(e.condition),
            effectSummary:    summarizeEffect(e.effect),
            beneficialIcon:   e.beneficial ? 'fa-shield-heart dce-beneficial' : 'fa-skull-crossbones dce-detrimental',
        }));

    const sectionHtml = await renderTemplate(
        `modules/${MODULE_ID}/templates/actor-effects.hbs`,
        { assignedEffects }
    );
    // If Sleek UI is present, prefer inserting before the settings button so it stays at the bottom.
    const sleekSettingsBtn = featuresTab.querySelector(':scope > .settings-button');
    if (sleekSettingsBtn) {
        sleekSettingsBtn.insertAdjacentHTML('beforebegin', sectionHtml);
    } else {
        featuresTab.insertAdjacentHTML('beforeend', sectionHtml);
    }

    const dropZone = featuresTab.querySelector('.dce-actor-drop-zone');
    if (dropZone) {
        dropZone.addEventListener('dragover', event => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
            dropZone.classList.add('dce-drag-over');
        });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dce-drag-over'));
        dropZone.addEventListener('drop', async event => {
            event.preventDefault();
            dropZone.classList.remove('dce-drag-over');
            const data = _tryParseTransfer(event);
            if (data?.type !== 'dce-conditional-effect') return;
            const existing = actor.getFlag(MODULE_ID, FLAG_ACTOR) ?? [];
            if (existing.includes(data.effectId)) {
                ui.notifications.warn('This effect is already assigned to this character.');
                return;
            }
            await actor.setFlag(MODULE_ID, FLAG_ACTOR, [...existing, data.effectId]);
            app.render();
        });
    }

    featuresTab.querySelectorAll('.dce-remove-actor-effect[data-effect-id]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const updated = (actor.getFlag(MODULE_ID, FLAG_ACTOR) ?? []).filter(id => id !== btn.dataset.effectId);
            await actor.setFlag(MODULE_ID, FLAG_ACTOR, updated);
            app.render();
        });
    });
}

async function _injectAdversaryEffectsSection(rootEl, actor, app) {
    rootEl.querySelector('.dce-actor-section')?.remove();

    // Inject into the adversary sheet.
    // Default adversary sheet: features tab content.
    // Sleek UI adversary sheet: sidebar markup uses a `.sidebar-content.adversary` container.
    const featuresTab = rootEl.querySelector('.tab.features')
        ?? rootEl.querySelector('[data-tab="features"]')
        ?? rootEl.querySelector('section.features')
        ?? rootEl.querySelector('.sidebar-content.adversary')
        ?? rootEl.querySelector('.sidebar-content');
    if (!featuresTab) return;

    const actorIds      = actor.getFlag(MODULE_ID, FLAG_ACTOR) ?? [];
    const globalEffects = getAllEffects();
    const assignedEffects = actorIds
        .map(id => globalEffects.find(e => e.id === id))
        .filter(Boolean)
        .map(e => ({
            ...e,
            conditionSummary: summarizeCondition(e.condition),
            effectSummary:    summarizeEffect(e.effect),
            beneficialIcon:   e.beneficial ? 'fa-shield-heart dce-beneficial' : 'fa-skull-crossbones dce-detrimental',
        }));

    const sectionHtml = await renderTemplate(
        `modules/${MODULE_ID}/templates/actor-effects.hbs`,
        { assignedEffects }
    );
    const sleekSettingsBtn = featuresTab.querySelector(':scope > .settings-button');
    if (sleekSettingsBtn) {
        sleekSettingsBtn.insertAdjacentHTML('beforebegin', sectionHtml);
    } else {
        featuresTab.insertAdjacentHTML('beforeend', sectionHtml);
    }

    const dropZone = featuresTab.querySelector('.dce-actor-drop-zone');
    if (dropZone) {
        dropZone.addEventListener('dragover', event => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
            dropZone.classList.add('dce-drag-over');
        });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dce-drag-over'));
        dropZone.addEventListener('drop', async event => {
            event.preventDefault();
            dropZone.classList.remove('dce-drag-over');
            const data = _tryParseTransfer(event);
            if (data?.type !== 'dce-conditional-effect') return;
            const existing = actor.getFlag(MODULE_ID, FLAG_ACTOR) ?? [];
            if (existing.includes(data.effectId)) {
                ui.notifications.warn('This effect is already assigned to this adversary.');
                return;
            }
            await actor.setFlag(MODULE_ID, FLAG_ACTOR, [...existing, data.effectId]);
            app.render();
        });
    }

    featuresTab.querySelectorAll('.dce-remove-actor-effect[data-effect-id]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const updated = (actor.getFlag(MODULE_ID, FLAG_ACTOR) ?? []).filter(id => id !== btn.dataset.effectId);
            await actor.setFlag(MODULE_ID, FLAG_ACTOR, updated);
            app.render();
        });
    });
}

function _tryParseTransfer(event) {
    try {
        const raw = event.dataTransfer?.getData('text/plain');
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

// ─── Roll Hooks ───────────────────────────────────────────────────────────────

function _registerRollHooks() {
    Hooks.on('daggerheart.preRollDuality', _onPreRoll);
    Hooks.on('daggerheart.postRoll', _onPostRoll);
    Hooks.on('daggerheart.postRollDuality', _onPostRollDuality);
    Hooks.on('daggerheart.preDamageAction', _onPreDamageAction);
    Hooks.on('daggerheart.preRoll', _onPreRollDamage);
    Hooks.on('daggerheart.preRollFate', _onPreRollFate);       // Hope/Fear fate roll (not evasion)
    Hooks.on('daggerheart.preApplyDamageAction', _onPreApplyDamage); // damage reduction
    Hooks.on('daggerheart.postApplyDamageAction', _onPostApplyDamage); // status on hit
    Hooks.on('daggerheart.preTakeDamage', _onPreTakeDamage);   // damage multiplier
    Hooks.on('daggerheart.postTakeDamage', _onPostTakeDamage);  // triggers: took/inflicted thresholds

    // Combat lifecycle hooks for end_of_combat duration effects
    Hooks.on('createCombat', _onCombatStart);
    Hooks.on('updateCombat', _cleanupExpiredDurationStates);
    Hooks.on('deleteCombat', _cleanupExpiredDurationStates);

    // Hope-spend & armor tracking: detect Hope/Armor changes via updateActor
    Hooks.on('preUpdateActor', _onPreUpdateActorHopeTrack);
    Hooks.on('updateActor', _onUpdateActorHopeTrack);

    // Armor-slot tracking via item updates (armor marks live on the item, not the actor)
    Hooks.on('preUpdateItem', _onPreUpdateItemArmorTrack);
    Hooks.on('updateItem', _onUpdateItemArmorTrack);

    // Countdown: tick on combat round advance
    Hooks.on('updateCombat', (combat, diff) => {
        if (!foundry.utils.hasProperty(diff, 'round') && !foundry.utils.hasProperty(diff, 'turn')) return;
        // Tick countdowns for the combatant whose turn just started
        const combatant = combat.combatant;
        const actor = combatant?.actor;
        if (actor) _tickCountdowns(actor, 'round_start');
    });
}

// ── Hope-Spend & Armor-Slot Tracking ───────────────────────────────────────
// We need to compare resource values before and after an updateActor to detect spending/marking.
const _resourceBeforeUpdate = new Map(); // actorId -> { hope, armor }

function _onPreUpdateActorHopeTrack(actor, diff) {
    const hopeDiff = foundry.utils.getProperty(diff, 'system.resources.hope.value');
    const armorDiff = foundry.utils.getProperty(diff, 'system.resources.armor.value');
    if (hopeDiff === undefined && armorDiff === undefined) return;
    _resourceBeforeUpdate.set(actor.id, {
        hope: actor.system?.resources?.hope?.value ?? 0,
        armor: actor.system?.resources?.armor?.value ?? 0,
    });
}

async function _onUpdateActorHopeTrack(actor, diff) {
    const newHope = foundry.utils.getProperty(diff, 'system.resources.hope.value');
    const newArmor = foundry.utils.getProperty(diff, 'system.resources.armor.value');
    if (newHope === undefined && newArmor === undefined) return;
    const before = _resourceBeforeUpdate.get(actor.id);
    _resourceBeforeUpdate.delete(actor.id);
    if (!before) return;

    // Hope decreased — trigger spent_hope
    if (newHope !== undefined && newHope < before.hope) {
        await _markTrigger(actor, 'spentHope', { active: true, amount: before.hope - newHope });
        logDebug(DEBUG_CATEGORIES.CORE, `Trigger set: spentHope on ${actor.name} (${before.hope} → ${newHope})`);
    }

    // Armor marks increased — trigger armor_slot_marked
    if (newArmor !== undefined && newArmor > before.armor) {
        await _markTrigger(actor, 'armorSlotMarked', { active: true, amount: newArmor - before.armor });
        logDebug(DEBUG_CATEGORIES.CORE, `Trigger set: armorSlotMarked on ${actor.name} (${before.armor} → ${newArmor})`);
    }
}

// ── Armor-Slot Tracking via Item Updates ──────────────────────────────────────
// Armor marks live on the armor ITEM (item.system.marks.value), not the actor.
// The actor's system.resources.armor is derived and doesn't appear in updateActor diffs.
// We track mark changes on armor items directly to fire the armorSlotMarked trigger.
const _armorMarksBeforeUpdate = new Map(); // itemId -> { marks, actorId }

function _onPreUpdateItemArmorTrack(item, diff) {
    if (item.type !== 'armor') return;
    const marksDiff = foundry.utils.getProperty(diff, 'system.marks.value');
    if (marksDiff === undefined) return;
    const parent = item.parent;
    if (!(parent instanceof Actor)) return;
    _armorMarksBeforeUpdate.set(item.id, {
        marks: item.system?.marks?.value ?? 0,
        actorId: parent.id,
    });
}

async function _onUpdateItemArmorTrack(item, diff) {
    if (item.type !== 'armor') return;
    const newMarks = foundry.utils.getProperty(diff, 'system.marks.value');
    if (newMarks === undefined) return;
    const before = _armorMarksBeforeUpdate.get(item.id);
    _armorMarksBeforeUpdate.delete(item.id);
    if (!before) return;
    const parent = item.parent;
    if (!(parent instanceof Actor)) return;

    // Armor marks increased — an armor slot was marked
    if (newMarks > before.marks) {
        await _markTrigger(parent, 'armorSlotMarked', { active: true, amount: newMarks - before.marks });
        logDebug(DEBUG_CATEGORIES.CORE, `Trigger set: armorSlotMarked on ${parent.name} via item (${before.marks} → ${newMarks})`);
    }
}

/**
 * When combat starts, sync all actors to activate any end_of_combat duration effects.
 */
async function _onCombatStart(combat) {
    logDebug(DEBUG_CATEGORIES.CORE, `Combat started (${combat.id}), syncing all actors for end_of_combat effects`);
    for (const actor of game.actors ?? []) {
        if (!actor?.isOwner) continue;
        _syncEvasionActiveEffects(actor);
        _syncThresholdActiveEffects(actor);
        _syncProficiencyActiveEffects(actor);
        _syncStatusActiveEffects(actor);
    }
}

// ── Duality roll (hit roll) — advantage, disadvantage, roll bonus ─────────────

function _onPreRoll(config, _message) {
    if (!config?.source?.actor || !config.roll) return;
    const actor = fromUuidSync(config.source.actor);
    if (!actor) return;

    const targetActors = _getTargetActors();
    const firstTarget  = targetActors[0] ?? null;
    const actionCtx    = { self: actor, target: firstTarget, action: config };

    for (const effect of _getActorConditionalEffects(actor)) {
        if (!effect.beneficial || !_isRollType(effect.effect.type)) continue;
        if (!_canApplyByDuration(actor, effect)) continue;
        if (!_matchesRollFilters(effect, config)) continue;
        if (!_evaluateCondition(effect.condition, actionCtx)) continue;
        _applyRollEffect(effect, config);
        _consumeDuration(actor, effect, 'roll');
        _consumeTriggerIfNeeded(actor, effect);
        _processChainedEffects(actor, effect, actionCtx, 'roll');
    }
    for (const targetActor of targetActors) {
        for (const effect of _getActorConditionalEffects(targetActor)) {
            if (effect.beneficial || !_isRollType(effect.effect.type)) continue;
            if (!_canApplyByDuration(targetActor, effect)) continue;
            if (!_matchesRollFilters(effect, config)) continue;
            const targetCtx = { self: targetActor, target: actor, action: config };
            if (!_evaluateCondition(effect.condition, targetCtx)) continue;
            _applyRollEffect(effect, config);
            _consumeDuration(targetActor, effect, 'roll');
            _consumeTriggerIfNeeded(targetActor, effect);
            _processChainedEffects(targetActor, effect, targetCtx, 'roll');
        }
    }
}

function _isRollType(type) { return type === 'roll_bonus' || type === 'advantage' || type === 'disadvantage'; }

/**
 * Check if a roll effect's trait/action-type filters match the current roll config.
 * Returns true if the effect should apply.
 */
function _matchesRollFilters(effect, config) {
    const eff = effect.effect;
    // Trait filter
    const traitFilter = eff.traitFilter ?? 'any';
    if (traitFilter !== 'any') {
        const rollTrait = config?.roll?.trait ?? null;
        if (!rollTrait || rollTrait !== traitFilter) return false;
    }
    // Action type filter (action vs reaction)
    const actionTypeFilter = eff.actionTypeFilter ?? 'any';
    if (actionTypeFilter !== 'any') {
        const rollActionType = config?.actionType ?? 'action'; // default to 'action' if not set
        if (rollActionType !== actionTypeFilter) return false;
    }
    return true;
}

function _applyRollEffect(effect, config) {
    const type = effect.effect.type;
    if (type === 'advantage') {
        config.roll.advantage = ADV_MODE.ADVANTAGE;
    } else if (type === 'disadvantage') {
        if (config.roll.advantage !== ADV_MODE.ADVANTAGE) config.roll.advantage = ADV_MODE.DISADVANTAGE;
    } else if (type === 'roll_bonus') {
        const bonus = Number(effect.effect.rollBonus);
        if (!bonus) return;
        config.roll.baseModifiers = config.roll.baseModifiers ?? [];
        config.roll.baseModifiers.push({ label: effect.name, value: bonus });
    }
}

// ── Fate/Reaction roll — no-op ────────────────────────────────────────────────

function _onPreRollFate(_config, _message) {
    // defense_bonus (evasion/difficulty) is handled by a real ActiveEffect on the actor
    // (created/deleted by _syncEvasionActiveEffects). Nothing to do here.
}

// ── Post duality roll — triggers (rolled with fear) ─────────────────────────

async function _consumeEvasionOnResolvedTargets(config) {
    if (!Array.isArray(config?.targets) || !config.targets.length) return;

    const consumedDefenseByActor = new Map(); // actorId -> Set<effectId>
    for (const t of config.targets) {
        // Only consume on actual hit checks (hit true/false), not arbitrary target arrays.
        if (!Object.prototype.hasOwnProperty.call(t ?? {}, 'hit')) continue;
        if (t?.hit !== true && t?.hit !== false) continue;

        const targetActor = t?.actorId ? fromUuidSync(t.actorId) : null;
        if (!targetActor?.id) continue;

        let consumedIds = consumedDefenseByActor.get(targetActor.id);
        if (!consumedIds) {
            consumedIds = new Set();
            consumedDefenseByActor.set(targetActor.id, consumedIds);
        }

        for (const condEffect of _getActorConditionalEffects(targetActor)) {
            if (!condEffect.beneficial || condEffect.effect.type !== 'defense_bonus') continue;
            if (!_canApplyByDuration(targetActor, condEffect)) continue;
            if (!_evaluateCondition(condEffect.condition, { self: targetActor, target: null, action: null })) continue;
            if (consumedIds.has(condEffect.id)) continue;
            consumedIds.add(condEffect.id);
            await _consumeDuration(targetActor, condEffect, 'roll');
            _consumeTriggerIfNeeded(targetActor, condEffect);
        }
    }
}

async function _onPostRoll(config, _message) {
    // Duality rolls also emit postRollDuality; avoid double-consumption there.
    if (Array.isArray(config?.roll)) return; // ignore damage/healing roll parts
    if (config?.roll?.result?.duality !== undefined) return;
    await _consumeEvasionOnResolvedTargets(config);
}

async function _onPostRollDuality(config, _message) {
    try {
        const actorUuid = config?.source?.actor;
        if (!actorUuid) return;
        const actor = fromUuidSync(actorUuid);
        if (!actor) return;
        const duality = config?.roll?.result?.duality;
        if (duality === -1) {
            await _markTrigger(actor, 'rolledFear', { active: true });
            logDebug(DEBUG_CATEGORIES.CORE, `Trigger set: rolledFear on ${actor.name}`);
        }
        if (duality === 0) {
            await _markTrigger(actor, 'rolledCritical', { active: true });
            logDebug(DEBUG_CATEGORIES.CORE, `Trigger set: rolledCritical on ${actor.name}`);
        }

        await _consumeEvasionOnResolvedTargets(config);

        // Tick on_roll countdowns for the rolling actor
        await _tickCountdowns(actor, 'on_roll');
    } catch (err) {
        logWarn(DEBUG_CATEGORIES.CORE, 'Error handling postRollDuality trigger', err);
    }
}

// ── Post take damage — triggers (took/inflicted thresholds) ──────────────────

async function _onPostTakeDamage(targetActor, updates) {
    try {
        if (!targetActor || !Array.isArray(updates)) return;
        const hpUpdate = updates.find(u => u.key === 'hitPoints');
        if (!hpUpdate?.value) return;

        // Daggerheart stores damage as a negative value for hitPoints.
        const thresholdValue = Math.abs(Number(hpUpdate.value ?? 0));
        if (!thresholdValue) return;

        const thresholdKey = thresholdValue >= 3 ? 'severe' : thresholdValue === 2 ? 'major' : 'minor';

        // Consume AE-backed threshold effects when this actor actually takes damage.
        // Sync hooks on durationState flag updates remove the corresponding AEs.
        const consumedReduction = new Set();
        for (const condEffect of _getActorConditionalEffects(targetActor)) {
            if (!condEffect.beneficial || condEffect.effect.type !== 'damage_reduction') continue;
            if (!_canApplyByDuration(targetActor, condEffect)) continue;
            if (!_evaluateCondition(condEffect.condition, { self: targetActor, target: null, action: null })) continue;
            if (consumedReduction.has(condEffect.id)) continue;
            consumedReduction.add(condEffect.id);
            await _consumeDuration(targetActor, condEffect, 'damage');
            _consumeTriggerIfNeeded(targetActor, condEffect);
        }

        // Target took damage threshold.
        await _markTrigger(targetActor, 'tookThreshold', { [thresholdKey]: true });
        logDebug(DEBUG_CATEGORIES.DAMAGE, `Trigger set: tookThreshold.${thresholdKey} on ${targetActor.name}`);

        // Attacker inflicted damage threshold (best-effort mapping from pending cache).
        // Pop the most recent valid entry from the list.
        const pendingList = _pendingDamageSources.get(targetActor.id);
        if (pendingList?.length) {
            const now = _nowMs();
            // Filter out stale entries (>10s old) and grab the most recent valid one
            const validIdx = pendingList.findLastIndex(p => (now - p.ts) < 10_000);
            if (validIdx >= 0) {
                const pending = pendingList.splice(validIdx, 1)[0];
                const attacker = pending.attackerUuid ? fromUuidSync(pending.attackerUuid) : null;
                if (attacker) {
                    await _markTrigger(attacker, 'inflictedThreshold', { [thresholdKey]: true });
                    logDebug(DEBUG_CATEGORIES.DAMAGE, `Trigger set: inflictedThreshold.${thresholdKey} on ${attacker.name}`);
                }
            }
            // Clean up empty lists
            if (!pendingList.length) _pendingDamageSources.delete(targetActor.id);
        }

        // Tick countdowns for the target (on_damage and on_attacked)
        await _tickCountdowns(targetActor, 'on_damage');
        await _tickCountdowns(targetActor, 'on_attacked');
    } catch (err) {
        logWarn(DEBUG_CATEGORIES.DAMAGE, 'Error handling postTakeDamage trigger', err);
    }
}

async function _cleanupExpiredDurationStates(combat, options, userId) {
    // This runs on deleteCombat and updateCombat.
    // When combat ends (deleteCombat), we need to:
    // 1. Clean up end_of_combat duration states for that combat
    // 2. Trigger AE syncs to remove the corresponding AEs
    
    // For deleteCombat, the combat being deleted is passed as first arg
    // game.combat may still point to it or may be null
    const deletedCombatId = combat?.id;
    const currentCombat = game.combat ?? null;
    const actorsToSync = [];
    
    for (const actor of game.actors ?? []) {
        if (!actor?.isOwner) continue;
        const state = actor.getFlag(MODULE_ID, FLAG_DURATION_STATE);
        if (!state || typeof state !== 'object') continue;
        
        const keysToDelete = [];
        
        for (const [effectId, entry] of Object.entries(state)) {
            if (!entry?.mode) continue;
            if (entry.mode === 'end_of_combat') {
                // Clear if:
                // - The entry's combat was just deleted, OR
                // - There's no current combat and entry has a combat ID, OR  
                // - The entry's combat doesn't match current combat
                const shouldClear = 
                    entry.combatId === deletedCombatId ||
                    (!currentCombat && entry.combatId) ||
                    (currentCombat && entry.combatId !== currentCombat.id);
                    
                if (shouldClear) {
                    keysToDelete.push(effectId);
                    logDebug(DEBUG_CATEGORIES.CORE, `Clearing end_of_combat duration for effect ${effectId} on ${actor.name} (combat ended)`);
                }
            }
        }
        
        // Use unsetFlag for each key to actually delete them (setFlag merges, doesn't delete)
        if (keysToDelete.length > 0) {
            for (const key of keysToDelete) {
                await actor.unsetFlag(MODULE_ID, `${FLAG_DURATION_STATE}.${key}`);
            }
            actorsToSync.push(actor);
        }
    }
    
    // Trigger AE syncs for actors that had combat-duration effects expire
    for (const actor of actorsToSync) {
        _syncEvasionActiveEffects(actor);
        _syncThresholdActiveEffects(actor);
        _syncProficiencyActiveEffects(actor);
        _syncStatusActiveEffects(actor);
    }
}

// ── Damage bonus ──────────────────────────────────────────────────────────────

function _onPreDamageAction(action, config) {
    const actor = action?.actor;
    if (!actor) return;

    const targetActors = _getTargetActors();
    const firstTarget  = targetActors[0] ?? null;
    const ctx = { self: actor, target: firstTarget, action };

    const bonusEffects = [];
    for (const condEffect of _getActorConditionalEffects(actor)) {
        if (!condEffect.beneficial || condEffect.effect.type !== 'damage_bonus') continue;
        if (!_canApplyByDuration(actor, condEffect)) continue;
        if (!_evaluateCondition(condEffect.condition, ctx)) continue;
        bonusEffects.push({ ...condEffect, _dceOwnerUuid: actor.uuid });
    }
    for (const targetActor of targetActors) {
        for (const condEffect of _getActorConditionalEffects(targetActor)) {
            if (condEffect.beneficial || condEffect.effect.type !== 'damage_bonus') continue;
            if (!_canApplyByDuration(targetActor, condEffect)) continue;
            if (!_evaluateCondition(condEffect.condition, { self: targetActor, target: actor, action })) continue;
            bonusEffects.push({ ...condEffect, _dceOwnerUuid: targetActor.uuid });
        }
    }

    if (!bonusEffects.length) return;
    config._dcePendingDamageEffects = bonusEffects;
}

function _onPreRollDamage(config, _msg) {
    if (!Array.isArray(config?.roll)) return;
    if (config._dcePendingDamageEffects) {
        _applyDamageBonusToFormulas(config);
        return;
    }
    // Chat-button path: reconstruct from source
    const actorUuid = config.source?.actor;
    if (!actorUuid) return;
    const actor = fromUuidSync(actorUuid);
    if (!actor) return;

    const targetActors = _getTargetActors();
    const firstTarget  = targetActors[0] ?? null;

    const bonusEffects = [];
    for (const condEffect of _getActorConditionalEffects(actor)) {
        if (!condEffect.beneficial || condEffect.effect.type !== 'damage_bonus') continue;
        if (!_canApplyByDuration(actor, condEffect)) continue;
        if (!_evaluateCondition(condEffect.condition, { self: actor, target: firstTarget, action: config })) continue;
        bonusEffects.push({ ...condEffect, _dceOwnerUuid: actor.uuid });
    }
    for (const targetActor of targetActors) {
        for (const condEffect of _getActorConditionalEffects(targetActor)) {
            if (condEffect.beneficial || condEffect.effect.type !== 'damage_bonus') continue;
            if (!_canApplyByDuration(targetActor, condEffect)) continue;
            if (!_evaluateCondition(condEffect.condition, { self: targetActor, target: actor, action: config })) continue;
            bonusEffects.push({ ...condEffect, _dceOwnerUuid: targetActor.uuid });
        }
    }

    if (!bonusEffects.length) return;
    config._dcePendingDamageEffects = bonusEffects;
    _applyDamageBonusToFormulas(config);
}

function _applyDamageBonusToFormulas(damageConfig) {
    const bonusEffects = damageConfig._dcePendingDamageEffects;
    if (!bonusEffects?.length) return;
    if (!Array.isArray(damageConfig.roll)) return;

    for (const condEffect of bonusEffects) {
        const eff = condEffect.effect;
        const parts = [];
        if (eff.dice?.trim()) parts.push(eff.dice.trim());
        if (eff.bonus && eff.bonus !== 0) parts.push(String(eff.bonus));
        if (!parts.length) continue;

        const bonusFormula = parts.join(' + ');

        let applied = false;

        for (const part of damageConfig.roll) {
            if (part.applyTo !== 'hitPoints') continue;

            let types = [];
            if (part.damageTypes instanceof Set)          types = [...part.damageTypes];
            else if (Array.isArray(part.damageTypes))     types = part.damageTypes;
            else if (part.damageTypes && typeof part.damageTypes === 'object') types = Object.values(part.damageTypes);

            const applies = eff.damageType === 'any'
                || eff.damageType === 'primaryWeapon'
                || eff.damageType === 'secondaryWeapon'
                // If the effect targets a broad category (physical/magical), allow it
                // to apply regardless of the weapon's listed damage types so a
                // "magical" bonus can be applied to a normal sword, etc.
                || eff.damageType === 'physical'
                || eff.damageType === 'magical'
                || types.includes(eff.damageType)
                || types.length === 0;

            if (!applies) continue;

            // Ensure the damage part's damageTypes include the effect's damageType
            try {
                if (eff.damageType && eff.damageType !== 'any' && eff.damageType !== 'primaryWeapon' && eff.damageType !== 'secondaryWeapon') {
                    let orig = part.damageTypes;
                    let kind = null; // 'set' | 'array' | 'object' | 'other'
                    if (orig instanceof Set) kind = 'set';
                    else if (Array.isArray(orig)) kind = 'array';
                    else if (orig && typeof orig === 'object') kind = 'object';
                    else kind = 'other';

                    const current = (kind === 'set') ? [...orig] : (kind === 'array' ? orig.slice() : (kind === 'object' ? Object.values(orig) : []));
                    if (!current.includes(eff.damageType)) current.push(eff.damageType);

                    // Write back preserving the original type where reasonable
                    if (kind === 'set') part.damageTypes = new Set(current);
                    else part.damageTypes = current;
                }
            } catch (err) {
                logWarn(DEBUG_CATEGORIES.DAMAGE, 'Failed to merge damage type into part.damageTypes', err);
            }

            part.extraFormula = part.extraFormula
                ? `${part.extraFormula} + ${bonusFormula}`
                : bonusFormula;

            applied = true;

            logDebug(DEBUG_CATEGORIES.DAMAGE, `Damage bonus "${bonusFormula}" from "${condEffect.name}"`);
        }

        if (applied) {
            const owner = condEffect._dceOwnerUuid ? fromUuidSync(condEffect._dceOwnerUuid) : null;
            if (owner) {
                _consumeDuration(owner, condEffect, 'damage');
                _consumeTriggerIfNeeded(owner, condEffect);
                // Process chained effects from this damage bonus
                const chainCtx = { self: owner, target: null, action: damageConfig };
                _processChainedEffects(owner, condEffect, chainCtx, 'damage');
            }
        }
    }
}


function _onPreApplyDamage(_action, _config) {}

/**
 * Hook: daggerheart.preTakeDamage
 * Fires on the defender's actor before damage is applied.
 * Applies damage_multiplier effects assigned to the actor.
 * @param {Actor} actor    - The actor taking damage
 * @param {object} damages - The damage object: { hitPoints: { parts: [{total, damageTypes, ...}] } }
 */
function _onPreTakeDamage(actor, damages) {
    if (!actor || !damages) return;

    const effects = _getActorConditionalEffects(actor).filter(
        e => e.effect.type === 'damage_multiplier'
    );
    if (!effects.length) return;

    const consumed = new Set();

    for (const [key, damage] of Object.entries(damages)) {
        if (!damage?.parts?.length) continue;
        for (const part of damage.parts) {
            // Collect all damage types in this part as a Set
            let partTypes;
            if (part.damageTypes instanceof Set)        partTypes = part.damageTypes;
            else if (Array.isArray(part.damageTypes))   partTypes = new Set(part.damageTypes);
            else if (part.damageTypes)                  partTypes = new Set(Object.values(part.damageTypes));
            else                                        partTypes = new Set(['physical']);

            for (const condEffect of effects) {
                if (!_canApplyByDuration(actor, condEffect)) continue;
                const eff = condEffect.effect;
                const multiplier = Number(eff.damageMultiplier ?? 2);
                if (!multiplier || multiplier === 1) continue;

                // Evaluate condition, passing incomingDamageTypes for damage_type conditions
                if (!_evaluateCondition(condEffect.condition, {
                    self: actor,
                    target: null,
                    action: null,
                    incomingDamageTypes: partTypes,
                })) continue;

                // Check that this multiplier's incomingDamageType matches the part (effect-level filter)
                const wantedType = eff.incomingDamageType ?? 'any';
                if (wantedType !== 'any' && !partTypes.has(wantedType)) continue;

                const original = part.total;
                part.total = Math.ceil(part.total * multiplier);
                logDebug(
                    DEBUG_CATEGORIES.DAMAGE,
                    `Damage multiplier ×${multiplier} from "${condEffect.name}" on ${actor.name}: ${original} → ${part.total} (${[...partTypes].join(', ')})`
                );

                if (!consumed.has(condEffect.id)) {
                    consumed.add(condEffect.id);
                    _consumeDuration(actor, condEffect, 'take_damage');
                    _consumeTriggerIfNeeded(actor, condEffect);
                    // Process chained effects from this damage multiplier
                    const chainCtx = { self: actor, target: null, action: null, incomingDamageTypes: partTypes };
                    _processChainedEffects(actor, condEffect, chainCtx, 'take_damage');
                }
            }
        }
    }
}

// ── Status on hit (postApplyDamageAction) ─────────────────────────────────────

async function _onPostApplyDamage(action, config) {
    if (!config?.targets) return;

    const attackerUuid = config.source?.actor;
    const attacker = attackerUuid ? fromUuidSync(attackerUuid) : null;
    if (!attacker) return;

    // Cache attacker -> target mapping so postTakeDamage can infer "inflicted" triggers.
    // Use an array to support multiple attackers hitting the same target in quick succession.
    for (const t of (config.targets ?? [])) {
        if (!t?.hit) continue;
        const targetActor = t.actorId ? fromUuidSync(t.actorId) : null;
        if (!targetActor?.id) continue;
        const list = _pendingDamageSources.get(targetActor.id) ?? [];
        list.push({ attackerUuid, ts: _nowMs() });
        _pendingDamageSources.set(targetActor.id, list);
    }

    const onHitEffects = _getActorConditionalEffects(attacker).filter(e =>
        e.beneficial && (e.effect.type === 'status_on_hit' || e.effect.type === 'stress_on_hit')
    );
    if (!onHitEffects.length) return;

    const targetActors = config.targets
        .filter(t => t.hit)
        .map(t => t.actorId ? fromUuidSync(t.actorId) : null)
        .filter(Boolean);

    if (!targetActors.length) return;

    for (const condEffect of onHitEffects) {
        if (!_canApplyByDuration(attacker, condEffect)) continue;
        const firstTarget = targetActors[0];
        if (!_evaluateCondition(condEffect.condition, { self: attacker, target: firstTarget, action })) continue;

        if (condEffect.effect.type === 'status_on_hit') {
            const statusId = condEffect.effect.statusToApply;
            const statusLabel = STATUSES.find(s => s.id === statusId)?.label ?? statusId;
            const targetNames = targetActors.map(a => a.name).join(', ');

            const confirmed = await foundry.applications.api.DialogV2.confirm({
                window:  { title: 'Apply Status Effect' },
                content: `<p><strong>${condEffect.name}</strong> triggered!</p><p>Apply <strong>${statusLabel}</strong> to: ${targetNames}?</p>`,
                yes: { label: 'Apply',  icon: 'fas fa-check',  callback: () => true  },
                no:  { label: 'Skip',   icon: 'fas fa-times',  callback: () => false },
            });

            if (!confirmed) continue;

            for (const targetActor of targetActors) {
                await targetActor.toggleStatusEffect(statusId, { active: true });
                logDebug(DEBUG_CATEGORIES.STATUS_ON_HIT, `Applied status "${statusId}" to ${targetActor.name}`);
            }
        } else if (condEffect.effect.type === 'stress_on_hit') {
            const stressAmt = Number(condEffect.effect.stressAmount ?? 1);
            const targetNames = targetActors.map(a => a.name).join(', ');

            const confirmed = await foundry.applications.api.DialogV2.confirm({
                window:  { title: 'Apply Stress on Hit' },
                content: `<p><strong>${condEffect.name}</strong> triggered!</p><p>Mark <strong>${stressAmt} Stress</strong> on: ${targetNames}?</p>`,
                yes: { label: 'Apply',  icon: 'fas fa-check',  callback: () => true  },
                no:  { label: 'Skip',   icon: 'fas fa-times',  callback: () => false },
            });

            if (!confirmed) continue;

            for (const targetActor of targetActors) {
                const current = targetActor.system?.resources?.stress?.value ?? 0;
                const max = targetActor.system?.resources?.stress?.max ?? 6;
                const newVal = Math.min(current + stressAmt, max);
                if (newVal !== current) {
                    await targetActor.update({ 'system.resources.stress.value': newVal });
                    logDebug(DEBUG_CATEGORIES.STATUS_ON_HIT, `Applied ${stressAmt} Stress to ${targetActor.name} (${current} → ${newVal})`);
                }
            }
        }

        _consumeDuration(attacker, condEffect, 'damage');
        _consumeTriggerIfNeeded(attacker, condEffect);

        // Process any chained effects from this on-hit effect
        const chainCtx = { self: attacker, target: targetActors[0] ?? null, action };
        await _processChainedEffects(attacker, condEffect, chainCtx, 'damage');
    }
}

// ─── Effect Palette ───────────────────────────────────────────────────────────

export class ConditionalEffectsPalette extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: 'dce-palette', classes: ['dce-palette'],
        window: { title: 'Conditional Effects', icon: 'fas fa-hand-holding-magic', resizable: true },
        position: { width: 340, height: 480 },
    };
    static PARTS = { main: { template: `modules/${MODULE_ID}/templates/palette.hbs` } };

    async _prepareContext(_options) {
        const effects = getAllEffects().map(e => ({
            ...e,
            conditionSummary: summarizeCondition(e.condition),
            effectSummary:    summarizeEffect(e.effect),
            typeLabel:        e.effect.type.replace(/_/g, ' '),
            beneficialIcon:   e.beneficial ? 'fa-shield-heart dce-beneficial' : 'fa-skull-crossbones dce-detrimental',
        }));
        return { effects, isEmpty: effects.length === 0 };
    }

    _onRender(_context, _options) {
        this.element.querySelectorAll('.dce-palette-row[data-effect-id]').forEach(row => {
            row.addEventListener('dragstart', event => {
                event.dataTransfer.effectAllowed = 'copy';
                event.dataTransfer.setData('text/plain', JSON.stringify({
                    type: 'dce-conditional-effect', effectId: row.dataset.effectId,
                }));
            });
        });
    }
}
