/**
 * debug.js
 *
 * Lightweight, opt-in debug logging with per-category toggles.
 * State is stored in CONFIG.debug (Foundry's built-in live debug object),
 * keyed as `daggerheart-cond-fx.<category>`.
 *
 * The debug dialog uses a proper ApplicationV2 subclass so event listeners
 * are reliably attached via _onRender.
 */

import { MODULE_ID } from './config.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// Keep this export so main.js import doesn't need to change.
export const DEBUG_SETTINGS_KEY = 'debug';

export const DEBUG_CATEGORIES = {
    CORE:          'core',
    HOOKS:         'hooks',
    CONDITIONS:    'conditions',
    THRESHOLDS:    'thresholds',
    EVASION_AE:    'evasionAE',
    STATUS_AE:     'statusAE',
    DAMAGE:        'damage',
    STATUS_ON_HIT: 'statusOnHit',
};

const _CATEGORY_META = [
    { key: DEBUG_CATEGORIES.CORE,          label: 'Core',                  hint: 'Startup, registration, lifecycle, effect retrieval, proficiency AE sync, duration tracking, and chained effects.' },
    { key: DEBUG_CATEGORIES.HOOKS,         label: 'Hooks & Rolls',         hint: 'When roll hooks fire, who is rolling, targets, effect lookups, roll modifications (advantage, bonus), trait/action filters, and attacker AE sync triggers.' },
    { key: DEBUG_CATEGORIES.CONDITIONS,    label: 'Condition Evaluation',  hint: 'Every condition check: range/distance calculations, status checks, attribute comparisons, weapon slots, triggers (fear/crit/hope/armor), and pass/fail results.' },
    { key: DEBUG_CATEGORIES.THRESHOLDS,    label: 'Damage Thresholds',     hint: 'Damage threshold AE sync: per-effect condition evaluation, desired vs existing AEs, what gets created/deleted and why.' },
    { key: DEBUG_CATEGORIES.EVASION_AE,    label: 'Evasion ActiveEffects', hint: 'Evasion/difficulty AE sync: per-effect condition evaluation, desired vs existing AEs, create/delete details, and post-roll duration consumption.' },
    { key: DEBUG_CATEGORIES.STATUS_AE,     label: 'Status ActiveEffects',  hint: 'Persistent status AE sync: per-effect condition evaluation, which statuses are applied/removed and why.' },
    { key: DEBUG_CATEGORIES.DAMAGE,        label: 'Damage Math',           hint: 'Damage bonus formulas, incoming damage multipliers, damage type matching, threshold triggers (took/inflicted), and per-effect pass/fail.' },
    { key: DEBUG_CATEGORIES.STATUS_ON_HIT, label: 'Status On Hit',         hint: 'Applying status effects and stress to targets after damage lands, per-effect condition evaluation and trigger results.' },
];

// ── CONFIG.debug key helpers ──────────────────────────────────────────────────

function _configKey(categoryKey) {
    return `${MODULE_ID}.${categoryKey}`;
}

// ── Settings key for persistence ─────────────────────────────────────────────
const DEBUG_PERSIST_KEY = 'debugCategories';

// ── Public API ────────────────────────────────────────────────────────────────

// Register a world setting to persist debug state across reloads.
export function registerDebugSettings() {
    game.settings.register(MODULE_ID, DEBUG_PERSIST_KEY, {
        scope: 'client', config: false, type: Object, default: {},
    });
}

// Restore persisted debug state into CONFIG.debug on ready.
export function restoreDebugState() {
    try {
        const saved = game.settings.get(MODULE_ID, DEBUG_PERSIST_KEY) ?? {};
        const restored = [];
        for (const [cat, enabled] of Object.entries(saved)) {
            if (enabled) {
                CONFIG.debug[_configKey(cat)] = true;
                restored.push(cat);
            }
        }
        if (restored.length) {
            console.log(`${MODULE_ID} | Debug restored from settings: ${restored.join(', ')}`);
        }
    } catch { /* first load, no saved state */ }
}

// Persist current debug state to the client setting.
function _persistDebugState() {
    const state = {};
    for (const c of _CATEGORY_META) {
        if (isDebugEnabled(c.key)) state[c.key] = true;
    }
    game.settings.set(MODULE_ID, DEBUG_PERSIST_KEY, state).catch(() => {});
}

export function isDebugEnabled(categoryKey) {
    return Boolean(CONFIG.debug[_configKey(categoryKey)]);
}

export function logDebug(categoryKey, message, ...rest) {
    if (!isDebugEnabled(categoryKey)) return;
    console.log(`${MODULE_ID} | [${categoryKey}] ${message}`, ...rest);
}

export function logWarn(categoryKey, message, ...rest) {
    if (!isDebugEnabled(categoryKey)) return;
    console.warn(`${MODULE_ID} | [${categoryKey}] ${message}`, ...rest);
}

// Errors are always printed regardless of debug state.
export function logError(message, ...rest) {
    console.error(`${MODULE_ID} | ${message}`, ...rest);
}

// ── Debug Dialog (ApplicationV2 subclass) ─────────────────────────────────────

class DebugDialog extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
        id: 'dce-debug-dialog',
        classes: ['dce-debug-dialog'],
        window: { title: 'Conditional Effects — Debug Logging', icon: 'fas fa-bug', resizable: false },
        position: { width: 420, height: 'auto' },
    };

    // Track unsaved checkbox state locally
    _pendingState = {};

    async _renderHTML(_context, _options) {
        // Build current state from CONFIG.debug
        const currentState = {};
        for (const c of _CATEGORY_META) {
            currentState[c.key] = isDebugEnabled(c.key);
        }
        // Merge any pending state from previous render
        const state = { ...currentState, ...this._pendingState };

        const rows = _CATEGORY_META.map(c => {
            const checked = state[c.key] ? 'checked' : '';
            return `
                <div class="form-group" style="margin:0.4rem 0;">
                    <label style="display:flex; gap:0.5rem; align-items:center; cursor:pointer;">
                        <input type="checkbox" data-dce-cat="${c.key}" ${checked} />
                        <span><strong>${c.label}</strong></span>
                    </label>
                    <p class="hint" style="margin:0.15rem 0 0 1.75rem; font-size:0.85em; color:#999;">${c.hint}</p>
                </div>
            `;
        }).join('');

        // Count how many are currently active (persisted)
        const activeCount = Object.values(currentState).filter(Boolean).length;
        const statusLine = activeCount > 0
            ? `<p style="margin:0 0 0.5rem; padding:6px 10px; background:rgba(58,154,110,0.12); border-radius:4px; font-size:0.85em; color:#3a9a6e;"><i class="fas fa-circle-check"></i> <strong>${activeCount}</strong> categor${activeCount === 1 ? 'y' : 'ies'} actively logging to console.</p>`
            : `<p style="margin:0 0 0.5rem; padding:6px 10px; background:rgba(192,64,64,0.08); border-radius:4px; font-size:0.85em; color:#c04040;"><i class="fas fa-circle-xmark"></i> No debug categories active.</p>`;

        const html = `
            <div class="dce-debug-form" style="padding:12px 16px;">
                ${statusLine}
                <div style="display:flex; gap:0.5rem; margin-bottom:0.75rem;">
                    <button type="button" data-dce-action="enableAll"  style="flex:1; padding:5px 8px; cursor:pointer;"><i class="fas fa-check-double"></i> Enable All</button>
                    <button type="button" data-dce-action="disableAll" style="flex:1; padding:5px 8px; cursor:pointer;"><i class="fas fa-ban"></i> Disable All</button>
                </div>
                <hr style="margin:0 0 0.5rem;" />
                ${rows}
                <hr style="margin:0.75rem 0 0.5rem;" />
                <div style="display:flex; gap:0.5rem; justify-content:flex-end;">
                    <button type="button" data-dce-action="save" style="padding:6px 16px; cursor:pointer; background:#5e7b4c; color:#fff; border:none; border-radius:4px; font-weight:600;">
                        <i class="fas fa-save"></i> Save
                    </button>
                    <button type="button" data-dce-action="close" style="padding:6px 16px; cursor:pointer;">
                        <i class="fas fa-times"></i> Close
                    </button>
                </div>
            </div>
        `;

        const temp = document.createElement('div');
        temp.innerHTML = html;
        return temp.firstElementChild;
    }

    _replaceHTML(result, content, options) {
        // ApplicationV2 expects us to place the rendered HTML into this.element
        const target = content instanceof HTMLElement ? content : this.element;
        if (!target) return;
        // Clear existing content in the window-content area
        const windowContent = this.element?.querySelector('.window-content') ?? this.element;
        if (windowContent) {
            windowContent.innerHTML = '';
            windowContent.appendChild(result);
        }
    }

    _onRender(_context, _options) {
        const el = this.element;
        if (!el) return;

        // Enable All button
        el.querySelector('[data-dce-action="enableAll"]')?.addEventListener('click', () => {
            el.querySelectorAll('[data-dce-cat]').forEach(cb => { cb.checked = true; });
        });

        // Disable All button
        el.querySelector('[data-dce-action="disableAll"]')?.addEventListener('click', () => {
            el.querySelectorAll('[data-dce-cat]').forEach(cb => { cb.checked = false; });
        });

        // Save button — reads checkboxes, applies to CONFIG.debug, persists, and re-renders
        el.querySelector('[data-dce-action="save"]')?.addEventListener('click', () => {
            this._saveDebugState();
        });

        // Close button
        el.querySelector('[data-dce-action="close"]')?.addEventListener('click', () => {
            this.close();
        });
    }

    _saveDebugState() {
        const el = this.element;
        if (!el) return;

        const enabled = [];
        const disabled = [];

        el.querySelectorAll('[data-dce-cat]').forEach(cb => {
            const cat = cb.dataset.dceCat;
            const key = _configKey(cat);
            if (cb.checked) {
                CONFIG.debug[key] = true;
                enabled.push(cat);
            } else {
                delete CONFIG.debug[key];
                disabled.push(cat);
            }
        });

        _persistDebugState();

        // Log a clear summary to console
        if (enabled.length) {
            console.log(`%c${MODULE_ID} | Debug NOW ACTIVE for: ${enabled.join(', ')}`, 'color: #3a9a6e; font-weight: bold;');
        }
        if (disabled.length) {
            console.log(`${MODULE_ID} | Debug disabled for: ${disabled.join(', ')}`);
        }
        if (!enabled.length && !disabled.length) {
            console.log(`${MODULE_ID} | No debug categories changed.`);
        }

        ui.notifications.info(`Debug logging: ${enabled.length} categor${enabled.length === 1 ? 'y' : 'ies'} active.`);

        // Re-render to update the status line
        this.render();
    }
}

// Track a single dialog instance so we can toggle or re-focus
let _debugDlg = null;

export function openDebugDialog() {
    // If we have an existing instance that is still rendered, bring it to front
    if (_debugDlg && _debugDlg.rendered) {
        _debugDlg.bringToFront();
        return;
    }
    // Create a fresh instance with a unique ID to avoid ApplicationV2 stale-instance issues
    _debugDlg = new DebugDialog({ id: `dce-debug-dialog-${Date.now()}` });
    _debugDlg.render(true);
}
