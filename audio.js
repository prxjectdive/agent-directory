// ============================================================================
// AUDIO — TTS worker, STT/Moonshine, PTT, radio command
// ============================================================================
import { sysLog, defaultProxyUrl, defaultModel, agentProfiles } from './core.js';

// DOM refs
const muteStatusText = document.getElementById('mute-status-text');
const commModule     = document.getElementById('comm-module');
const pttBtn         = document.getElementById('btn-ptt');
const chatInput      = document.getElementById('chat-input');

// ============================================================================
// STATE
// ============================================================================
export let isRadioInitialized = false;
export let isMuted            = true;

let audioContext        = null;
let moonshineTranscriber = null;
let moonshineReady      = null;
let moonshineModelLoaded = false;
export let lastMoonshineText = "";
let isPttActive         = false;
let isPttStarting       = false;
let activeMicStream     = null;

let ttsWorker  = null;
let ttsReady   = null;
let ttsQueue   = [];
let ttsPlaying = false;
let ttsCurrentSource = null;

// ============================================================================
// GETUSMEDIA INTERCEPT — track mic stream for clean release
// ============================================================================
const _originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.getUserMedia = async function(constraints) {
    const stream = await _originalGetUserMedia(constraints);
    if (constraints && constraints.audio) activeMicStream = stream;
    return stream;
};

// ============================================================================
// TTS
// ============================================================================
export async function loadKokoro() {
    if (ttsReady) return ttsReady;
    ttsReady = new Promise((resolve, reject) => {
        ttsWorker = new Worker('tts-worker.js');
        ttsWorker.onmessage = ({ data }) => {
            if (data.type === 'progress') {
                muteStatusText.textContent = `COMMS: SYNC ${data.percent}%`;
            } else if (data.type === 'init_status') {
                muteStatusText.textContent = data.text;
            } else if (data.type === 'ready') {
                resolve(ttsWorker);
            } else if (data.type === 'error') {
                reject(new Error(data.message));
            } else if (data.type === 'audio') {
                ttsWorker.dispatchEvent(new MessageEvent('audio', { data }));
            }
        };
        ttsWorker.onerror = (e) => reject(e);
        ttsWorker.postMessage({ type: 'init', isMobile: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 850 });
    });
    return ttsReady;
}

export function stopTTS() {
    ttsQueue   = [];
    ttsPlaying = false;
    if (ttsCurrentSource) {
        try { ttsCurrentSource.stop(); } catch(e) {}
        ttsCurrentSource = null;
    }
}

export async function playTTS(text, voice = 'af_sky', speed = 1.25) {
    if (!isRadioInitialized || !ttsWorker || isMuted) return;
    const cleanText = text.replace(/\[.*?\]/g, '').replace(/\*.*?\*/g, '').trim();
    if (!cleanText) return;
    ttsQueue.push({ cleanText, voice, speed });
    if (!ttsPlaying) processTTSQueue();
}

function makeDistortionCurve(amount = 20) {
    const n_samples = 44100;
    const curve     = new Float32Array(n_samples);
    const deg       = Math.PI / 180;
    for (let i = 0; i < n_samples; ++i) {
        const x = (i * 2) / n_samples - 1;
        curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
}

async function processTTSQueue() {
    if (ttsPlaying || ttsQueue.length === 0) return;
    ttsPlaying = true;
    while (ttsQueue.length > 0) {
        const { cleanText, voice, speed } = ttsQueue.shift();
        try {
            if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
            if (audioContext.state === 'suspended') await audioContext.resume();

            const result = await new Promise((resolve, reject) => {
                const handler = ({ data }) => {
                    if (data.type === 'audio') { ttsWorker.removeEventListener('audio', handler); resolve(data); }
                    else if (data.type === 'error') { ttsWorker.removeEventListener('audio', handler); reject(new Error(data.message)); }
                };
                ttsWorker.addEventListener('audio', handler);
                ttsWorker.postMessage({ type: 'generate', text: cleanText, voice });
            });

            if (!ttsPlaying) break;

            const buffer = audioContext.createBuffer(1, result.audio.length, result.samplingRate);
            buffer.getChannelData(0).set(result.audio);
            const source     = audioContext.createBufferSource();
            source.buffer    = buffer;
            source.playbackRate.value = speed;
            source.detune.value       = -350;
            const bandpass   = audioContext.createBiquadFilter();
            bandpass.type    = 'bandpass';
            bandpass.frequency.value = 1500;
            bandpass.Q.value         = 1.0;
            const highpass   = audioContext.createBiquadFilter();
            highpass.type    = 'highpass';
            highpass.frequency.value = 300;
            const lowpass    = audioContext.createBiquadFilter();
            lowpass.type     = 'lowpass';
            lowpass.frequency.value  = 3500;
            const distortion = audioContext.createWaveShaper();
            distortion.curve     = makeDistortionCurve(15);
            distortion.oversample = '4x';
            const gain       = audioContext.createGain();
            gain.gain.value  = 1;
            source.connect(bandpass);
            bandpass.connect(highpass);
            highpass.connect(lowpass);
            lowpass.connect(distortion);
            distortion.connect(gain);
            gain.connect(audioContext.destination);
            ttsCurrentSource = source;
            await new Promise(resolve => { source.onended = resolve; source.start(); });
            ttsCurrentSource = null;
            sysLog('Agent initiated voice transmission.');
        } catch(e) {}
    }
    ttsPlaying = false;
}

// ============================================================================
// STT / Moonshine
// ============================================================================
export async function loadMoonshine() {
    if (moonshineReady) return moonshineReady;
    moonshineReady = new Promise(async (resolve, reject) => {
        try {
            const Moonshine = await import('https://cdn.jsdelivr.net/npm/@moonshine-ai/moonshine-js@latest/dist/moonshine.min.js');
            resolve(Moonshine);
        } catch (err) { reject(err); }
    });
    return moonshineReady;
}

// ============================================================================
// RADIO COMMAND
// ============================================================================
export async function handleRadioCommand(enable) {
    // addMessageToChat is provided by chat.js — use custom event to avoid circular dep
    if (enable) {
        if (!isRadioInitialized) {
            sysLog("Operator established comms.", "warn");
            muteStatusText.textContent = "COMMS: SYNCING...";
            muteStatusText.classList.add('enabled');
            muteStatusText.classList.remove('muted');
            try {
                await loadMoonshine();
                await loadKokoro();
                isRadioInitialized = true;
                isMuted            = false;
                commModule.classList.add('active');
                muteStatusText.textContent = "COMMS: ENABLED";
                pttBtn.classList.remove('muted');
                pttBtn.classList.remove('asleep');
                sysLog("Comms link fully operational.", "sys");
                document.dispatchEvent(new CustomEvent('add-system-msg', { detail: { text: "Radio communication enabled.", color: "#a3ffaa" } }));
            } catch (err) {
                muteStatusText.textContent = "COMMS: FAIL";
                muteStatusText.classList.add('muted');
            }
        } else {
            isMuted = false;
            muteStatusText.textContent = "COMMS: ENABLED";
            muteStatusText.classList.remove('muted');
            pttBtn.classList.remove('muted');
            sysLog("Operator enabled comms.");
            document.dispatchEvent(new CustomEvent('add-system-msg', { detail: { text: "Radio communication enabled.", color: "#a3ffaa" } }));
        }
    } else {
        isMuted = true;
        stopTTS();
        muteStatusText.textContent = "COMMS: DISABLED";
        muteStatusText.classList.add('muted');
        muteStatusText.classList.remove('enabled');
        pttBtn.classList.add('muted');
        pttBtn.classList.remove('asleep');
        commModule.classList.remove('active');

        if (ttsWorker) { ttsWorker.terminate(); ttsWorker = null; }
        ttsReady = null;
        isRadioInitialized = false;

        if (moonshineTranscriber) { try { moonshineTranscriber.stop(); } catch(e) {} moonshineTranscriber = null; }
        if (activeMicStream) { activeMicStream.getTracks().forEach(t => t.stop()); activeMicStream = null; }
        moonshineReady       = null;
        moonshineModelLoaded = false;
        pttBtn.classList.add('asleep');

        sysLog("Operator disabled comms.", "warn");
        document.dispatchEvent(new CustomEvent('add-system-msg', { detail: { text: "Radio communication disabled.", color: "#a3ffaa" } }));
    }
}

// ============================================================================
// PTT
// ============================================================================
export async function handlePttStart() {
    if (!isRadioInitialized || isMuted || document.body.dataset.waiting === 'true') return;
    isPttStarting = true;
    isPttActive   = true;
    lastMoonshineText = "";
    chatInput.value = "";
    chatInput.placeholder = "[ LISTENING... ]";
    pttBtn.classList.add('active');
    sysLog("Operator initiated voice transmission.");

    try {
        const Moonshine = await loadMoonshine();
        if (!moonshineTranscriber) {
            moonshineTranscriber = new Moonshine.MicrophoneTranscriber("model/base", {
                onPermissionsRequested() { },
                onPermissionsGranted() { },
                onPermissionsDenied() { isPttActive = false; isPttStarting = false; pttBtn.classList.remove('active'); chatInput.placeholder = "ENTER COMMAND OR MESSAGE..."; },
                onModelLoadStarted() { },
                onModelLoadComplete() { moonshineModelLoaded = true; if (!isMuted) muteStatusText.textContent = "COMMS: ENABLED"; },
                onTranscriptionUpdated(text) {
                    if (!isPttActive || isMuted) return;
                    chatInput.value = (lastMoonshineText + " " + text).trim();
                    chatInput.placeholder = chatInput.value ? "ENTER COMMAND OR MESSAGE..." : "[ LISTENING... ]";
                },
                onTranscriptionCommitted(text) {
                    if (!isPttActive || isMuted) return;
                    const sanitized = text.trim().toLowerCase().replace(/[.,!?;:]/g, "");
                    if (sanitized === "clear") {
                        lastMoonshineText = "";
                        chatInput.value   = "[ BUFFER PURGED ]";
                        setTimeout(() => { if (chatInput.value === "[ BUFFER PURGED ]") chatInput.value = ""; }, 800);
                        return;
                    }
                    if (text.trim()) {
                        lastMoonshineText = (lastMoonshineText + " " + text).trim();
                        chatInput.value   = lastMoonshineText;
                    }
                },
            }, false);
        }
        if (typeof moonshineTranscriber.reset === 'function') moonshineTranscriber.reset();
        await moonshineTranscriber.start();
        if (moonshineModelLoaded && !isMuted) muteStatusText.textContent = "COMMS: ENABLED";
    } catch(e) {}

    isPttStarting = false;
    if (!isPttActive) {
        if (moonshineTranscriber) { moonshineTranscriber.stop(); moonshineTranscriber = null; }
        if (activeMicStream) { activeMicStream.getTracks().forEach(t => t.stop()); activeMicStream = null; }
    }
}

export const handlePttRelease = () => {
    if (pttBtn.classList.contains('active')) {
        isPttActive = false;
        pttBtn.classList.remove('active');
        if (isPttStarting) return;
        if (moonshineTranscriber) { moonshineTranscriber.stop(); moonshineTranscriber = null; }
        if (activeMicStream) { activeMicStream.getTracks().forEach(t => t.stop()); activeMicStream = null; }
        setTimeout(() => {
            chatInput.placeholder = "ENTER COMMAND OR MESSAGE...";
            const val = chatInput.value.trim();
            if (val && val !== "[ BUFFER PURGED ]") {
                document.dispatchEvent(new CustomEvent('ptt-send'));
            }
        }, 800);
    }
};

// ============================================================================
// PTT EVENT LISTENERS
// ============================================================================
pttBtn.addEventListener('mousedown', handlePttStart);
pttBtn.addEventListener('touchstart', async (e) => { e.preventDefault(); await handlePttStart(); });
window.addEventListener('mouseup', handlePttRelease);
pttBtn.addEventListener('touchend', (e) => { e.preventDefault(); handlePttRelease(); });
