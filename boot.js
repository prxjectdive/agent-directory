// ============================================================================
// BOOT — entry point: config panel, agent directory, drawers, history router
// ============================================================================
import { sysLog, loadAllPrompts, setGridScrollPosition, gridScrollPosition, activeAgentId, isMobile } from './core.js';
import { openChatInterface, updateSendButton } from './chat.js';
import { initMusicPlayer } from './panels/music-player.js';
import { initModelViewer, loadAgentModel, unloadAgentModel, handleResize as modelViewerResize, MODEL_REGISTRY } from './panels/model-viewer.js';
import './audio.js'; // registers PTT listeners

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
const cfgOpName       = document.getElementById('cfg-op-name');
const cfgUserInfo     = document.getElementById('cfg-user-info');
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
    loadStoredDates();
    initSystemConfig();
    if (!isMobile) initModelViewer(panelModel);
    history.replaceState({ view: 'grid' }, '');
    sysLog("SYSTEM BOOT COMPLETE.", "sys");
    sysLog("Operator logged in to agent directory.", "warn");
}

// ============================================================================
// CONFIGURATION
// ============================================================================
function initSystemConfig() {
    cfgProxyUrl.value = localStorage.getItem('or_proxy_url') || "";
    cfgApiKey.value   = localStorage.getItem('or_api_key')   || "";
    cfgModel.value    = localStorage.getItem('or_model')     || "";
    cfgOpName.value   = localStorage.getItem('cfg_op_name')  || "";
    cfgUserInfo.value = localStorage.getItem('cfg_user_info') || "";
}

btnOpenConfig.addEventListener('click', () => {
    sysLog("Operator accessed System Configuration.");
    setGridScrollPosition(screenEl.scrollTop);
    agentGrid.style.display       = 'none';
    blacksiteBanner.style.display = 'none';
    btnOpenConfig.style.display   = 'none';
    configPanel.style.display     = 'flex';
    history.pushState({ view: 'config' }, '');
});

btnCloseConfig.addEventListener('click', () => {
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
    localStorage.setItem('or_proxy_url', cfgProxyUrl.value.trim());
    localStorage.setItem('or_api_key',   cfgApiKey.value.trim());
    localStorage.setItem('or_model',     cfgModel.value.trim());
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

    } else if (view === 'chat') {
        // Forward to chat
        mainScreen.style.display = 'flex';
        sysLog(`Operator resumed evaluation of Agent ${e.state.agentId}.`);
        document.dispatchEvent(new CustomEvent('nav-open-chat', { detail: { agentId: e.state.agentId } }));
    }
});