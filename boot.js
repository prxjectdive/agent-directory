// ============================================================================
// BOOT — entry point: config panel, agent directory, drawers, history router
// ============================================================================
import {
    sysLog, loadAllPrompts, setGridScrollPosition, gridScrollPosition, activeAgentId, isMobile,
    getApiKey, setApiKey, forgetApiKey, isRememberApiKey, migrateLegacyApiKey,
    isCustomModelAllowed, MODEL_GATE_MSG
} from './core.js';
import { openChatInterface, updateSendButton } from './chat.js';
import { initMusicPlayer } from './panels/music-player.js';
import { initModelViewer, loadAgentModel, unloadAgentModel, handleResize as modelViewerResize, MODEL_REGISTRY } from './panels/model-viewer.js';
import './audio.js'; // registers PTT listeners

// ============================================================================
// CSP REPORTING
// ============================================================================
// The policy in index.html is load-bearing: add an external asset without also
// adding its directive and the resource simply never arrives, often with no
// obvious error. Name the directive that refused it so the next person is not
// guessing. Console only — operators get in-world wording, diagnostics stay here.
//
// Note the blind spot: a module worker whose *import graph* is refused reports
// nothing here, because the violation happens inside the worker and the worker
// never runs to report it. audio.js covers that case at its own catch site.
document.addEventListener('securitypolicyviolation', (e) => {
    // Chrome reports the granular directive (script-src-elem, style-src-attr).
    // The policy only spells out the base ones, so point at the line that
    // actually exists rather than at a directive nobody will find.
    const fixIn = e.effectiveDirective.replace(/-(elem|attr)$/, '');
    console.error(
        `[CSP] ${e.effectiveDirective} blocked ${e.blockedURI || '(inline)'}` +
        (e.sourceFile ? ` (from ${e.sourceFile}:${e.lineNumber})` : '') +
        ` — if this resource is expected, add its origin to ${fixIn} in index.html.`
    );
});

// ============================================================================
// DOM REFS
// ============================================================================
const screenEl        = document.getElementById('screen');
const mainScreen      = document.getElementById('main-content');
const mainHeader      = document.getElementById('main-header');
const agentGrid       = document.getElementById('agent-grid');
const blacksiteBanner = document.getElementById('blacksite-banner');
const configPanel     = document.getElementById('config-interface');
const btnOpenConfig   = document.getElementById('btn-open-config');
const btnCloseConfig  = document.getElementById('btn-close-config');
const btnSaveConfig   = document.getElementById('btn-save-config');
const cfgProxyUrl     = document.getElementById('cfg-proxy-url');
const cfgApiKey       = document.getElementById('cfg-api-key');
const cfgModel        = document.getElementById('cfg-model');
const cfgModelError   = document.getElementById('cfg-model-error');
const cfgOpName       = document.getElementById('cfg-op-name');
const cfgUserInfo     = document.getElementById('cfg-user-info');
const cfgRememberKey  = document.getElementById('cfg-remember-key');
const btnFailsafe     = document.getElementById('btn-failsafe');
const btnResetConfig  = document.getElementById('btn-reset-config');
const configFields    = document.getElementById('config-fields');
const failsafeWarning = document.getElementById('failsafe-warning');
const evalButtons     = document.querySelectorAll('.eval-trigger');

// Desktop panel tabs
const panelTabs       = document.querySelectorAll('.panel-tab');
const panelLog        = document.getElementById('panel-log');
const panelTape       = document.getElementById('panel-tape');
const panelModel      = document.getElementById('panel-model');

// Mobile drawers
const logTab          = document.getElementById('log-tab');
const tapeTab         = document.getElementById('tape-tab');
const modelTab        = document.getElementById('model-tab');
const logDrawer       = document.getElementById('log-drawer');
const logOverlay      = document.getElementById('log-overlay');
const logDrawerOutput = document.getElementById('log-drawer-output');
const logDrawerClose  = document.getElementById('log-drawer-close');
const tapeDrawer      = document.getElementById('tape-drawer');
const tapeOverlay     = document.getElementById('tape-overlay');
const tapeDrawerClose = document.getElementById('tape-drawer-close');
const modelDrawer     = document.getElementById('model-drawer');
const modelOverlay    = document.getElementById('model-overlay');
const modelDrawerOutput = document.getElementById('model-drawer-output');
const modelDrawerClose  = document.getElementById('model-drawer-close');

// ============================================================================
// DESKTOP PANEL TABS
// ============================================================================
panelTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        const target = tab.dataset.panel;
        panelTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        panelLog.style.display   = target === 'log'   ? 'flex' : 'none';
        panelTape.style.display  = target === 'tape'  ? 'flex' : 'none';
        panelModel.style.display = target === 'model' ? 'flex' : 'none';
        if (target === 'model') { initModelViewer(panelModel); modelViewerResize(); }
    });
});

// ============================================================================
// MOBILE LOG DRAWER
// ============================================================================
function openLogDrawer() {
    closeAllDrawers();
    logDrawer.classList.add('open');
    logOverlay.classList.add('open');
    logDrawerOutput.scrollTop = logDrawerOutput.scrollHeight;
}
function closeLogDrawer() {
    logDrawer.classList.remove('open');
    logOverlay.classList.remove('open');
}

logTab.addEventListener('click', openLogDrawer);
logDrawerClose.addEventListener('click', closeLogDrawer);
logOverlay.addEventListener('click', closeLogDrawer);

// Expose for core.js VALA easter egg
document.addEventListener('close-log-drawer', closeLogDrawer);

// ============================================================================
// MOBILE TAPE DRAWER
// ============================================================================
function openTapeDrawer() {
    closeAllDrawers();
    tapeDrawer.classList.add('open');
    tapeOverlay.classList.add('open');
}
function closeTapeDrawer() {
    tapeDrawer.classList.remove('open');
    tapeOverlay.classList.remove('open');
}

tapeTab.addEventListener('click', openTapeDrawer);
tapeDrawerClose.addEventListener('click', closeTapeDrawer);
tapeOverlay.addEventListener('click', closeTapeDrawer);

// ============================================================================
// MOBILE MODEL DRAWER
// ============================================================================
function openModelDrawer() {
    closeAllDrawers();
    modelDrawer.classList.add('open');
    modelOverlay.classList.add('open');
    setTimeout(() => {
        initModelViewer(modelDrawerOutput);
        modelViewerResize();
        if (activeAgentId && MODEL_REGISTRY[activeAgentId]) loadAgentModel(activeAgentId);
    }, 300);
}
function closeModelDrawer() {
    modelDrawer.classList.remove('open');
    modelOverlay.classList.remove('open');
}

modelTab.addEventListener('click', openModelDrawer);
modelDrawerClose.addEventListener('click', closeModelDrawer);
modelOverlay.addEventListener('click', closeModelDrawer);

function closeAllDrawers() {
    closeLogDrawer();
    closeTapeDrawer();
    closeModelDrawer();
}

// The 3D model belongs to the agent's evaluation — tear it down on exit so the
// viewer sits at its default empty state back on the directory grid.
document.addEventListener('chat-closed', () => {
    closeModelDrawer();
    unloadAgentModel();
});

// ============================================================================
// MAIN SCREEN — shown immediately on load (boot sequence removed)
// ============================================================================
function showMain() {
    mainScreen.style.display = 'flex';
    screenEl.scrollTop       = 0;
    const migrated = migrateLegacyApiKey();
    loadStoredDates();
    initSystemConfig();
    if (!isMobile) initModelViewer(panelModel);
    history.replaceState({ view: 'grid' }, '');
    sysLog("SYSTEM BOOT COMPLETE.", "sys");
    sysLog("Operator logged in to agent directory.", "warn");
    if (migrated) {
        sysLog("API key moved out of local storage — it now lasts for this session only.", "warn");
        sysLog("Re-enable retention in System Configuration if wanted.", "warn");
    }
}

// ============================================================================
// CONFIGURATION
// ============================================================================
// The wording lives in core.js so the panel and the system log can never drift
// apart — the operator should read the same sentence wherever it surfaces.
function setModelError(show) {
    cfgModelError.textContent = show ? MODEL_GATE_MSG : "";
    cfgModelError.hidden      = !show;
    // Either field resolves it, so both are flagged — the operator picks one.
    cfgProxyUrl.classList.toggle('flag-required', show);
    cfgApiKey.classList.toggle('flag-required', show);
}

function initSystemConfig() {
    cfgProxyUrl.value       = localStorage.getItem('or_proxy_url') || "";
    cfgApiKey.value         = getApiKey();
    cfgRememberKey.checked  = isRememberApiKey();
    cfgModel.value          = localStorage.getItem('or_model')     || "";
    cfgOpName.value         = localStorage.getItem('cfg_op_name')  || "";
    cfgUserInfo.value       = localStorage.getItem('cfg_user_info') || "";
    setModelError(false);
}

// Clear the complaint the moment the operator starts satisfying it, from any of
// the three fields involved — a message that outlives the problem reads as a bug.
[cfgModel, cfgApiKey, cfgProxyUrl].forEach(field =>
    field.addEventListener('input', () => { if (!cfgModelError.hidden) setModelError(false); })
);

// Unticking the box is itself the instruction to stop persisting — it takes
// effect now, not on save, so the key never outlives the operator's intent.
cfgRememberKey.addEventListener('change', () => {
    setApiKey(cfgApiKey.value.trim(), cfgRememberKey.checked);
    sysLog(cfgRememberKey.checked
        ? "API key will be retained on this device."
        : "API key retention disabled — key cleared from local storage.", "warn");
});

// ============================================================================
// FAILSAFE — wipe this device back to factory defaults
// ============================================================================
let failsafeArmed = false;

function setFailsafeMode(on) {
    failsafeArmed = on;
    configFields.style.display    = on ? 'none'  : 'flex';
    failsafeWarning.style.display = on ? 'flex'  : 'none';
    btnFailsafe.style.display     = on ? 'none'  : 'block';
    btnSaveConfig.style.display   = on ? 'none'  : 'block';
    btnResetConfig.style.display  = on ? 'block' : 'none';
    // While armed, RESET is the only red control — CANCEL steps back to neutral
    // so the destructive button is not one of two identical-looking options.
    btnCloseConfig.style.color       = on ? '#888' : '#ff5555';
    btnCloseConfig.style.borderColor = on ? '#888' : '#ff5555';
}

// Only ever the keys this app owns. localStorage is shared with every other
// page on this origin, so localStorage.clear() would take out unrelated
// projects' data — see SITE-NOTES.md.
const APP_KEYS     = ['or_proxy_url', 'or_model', 'or_api_key', 'or_api_key_remember', 'cfg_op_name', 'cfg_user_info'];
const APP_PREFIXES = ['chat_log_', 'eval_date_'];

function wipeLocalData() {
    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (APP_KEYS.includes(k) || APP_PREFIXES.some(p => k.startsWith(p))) doomed.push(k);
    }
    doomed.forEach(k => localStorage.removeItem(k));
    forgetApiKey();   // also clears the session copy
    return doomed.length;
}

btnFailsafe.addEventListener('click', () => {
    setFailsafeMode(true);
    sysLog("FAILSAFE ARMED. Awaiting confirmation.", "warn");
});

btnResetConfig.addEventListener('click', () => {
    const wiped = wipeLocalData();
    sysLog(`FAILSAFE ENGAGED. ${wiped} record(s) purged. Rebooting terminal...`, "err");
    // Full reload so every view, card date and in-memory link returns to default
    setTimeout(() => location.reload(), 600);
});

btnOpenConfig.addEventListener('click', () => {
    sysLog("Operator accessed System Configuration.");
    setGridScrollPosition(screenEl.scrollTop);
    agentGrid.style.display       = 'none';
    blacksiteBanner.style.display = 'none';
    btnOpenConfig.style.display   = 'none';
    configPanel.style.display     = 'flex';
    setFailsafeMode(false);
    // Re-read storage on the way in as well as on the way out, so the fields can
    // never show something storage no longer agrees with. Also clears any leftover
    // validation state, so the panel always opens clean.
    initSystemConfig();
    history.pushState({ view: 'config' }, '');
});

btnCloseConfig.addEventListener('click', () => {
    // While the failsafe is armed, CANCEL backs out of it rather than leaving
    // the panel — the operator is answering the warning, not closing settings.
    if (failsafeArmed) {
        setFailsafeMode(false);
        sysLog("Failsafe aborted.", "sys");
        return;
    }
    sysLog("Operator closed System Configuration.");
    configPanel.style.display     = 'none';
    agentGrid.style.display       = 'grid';
    blacksiteBanner.style.display = 'block';
    btnOpenConfig.style.display   = 'block';
    screenEl.scrollTop            = gridScrollPosition;
    initSystemConfig();
    history.replaceState({ view: 'grid' }, '');
});

btnSaveConfig.addEventListener('click', () => {
    const proxyUrl = cfgProxyUrl.value.trim();
    const apiKey   = cfgApiKey.value.trim();
    const model    = cfgModel.value.trim();

    // Refuse the whole save, not just the model field. Writing the rest would
    // leave the panel showing a model the site is not going to use. The panel
    // stays open with every entry intact, so nothing typed is lost.
    if (model && !isCustomModelAllowed(apiKey, proxyUrl)) {
        setModelError(true);
        cfgModel.focus();
        return;
    }

    localStorage.setItem('or_proxy_url', proxyUrl);
    setApiKey(apiKey, cfgRememberKey.checked);
    localStorage.setItem('or_model',     model);
    localStorage.setItem('cfg_op_name',  cfgOpName.value.trim());
    localStorage.setItem('cfg_user_info', cfgUserInfo.value.trim());
    sysLog("Operator modified System Configuration settings.", "warn");
    btnCloseConfig.click();
});

// ============================================================================
// AGENT DIRECTORY
// ============================================================================
function loadStoredDates() {
    document.querySelectorAll('.card').forEach(card => {
        const saved = localStorage.getItem(`eval_date_${card.getAttribute('data-agent-id')}`);
        const span  = card.querySelector('.eval-date');
        if (saved && span) span.textContent = saved;
    });
}

evalButtons.forEach(button => {
    button.addEventListener('click', function(e) {
        e.preventDefault();
        setGridScrollPosition(screenEl.scrollTop);
        const card    = this.closest('.card');
        const agentId = card.getAttribute('data-agent-id');
        const dateSpan = card.querySelector('.eval-date');
        sysLog(`Operator initiated evaluation protocol for agent ${agentId}.`);
        if (dateSpan) {
            const d       = new Date();
            const dateStr = `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}/${d.getFullYear()}`;
            dateSpan.textContent = dateStr;
            localStorage.setItem(`eval_date_${agentId}`, dateStr);
        }
        openChatInterface(agentId);
        // Preload 3D model in background on desktop only
        if (!isMobile) {
            initModelViewer(panelModel);
            if (MODEL_REGISTRY[agentId]) loadAgentModel(agentId);
        }
    });
});

// ============================================================================
// INIT
// ============================================================================
await Promise.all([loadAllPrompts(), initMusicPlayer()]);
showMain();

// ============================================================================
// HISTORY ROUTER — single popstate listener for all views
// ============================================================================
window.addEventListener('popstate', (e) => {
    const view = e.state?.view;

    if (view === 'grid') {
        // Back from chat or config
        mainScreen.style.display      = 'flex';
        configPanel.style.display     = 'none';
        blacksiteBanner.style.display = 'block';
        btnOpenConfig.style.display   = 'block';
        agentGrid.style.display       = 'grid';
        screenEl.scrollTop            = gridScrollPosition;
        if (activeAgentId) {
            // Coming from chat
            document.dispatchEvent(new CustomEvent('nav-back-to-grid'));
        } else {
            // Coming from config
            sysLog("Operator returned to Agent Directory.");
            initSystemConfig();
        }

    } else if (view === 'config') {
        // Back from save, or forward from grid
        mainScreen.style.display      = 'flex';
        sysLog("Operator accessed System Configuration.");
        setGridScrollPosition(screenEl.scrollTop);
        agentGrid.style.display       = 'none';
        blacksiteBanner.style.display = 'none';
        btnOpenConfig.style.display   = 'none';
        configPanel.style.display     = 'flex';
        setFailsafeMode(false);

    } else if (view === 'chat') {
        // Forward to chat
        mainScreen.style.display = 'flex';
        sysLog(`Operator resumed evaluation of Agent ${e.state.agentId}.`);
        document.dispatchEvent(new CustomEvent('nav-open-chat', { detail: { agentId: e.state.agentId } }));
    }
});