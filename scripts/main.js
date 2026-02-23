/**
 * main.js — v1.2.0
 */

import {
    MODULE_ID, FLAG_ASSIGNED, FLAG_ACTOR, FLAG_PC_TOGGLES, APPLICABLE_ITEM_TYPES, ADV_MODE,
    getAllEffects, STATUSES, ATTRIBUTES, DAMAGE_TYPES, INCOMING_DAMAGE_TYPES,
    registerSettings, summarizeCondition, summarizeEffect,
    ConditionalEffectsManager, isEffectActive,
    getPcToggles,
} from './config.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// ─── Init / Ready ─────────────────────────────────────────────────────────────

Hooks.once('init', () => {
    console.log(`${MODULE_ID} | Initialising`);
    registerSettings();
    _wrapActorPrepareDerivedData();
});


function _wrapActorPrepareDerivedData() {
    const original = Actor.prototype.prepareDerivedData;
    Actor.prototype.prepareDerivedData = function (...args) {
        original.apply(this, args);
        _applyThresholdBonus(this);
    };
}


function _applyThresholdBonus(actor) {
    if (!actor?.system) return;
    if (!actor.system.damageThresholds) return;
    if (!game.settings) return;

    const effects = _getActorConditionalEffects(actor);
    let majorBonus  = 0;
    let severeBonus = 0;
    const appliedEffects = [];

    for (const effect of effects) {
        if (!effect.beneficial || effect.effect.type !== 'damage_reduction') continue;
        if (!_evaluateCondition(effect.condition, { self: actor, target: null, action: null })) continue;
        majorBonus  += Number(effect.effect.thresholdMajor  ?? 0);
        severeBonus += Number(effect.effect.thresholdSevere ?? 0);
        appliedEffects.push(effect.name);
    }

    if (!majorBonus && !severeBonus) return;

    // The system's prepareBaseData() resets damageThresholds to their computed base before
    // prepareDerivedData() (and therefore this function) runs. So the thresholds already
    // hold the correct base — we just add our bonuses on top. No tracking needed.
    try {
        if (majorBonus) {
            actor.system.damageThresholds.major = Number(actor.system.damageThresholds.major ?? 0) + majorBonus;
        }
        if (severeBonus) {
            actor.system.damageThresholds.severe = Number(actor.system.damageThresholds.severe ?? 0) + severeBonus;
        }
        console.log(`${MODULE_ID} | Threshold bonus major=+${majorBonus} severe=+${severeBonus} for ${actor.name} (now major=${actor.system.damageThresholds.major}, severe=${actor.system.damageThresholds.severe}), effects=[${appliedEffects.join(',')}]`);
    } catch (err) {
        console.error(`${MODULE_ID} | Error applying threshold bonus:`, err);
    }
}

Hooks.once('ready', async () => {
    await loadTemplates([
        `modules/${MODULE_ID}/templates/manager.hbs`,
        `modules/${MODULE_ID}/templates/effect-config.hbs`,
        `modules/${MODULE_ID}/templates/item-effects.hbs`,
        `modules/${MODULE_ID}/templates/actor-effects.hbs`,
        `modules/${MODULE_ID}/templates/palette.hbs`,
    ]);
    _registerItemSheetHooks();
    _registerActorSheetHooks();
    _registerRollHooks();
    _registerEvasionSyncHooks();
    _registerDaggerheartMenuHook();

    // Sync evasion AEs for all currently-loaded actors on world load.
    for (const actor of game.actors) {
        _syncEvasionActiveEffects(actor);
    }

    const dhMenu = ui.daggerheartMenu ?? Object.values(ui).find(a => a?.constructor?.tabName === 'daggerheartMenu');
    if (dhMenu?.element) _injectDaggerheartMenuSection(dhMenu, dhMenu.element);
    console.log(`${MODULE_ID} | Ready`);
});

// ─── Evaluator ────────────────────────────────────────────────────────────────

function _getActorConditionalEffects(actor) {
    if (!actor) return [];
    const globalEffects = getAllEffects().filter(isEffectActive);
    if (!globalEffects.length) return [];
    const assignedIds = new Set(); // Use a Set to prevent duplicate effects

    // ─── NEW: Apply Scene-wide PC toggles ───
    if (actor.type === 'character') {
        const pcToggles = getPcToggles();
        pcToggles.forEach(id => assignedIds.add(id));
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
    return globalEffects.filter(e => assignedIds.has(e.id));
}

// ─── Evasion Active Effect Sync ──────────────────────────────────────────────
//
// For defense_bonus effects, we create real Foundry ActiveEffects on the actor
// (with changes: [{ key:'system.evasion', mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: N }])
// so the system's own AE pipeline handles the math cleanly during prepareData().
// We identify our AEs by flag: flags.[MODULE_ID].sourceEffectId = <condEffectId>.
//
// A per-actor debounce prevents duplicate async operations when multiple hooks
// fire in quick succession (e.g. equip triggers updateItem + updateActor).

const _evasionSyncPending = new Set();

async function _syncEvasionActiveEffects(actor) {
    if (!actor?.id || !actor.isOwner) return;
    if (!('evasion' in (actor.system ?? {}))) return;

    // Debounce: if a sync is already queued for this actor, skip.
    if (_evasionSyncPending.has(actor.id)) return;
    _evasionSyncPending.add(actor.id);

    // Defer to next microtask so rapid successive hook calls collapse into one.
    await Promise.resolve();
    _evasionSyncPending.delete(actor.id);

    try {
        const condEffects = _getActorConditionalEffects(actor);

        // Build the set of condEffect IDs that should have an AE right now.
        const desired = new Map(); // condEffectId -> bonus value
        for (const ce of condEffects) {
            if (!ce.beneficial || ce.effect.type !== 'defense_bonus') continue;
            if (!_evaluateCondition(ce.condition, { self: actor, target: null, action: null })) continue;
            const bonus = Number(ce.effect.defenseBonus ?? 0);
            if (!bonus) continue;
            desired.set(ce.id, { bonus, name: ce.name });
        }

        // Find existing dce evasion AEs on this actor.
        const existing = actor.effects.filter(ae =>
            ae.getFlag(MODULE_ID, 'sourceEffectId') !== undefined &&
            ae.getFlag(MODULE_ID, 'evasionAE') === true
        );

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
            await actor.deleteEmbeddedDocuments('ActiveEffect', toDelete);
            console.log(`${MODULE_ID} | Deleted ${toDelete.length} evasion AE(s) from ${actor.name}`);
        }

        if (toCreate.size) {
            const aeData = [];
            for (const [sourceId, { bonus, name }] of toCreate) {
                aeData.push({
                    name: `${name} (Evasion)`,
                    img: 'icons/magic/defensive/shield-barrier-blue.webp',
                    transfer: false,
                    flags: {
                        [MODULE_ID]: {
                            sourceEffectId: sourceId,
                            evasionAE: true,
                        },
                    },
                    changes: [{
                        key:   'system.evasion',
                        mode:  CONST.ACTIVE_EFFECT_MODES.ADD,
                        value: String(bonus),
                    }],
                });
            }
            await actor.createEmbeddedDocuments('ActiveEffect', aeData);
            console.log(`${MODULE_ID} | Created ${aeData.length} evasion AE(s) on ${actor.name}`);
        }
    } catch (err) {
        console.error(`${MODULE_ID} | Error syncing evasion AEs for ${actor.name}:`, err);
    }
}

function _registerEvasionSyncHooks() {
    // Item equip/unequip or vault state change — may change which items are "active"
    // and therefore which condEffects are in scope.
    Hooks.on('updateItem', (item, diff) => {
        const parent = item?.parent;
        if (!(parent instanceof Actor)) return;
        const equippedChanged = foundry.utils.getProperty(diff, 'system.equipped') !== undefined;
        const inVaultChanged  = foundry.utils.getProperty(diff, 'system.inVault')  !== undefined;
        if (equippedChanged || inVaultChanged) _syncEvasionActiveEffects(parent);
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

    // Scene PC toggle changed — sync all character actors in the world.
    Hooks.on('updateScene', (scene, diff) => {
        if (!scene.isActive) return;
        if (foundry.utils.getProperty(diff, `flags.${MODULE_ID}.${FLAG_PC_TOGGLES}`) === undefined) return;
        for (const actor of game.actors) {
            if (actor.type === 'character') _syncEvasionActiveEffects(actor);
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

function _evaluateCondition(condition, { self, target, action, incomingDamageTypes }) {
    if (condition.type === 'always') return true;

    if (condition.type === 'damage_type') {
        // Only valid when incomingDamageTypes is provided (i.e., at preTakeDamage time)
        if (!incomingDamageTypes) return false;
        const wanted = condition.incomingDamageType ?? 'any';
        if (wanted === 'any') return true;
        return incomingDamageTypes.has(wanted);
    }

    /**if (condition.type === 'range') {
        if (condition.range === 'any') return true;
        const range = action?.range ?? action?.system?.range ?? null;
        if (!range) return true; // unknown range — apply
        const isClose = range === 'close' || range === 'melee' || range === 'veryClose';
        const isMelee = condition.range === 'melee';
        return isMelee ? isClose : !isClose;
    }*/

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

    // Inject into the character sidebar, after the experience section
    const featuresTab = rootEl.querySelector('.experience-section')?.closest('aside')
        ?? rootEl.querySelector('.character-sidebar-sheet')
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
    featuresTab.insertAdjacentHTML('beforeend', sectionHtml);

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

    // Inject at the end of the features tab
    const featuresTab = rootEl.querySelector('.tab.features')
        ?? rootEl.querySelector('[data-tab="features"]')
        ?? rootEl.querySelector('section.features');
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
    featuresTab.insertAdjacentHTML('beforeend', sectionHtml);

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
    Hooks.on('daggerheart.preDamageAction', _onPreDamageAction);
    Hooks.on('daggerheart.preRoll', _onPreRollDamage);
    Hooks.on('daggerheart.preRollFate', _onPreRollFate);       // Hope/Fear fate roll (not evasion)
    Hooks.on('daggerheart.preApplyDamageAction', _onPreApplyDamage); // damage reduction
    Hooks.on('daggerheart.postApplyDamageAction', _onPostApplyDamage); // status on hit
    Hooks.on('daggerheart.preTakeDamage', _onPreTakeDamage);   // damage multiplier
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
        if (!_evaluateCondition(effect.condition, actionCtx)) continue;
        _applyRollEffect(effect, config);
    }
    for (const targetActor of targetActors) {
        for (const effect of _getActorConditionalEffects(targetActor)) {
            if (effect.beneficial || !_isRollType(effect.effect.type)) continue;
            if (!_evaluateCondition(effect.condition, { self: targetActor, target: actor, action: config })) continue;
            _applyRollEffect(effect, config);
        }
    }
}

function _isRollType(type) { return type === 'roll_bonus' || type === 'advantage' || type === 'disadvantage'; }

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
    // defense_bonus (evasion) is handled by a real ActiveEffect on the actor
    // (created/deleted by _syncEvasionActiveEffects). Nothing to do here.
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
        if (!_evaluateCondition(condEffect.condition, ctx)) continue;
        bonusEffects.push(condEffect);
    }
    for (const targetActor of targetActors) {
        for (const condEffect of _getActorConditionalEffects(targetActor)) {
            if (condEffect.beneficial || condEffect.effect.type !== 'damage_bonus') continue;
            if (!_evaluateCondition(condEffect.condition, { self: targetActor, target: actor, action })) continue;
            bonusEffects.push(condEffect);
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
        if (!_evaluateCondition(condEffect.condition, { self: actor, target: firstTarget, action: config })) continue;
        bonusEffects.push(condEffect);
    }
    for (const targetActor of targetActors) {
        for (const condEffect of _getActorConditionalEffects(targetActor)) {
            if (condEffect.beneficial || condEffect.effect.type !== 'damage_bonus') continue;
            if (!_evaluateCondition(condEffect.condition, { self: targetActor, target: actor, action: config })) continue;
            bonusEffects.push(condEffect);
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
                console.warn(`${MODULE_ID} | Failed to merge damage type into part.damageTypes`, err);
            }

            part.extraFormula = part.extraFormula
                ? `${part.extraFormula} + ${bonusFormula}`
                : bonusFormula;

            console.log(`${MODULE_ID} | Damage bonus "${bonusFormula}" from "${condEffect.name}"`);
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
                console.log(`${MODULE_ID} | Damage multiplier ×${multiplier} from "${condEffect.name}" on ${actor.name}: ${original} → ${part.total} (${[...partTypes].join(', ')})`);
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

    const statusEffects = _getActorConditionalEffects(attacker).filter(e =>
        e.beneficial && e.effect.type === 'status_on_hit'
    );
    if (!statusEffects.length) return;

    const targetActors = config.targets
        .filter(t => t.hit)
        .map(t => t.actorId ? fromUuidSync(t.actorId) : null)
        .filter(Boolean);

    if (!targetActors.length) return;

    for (const condEffect of statusEffects) {
        const firstTarget = targetActors[0];
        if (!_evaluateCondition(condEffect.condition, { self: attacker, target: firstTarget, action })) continue;

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
            console.log(`${MODULE_ID} | Applied status "${statusId}" to ${targetActor.name}`);
        }
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