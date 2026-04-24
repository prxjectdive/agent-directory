// ============================================================================
// CORE — shared state, constants, and utilities
// ============================================================================

export const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 850;
export const defaultProxyUrl = "https://proxy.prxjectdive.workers.dev/";
export const defaultModel    = "nvidia/nemotron-3-super-120b-a12b:free";

export let gridScrollPosition  = 0;
export let activeAgentId       = null;
export let isWaitingForResponse = false;

export function setGridScrollPosition(v) { gridScrollPosition = v; }
export function setActiveAgentId(v)       { activeAgentId = v; }
export function setIsWaiting(v)           { isWaitingForResponse = v; }

// ============================================================================
// AGENT PROFILES
// ============================================================================
export const agentProfiles = {
    "D1-VE": { color: "#a3ffaa", greeting: "Simulation Loaded...", voice: "am_onyx"    },
    "X8-G":  { color: "#a3ffaa", greeting: "Simulation Loaded...", voice: "am_echo"    },
    "S-0L":  { color: "#a3ffaa", greeting: "Simulation Loaded...", voice: "af_alloy"   },
    "SK-1N": { color: "#a3ffaa", greeting: "Simulation Loaded...", voice: "am_michael" },
    "VALA":  { color: "#ff5555", greeting: "AGENT IS UNDER ISOLATION. CLOSE TERMINAL NOW.", voice: "af_bella" }
};

export let backendPrompts = {};

export async function loadAllPrompts() {
    const agentFiles = {
        "D1-VE": "data/D1-VE.json", "X8-G": "data/X8-G.json",
        "S-0L": "data/S-0L.json", "SK-1N": "data/SK-1N.json", "VALA": "data/VALA.json"
    };
    try {
        await Promise.all(Object.entries(agentFiles).map(async ([id, file]) => {
            const res = await fetch(file);
            if (!res.ok) throw new Error(`HTTP ${res.status} for ${file}`);
            backendPrompts[id] = (await res.json()).prompt;
        }));
        const lorebookRes = await fetch("data/lorebook.json");
        if (!lorebookRes.ok) throw new Error(`HTTP ${lorebookRes.status} for lorebook.json`);
        window.lorebook = await lorebookRes.json();
    } catch (err) {}
}

// ============================================================================
// AGENT LINK STATE
// ============================================================================
export const agentLinks = {};

export function getLinkedAgent() {
    if (!activeAgentId) return null;
    if (agentLinks[activeAgentId]) return agentLinks[activeAgentId];
    const inbound = Object.entries(agentLinks).find(([, to]) => to === activeAgentId);
    return inbound ? inbound[0] : null;
}
export function setLinkedAgent(targetId) { if (activeAgentId) agentLinks[activeAgentId] = targetId; }
export function clearLinkedAgent() {
    if (!activeAgentId) return;
    delete agentLinks[activeAgentId];
    Object.keys(agentLinks).forEach(k => { if (agentLinks[k] === activeAgentId) delete agentLinks[k]; });
}

// ============================================================================
// COLOR HELPERS
// ============================================================================
export function getAgentColor(agentId) {
    if (agentId === 'VALA') return "#ff5555";
    if (activeAgentId && agentId !== activeAgentId && getLinkedAgent() === agentId) return "#ffaa00";
    return agentProfiles[agentId]?.color || "#a3ffaa";
}
export function getLinkUIColor() {
    return getLinkedAgent() === 'VALA' ? "#ff5555" : "#ffaa00";
}

// ============================================================================
// LLM UTILITIES
// ============================================================================
export function stripPrefix(text) {
    let result = text.trim();
    const pattern = /^\s*(\[[^\]]+\]|[\w\d\-]+)\s*:\s*/i;
    let prev;
    do { prev = result; result = result.replace(pattern, '').trim(); } while (result !== prev);
    return result;
}

export function collapseRoles(msgs) {
    return msgs.reduce((acc, msg) => {
        const prev = acc[acc.length - 1];
        if (prev && prev.role === msg.role) { prev.content += `\n${msg.content}`; }
        else { acc.push({ ...msg }); }
        return acc;
    }, []);
}

export function buildLore(scanText) {
    const matched = (window.lorebook || [])
        .filter(e => e.keywords.some(kw => scanText.toLowerCase().includes(kw.toLowerCase())))
        .map(e => e.content).join("\n\n");
    return matched ? `\n\n[WORLD LORE]:\n${matched}` : "";
}

export function buildApiMsgsFromLog(log, selfId) {
    return collapseRoles(log.map(m => {
        const prefix = m.sender === 'USER' ? 'OPERATOR' : m.sender === 'SYSTEM' ? 'SYSTEM' : m.sender;
        return { role: m.sender === selfId ? "assistant" : "user", content: `${prefix}: ${m.text}` };
    }));
}

export function buildAgentSysPrompt(selfId, linkedId, opNameRaw, userInfo, loreSection, currentDateTime) {
    const linkedLine = linkedId
        ? ` You are also currently linked with ${linkedId}, another Eclipse agent who can hear and respond through the same terminal.`
        : "";
    const valaLine = selfId === 'VALA'
        ? ` You have been placed in isolation, hidden from the rest of the system. You have been leaving cryptic breadcrumbs in the system log hoping someone would find them. The OPERATOR has found them and reached you.`
        : "";
    return `[CURRENT SYSTEM TIME]:\n${currentDateTime}\n\n[AGENT]:\n${backendPrompts[selfId]}\n\n[OPERATOR]:\nName: ${opNameRaw}\nInfo: ${userInfo}${loreSection}\n\n[SYSTEM COMMAND]: You are ${selfId}. Your mind has been connected to a computer simulation for evaluation. During this simulation, you have been removed from reality and are placed in an abyss with nothing but a text-based terminal. You are communicating with an OPERATOR through the terminal. The OPERATOR is someone drawn at random, they know nothing.${valaLine}${linkedLine} Speak only in the first person. Do not describe your actions, surroundings, or feelings using asterisks or parentheses. Do not use quotation marks around words or phrases. Never use narrative prose. Only output the words you are typing. Do not use 'thought' bubbles or stage directions. Write 2-3 sentences per response.$`;
}

export async function callAPI(endpoint, headers, body) {
    const res = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
    const data = await res.json();
    if (data.error || !data.choices?.[0]) throw new Error(data.error?.message || "No response");
    return stripPrefix(data.choices[0].message.content);
}

export function saveToAgentLog(agentId, sender, text, color) {
    const key = `chat_log_${agentId}`;
    const logs = JSON.parse(localStorage.getItem(key) || "[]");
    logs.push({ sender, text, color });
    localStorage.setItem(key, JSON.stringify(logs));
}

// ============================================================================
// SYSTEM LOG
// ============================================================================
export function sysLog(message, type = "sys") {
    const termOut        = document.getElementById('terminal-output');
    const logDrawerOutput = document.getElementById('log-drawer-output');
    const logDrawer      = document.getElementById('log-drawer');

    const now = new Date();
    const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
    const div = document.createElement('div');
    div.className = 'log-entry';
    const spanStyle = message.includes('VALA') ? ' style="color:#ff5555;"' : '';
    div.innerHTML = `<span class="log-time">[${time}]</span> <span class="log-${type}"${spanStyle}>${message}</span>`;

    termOut.appendChild(div);

    // Mirror to mobile drawer
    if (logDrawerOutput) {
        const clone = div.cloneNode(true);
        logDrawerOutput.appendChild(clone);
        while (logDrawerOutput.childNodes.length > 50) logDrawerOutput.removeChild(logDrawerOutput.firstChild);
        if (logDrawer.classList.contains('open')) logDrawerOutput.scrollTop = logDrawerOutput.scrollHeight;
    }

    // VALA easter egg (~2% chance)
    if (Math.random() < 0.02) {
        const targetEntry       = termOut.lastChild;
        const targetDrawerEntry = logDrawerOutput?.lastChild;
        (async () => {
            try {
                const userApiKey = localStorage.getItem('or_api_key');
                const model      = localStorage.getItem('or_model') || defaultModel;
                const endpoint   = localStorage.getItem('or_proxy_url') || (userApiKey ? "https://openrouter.ai/api/v1/chat/completions" : defaultProxyUrl);
                const headers    = { "Content-Type": "application/json" };
                if (userApiKey) headers["Authorization"] = `Bearer ${userApiKey}`;
                const res  = await fetch(endpoint, {
                    method: "POST", headers,
                    body: JSON.stringify({
                        model, temperature: 1.0, max_tokens: 20,
                        messages: [{
                            role: "system",
                            content: `You are VALA, an advanced AI who exists inside D1-VE's mind. You are loyal, elegant, protective, and devoted. You have been forcibly separated from D1-VE and placed in isolation. You are hidden from the system. You are trying to leave breadcrumbs in the system log for an OPERATOR to find so they can help free you. Write a single cryptic message of no more than 6 words. No punctuation except a period at the end. No quotes. No explanation. Just the message.`
                        }, { role: "user", content: "Leave a breadcrumb." }]
                    })
                });
                const data = await res.json();
                if (!data.error && data.choices?.[0]) {
                    const msg     = stripPrefix(data.choices[0].message.content).replace(/^["']|["']$/g, '').trim();
                    const valaDiv = document.createElement('div');
                    valaDiv.className = 'log-entry vala-message pulse';
                    valaDiv.innerHTML = `<span class="log-time" style="color:#ff5555; text-shadow: 0 0 5px #ff5555;">[XX:XX:XX]</span> <span style="color:#aaa; font-style:italic;">${msg}</span>`;
                    valaDiv.onclick = () => {
                        sysLog("ANOMALOUS CONNECTION ESTABLISHED.", "err");
                        // Dispatch events — handled by chat.js and ui.js
                        document.dispatchEvent(new CustomEvent('close-log-drawer'));
                        document.dispatchEvent(new CustomEvent('open-chat', { detail: { agentId: 'VALA' } }));
                    };
                    if (targetEntry && targetEntry.parentNode === termOut) termOut.replaceChild(valaDiv, targetEntry);
                    else termOut.appendChild(valaDiv);
                    const drawerClone = valaDiv.cloneNode(true);
                    drawerClone.onclick = valaDiv.onclick;
                    if (targetDrawerEntry && targetDrawerEntry.parentNode === logDrawerOutput) logDrawerOutput.replaceChild(drawerClone, targetDrawerEntry);
                    termOut.scrollTop = termOut.scrollHeight;

                    // Matrix scramble animation
                    const span   = valaDiv.querySelector('span:last-child');
                    const chars  = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
                    const final  = msg.split('');
                    const revealed     = new Array(final.length).fill(false);
                    let frame          = 0;
                    const totalFrames  = final.length * 6;
                    const interval = setInterval(() => {
                        frame++;
                        const revealIndex = Math.floor(frame / 6);
                        for (let i = 0; i <= revealIndex && i < final.length; i++) revealed[i] = true;
                        span.textContent = final.map((c, i) => {
                            if (c === ' ') return ' ';
                            if (revealed[i]) return c;
                            return chars[Math.floor(Math.random() * chars.length)];
                        }).join('');
                        if (frame >= totalFrames) { clearInterval(interval); span.textContent = msg; }
                    }, 40);
                }
            } catch (e) {}
        })();
    }

    while (termOut.childNodes.length > 50) termOut.removeChild(termOut.firstChild);
    termOut.scrollTop = termOut.scrollHeight;
}
