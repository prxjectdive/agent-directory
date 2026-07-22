// ============================================================================
// CORE — shared state, constants, and utilities
// ============================================================================

const MOBILE_UA_PATTERN = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
function computeIsMobile() {
    return MOBILE_UA_PATTERN.test(navigator.userAgent) || window.innerWidth <= 850;
}
// Live binding — importers always see the current value, kept fresh on resize
export let isMobile = computeIsMobile();
window.addEventListener('resize', () => { isMobile = computeIsMobile(); });
export const defaultProxyUrl = "https://proxy.prxjectdive.workers.dev/";
export const defaultModel    = "nvidia/nemotron-3-ultra-550b-a55b:free";
// Reached only on the final retry, when the shared free pool behind the default
// model has already dropped two requests in a row. The 120B slug is saturated
// far less often, so the rare conversation that gets this far still gets an
// answer. Smaller model, but a reply beats a dead terminal.
export const fallbackModel   = "nvidia/nemotron-3-super-120b-a12b:free";

export let gridScrollPosition  = 0;
export let activeAgentId       = null;
export let isWaitingForResponse = false;

export function setGridScrollPosition(v) { gridScrollPosition = v; }
export function setActiveAgentId(v)       { activeAgentId = v; }
export function setIsWaiting(v)           { isWaitingForResponse = v; }

// ============================================================================
// AGENT PROFILES
// ============================================================================
// voice: a Supertonic preset (M1-M5 / F1-F5). detune: cents applied on playback.
export const agentProfiles = {
    "D1-VE": { color: "#a3ffaa", greeting: "Simulation Loaded...", voice: "M2", detune: 0    },
    "X8-G":  { color: "#a3ffaa", greeting: "Simulation Loaded...", voice: "M4", detune: -100 },
    "S-0L":  { color: "#a3ffaa", greeting: "Simulation Loaded...", voice: "F1", detune: -100 },
    "SK-1N": { color: "#a3ffaa", greeting: "Simulation Loaded...", voice: "M1", detune: 0    },
    "VALA":  { color: "#ff5555", greeting: "AGENT IS UNDER ISOLATION. CLOSE TERMINAL NOW.", voice: "F3", detune: 0 }
};

export const isKnownAgent = (id) => Object.prototype.hasOwnProperty.call(agentProfiles, id);

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
    } catch (err) {
        console.error("Failed to load prompt data:", err);
    }
}

// ============================================================================
// SAFE DOM
// ============================================================================
// Nothing the operator types, the model returns, or localStorage hands back is
// ever parsed as HTML. These build the same markup the string templates used
// to, with every variable part as a text node.
export function makeSpan({ className, color, text, style } = {}) {
    const span = document.createElement('span');
    if (className) span.className = className;
    if (color)     span.style.color = color;
    if (style)     Object.assign(span.style, style);
    if (text !== undefined) span.textContent = text;
    return span;
}

// ============================================================================
// STORAGE READS
// ============================================================================
// Every localStorage value is attacker-reachable in the sense that anything on
// https://prxjectdive.github.io shares this storage, and it also just rots —
// a half-written chat log used to take the whole page down on JSON.parse.
export function readJsonArray(key) {
    let raw;
    try { raw = localStorage.getItem(key); } catch { return []; }
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        console.warn(`Discarding unreadable localStorage entry: ${key}`);
        return [];
    }
}

// Chat logs are replayed straight into the DOM, so shape them on the way out.
export function readChatLog(agentId) {
    return readJsonArray(`chat_log_${agentId}`)
        .filter(m => m && typeof m.sender === 'string' && typeof m.text === 'string')
        .map(m => ({
            sender: m.sender,
            text:   m.text,
            color:  typeof m.color === 'string' ? m.color : undefined,
        }));
}

// ============================================================================
// API KEY STORAGE
// ============================================================================
// localStorage on GitHub Pages is keyed to the whole https://prxjectdive.github.io
// origin — it is NOT scoped to /agent-directory/. Every other project page on
// that account shares it, and any script running there can read it. So the key
// lives in sessionStorage (this tab, until it closes) unless the operator ticks
// "Remember API key on this device", which is the only thing that ever writes it
// to disk. See SITE-NOTES.md.
const API_KEY   = 'or_api_key';
const REMEMBER  = 'or_api_key_remember';

export function isRememberApiKey() {
    try { return localStorage.getItem(REMEMBER) === 'true'; } catch { return false; }
}

export function getApiKey() {
    try {
        return sessionStorage.getItem(API_KEY) || (isRememberApiKey() ? localStorage.getItem(API_KEY) : null) || "";
    } catch { return ""; }
}

// Writes to exactly one store and clears the other, so a key can never be left
// behind on disk by flipping the checkbox.
export function setApiKey(key, remember) {
    forgetApiKey();
    try {
        localStorage.setItem(REMEMBER, remember ? 'true' : 'false');
        if (!key) return;
        (remember ? localStorage : sessionStorage).setItem(API_KEY, key);
    } catch (err) { console.error('Could not store API key:', err); }
}

export function forgetApiKey() {
    try { localStorage.removeItem(API_KEY);   } catch {}
    try { sessionStorage.removeItem(API_KEY); } catch {}
}

// Older builds wrote the key to localStorage unconditionally. Nobody opted into
// that, so move it into the session store on first load: it keeps working in
// this tab, it just stops living on disk until the operator asks for it.
export function migrateLegacyApiKey() {
    try {
        if (localStorage.getItem(REMEMBER) !== null) return false;
        const legacy = localStorage.getItem(API_KEY);
        localStorage.setItem(REMEMBER, 'false');
        if (!legacy) return false;
        sessionStorage.setItem(API_KEY, legacy);
        localStorage.removeItem(API_KEY);
        return true;
    } catch { return false; }
}

// ============================================================================
// REQUEST TARGET
// ============================================================================
export const openRouterEndpoint = "https://openrouter.ai/api/v1/chat/completions";

// An API key is a bearer credential — it goes over TLS or it does not go at all.
function isSecureEndpoint(url) {
    try {
        const { protocol, hostname } = new URL(url, location.href);
        return protocol === 'https:' || hostname === 'localhost' || hostname === '127.0.0.1';
    } catch { return false; }
}

let warnedInsecure = false;

// Single source of truth for where a chat request goes and what it carries.
export function buildRequestTarget() {
    const apiKey   = getApiKey();
    const custom   = (localStorage.getItem('or_proxy_url') || "").trim();
    const endpoint = custom || (apiKey ? openRouterEndpoint : defaultProxyUrl);
    const headers  = { "Content-Type": "application/json" };

    if (apiKey) {
        if (isSecureEndpoint(endpoint)) {
            headers["Authorization"] = `Bearer ${apiKey}`;
        } else if (!warnedInsecure) {
            warnedInsecure = true;
            sysLog("Endpoint is not encrypted — API key withheld.", "err");
        }
    }
    return { endpoint, headers };
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
    const entries = Array.isArray(window.lorebook) ? window.lorebook : [];
    const matched = entries
        .filter(e => Array.isArray(e?.keywords) && typeof e.content === 'string')
        .filter(e => e.keywords.some(kw => scanText.toLowerCase().includes(String(kw).toLowerCase())))
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
    return `[CURRENT SYSTEM TIME]:\n${currentDateTime}\n\n[AGENT]:\n${backendPrompts[selfId]}\n\n[OPERATOR]:\nName: ${opNameRaw}\nInfo: ${userInfo}${loreSection}\n\n[SYSTEM COMMAND]: You are ${selfId}. Your mind has been connected to a computer simulation for evaluation. During this simulation, you have been removed from reality and are placed in an abyss with nothing but a text-based terminal. You are communicating with an OPERATOR through the terminal. The OPERATOR is someone drawn at random, they know nothing.${valaLine}${linkedLine} Speak only in the first person. Do not describe your actions, surroundings, or feelings using asterisks or parentheses. Do not use quotation marks around words or phrases. Never use narrative prose. Only output the words you are typing. Do not use 'thought' bubbles or stage directions. Write 2-3 sentences per response.`;
}

// The free NVIDIA endpoint is a shared pool — when it is saturated it returns
// ResourceExhausted and clears again within a second or two. Those are worth
// retrying; a bad model slug or our own rate limit never will be.
const MAX_ATTEMPTS   = 3;
const RETRY_DELAY_MS = 800;
const TRANSIENT_ERROR = /ResourceExhausted|no instances available|overloaded|temporarily unavailable|50[23]/i;

// Swapping the model out from under the operator is only defensible when the
// operator never picked one. A custom key, proxy or model means their account,
// their provider and their choice — those route exactly as configured and fail
// on their own model rather than silently landing somewhere they did not ask for.
function isDefaultRoute() {
    return !getApiKey()
        && !(localStorage.getItem('or_proxy_url') || "").trim()
        && !(localStorage.getItem('or_model')     || "").trim();
}

export async function callAPI(endpoint, headers, body, onRetry = null) {
    const canFallback = isDefaultRoute();

    for (let attempt = 1; ; attempt++) {
        // Only the last attempt switches models — the default is the better
        // writer, so it gets both of its chances before we trade down.
        const sendBody = (canFallback && attempt === MAX_ATTEMPTS)
            ? { ...body, model: fallbackModel }
            : body;
        try {
            const res  = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(sendBody) });
            const data = await res.json();
            if (data.error || !data.choices?.[0]) throw new Error(data.error?.message || "No response");
            return stripPrefix(data.choices[0].message.content);
        } catch (err) {
            if (attempt >= MAX_ATTEMPTS || !TRANSIENT_ERROR.test(err.message)) throw err;
            sysLog(`Signal interrupted — retransmitting (${attempt}/${MAX_ATTEMPTS - 1}).`, "warn");
            onRetry?.(attempt);
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
        }
    }
}

export function saveToAgentLog(agentId, sender, text, color) {
    const key  = `chat_log_${agentId}`;
    const logs = readJsonArray(key);
    logs.push({ sender, text, color });
    try { localStorage.setItem(key, JSON.stringify(logs)); }
    catch (err) { console.error('Could not write chat log:', err); }
}

// ============================================================================
// SYSTEM LOG
// ============================================================================
const LOG_TYPES = ['sys', 'warn', 'err'];

export function sysLog(message, type = "sys") {
    const termOut        = document.getElementById('terminal-output');
    const logDrawerOutput = document.getElementById('log-drawer-output');
    const logDrawer      = document.getElementById('log-drawer');

    const now = new Date();
    const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
    const div = document.createElement('div');
    div.className = 'log-entry';
    // Log lines quote agent ids, failed commands and error text straight back at
    // the operator — all of it is text, none of it is markup.
    div.append(
        makeSpan({ className: 'log-time', text: `[${time}]` }),
        document.createTextNode(' '),
        makeSpan({
            className: `log-${LOG_TYPES.includes(type) ? type : 'sys'}`,
            color: message.includes('VALA') ? '#ff5555' : undefined,
            text: message,
        })
    );

    termOut.appendChild(div);

    // Mirror to mobile drawer
    if (logDrawerOutput) {
        const clone = div.cloneNode(true);
        logDrawerOutput.appendChild(clone);
        while (logDrawerOutput.childNodes.length > 50) logDrawerOutput.removeChild(logDrawerOutput.firstChild);
        if (logDrawer.classList.contains('open')) logDrawerOutput.scrollTop = logDrawerOutput.scrollHeight;
    }

    // VALA easter egg (~1% chance)
    if (Math.random() < 0.01) {
        const targetEntry       = termOut.lastChild;
        const targetDrawerEntry = logDrawerOutput?.lastChild;
        (async () => {
            try {
                const model = localStorage.getItem('or_model') || defaultModel;
                const { endpoint, headers } = buildRequestTarget();
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
                    // msg is raw model output — text node, never markup.
                    valaDiv.append(
                        makeSpan({
                            className: 'log-time',
                            text: '[XX:XX:XX]',
                            style: { color: '#ff5555', textShadow: '0 0 5px #ff5555' },
                        }),
                        document.createTextNode(' '),
                        makeSpan({ text: msg, style: { color: '#aaa', fontStyle: 'italic' } })
                    );
                    valaDiv.onclick = () => {
                        sysLog("ANOMALOUS CONNECTION ESTABLISHED.", "err");
                        // Dispatch events — handled by chat.js and boot.js
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
