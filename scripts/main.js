/**
 * main.js — v1.2.0
 */

import {
    MODULE_ID, FLAG_ASSIGNED, FLAG_ACTOR, APPLICABLE_ITEM_TYPES, ADV_MODE,
    getAllEffects, STATUSES, ATTRIBUTES, DAMAGE_TYPES,
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
        _applyEvasionBonus(this);
        _applyThresholdBonus(this);
    };
}

function _applyEvasionBonus(actor) {
    if (!actor?.system) return;
    if (!('evasion' in actor.system)) return;
    if (!game.settings) return;

    const effects = _getActorConditionalEffects(actor);
    let totalBonus = 0;
    const appliedEffects = [];

    for (const effect of effects) {
        if (!effect.beneficial || effect.effect.type !== 'defense_bonus') continue;
        // Evaluate condition with only self available (no roll/target context at prep time)
        if (!_evaluateCondition(effect.condition, { self: actor, target: null, action: null })) continue;
        const bonus = Number(effect.effect.defenseBonus ?? 0);
        if (!bonus) continue;
        totalBonus += bonus;
        appliedEffects.push(effect.name);
    }

    // Ensure we don't double-apply across multiple prepareDerivedData runs.
    try {
        actor._dceLastApplied = actor._dceLastApplied || { evasion: 0, major: 0, severe: 0 };
        const prev = Number(actor._dceLastApplied.evasion || 0);
        const current = Number(actor.system.evasion || 0);
        // The system has just reset evasion to its base, so don't try to calculate base from current - prev.
        const base = totalBonus === 0 && prev > 0 ? current : (current - prev);
        const newVal = base + totalBonus;
        
        console.log(`${MODULE_ID} | Evasion calc for ${actor.name}: prev=${prev}, current=${current}, base=${base}, totalBonus=${totalBonus}, newVal=${newVal}, effects=[${appliedEffects.join(',')}]`);
        
        actor.system.evasion = newVal;
        actor._dceLastApplied.evasion = totalBonus;
    } catch (err) {
        console.error(`${MODULE_ID} | Error applying evasion bonus:`, err);
    }
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

    if (majorBonus || severeBonus) {
        try {
            actor._dceLastApplied = actor._dceLastApplied || { evasion: 0, major: 0, severe: 0 };
            
            // Apply major threshold
            const prevMajor = Number(actor._dceLastApplied.major || 0);
            const currentMajor = Number(actor.system.damageThresholds.major ?? 0);
            const baseMajor = majorBonus === 0 && prevMajor > 0 ? currentMajor : (currentMajor - prevMajor);
            const newMajor = baseMajor + majorBonus;
            actor.system.damageThresholds.major = newMajor;
            actor._dceLastApplied.major = majorBonus;
            console.log(`${MODULE_ID} | Threshold major calc for ${actor.name}: prev=${prevMajor}, current=${currentMajor}, base=${baseMajor}, bonus=${majorBonus}, newVal=${newMajor}`);
            
            // Apply severe threshold
            const prevSevere = Number(actor._dceLastApplied.severe || 0);
            const currentSevere = Number(actor.system.damageThresholds.severe ?? 0);
            const baseSevere = severeBonus === 0 && prevSevere > 0 ? currentSevere : (currentSevere - prevSevere);
            const newSevere = baseSevere + severeBonus;
            actor.system.damageThresholds.severe = newSevere;
            actor._dceLastApplied.severe = severeBonus;
            console.log(`${MODULE_ID} | Threshold severe calc for ${actor.name}: prev=${prevSevere}, current=${currentSevere}, base=${baseSevere}, bonus=${severeBonus}, newVal=${newSevere}, effects=[${appliedEffects.join(',')}]`);
        } catch (err) {
            console.error(`${MODULE_ID} | Error applying threshold bonus:`, err);
        }
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
    _registerItemUpdateHooks();
    _registerDaggerheartMenuHook();

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

// Ensure actor derived data refreshes when an owned item's equip/vault state changes
function _registerItemUpdateHooks() {
    Hooks.on('updateItem', (item, diff, options, userId) => {
        try {
            const parent = item?.parent ?? null;
            if (!(parent instanceof Actor)) return;
            const equippedChanged = !!foundry.utils.getProperty(diff, 'system.equipped');
            const inVaultChanged  = !!foundry.utils.getProperty(diff, 'system.inVault');
            if (equippedChanged || inVaultChanged) parent.prepareDerivedData();
        } catch (err) {
            console.error(`${MODULE_ID} | Error handling updateItem hook:`, err);
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

function _evaluateCondition(condition, { self, target, action }) {
    if (condition.type === 'always') return true;

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
    // defense_bonus (evasion) is applied as a passive stat modifier in
    // _applyEvasionBonus(), which runs during Actor.prepareDerivedData().
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
