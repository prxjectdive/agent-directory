// ============================================================
// TTS WORKER — runs Supertonic 3 off the main thread
//
// Module worker: it imports the vendored helper statically, which in turn
// pulls onnxruntime-web from the CDN. Workers get no import map, so both
// specifiers are full URLs.
// ============================================================
import * as ort from 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort.all.bundle.min.mjs';
import { TextToSpeech, loadCfgs, loadTextProcessor, loadVoiceStyle } from './vendor/supertonic-helper.js';

const HF_BASE    = 'https://huggingface.co/Supertone/supertonic-3/resolve/main';
const CACHE_NAME = 'supertonic-3-v1';
const TOTAL_STEP = 8;      // denoising steps — upstream default, quality vs speed
const MODEL_SPEED = 1.05;  // upstream default; playback rate is left alone downstream

// Byte counts as published on Hugging Face, used only for the progress readout.
const MODEL_FILES = [
    { name: 'duration_predictor.onnx', bytes: 3700147   },
    { name: 'text_encoder.onnx',       bytes: 36416150  },
    { name: 'vector_estimator.onnx',   bytes: 256534781 },
    { name: 'vocoder.onnx',            bytes: 101424195 },
];
const TOTAL_BYTES = MODEL_FILES.reduce((n, f) => n + f.bytes, 0);

let tts        = null;
let sampleRate = 44100;
const styles   = new Map();   // voice id -> Style, built once per voice

// ============================================================
// CACHED FETCH — Cache API keeps the ~380MB off the network on repeat visits
// ============================================================
async function cachedFetch(url, onBytes) {
    let cache = null;
    try { cache = await caches.open(CACHE_NAME); } catch { /* private mode, etc. */ }

    const hit = cache && await cache.match(url);
    if (hit) return hit.arrayBuffer();

    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} fetching ${url}`);

    // Stream so the sync readout moves while a 245MB file lands
    const total  = Number(res.headers.get('Content-Length')) || 0;
    const reader = res.body?.getReader();
    let buf;
    if (reader) {
        const chunks = [];
        let loaded = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            loaded += value.length;
            onBytes?.(value.length);
        }
        buf = new Uint8Array(total || loaded);
        let off = 0;
        for (const c of chunks) { buf.set(c, off); off += c.length; }
        buf = buf.buffer;
    } else {
        buf = await res.arrayBuffer();
        onBytes?.(buf.byteLength);
    }

    if (cache) {
        try { await cache.put(url, new Response(buf.slice(0))); } catch { /* quota */ }
    }
    return buf;
}

// ============================================================
// INIT
// ============================================================
async function init(isMobile) {
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/';
    ort.env.logLevel = 'error';

    const providers = isMobile ? ['wasm'] : ['webgpu', 'wasm'];

    // One combined percentage across all four files
    let loaded = 0;
    const report = (n) => {
        loaded += n;
        self.postMessage({ type: 'progress', percent: Math.min(99, Math.round((loaded / TOTAL_BYTES) * 100)) });
    };

    // Build each session as its bytes arrive, so only one model buffer is held
    // at a time rather than all ~380MB at once.
    const sessionOpts = { executionProviders: providers, graphOptimizationLevel: 'all' };
    const sessions = [];
    for (const f of MODEL_FILES) {
        const before = loaded;
        const buf = await cachedFetch(`${HF_BASE}/onnx/${f.name}`, report);
        if (loaded === before) report(f.bytes);   // came from cache, credit it whole
        sessions.push(await ort.InferenceSession.create(new Uint8Array(buf), sessionOpts));
    }

    self.postMessage({ type: 'init_status', text: 'COMMS: INIT...' });

    const cfgs = await loadCfgs(`${HF_BASE}/onnx`);
    const textProcessor = await loadTextProcessor(`${HF_BASE}/onnx`);
    tts = new TextToSpeech(cfgs, textProcessor, ...sessions);
    sampleRate = tts.sampleRate;

    await getStyle('M1');   // warm the style path
    self.postMessage({ type: 'ready' });
}

async function getStyle(voice) {
    if (styles.has(voice)) return styles.get(voice);
    const style = await loadVoiceStyle([`${HF_BASE}/voice_styles/${voice}.json`]);
    styles.set(voice, style);
    return style;
}

// ============================================================
// MESSAGES
// ============================================================
self.onmessage = async ({ data }) => {
    if (data.type === 'init') {
        try {
            await init(data.isMobile);
        } catch (err) {
            self.postMessage({ type: 'error', message: err.message });
        }

    } else if (data.type === 'generate') {
        if (!tts) { self.postMessage({ type: 'error', message: 'TTS not initialized' }); return; }
        try {
            const style = await getStyle(data.voice);
            const { wav, duration } = await tts.call(data.text, 'en', style, TOTAL_STEP, MODEL_SPEED);
            const trimmed = wav.slice(0, Math.floor(sampleRate * duration[0]));
            const audio = trimmed instanceof Float32Array ? trimmed : new Float32Array(trimmed);
            self.postMessage({ type: 'audio', audio, samplingRate: sampleRate }, [audio.buffer]);
        } catch (err) {
            self.postMessage({ type: 'error', message: err.message });
        }
    }
};
