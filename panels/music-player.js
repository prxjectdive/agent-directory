// ============================================================================
// MUSIC PLAYER — tape deck panel
// ============================================================================

const audio = new Audio();
let tracks  = [];
let current = 0;
let playing = false;
let loopMode = 'none'; // 'none' | 'all' | 'one'
let shuffle  = false;
let shuffleQueue = [];

// Web Audio API — X/Y oscilloscope
let audioCtx    = null;
let analyser    = null;
let analyserL   = null;
let analyserR   = null;
let sourceNode  = null;
let animFrameId = null;

const views = [];

// ============================================================================
// INIT
// ============================================================================
export async function initMusicPlayer() {
    try {
        const res = await fetch('data/tracks.json');
        tracks = res.ok ? await res.json() : [];
    } catch { tracks = []; }

    renderInto(document.getElementById('panel-tape'));
    renderInto(document.getElementById('tape-drawer-output'));

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play',  () => { initAudioContext(); startScope(); });
    audio.addEventListener('pause', () => { stopScope(); });

    if (tracks.length) loadTrack(0);
}

// ============================================================================
// WEB AUDIO / X/Y OSCILLOSCOPE
// ============================================================================
function initAudioContext() {
    if (audioCtx) return;
    audioCtx  = new (window.AudioContext || window.webkitAudioContext)();
    analyser  = audioCtx.createAnalyser();
    analyser.fftSize = 2048;

    const splitter = audioCtx.createChannelSplitter(2);
    analyserL = audioCtx.createAnalyser(); analyserL.fftSize = 2048;
    analyserR = audioCtx.createAnalyser(); analyserR.fftSize = 2048;

    sourceNode = audioCtx.createMediaElementSource(audio);
    sourceNode.connect(splitter);
    splitter.connect(analyserL, 0);
    splitter.connect(analyserR, 1);
    sourceNode.connect(audioCtx.destination);
}

function startScope() {
    if (!analyserL || !analyserR) return;
    if (animFrameId) cancelAnimationFrame(animFrameId);

    const bufLen  = analyserL.fftSize;
    const dataL   = new Float32Array(bufLen);
    const dataR   = new Float32Array(bufLen);
    const drawSamples = 1024;

    function draw() {
        if (!playing) { stopScope(); return; }
        animFrameId = requestAnimationFrame(draw);
        analyserL.getFloatTimeDomainData(dataL);
        analyserR.getFloatTimeDomainData(dataR);

        views.forEach(container => {
            const canvas = container.querySelector('.tp-scope-canvas');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const W = canvas.width;
            const H = canvas.height;
            const cx = W / 2;
            const cy = H / 2;

            // Full clear each frame
            ctx.fillStyle = '#030a03';
            ctx.fillRect(0, 0, W, H);

            // Dotted grid — centre x/y only
            ctx.setLineDash([2, 4]);
            ctx.strokeStyle = 'rgba(0, 55, 0, 0.5)';
            ctx.lineWidth = 0.5;
            ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
            ctx.setLineDash([]);

            // X/Y rotated 45° — mono is horizontal
            const scaleX = 0.72;
            const scaleY = 1.1;
            const inv_sq2 = 1 / Math.SQRT2;

            const pts = [];
            for (let i = 0; i < drawSamples; i++) {
                const l = dataL[i];
                const r = dataR[i];
                pts.push({
                    x: cx + (l + r) * inv_sq2 * scaleX * cx,
                    y: cy - (r - l) * inv_sq2 * scaleY * cy
                });
            }

            for (let pass = 0; pass < 3; pass++) {
                ctx.beginPath();
                ctx.moveTo(pts[0].x, pts[0].y);
                for (let i = 1; i < pts.length - 1; i++) {
                    const mx = (pts[i].x + pts[i + 1].x) / 2;
                    const my = (pts[i].y + pts[i + 1].y) / 2;
                    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
                }
                ctx.strokeStyle = pass === 0
                    ? 'rgba(0, 255, 80, 0.06)'
                    : pass === 1
                    ? 'rgba(0, 255, 80, 0.55)'
                    : 'rgba(180, 255, 200, 0.85)';
                ctx.lineWidth = pass === 0 ? 4 : pass === 1 ? 1.2 : 0.6;
                ctx.stroke();
            }
        });
    }

    draw();
}

function stopScope() {
    if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }

    views.forEach(container => {
        const canvas = container.querySelector('.tp-scope-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    });
}

// ============================================================================
// ENDED HANDLER
// ============================================================================
function onEnded() {
    if (loopMode === 'one') {
        audio.currentTime = 0;
        audio.play();
        return;
    }
    const wasLast = !shuffle && current === tracks.length - 1;
    if (wasLast && loopMode === 'none') {
        playing = false;
        updateAllViews();
        return;
    }
    advanceTrack(1);
    playing = true;
    audio.play();
    updateAllViews();
}

// ============================================================================
// RENDER
// ============================================================================
function renderInto(container) {
    if (!container) return;
    views.push(container);

    if (!tracks.length) {
        container.innerHTML = `<div class="tape-player"><div class="tp-empty">// NO TRACKS LOADED //</div></div>`;
        return;
    }

    container.innerHTML = `
        <div class="tape-player">
            <div class="tp-cover-wrap">
                <img class="tp-cover-img" src="" alt="">
            </div>
            <div class="tp-track-info">
                <div class="tp-title">---</div>
                <div class="tp-artist">---</div>
                <div class="tp-album">---</div>
            </div>
            <div class="tp-mechanism">
                <div class="tp-reel tp-reel-l"></div>
                <div class="tp-tape-bridge"><div class="tp-tape-strand"></div></div>
                <div class="tp-reel tp-reel-r"></div>
            </div>
            <div class="tp-controls">
                <button class="tp-btn tp-shuffle">SHUFFLE</button>
                <button class="tp-btn tp-prev">PREV</button>
                <button class="tp-btn tp-play">[ &gt; ]</button>
                <button class="tp-btn tp-next">NEXT</button>
                <button class="tp-btn tp-loop">LOOP</button>
            </div>
            <div class="tp-progress-wrap">
                <div class="tp-progress-bar">
                    <div class="tp-progress-fill"></div>
                </div>
                <div class="tp-times">
                    <span class="tp-current">0:00</span>
                    <span class="tp-duration">0:00</span>
                </div>
            </div>
            <div class="tp-tracklist">
                ${tracks.map((t, i) => `
                    <div class="tp-track" data-index="${i}">
                        <span class="tp-track-num">${String(i + 1).padStart(2, '0')}.</span>
                        <span class="tp-track-name">${t.title}</span>
                        <span class="tp-track-dur">${t.duration}</span>
                    </div>
                `).join('')}
            </div>
            <div class="tp-scope">
                <canvas class="tp-scope-canvas" width="240" height="180"></canvas>
            </div>
        </div>
    `;

    wireControls(container);
}

function wireControls(container) {
    container.querySelector('.tp-play')?.addEventListener('click', togglePlay);
    container.querySelector('.tp-prev')?.addEventListener('click', () => { const wasPlaying = playing; advanceTrack(-1); if (wasPlaying) { audio.play(); playing = true; updateAllViews(); } });
    container.querySelector('.tp-next')?.addEventListener('click', () => { const wasPlaying = playing; advanceTrack(1);  if (wasPlaying) { audio.play(); playing = true; updateAllViews(); } });
    container.querySelector('.tp-shuffle')?.addEventListener('click', toggleShuffle);
    container.querySelector('.tp-loop')?.addEventListener('click', cycleLoop);

    container.querySelector('.tp-progress-bar')?.addEventListener('click', (e) => {
        if (!audio.duration) return;
        const rect = e.currentTarget.getBoundingClientRect();
        audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
    });

    container.querySelectorAll('.tp-track').forEach(row => {
        row.addEventListener('click', () => {
            const i = parseInt(row.dataset.index);
            loadTrack(i);
            audio.play();
            playing = true;
            updateAllViews();
        });
    });
}

// ============================================================================
// PLAYBACK
// ============================================================================
function loadTrack(index) {
    current   = index;
    audio.src = tracks[index].src;
    audio.load();
    playing   = false;
    updateAllViews();
}

function togglePlay() {
    if (!tracks.length) return;
    if (playing) { audio.pause(); playing = false; stopScope(); }
    else         { audio.play();  playing = true;  }
    updateAllViews();
}

// Advance by +1 or -1, respecting shuffle
function advanceTrack(dir) {
    if (shuffle) {
        if (shuffleQueue.length === 0) buildShuffleQueue();
        const next = shuffleQueue.shift();
        loadTrack(next);
    } else {
        const next = (current + dir + tracks.length) % tracks.length;
        loadTrack(next);
    }
}

// ============================================================================
// SHUFFLE
// ============================================================================
function buildShuffleQueue() {
    const indices = tracks.map((_, i) => i).filter(i => i !== current);
    for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    shuffleQueue = indices;
}

function toggleShuffle() {
    shuffle = !shuffle;
    shuffleQueue = [];
    if (shuffle) buildShuffleQueue();
    updateAllViews();
}

// ============================================================================
// LOOP
// ============================================================================
function cycleLoop() {
    if      (loopMode === 'none') loopMode = 'all';
    else if (loopMode === 'all')  loopMode = 'one';
    else                          loopMode = 'none';
    audio.loop = loopMode === 'one';
    updateAllViews();
}

// ============================================================================
// UPDATE ALL VIEWS
// ============================================================================
function updateAllViews() {
    const track = tracks[current];
    if (!track) return;

    const loopLabel = { none: 'LOOP', all: 'LOOP ALL', one: 'LOOP ONE' }[loopMode];

    views.forEach(container => {
        const cover   = container.querySelector('.tp-cover-img');
        const title   = container.querySelector('.tp-title');
        const artist  = container.querySelector('.tp-artist');
        const album   = container.querySelector('.tp-album');
        const btn     = container.querySelector('.tp-play');
        const reelL   = container.querySelector('.tp-reel-l');
        const reelR   = container.querySelector('.tp-reel-r');
        const dur     = container.querySelector('.tp-duration');
        const loopBtn = container.querySelector('.tp-loop');
        const rndBtn  = container.querySelector('.tp-shuffle');

        if (cover)  { cover.src = track.cover || ''; cover.alt = track.title; }
        if (title)  title.textContent  = track.title;
        if (artist) artist.textContent = track.artist;
        if (album)  album.textContent  = track.album;
        if (dur)    dur.textContent    = track.duration;

        if (btn) {
            btn.innerHTML = playing ? '[ || ]' : '[ &gt; ]';
            btn.classList.toggle('playing', playing);
        }

        if (reelL) reelL.classList.toggle('spinning', playing);
        if (reelR) reelR.classList.toggle('spinning', playing);

        if (loopBtn) {
            loopBtn.textContent = loopLabel;
            loopBtn.classList.toggle('active', loopMode !== 'none');
        }

        if (rndBtn) rndBtn.classList.toggle('active', shuffle);

        container.querySelectorAll('.tp-track').forEach((row, i) => {
            row.classList.toggle('active', i === current);
        });
    });
}

function onTimeUpdate() {
    const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
    views.forEach(container => {
        const fill = container.querySelector('.tp-progress-fill');
        const cur  = container.querySelector('.tp-current');
        if (fill) fill.style.width    = pct + '%';
        if (cur)  cur.textContent     = formatTime(audio.currentTime);
    });
}

function formatTime(secs) {
    if (!secs || isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}