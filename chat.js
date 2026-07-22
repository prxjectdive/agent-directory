// ============================================================================
// CHAT — chat interface, commands, autocomplete, link system
// ============================================================================
import {
    sysLog, agentProfiles, backendPrompts, agentLinks,
    getLinkedAgent, setLinkedAgent, clearLinkedAgent,
    getAgentColor, getLinkUIColor,
    buildLore, buildApiMsgsFromLog, buildAgentSysPrompt, callAPI,
    saveToAgentLog, stripPrefix, defaultProxyUrl, defaultModel,
    activeAgentId, setActiveAgentId,
    gridScrollPosition, setGridScrollPosition,
    isWaitingForResponse, setIsWaiting,
    readChatLog, buildRequestTarget, isKnownAgent, makeSpan
} from './core.js';
import { isRadioInitialized, isMuted, stopTTS, playTTS, handleRadioCommand, lastMoonshineText } from './audio.js';

// ============================================================================
// DOM REFS
// ============================================================================
const screenEl       = document.getElementById('screen');
const mainHeader     = document.getElementById('main-header');
const mainFooter     = document.getElementById('main-footer');
const agentGrid      = document.getElementById('agent-grid');
const blacksiteBanner = document.getElementById('blacksite-banner');
const btnOpenConfig  = document.getElementById('btn-open-config');
const chatInterface  = document.getElementById('chat-interface');
const chatHistory    = document.getElementById('chat-history');
const chatTitle      = document.getElementById('chat-agent-title');
const chatInput      = document.getElementById('chat-input');
const btnSendChat    = document.getElementById('btn-send-chat');
const btnBackGrid    = document.getElementById('btn-back-grid');
const pttBtn         = document.getElementById('btn-ptt');
const linkIndicator  = document.getElementById('link-indicator');
const cmdAutocomplete = document.getElementById('cmd-autocomplete');
const cmdGhost       = document.getElementById('cmd-ghost');

// ============================================================================
// INPUT LOCKING
// ============================================================================
export function lockInput() {
    setIsWaiting(true);
    document.body.dataset.waiting = 'true';
    btnSendChat.disabled      = true;
    btnSendChat.style.opacity = '0.35';
    btnSendChat.style.cursor  = 'not-allowed';
    if (isRadioInitialized && !isMuted) pttBtn.classList.add('muted');
}

export function unlockInput() {
    setIsWaiting(false);
    document.body.dataset.waiting = '';
    btnSendChat.disabled      = false;
    btnSendChat.style.opacity = '';
    btnSendChat.style.cursor  = '';
    if (isRadioInitialized && !isMuted) pttBtn.classList.remove('muted');
    updateSendButton();
    chatInput.focus();
}

// ============================================================================
// SEND BUTTON / LINK INDICATOR
// ============================================================================
export function updateSendButton() {
    const linkedAgentId = getLinkedAgent();
    const uiColor       = getLinkUIColor();
    if (linkedAgentId && chatInput.value.trim() === '') {
        btnSendChat.textContent   = '[ LINK ]';
        btnSendChat.style.color   = uiColor;
        btnSendChat.style.borderColor = uiColor;
    } else {
        btnSendChat.textContent   = '[ SEND ]';
        btnSendChat.style.color   = '';
        btnSendChat.style.borderColor = '';
    }
    if (linkedAgentId) {
        linkIndicator.textContent    = `LINKED TO: ${linkedAgentId}`;
        linkIndicator.style.color    = uiColor;
        linkIndicator.style.textShadow = `0 0 6px ${uiColor}40`;
        linkIndicator.style.display  = 'block';
    } else {
        linkIndicator.style.display  = 'none';
    }
}

// ============================================================================
// RENDER HELPERS
// ============================================================================
// Every part of a bubble is untrusted: `text` is operator input or model output,
// `sender` reaches here from a stored chat log. textContent renders the exact
// same line the template did, minus the HTML parser.
export function renderMessage(sender, text, color, id = null, right = false) {
    const row    = document.createElement('div');
    row.className = `chat-msg-row ${(sender === 'USER' || right) ? 'row-user' : 'row-agent'}`;
    if (id) row.id = id;
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${sender === 'USER' ? 'bubble-user' : 'bubble-agent'}`;
    if (sender === 'USER') {
        const opName = (localStorage.getItem('cfg_op_name') || 'Operator').toUpperCase();
        bubble.textContent = `> [${opName}]: ${text}`;
    } else {
        bubble.style.borderColor = color;
        bubble.style.color       = color;
        bubble.textContent = `> [${sender}]: ${text}`;
    }
    row.appendChild(bubble);
    chatHistory.appendChild(row);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

export function renderRightMessage(sender, text, color, id = null) {
    renderMessage(sender, text, color, id, true);
}

export function addMessageToChat(sender, text, color) {
    renderMessage(sender, text, color);
    if (!activeAgentId) return;
    saveToAgentLog(activeAgentId, sender, text, color);
}

export function removeMessage(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

// The terminal speaks for itself while a transmission is in flight — the agent
// hasn't said anything yet, so the placeholder is SYSTEM, not the agent.
const SYSTEM_COLOR = '#a3ffaa';
function renderConnecting(id, right = false) {
    renderMessage("SYSTEM", "Establishing connection...", SYSTEM_COLOR, id, right);
}

// Repaint a pending "Establishing connection..." bubble while callAPI retries
const RECONNECT_COLOR = '#ffaa00';
function markReconnecting(id) {
    const bubble = document.getElementById(id)?.querySelector('.chat-bubble');
    if (!bubble) return;
    bubble.style.borderColor = RECONNECT_COLOR;
    bubble.style.color       = RECONNECT_COLOR;
    bubble.textContent       = '> [SYSTEM]: Signal interrupted. Reconnecting...';
}

// ============================================================================
// CHAT HISTORY
// ============================================================================
export function loadChatHistory(agentId) {
    chatHistory.replaceChildren();
    const savedHistory = readChatLog(agentId);
    if (savedHistory.length) {
        savedHistory.forEach(log => {
            const isOtherAgent = log.sender !== 'USER' && log.sender !== 'SYSTEM' && log.sender !== agentId;
            const isError      = log.color === '#ff5555' && log.sender !== 'SYSTEM' && log.sender !== 'USER';
            const color        = (log.sender === 'USER' || log.sender === 'SYSTEM' || isError) ? log.color : getAgentColor(log.sender);
            isOtherAgent ? renderRightMessage(log.sender, log.text, color) : renderMessage(log.sender, log.text, color);
        });
    } else {
        addMessageToChat("SYSTEM", agentProfiles[agentId].greeting, agentProfiles[agentId].color);
    }
}

// ============================================================================
// OPEN / CLOSE CHAT
// ============================================================================
export function openChatInterface(agentId, pushHistory = true) {
    // agentId arrives from card markup, history.state and cross-module events —
    // anything not in the roster would sail straight into a null profile lookup.
    if (!isKnownAgent(agentId)) { sysLog(`Unknown agent: ${agentId}`, "err"); return; }
    setActiveAgentId(agentId);
    mainHeader.style.display    = 'none';
    mainFooter.style.display    = 'none';
    agentGrid.style.display     = 'none';
    blacksiteBanner.style.display = 'none';
    screenEl.style.overflowY   = 'hidden';
    chatInterface.style.display = 'flex';
    chatTitle.textContent       = `INTERFACING WITH: ${agentId}`;
    chatTitle.style.color       = agentProfiles[agentId].color;

    loadChatHistory(agentId);
    updateSendButton();
    if (pushHistory) history.pushState({ view: 'chat', agentId }, '');

    // Desync: link
    if (!getLinkedAgent()) {
        const logs = readChatLog(agentId);
        const lastLinkMsg = [...logs].reverse().find(m =>
            m.sender === 'SYSTEM' && (
                m.text.toLowerCase().startsWith('link established with') ||
                m.text.toLowerCase().startsWith('link severed with')
            )
        );
        if (lastLinkMsg && lastLinkMsg.text.toLowerCase().startsWith('link established with')) {
            const partner = lastLinkMsg.text.replace(/link established with /i, '').replace(/\.$/, '').trim();
            addMessageToChat("SYSTEM", `Link severed with ${partner}.`, partner === 'VALA' ? "#ff5555" : "#ffaa00");
        }
    }

    // Desync: comms
    if (isMuted || !isRadioInitialized) {
        const logs = readChatLog(agentId);
        const lastCommsMsg = [...logs].reverse().find(m =>
            m.sender === 'SYSTEM' && (m.text === 'Radio communication enabled.' || m.text === 'Radio communication disabled.')
        );
        if (lastCommsMsg && lastCommsMsg.text === 'Radio communication enabled.') {
            addMessageToChat("SYSTEM", "Radio communication disabled.", "#a3ffaa");
        }
    }

    chatInput.focus();
}

btnBackGrid.addEventListener('click', () => {
    sysLog("Operator returned to Agent Directory.");
    setActiveAgentId(null);
    stopTTS();
    updateSendButton();
    chatInterface.style.display   = 'none';
    mainHeader.style.display      = 'block';
    mainFooter.style.display      = 'block';
    agentGrid.style.display       = 'grid';
    blacksiteBanner.style.display = 'block';
    btnOpenConfig.style.display   = 'block';
    screenEl.style.overflowY     = 'auto';
    screenEl.scrollTop           = gridScrollPosition;
    // Model viewer is only valid while an evaluation is open — boot.js resets it
    document.dispatchEvent(new CustomEvent('chat-closed'));
    history.replaceState({ view: 'grid' }, '');
});

// ============================================================================
// AUTOCOMPLETE
// ============================================================================
const commands = [
    { cmd: '/back',          desc: 'Revert the most recent message' },
    { cmd: '/clear',         desc: 'Purge full chat history' },
    { cmd: '/comms enable',  desc: 'Enable voice comms' },
    { cmd: '/comms disable', desc: 'Disable voice comms' },
    { cmd: '/link ',         desc: 'Establish an agent-to-agent connection', ghost: '[agent]' },
    { cmd: '/unlink',        desc: 'Sever the active agent link' },
];

let acIndex   = -1;
let acVisible = [];

function renderAutocomplete(matches) {
    acVisible = matches;
    acIndex   = -1;
    if (matches.length === 0) { cmdAutocomplete.style.display = 'none'; return; }
    cmdAutocomplete.replaceChildren();
    matches.forEach((m, i) => {
        const row   = document.createElement('div');
        row.style.cssText = 'display:flex; justify-content:space-between; padding:8px 12px; cursor:pointer; border-bottom:1px solid #1a1a1a; gap:20px;';

        const label = makeSpan({ style: { color: '#fff', whiteSpace: 'nowrap' } });
        if (m.ghost) {
            label.append('/link ', makeSpan({ text: m.ghost, color: '#555' }));
        } else {
            label.textContent = m.cmd;
        }
        row.append(label, makeSpan({ text: m.desc, style: { color: '#555', textAlign: 'right' } }));
        row.addEventListener('mousedown', e => { e.preventDefault(); applyAutocomplete(m); });
        row.addEventListener('mouseenter', () => setAcIndex(i));
        cmdAutocomplete.appendChild(row);
    });
    cmdAutocomplete.style.display = 'block';
}

function setAcIndex(i) {
    cmdAutocomplete.querySelectorAll('div').forEach((r, idx) => { r.style.background = idx === i ? '#1a1a1a' : 'transparent'; });
    acIndex = i;
}

function updateGhost() {
    if (chatInput.value === '/link ') {
        // The typed part is spaced out invisibly so [agent] lands after the caret
        cmdGhost.replaceChildren(makeSpan({ text: '/link ', color: 'transparent' }), '[agent]');
        cmdGhost.style.display = 'block';
    } else {
        cmdGhost.style.display = 'none';
    }
}

function applyAutocomplete(m) {
    chatInput.value = m.cmd;
    cmdAutocomplete.style.display = 'none';
    acIndex   = -1;
    acVisible = [];
    updateGhost();
    updateSendButton();
    chatInput.focus();
}

function hideAutocomplete() {
    cmdAutocomplete.style.display = 'none';
    acIndex   = -1;
    acVisible = [];
}

// ============================================================================
// SEND
// ============================================================================
async function handleSend() {
    if (!activeAgentId || isWaitingForResponse) return;
    const linkedAgentId = getLinkedAgent();
    const text          = chatInput.value.trim();
    if (!text || text === "[ BUFFER PURGED ]") return;

    if (text.startsWith("/")) {
        const cmd = text.toLowerCase();
        chatInput.value = "";
        updateGhost();
        hideAutocomplete();

        if (cmd === "/clear") {
            localStorage.removeItem(`chat_log_${activeAgentId}`);
            chatHistory.replaceChildren();
            addMessageToChat("SYSTEM", agentProfiles[activeAgentId].greeting, agentProfiles[activeAgentId].color);
            sysLog(`History purged for unit ${activeAgentId}.`, "sys");
            return;
        }

        if (cmd === "/back") {
            const logs = readChatLog(activeAgentId);
            if (logs.length > 1) {
                const removed = logs.pop();
                localStorage.setItem(`chat_log_${activeAgentId}`, JSON.stringify(logs));
                loadChatHistory(activeAgentId);
                sysLog(`Removed latest message from ${removed.sender}.`, "sys");
                if (linkedAgentId) {
                    const otherLogs = readChatLog(linkedAgentId);
                    if (otherLogs.length > 0 && otherLogs[otherLogs.length - 1].text === removed.text) {
                        otherLogs.pop();
                        localStorage.setItem(`chat_log_${linkedAgentId}`, JSON.stringify(otherLogs));
                        sysLog(`Mirrored /back on ${linkedAgentId}.`, "sys");
                    } else {
                        sysLog(`Desync detected — /back applied to ${activeAgentId} only.`, "warn");
                    }
                }
            } else { sysLog("History is at baseline. Cannot revert further.", "warn"); }
            return;
        }

        if (cmd === "/comms enable")  { handleRadioCommand(true);  return; }
        if (cmd === "/comms disable") { handleRadioCommand(false); return; }

        if (cmd === "/link") { sysLog("No agent specified. Use /link [agent].", "err"); return; }

        if (cmd.startsWith("/link ")) {
            const rawTarget = text.slice(6).trim().toUpperCase();
            if (!rawTarget) { sysLog("No agent specified. Use /link [agent].", "err"); return; }
            const targetId = Object.keys(agentProfiles).find(id => id.toUpperCase() === rawTarget);
            if (!targetId) { sysLog(`Unknown agent: ${rawTarget}`, "err"); return; }
            if (targetId === activeAgentId) { sysLog(`${activeAgentId} is already linked to itself. Use /unlink first.`, "err"); return; }
            const currentLink = getLinkedAgent();
            if (currentLink && currentLink !== targetId) { sysLog(`${activeAgentId} is already linked to ${currentLink}. Use /unlink first.`, "err"); return; }
            const targetCurrentLink = agentLinks[targetId] || Object.entries(agentLinks).find(([, to]) => to === targetId)?.[0] || null;
            if (targetCurrentLink && targetCurrentLink !== activeAgentId) { sysLog(`${targetId} is already linked to ${targetCurrentLink}. Use /unlink first.`, "err"); return; }
            setLinkedAgent(targetId);
            sysLog(`Link established between ${activeAgentId} and ${targetId}.`, "sys");
            const linkColor      = targetId      === 'VALA' ? "#ff5555" : "#ffaa00";
            const linkColorOther = activeAgentId === 'VALA' ? "#ff5555" : "#ffaa00";
            addMessageToChat("SYSTEM", `Link established with ${targetId}.`, linkColor);
            saveToAgentLog(targetId, "SYSTEM", `Link established with ${activeAgentId}.`, linkColorOther);
            updateSendButton();
            return;
        }

        if (cmd === "/unlink") {
            const currentLink = getLinkedAgent();
            if (!currentLink) { sysLog("No active link to sever.", "warn"); return; }
            clearLinkedAgent();
            sysLog(`Link severed between ${activeAgentId} and ${currentLink}.`, "sys");
            const severColor      = currentLink   === 'VALA' ? "#ff5555" : "#ffaa00";
            const severColorOther = activeAgentId === 'VALA' ? "#ff5555" : "#ffaa00";
            addMessageToChat("SYSTEM", `Link severed with ${currentLink}.`, severColor);
            saveToAgentLog(currentLink, "SYSTEM", `Link severed with ${activeAgentId}.`, severColorOther);
            updateSendButton();
            return;
        }

        sysLog(`INVALID COMMAND: ${text}`, "err");
        return;
    }

    // Regular message
    // reset lastMoonshineText via audio module
    document.dispatchEvent(new CustomEvent('reset-moonshine-text'));

    addMessageToChat('USER', text, '#ffffff');
    sysLog(`Operator sent transmission to Agent ${activeAgentId}.`);
    chatInput.value = '';
    updateGhost();
    lockInput();

    const agentProfile   = agentProfiles[activeAgentId];
    const typingId       = "type-" + Date.now();
    renderConnecting(typingId);

    const model          = localStorage.getItem('or_model') || defaultModel;
    const opNameRaw      = localStorage.getItem('cfg_op_name') || "Operator";
    const userInfo       = localStorage.getItem('cfg_user_info') || "No background.";
    const logHistory     = readChatLog(activeAgentId);
    const currentDateTime = new Date().toLocaleString('en-US', { hour12: false });
    const { endpoint, headers } = buildRequestTarget();

    const loreSection        = buildLore((logHistory.slice(-10).map(m => m.text).join(" ") + " " + text).toLowerCase());
    const combinedSystemPrompt = buildAgentSysPrompt(activeAgentId, linkedAgentId, opNameRaw, userInfo, loreSection, currentDateTime);
    const apiMessages        = [{ role: "system", content: combinedSystemPrompt }, ...buildApiMsgsFromLog(logHistory.slice(-200), activeAgentId)];

    let responseText;
    try {
        responseText = await callAPI(endpoint, headers, { model, messages: apiMessages }, () => markReconnecting(typingId));
    } catch {
        removeMessage(typingId);
        addMessageToChat("SYSTEM", "Connection lost. Transmission failed.", "#ff5555");
        sysLog(`Connection error communicating with Agent ${activeAgentId}.`, "err");
        unlockInput();
        return;
    }

    removeMessage(typingId);
    addMessageToChat(activeAgentId, responseText, agentProfile.color);
    sysLog(`Agent ${activeAgentId} responded.`);
    playTTS(responseText, agentProfile.voice, agentProfile.detune);

    if (linkedAgentId) {
        saveToAgentLog(linkedAgentId, 'USER', text, '#ffffff');
        saveToAgentLog(linkedAgentId, activeAgentId, responseText, agentProfile.color);

        const linkedLog       = readChatLog(linkedAgentId);
        const linkedSysPrompt = buildAgentSysPrompt(linkedAgentId, activeAgentId, opNameRaw, userInfo, buildLore(linkedLog.slice(-10).map(m => m.text).join(" ")), currentDateTime);
        const linkedApiMessages = [{ role: "system", content: linkedSysPrompt }, ...buildApiMsgsFromLog(linkedLog.slice(-200), linkedAgentId)];

        const linkedTypingId = "lnk-op-" + Date.now();
        renderConnecting(linkedTypingId, true);

        let lText;
        try {
            lText = await callAPI(endpoint, headers, { model, messages: linkedApiMessages }, () => markReconnecting(linkedTypingId));
        } catch {
            removeMessage(linkedTypingId);
            renderMessage("SYSTEM", `Connection lost. ${linkedAgentId} did not respond.`, "#ff5555");
            sysLog(`Connection error communicating with Agent ${linkedAgentId}.`, "err");
            unlockInput();
            return;
        }

        removeMessage(linkedTypingId);
        renderRightMessage(linkedAgentId, lText, getAgentColor(linkedAgentId));
        saveToAgentLog(linkedAgentId, linkedAgentId, lText, agentProfiles[linkedAgentId].color);
        saveToAgentLog(activeAgentId, linkedAgentId, lText, agentProfiles[linkedAgentId].color);
        sysLog(`Agent ${linkedAgentId} responded.`);
        playTTS(lText, agentProfiles[linkedAgentId].voice, agentProfiles[linkedAgentId].detune);
    }

    unlockInput();
}

// ============================================================================
// HANDLE LINK BUTTON
// ============================================================================
async function handleLink() {
    if (!activeAgentId || !getLinkedAgent() || isWaitingForResponse) return;
    const linkedAgentId = getLinkedAgent();

    lockInput();
    btnSendChat.textContent = '[ ... ]';

    const opNameRaw      = localStorage.getItem('cfg_op_name') || "Operator";
    const userInfo       = localStorage.getItem('cfg_user_info') || "No background.";
    const model          = localStorage.getItem('or_model') || defaultModel;
    const currentDateTime = new Date().toLocaleString('en-US', { hour12: false });
    const { endpoint, headers } = buildRequestTarget();

    const restoreInput = () => { unlockInput(); };

    // Step 1: linked agent speaks
    const linkedLog    = readChatLog(linkedAgentId);
    const linkedSysPrompt = buildAgentSysPrompt(linkedAgentId, activeAgentId, opNameRaw, userInfo, buildLore(linkedLog.slice(-10).map(m => m.text).join(" ")), currentDateTime);
    const linkedApiMsgs   = [{ role: "system", content: linkedSysPrompt }, ...buildApiMsgsFromLog(linkedLog, linkedAgentId)];

    const linkedTypingId = "lnk-t-" + Date.now();
    renderConnecting(linkedTypingId, true);

    let linkedResponse;
    try {
        linkedResponse = await callAPI(endpoint, headers, { model, messages: linkedApiMsgs }, () => markReconnecting(linkedTypingId));
    } catch {
        removeMessage(linkedTypingId);
        renderMessage("SYSTEM", `Connection lost. ${linkedAgentId} did not respond.`, "#ff5555");
        sysLog(`Link error: ${linkedAgentId} failed to respond.`, "err");
        restoreInput(); return;
    }

    removeMessage(linkedTypingId);
    renderRightMessage(linkedAgentId, linkedResponse, getAgentColor(linkedAgentId));
    saveToAgentLog(linkedAgentId, linkedAgentId, linkedResponse, agentProfiles[linkedAgentId].color);
    saveToAgentLog(activeAgentId, linkedAgentId, linkedResponse, agentProfiles[linkedAgentId].color);
    sysLog(`Agent ${linkedAgentId} transmitted to ${activeAgentId}.`);
    playTTS(linkedResponse, agentProfiles[linkedAgentId].voice, agentProfiles[linkedAgentId].detune);

    // Step 2: active agent responds
    const activeLog    = readChatLog(activeAgentId);
    const activeSysPrompt = buildAgentSysPrompt(activeAgentId, linkedAgentId, opNameRaw, userInfo, buildLore(activeLog.slice(-10).map(m => m.text).join(" ")), currentDateTime);
    const activeApiMsgs   = [{ role: "system", content: activeSysPrompt }, ...buildApiMsgsFromLog(activeLog, activeAgentId)];

    const activeTypingId = "act-t-" + Date.now();
    renderConnecting(activeTypingId);

    let activeResponse;
    try {
        activeResponse = await callAPI(endpoint, headers, { model, messages: activeApiMsgs }, () => markReconnecting(activeTypingId));
    } catch {
        removeMessage(activeTypingId);
        renderMessage("SYSTEM", `Connection lost. ${activeAgentId} did not respond.`, "#ff5555");
        sysLog(`Link error: ${activeAgentId} failed to respond.`, "err");
        restoreInput(); return;
    }

    removeMessage(activeTypingId);
    renderMessage(activeAgentId, activeResponse, agentProfiles[activeAgentId].color);
    saveToAgentLog(activeAgentId, activeAgentId, activeResponse, agentProfiles[activeAgentId].color);
    saveToAgentLog(linkedAgentId, activeAgentId, activeResponse, agentProfiles[activeAgentId].color);
    sysLog(`Agent ${activeAgentId} responded to ${linkedAgentId}.`);
    playTTS(activeResponse, agentProfiles[activeAgentId].voice, agentProfiles[activeAgentId].detune);

    restoreInput();
}

// ============================================================================
// INPUT EVENT LISTENERS
// ============================================================================
btnSendChat.addEventListener('click', () => {
    if (getLinkedAgent() && chatInput.value.trim() === '') { handleLink(); }
    else { handleSend(); }
});

chatInput.addEventListener('keydown', (e) => {
    if (cmdAutocomplete.style.display !== 'none') {
        if (e.key === 'ArrowDown') { e.preventDefault(); setAcIndex(Math.min(acIndex + 1, acVisible.length - 1)); return; }
        if (e.key === 'ArrowUp')   { e.preventDefault(); setAcIndex(Math.max(acIndex - 1, 0)); return; }
        if (e.key === 'Escape')    { hideAutocomplete(); return; }
        if ((e.key === 'Tab' || e.key === 'Enter') && acIndex >= 0) { e.preventDefault(); applyAutocomplete(acVisible[acIndex]); return; }
    }
    if (e.key === 'Enter') {
        if (getLinkedAgent() && chatInput.value.trim() === '') { handleLink(); }
        else { handleSend(); }
    }
    if (e.key === 'Tab') e.preventDefault();
});

chatInput.addEventListener('input', () => {
    updateSendButton();
    updateGhost();
    const val = chatInput.value;
    if (!val || !val.startsWith('/')) { hideAutocomplete(); return; }
    if (val.startsWith('/link ') && val.length > '/link '.length) { hideAutocomplete(); return; }
    renderAutocomplete(commands.filter(c => c.cmd.startsWith(val.toLowerCase())));
});

chatInput.addEventListener('keyup', updateSendButton);
chatInput.addEventListener('blur', () => setTimeout(hideAutocomplete, 150));

// ============================================================================
// CROSS-MODULE EVENTS
// ============================================================================
document.addEventListener('open-chat', (e) => openChatInterface(e.detail.agentId));

// Browser back button from chat → grid
document.addEventListener('nav-back-to-grid', () => btnBackGrid.click());

// Browser forward button to chat (no history push — already in stack)
document.addEventListener('nav-open-chat', (e) => openChatInterface(e.detail.agentId, false));

// Audio module: comms enabled/disabled → add system message
document.addEventListener('add-system-msg', (e) => addMessageToChat("SYSTEM", e.detail.text, e.detail.color));

// PTT release → trigger send
document.addEventListener('ptt-send', () => handleSend());

// PTT reset moonshine text
document.addEventListener('reset-moonshine-text', () => {
    // lastMoonshineText is managed in audio.js; reset via its own module state
    // audio.js clears it on PTT start already; this event is a no-op here
});