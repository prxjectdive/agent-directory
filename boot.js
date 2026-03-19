// ============================================================================
// BOOT — boot sequence, config panel, agent directory, drawers, entry point
// ============================================================================
import { sysLog, loadAllPrompts, setGridScrollPosition, gridScrollPosition } from './core.js';
import { openChatInterface, updateSendButton } from './chat.js';
import { initMusicPlayer } from './panels/music-player.js';
import './audio.js'; // registers PTT listeners

// ============================================================================
// DOM REFS
// ============================================================================
const screenEl        = document.getElementById('screen');
const bootScreen      = document.getElementById('boot-screen');
const bootDiv         = document.getElementById('boot-text');
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

// Mobile drawers
const logTab          = document.getElementById('log-tab');
const tapeTab         = document.getElementById('tape-tab');
const logDrawer       = document.getElementById('log-drawer');
const logOverlay      = document.getElementById('log-overlay');
const logDrawerOutput = document.getElementById('log-drawer-output');
const logDrawerClose  = document.getElementById('log-drawer-close');
const tapeDrawer      = document.getElementById('tape-drawer');
const tapeOverlay     = document.getElementById('tape-overlay');
const tapeDrawerClose = document.getElementById('tape-drawer-close');

// ============================================================================
// DESKTOP PANEL TABS
// ============================================================================
panelTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        const target = tab.dataset.panel;
        panelTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        panelLog.style.display  = target === 'log'  ? 'flex' : 'none';
        panelTape.style.display = target === 'tape' ? 'flex' : 'none';
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

function closeAllDrawers() {
    closeLogDrawer();
    closeTapeDrawer();
}

// ============================================================================
// BOOT SEQUENCE
// ============================================================================
const bootSequence = [
    "BIOS DATE 04/18/74 19:01:23 VER 1.04",
    "CPU: PRXJECT NEURAL PROCESSOR 8.4 GHz",
    "MEMORY CHECK: 1048576K OK",
    "LOADING KERNEL MODULES ................. OK",
    "MOUNTING ENCRYPTED VOLUMES ............. OK",
    "ESTABLISHING SECURE CONNECTION ......... OK",
    "DECRYPTING AGENT RECORDS ............... OK",
    " ",
    "WARNING: UNAUTHORIZED ACCESS IS STRICTLY PROHIBITED.",
    " ",
];

const enterKeyHandler = (e) => { if (e.key === 'Enter') showMain(); };
let isSystemMainActive = false;

async function runBoot() {
    for (let text of bootSequence) {
        const p = document.createElement('p');
        bootDiv.appendChild(p);
        if (text.trim() === "") { p.innerHTML = "&nbsp;"; } else {
            p.textContent = "> ";
            for (let char of text) { p.textContent += char; await new Promise(r => setTimeout(r, 5)); }
        }
        await new Promise(r => setTimeout(r, 50));
        screenEl.scrollTop = screenEl.scrollHeight;
    }

    const btn = document.createElement('button');
    btn.className  = 'btn pulse';
    btn.style.cssText = 'margin-top: 20px; width: auto; border: none; padding-left: 0;';
    btn.onclick    = showMain;
    bootDiv.appendChild(btn);

    const finalMsg = "> PRESS ENTER OR CLICK HERE TO EXPLORE ";
    for (let char of finalMsg) {
        btn.innerHTML += char;
        await new Promise(r => setTimeout(r, 10));
        screenEl.scrollTop = screenEl.scrollHeight;
    }
    btn.innerHTML += "<span class='cursor'></span>";
    window.addEventListener('keydown', enterKeyHandler);
}

function showMain() {
    if (isSystemMainActive) return;
    isSystemMainActive = true;
    window.removeEventListener('keydown', enterKeyHandler);
    bootScreen.style.display = 'none';
    mainScreen.style.display = 'flex';
    screenEl.scrollTop       = 0;
    document.getElementById('mobile-tab-strip').classList.remove('boot-hidden');
    loadStoredDates();
    initSystemConfig();
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
});

btnCloseConfig.addEventListener('click', () => {
    sysLog("Operator closed System Configuration.");
    configPanel.style.display     = 'none';
    agentGrid.style.display       = 'grid';
    blacksiteBanner.style.display = 'block';
    btnOpenConfig.style.display   = 'block';
    screenEl.scrollTop            = gridScrollPosition;
    initSystemConfig();
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
    });
});

// ============================================================================
// INIT
// ============================================================================
await Promise.all([loadAllPrompts(), initMusicPlayer()]);
setTimeout(runBoot, 500);