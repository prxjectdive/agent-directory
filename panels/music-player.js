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

    if (tracks.length) loadTrack(0);
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
    audio.play();
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
                <button class="tp-btn tp-shuffle">[ SHUFFLE ]</button>
                <button class="tp-btn tp-prev">[ PREV ]</button>
                <button class="tp-btn tp-play">[ PLAY ]</button>
                <button class="tp-btn tp-next">[ NEXT ]</button>
                <button class="tp-btn tp-loop">[ LOOP ]</button>
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
        </div>
    `;

    wireControls(container);
}

function wireControls(container) {
    container.querySelector('.tp-play')?.addEventListener('click', togglePlay);
    container.querySelector('.tp-prev')?.addEventListener('click', () => { advanceTrack(-1); if (playing) audio.play(); });
    container.querySelector('.tp-next')?.addEventListener('click', () => { advanceTrack(1);  if (playing) audio.play(); });
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
    if (playing) { audio.pause(); playing = false; }
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

    const loopLabel = { none: '[ LOOP ]', all: '[ LOOP ALL ]', one: '[ LOOP ONE ]' }[loopMode];

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