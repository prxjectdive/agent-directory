# vendor/

Third-party code served from this repository instead of a CDN, so that the
executable surface of the site is fixed at whatever is committed here.

| Path | Package | Version | License |
|---|---|---|---|
| `three/` | [three](https://github.com/mrdoob/three.js) | 0.160.0 | MIT |
| `moonshine.min.js` | [@moonshine-ai/moonshine-js](https://github.com/moonshine-ai/moonshine-js) | 0.1.29 | MIT |
| `supertonic-helper.js` | Supertonic helper code | — | MIT (`SUPERTONIC-LICENSE`) |

## three/

Fetched from `https://cdn.jsdelivr.net/npm/three@0.160.0/`, following the static
import graph from the six entry points `panels/model-viewer.js` uses until it
closed — 10 files, ~1.4 MB.

```
build/three.module.js
examples/jsm/controls/OrbitControls.js
examples/jsm/loaders/GLTFLoader.js
examples/jsm/postprocessing/{EffectComposer,RenderPass,ShaderPass,MaskPass,Pass}.js
examples/jsm/shaders/CopyShader.js
examples/jsm/utils/BufferGeometryUtils.js
```

**One modification to upstream:** the seven addon files that imported the bare
specifier `'three'` now import `'../../../build/three.module.js'` instead:

```
sed -i "s|^} from 'three';$|} from '../../../build/three.module.js';|" <files>
```

That removes the need for an inline `<script type="importmap">` in
`index.html`, which in turn is what lets the CSP run `script-src 'self'` with
no inline allowance and no hash to keep in sync. Nothing else in these files
is changed. To upgrade three.js, re-fetch and re-apply that one substitution.

## moonshine.min.js

Speech-to-text, loaded on demand by `audio.js` when comms are enabled. It was
previously imported from jsDelivr at `@latest`, i.e. an unpinned third-party
script that could change at any time.

Vendoring pins the *script*. It does not make the feature self-contained — the
bundle has its asset hosts compiled in and still reaches out at runtime for:

- `https://download.moonshine.ai/` — Moonshine model weights
- `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/` — its own ORT build
- `https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@latest/` — voice activity
  detection, still unpinned inside the bundle

Those hosts are why `connect-src` and `script-src` in the CSP are not just
`'self'`. Removing them would mean forking moonshine-js.

## Not vendored

`onnxruntime-web@1.27.0`, imported by `tts-worker.js` from jsDelivr. The runtime
plus its SIMD WASM binaries run to tens of megabytes, and the Supertonic voice
models it loads are a further ~380 MB from Hugging Face that
[cannot be self-hosted here](../../SITE-NOTES.md) — so vendoring the runtime
alone would add substantial repository weight without making the voice feature
independent of third parties. It is version-pinned, which is the property that
matters: a pinned jsDelivr URL is immutable.
