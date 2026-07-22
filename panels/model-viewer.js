// ============================================================================
// MODEL VIEWER — Three.js 3D model panel with CRT post-processing
// ============================================================================
// Three.js is vendored under vendor/three/ — see vendor/three/README.md. Imports
// are relative rather than bare so the page needs no inline <script type="importmap">,
// which lets the CSP stay at script-src 'self' with no inline allowance.
import * as THREE from '../vendor/three/build/three.module.js';
import { OrbitControls } from '../vendor/three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from '../vendor/three/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from '../vendor/three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from '../vendor/three/examples/jsm/postprocessing/ShaderPass.js';

// ============================================================================
// MODEL REGISTRY — add agents here as models become available
// ============================================================================
export const MODEL_REGISTRY = {
    "D1-VE": "models/D1-VE.glb",
    // "X8-G":  "models/X8-G.glb",
    // "S-0L":  "models/S-0L.glb",
    // "SK-1N": "models/SK-1N.glb",
};

// ============================================================================
// STATE
// ============================================================================
let initialized    = false;
let renderer       = null;
let scene          = null;
let camera         = null;
let controls       = null;
let composer       = null;
let filmPass       = null;
let currentModel   = null;
let clock          = null;
let animFrameId    = null;
let wrapperEl      = null;
let loadToken      = 0;   // invalidates in-flight loads when the viewer is unloaded

// ============================================================================
// INIT — lazy, called once when the MODEL tab is first opened
// ============================================================================
export function initModelViewer(container) {
    if (initialized) { handleResize(); return; }
    initialized = true;
    clock = new THREE.Clock();

    container.style.flexDirection = 'column';
    container.style.gap           = '0';
    container.style.padding       = '1.5vw';
    container.style.overflow      = 'hidden';

    // -- Canvas wrapper (takes remaining space)
    wrapperEl = document.createElement('div');
    wrapperEl.style.cssText = 'position:relative; flex:1; min-height:0; overflow:hidden; background:#000;';

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:100%; height:100%; display:block;';
    wrapperEl.appendChild(canvas);

    // CRT scanline overlay
    const crt = document.createElement('div');
    crt.style.cssText = `
        position:absolute; top:0; left:0; right:0; bottom:0;
        pointer-events:none; z-index:2;
        background:
            linear-gradient(rgba(18,16,16,0) 50%, rgba(0,0,0,0.18) 50%),
            linear-gradient(90deg, rgba(255,255,255,0.01), rgba(255,255,255,0.005), rgba(255,255,255,0.01));
        background-size: 100% 3px, 3px 100%;
    `;
    wrapperEl.appendChild(crt);

    // Loading overlay
    const loadOverlay = document.createElement('div');
    loadOverlay.id = 'mv-load-overlay';
    loadOverlay.style.cssText = `
        position:absolute; top:0; left:0; right:0; bottom:0;
        display:flex; align-items:center; justify-content:center;
        background:#000; z-index:5;
        font-size:0.8em; color:#555; letter-spacing:2px; text-transform:uppercase;
    `;
    loadOverlay.style.display = 'none';
    wrapperEl.appendChild(loadOverlay);

    container.appendChild(wrapperEl);

    // -- Info bar
    const infoBar = document.createElement('div');
    infoBar.style.cssText = `
        flex-shrink:0; display:flex; justify-content:space-between; align-items:center;
        padding:8px 0 6px; font-size:0.75em; color:#555;
        text-transform:uppercase; letter-spacing:1px;
        border-top:1px dashed #1a1a1a; margin-top:6px;
    `;
    // Fixed markup, no interpolation — both spans are filled via textContent.
    infoBar.innerHTML = `
        <span id="mv-label">UNIT: NONE</span>
        <span id="mv-status">IDLE</span>
    `;
    container.appendChild(infoBar);



    // -- Controls hint
    const hint = document.createElement('div');
    hint.style.cssText = `
        flex-shrink:0; font-size:0.65em; color:#555;
        padding-top:8px; letter-spacing:1px; text-transform:uppercase;
    `;
    const onMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 850;
    hint.textContent = onMobile
        ? 'DRAG: ROTATE  //  PINCH: ZOOM  //  TWO-FINGER DRAG: PAN'
        : 'DRAG: ROTATE  //  SCROLL: ZOOM  //  RIGHT-DRAG: PAN';
    container.appendChild(hint);

    // ---- Three.js ----
    const W = wrapperEl.clientWidth  || 300;
    const H = wrapperEl.clientHeight || 300;

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ReinhardToneMapping;
    renderer.toneMappingExposure = 4.5;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    camera = new THREE.PerspectiveCamera(42, W / H, 0.01, 100);
    camera.position.set(0, 1, 12);

    // Hard overhead prison spotlight
    const spot = new THREE.SpotLight(0xffffff, 120);
    spot.position.set(0, 6, 0.5);
    spot.angle        = Math.PI / 7;
    spot.penumbra     = 0.2;
    spot.decay        = 2;
    spot.distance     = 3;
    spot.castShadow   = true;
    spot.shadow.mapSize.width  = 128;
    spot.shadow.mapSize.height = 128;
    spot.shadow.camera.near    = 1;
    spot.shadow.camera.far     = 30;
    spot.shadow.bias           = -0.0005;
    scene.add(spot);
    scene.add(spot.target);

    // Matte black floor
    const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(300, 300),
        new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1.0, metalness: 0.0 })
    );
    floor.rotation.x  = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // OrbitControls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping  = true;
    controls.dampingFactor  = 0.06;
    controls.minDistance    = 0.5;
    controls.maxDistance    = 10;
    controls.maxPolarAngle  = Math.PI / 2 - 0.02;
    controls.target.set(0, 1, 0);
    controls.update();

    // ---- Post-processing: B&W + chromatic aberration + grain + scanlines ----
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    filmPass = new ShaderPass({
        uniforms: {
            tDiffuse:   { value: null },
            time:       { value: 0.0 },
            resolution: { value: new THREE.Vector2(W, H) },
        },
        vertexShader: /* glsl */`
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: /* glsl */`
            uniform sampler2D tDiffuse;
            uniform float     time;
            uniform vec2      resolution;
            varying vec2      vUv;

            float rand(vec2 co) {
                return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
            }

            void main() {
                vec2 uv = vUv;

                // Base sample (no CA), used for grayscale
                vec3 base = texture2D(tDiffuse, uv).rgb;

                // Grayscale luminance from base
                float lum = base.r * 0.6 + base.g * 0.9 + base.b * 0.5;
                vec3 col  = vec3(lum);

                // Now compute chromatic aberration from the ORIGINAL color image
                float ca = 0.0055;
                vec3 colR = texture2D(tDiffuse, uv + vec2( ca, 0.0)).rgb;
                vec3 colG = texture2D(tDiffuse, uv).rgb;
                vec3 colB = texture2D(tDiffuse, uv + vec2(-ca, 0.0)).rgb;
                vec3 caColor = vec3(colR.r, colG.g, colB.b);

                // Difference between CA color and base color gives the fringe component
                vec3 caFringe = caColor - base;

                // Mix a small amount of color fringe into the grayscale image
                float fringeStrength = 0.4; // tweak this
                col += caFringe * fringeStrength;

                // Aggressive contrast — crush blacks to zero, blow highlights white
                col = (col - 0.3) * 1.0 + 0.3;
                col = clamp(col, 0.0, 1.0);

                // Film grain
                float grain = rand(uv + fract(time * 0.09)) - 0.5;
                col += grain * 0.045;

                // Scanlines — subtle horizontal banding
                float sl = sin(uv.y * resolution.y * 3.14159) * 0.5 + 0.5;
                col *= 0.93 + sl * 0.07;

                // Vignette
                vec2 vig = (uv - 0.5) * 2.0;
                float v  = 1.0 - dot(vig * 0.55, vig * 0.55);
                col *= clamp(v, 0.0, 1.0);

                gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
            }
        `
    });
    composer.addPass(filmPass);

    // Resize observer
    new ResizeObserver(handleResize).observe(wrapperEl);

    // Render loop
    (function animate() {
        animFrameId = requestAnimationFrame(animate);
        controls.update();
        if (filmPass) filmPass.uniforms.time.value = clock.getElapsedTime();
        composer.render();
    })();
}

// ============================================================================
// RESIZE
// ============================================================================
export function handleResize() {
    if (!renderer || !wrapperEl) return;
    const W = wrapperEl.clientWidth;
    const H = wrapperEl.clientHeight;
    if (!W || !H) return;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.setSize(W, H);
    composer.setSize(W, H);
    if (filmPass?.uniforms?.resolution) {
        filmPass.uniforms.resolution.value.set(W, H);
    }
}

// ============================================================================
// DISPOSE CURRENT MODEL
// ============================================================================
function disposeGltf(root) {
    root.traverse(child => {
        if (child.isMesh) {
            child.geometry?.dispose();
            if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
            else child.material?.dispose();
        }
    });
}

function disposeCurrentModel() {
    if (!currentModel) return;
    scene.remove(currentModel);
    disposeGltf(currentModel);
    currentModel = null;
}

// ============================================================================
// UNLOAD — return the viewer to its default empty state
// ============================================================================
export function unloadAgentModel() {
    loadToken++;              // any in-flight load is now stale
    if (!initialized) return;

    disposeCurrentModel();

    // Reset camera to the framing set up at init
    if (controls && camera) {
        controls.target.set(0, 1, 0);
        camera.position.set(0, 1, 12);
        controls.update();
    }

    // Reset UI chrome
    document.querySelectorAll('.mv-agent-btn').forEach(b => b.classList.remove('active'));
    const label   = document.getElementById('mv-label');
    const status  = document.getElementById('mv-status');
    const overlay = document.getElementById('mv-load-overlay');
    if (label)   label.textContent  = 'UNIT: NONE';
    if (status)  { status.textContent = 'IDLE'; status.style.color = '#555'; }
    if (overlay) overlay.style.display = 'none';
}

// ============================================================================
// LOAD MODEL
// ============================================================================
export async function loadAgentModel(agentId) {
    const path   = MODEL_REGISTRY[agentId];
    const label  = document.getElementById('mv-label');
    const status = document.getElementById('mv-status');
    const overlay = document.getElementById('mv-load-overlay');

    if (!path || !scene) return;

    // Update UI
    document.querySelectorAll('.mv-agent-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.agentId === agentId);
    });
    if (label)  label.textContent  = `UNIT: ${agentId}`;
    if (status) { status.textContent = 'SYNCING...'; status.style.color = '#ffaa00'; }
    if (overlay){ overlay.style.display = 'flex'; overlay.textContent = 'LOADING MODEL...'; }

    // Remove previous model
    disposeCurrentModel();

    const token  = ++loadToken;
    const loader = new GLTFLoader();
    try {
        const gltf = await new Promise((res, rej) => loader.load(path, res, undefined, rej));

        // Operator left the evaluation while this was downloading — drop it
        if (token !== loadToken) { disposeGltf(gltf.scene); return; }

        const model = gltf.scene;

        // Auto-scale and ground to floor
        const box    = new THREE.Box3().setFromObject(model);
        const size   = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale  = 5 / maxDim;

        model.scale.setScalar(scale);

        // Recompute after scaling
        const box2 = new THREE.Box3().setFromObject(model);
        const center2 = box2.getCenter(new THREE.Vector3());

        // Center X/Z only — keep Y so feet sit exactly on y=0 floor
        model.position.x -= center2.x;
        model.position.z -= center2.z;
        model.position.y -= box2.min.y;

        // Face toward camera
        model.rotation.y = Math.PI / 2;

        model.traverse(child => {
            if (child.isMesh) {
                child.castShadow    = true;
                child.receiveShadow = true;
                // Ensure material responds to lights
                if (child.material && child.material.isMeshBasicMaterial) {
                    child.material = new THREE.MeshStandardMaterial({
                        color: child.material.color,
                        map:   child.material.map,
                        roughness: 0.7,
                        metalness: 0.1,
                    });
                }
            }
        });

        scene.add(model);
        currentModel = model;

        // Place camera at max zoom-out distance
        const scaledH = size.y * scale;
        controls.target.set(0, scaledH * 0.48, 0);
        camera.position.set(0, scaledH * 0.5, controls.maxDistance);
        controls.update();

        if (overlay) overlay.style.display = 'none';
        if (status)  { status.textContent = 'LOADED'; status.style.color = '#a3ffaa'; }

    } catch (err) {
        if (token !== loadToken) return;   // stale failure — viewer already reset
        console.error('[MODEL VIEWER] Failed to load:', path, err);
        if (overlay) { overlay.style.display = 'flex'; overlay.textContent = 'ERROR: MODEL NOT FOUND'; }
        if (status)  { status.textContent = 'ERROR'; status.style.color = '#ff5555'; }
        if (label)   label.textContent = '// LOAD FAILED //';
    }
}