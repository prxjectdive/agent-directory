// ============================================================
// TTS WORKER — runs Kokoro off the main thread
// ============================================================
let tts = null;

self.onmessage = async ({ data }) => {
    if (data.type === 'init') {
        try {
            const { env, KokoroTTS } = await import('https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm');
            env.allowLocalModels = false;
            const device = data.isMobile ? 'wasm' : 'webgpu';
            tts = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
                dtype: 'q4',
                device,
                execution_providers: ['webgpu', 'wasm'],
                log_level: 3,
                progress_callback: (info) => {
                    if (info.status === 'progress' && info.total) {
                        self.postMessage({ type: 'progress', percent: Math.round((info.loaded / info.total) * 100) });
                    } else if (info.status === 'ready') {
                        self.postMessage({ type: 'init_status', text: 'COMMS: INIT...' });
                    }
                }
            });
            // Warmup
            try { await tts.generate("a", { voice: 'am_onyx' }); } catch (e) {}
            self.postMessage({ type: 'ready' });
        } catch (err) {
            self.postMessage({ type: 'error', message: err.message });
        }

    } else if (data.type === 'generate') {
        if (!tts) { self.postMessage({ type: 'error', message: 'TTS not initialized' }); return; }
        try {
            const result = await tts.generate(data.text, { voice: data.voice });
            // Transfer the buffer to avoid copying
            const audio = result.audio instanceof Float32Array ? result.audio : new Float32Array(result.audio);
            self.postMessage({ type: 'audio', audio, samplingRate: result.sampling_rate }, [audio.buffer]);
        } catch (err) {
            self.postMessage({ type: 'error', message: err.message });
        }
    }
};
