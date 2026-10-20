// Thornebury fitting-room viewer: a bare shop mannequin that dresses itself
// in whichever garments are ordered. Garments are drafted around the
// mannequin's own body hull, so they fit whatever figure the measurements describe.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const T = THREE;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const wrapPi = (a) => { a = ((a + Math.PI) % TAU + TAU) % TAU - Math.PI; return a; };
function pl(arr, t) {
  if (t <= arr[0][0]) return arr[0][1];
  for (let i = 0; i < arr.length - 1; i++) {
    const a = arr[i], b = arr[i + 1];
    if (t <= b[0]) return lerp(a[1], b[1], (t - a[0]) / (b[0] - a[0]));
  }
  return arr[arr.length - 1][1];
}

let dataP = null;
function loadData(base) {
  if (!dataP) {
    dataP = Promise.all([
      fetch(base + 'anatomy.json').then(r => { if (!r.ok) throw new Error('anatomy'); return r.json(); }),
      new GLTFLoader().loadAsync(base + 'mannequin.glb'),
      new GLTFLoader().loadAsync(base + 'g_shirt.glb').catch(() => null),
      null
    ]).catch(e => { dataP = null; throw e; });
  }
  return dataP;
}

// garment id -> pieces worn
const OUTFITS = {
  shirt: ['shirt'],
  pants: ['pants'],
  waistcoat: ['shirt', 'waistcoat'],
  coat: ['shirt', 'coat'],
  suit: ['shirt', 'coat', 'pants'],
  three: ['shirt', 'waistcoat', 'coat', 'pants']
};

class SuitViewer extends HTMLElement {
  static get observedAttributes() { return ['config']; }
  constructor() {
    super();
    this._cfg = null; this._yaw = 0.45; this._targetYaw = 0.45; this._auto = true;
    this._dragging = false; this._lastInteract = 0; this._dirty = true; this._visible = true;
  }
  set config(v) { this._setCfg(v); }
  get config() { return this._cfg; }
  attributeChangedCallback(n, o, v) { if (n === 'config') this._setCfg(v); }
  _setCfg(v) {
    let c;
    try { c = typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return; }
    if (!c) return;
    const prev = this._cfg;
    if (JSON.stringify(prev) === JSON.stringify(c)) return;
    this._cfg = c;
    if (!prev || prev.autoRotate !== c.autoRotate) this._auto = c.autoRotate !== false;
    if (prev && c.viewNonce !== prev.viewNonce && typeof c.viewYaw === 'number') {
      const k = Math.round((this._yaw - c.viewYaw) / TAU);
      this._targetYaw = c.viewYaw + k * TAU;
    }
    const geomKeys = ['garment', 'fabric', 'color', 'lapel', 'wcStyle', 'button', 'fit', 'pockets', 'lining', 'collar', 'cuff', 'heightM', 'weightKg', 'chestM', 'waistM', 'hipM', 'shoulderM', 'sleeveM', 'inseamM', 'openFront'];
    if (!prev || geomKeys.some(k => prev[k] !== c[k])) this._dirty = true;
  }
  connectedCallback() {
    Object.assign(this.style, { display: 'block', width: '100%', height: '100%', position: 'relative' });
    this._msg = document.createElement('div');
    Object.assign(this._msg.style, { position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '12px Karla, sans-serif', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#8c877c' });
    this._msg.textContent = 'Preparing fitting room…';
    this.appendChild(this._msg);
    const base = this.getAttribute('assets') || '/assets/';
    loadData(base).then(([A, gltf, gs, gw]) => { if (this.isConnected) this._init(A, gltf, { shirt: gs, waistcoat: gw }); })
      .catch(() => { this._msg.textContent = '3D preview unavailable'; });
  }
  disconnectedCallback() {
    cancelAnimationFrame(this._raf);
    if (this._ro) this._ro.disconnect();
    if (this._io) this._io.disconnect();
    if (this.renderer) { this.renderer.dispose(); this.renderer.domElement.remove(); this.renderer = null; }
  }

  _init(A, gltf, models) {
    if (this.renderer) return;
    this.A = A;
    // fitted garment models: one shared position/region set, one index list per part
    this.models = {};
    for (const [k, g] of Object.entries(models || {})) {
      if (!g) continue;
      const parts = [];
      g.scene.traverse(o => { if (o.isMesh) parts.push({ geo: o.geometry, part: (o.geometry.userData && o.geometry.userData.part) || o.name || '' }); });
      if (!parts.length) continue;
      const g0 = parts[0].geo;
      this.models[k] = { base: g0.getAttribute('position').array.slice(), region: g0.getAttribute('_region'), uv: g0.getAttribute('uv'),
        parts: parts.map(p => ({ part: p.part, index: p.geo.getIndex() })) };
    }
    // drape envelope: garments skim over the body instead of following every muscle
    const env = (G) => {
      const n = G.length, na = A.na, D = G.map((row, i) => row.map((_, j) => {
        let m = 0; for (let k = -3; k <= 3; k++) { const r = G[clamp(i + k, 0, n - 1)]; m = Math.max(m, r[j], r[(j + 1) % na], r[(j + na - 1) % na]); } return m;
      }));
      const lim = (A.armpitY - 0.04 - A.y0) / A.dy;
      return D.map((row, i) => row.map((_, j) => {
        let s = 0, w = 0; for (let k = -4; k <= 4; k++) { const ww = Math.exp(-k * k / 8); s += D[clamp(i + k, 0, n - 1)][j] * ww; w += ww; }
        const t = clamp((i - lim) / 5, 0, 1); // above the chest keep the true shoulder & neck line
        return lerp(s / w, G[i][j], t);
      }));
    };
    A.drape = env(A.hullTorso);
    // tailored cloth bridges the chest: wide angular smoothing so a coat front hangs flat, not over each pec
    A.drapeCoat = A.drape.map(row => row.map((r0, j) => {
      let s = 0, w = 0; for (let k = -7; k <= 7; k++) { const ww = Math.exp(-k * k / 18); s += row[(j + k + A.na) % A.na] * ww; w += ww; }
      return Math.max(s / w, r0 * 0.985);
    }));
    let src = null;
    gltf.scene.traverse(o => { if (o.isMesh && !src) src = o.geometry; });
    this._basePos = src.getAttribute('position').array.slice();
    this._region = src.getAttribute('_region');
    this._index = src.getIndex();

    const r = new T.WebGLRenderer({ antialias: true, alpha: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputColorSpace = T.SRGBColorSpace;
    r.toneMapping = T.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer = r;
    const cv = r.domElement;
    Object.assign(cv.style, { width: '100%', height: '100%', display: 'block', touchAction: 'pan-y', cursor: 'grab' });
    this._msg.remove();
    this.appendChild(cv);

    const scene = new T.Scene();
    this.scene = scene;
    this.camera = new T.PerspectiveCamera(28, 1, 0.05, 50);
    scene.add(new T.HemisphereLight(0xfff6ea, 0x4a4033, 1.0));
    const key = new T.DirectionalLight(0xfff0dc, 2.3);
    key.position.set(1.8, 3.4, 2.8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -1.0, right: 1.0, top: 2.3, bottom: -0.2, near: 0.5, far: 9 });
    key.shadow.bias = -0.0003; key.shadow.normalBias = 0.015;
    scene.add(key);
    const fill = new T.DirectionalLight(0xdfe6ff, 0.75); fill.position.set(-3, 2, 1.5); scene.add(fill);
    const rim = new T.DirectionalLight(0xffffff, 1.2); rim.position.set(-0.5, 2.6, -3); scene.add(rim);

    const plinth = new T.Mesh(new T.CylinderGeometry(0.42, 0.45, 0.04, 72), new T.MeshStandardMaterial({ color: 0xe2d9c9, roughness: 0.85 }));
    plinth.position.y = 0.02; plinth.receiveShadow = true;
    scene.add(plinth);
    const ground = new T.Mesh(new T.CircleGeometry(1.4, 64), new T.ShadowMaterial({ opacity: 0.12 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    scene.add(ground);

    this.rig = new T.Group();
    scene.add(this.rig);
    this._camY = 0.9; this._camD = 4.4;

    cv.addEventListener('pointerdown', e => {
      this._dragging = true; this._lastX = e.clientX; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing';
    });
    cv.addEventListener('pointermove', e => {
      if (!this._dragging) return;
      const dx = e.clientX - this._lastX; this._lastX = e.clientX;
      this._targetYaw += dx * 0.012; this._yaw = this._targetYaw;
    });
    const end = () => { this._dragging = false; this._lastInteract = performance.now(); cv.style.cursor = 'grab'; };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);

    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(this);
    this._io = new IntersectionObserver(es => { this._visible = es[0].isIntersecting; });
    this._io.observe(this);
    this._resize();
    this._last = performance.now();
    const loop = (now) => {
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this._last) / 1000); this._last = now;
      if (!this._visible) return;
      if (this._dirty) { this._dirty = false; this._build(); }
      if (this._auto && !this._dragging && now - this._lastInteract > 2500) this._targetYaw += dt * 0.36;
      this._yaw += (this._targetYaw - this._yaw) * Math.min(1, dt * 5);
      this.rig.rotation.y = this._yaw;
      const f = this._frame || { H: 1.8, chestY: 1.3 };
      const close = this._cfg && this._cfg.closeUp;
      const ty = close ? f.chestY + 0.02 : f.H * 0.52;
      const td = close ? 1.45 : f.H * 2.35 + 0.2;
      this._camY += (ty - this._camY) * Math.min(1, dt * 4);
      this._camD += (td - this._camD) * Math.min(1, dt * 4);
      this.camera.position.set(0, this._camY + this._camD * 0.05, this._camD);
      this.camera.lookAt(0, this._camY, 0);
      this.renderer.render(this.scene, this.camera);
    };
    this._raf = requestAnimationFrame(loop);
  }
  _resize() {
    if (!this.renderer) return;
    const w = this.clientWidth || 300, h = this.clientHeight || 400;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.62 ? 34 : 28;
    this.camera.updateProjectionMatrix();
  }

  _tex(kind, rep) {
    this._texCache = this._texCache || {};
    if (rep) { const key = kind + '@' + rep; if (!this._texCache[key]) { const t = this._tex(kind).clone(); t.repeat.set(rep, rep); t.needsUpdate = true; this._texCache[key] = t; } return this._texCache[key]; }
    if (this._texCache[kind]) return this._texCache[kind];
    const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const x = cv.getContext('2d');
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    x.fillStyle = kind === 'silk' ? '#6a2433' : '#ffffff'; x.fillRect(0, 0, S, S);
    const diag = (step, w, a) => {
      x.strokeStyle = 'rgba(0,0,0,' + a + ')'; x.lineWidth = w;
      for (let i = -S; i < S * 2; i += step) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + S, S); x.stroke(); }
    };
    if (kind === 'wool') diag(8, 2, 0.09);
    if (kind === 'cotton' || kind === 'twill') diag(12, 4, 0.12);
    if (kind === 'oxford') {
      for (let i = 0; i < S; i += 4) { x.fillStyle = 'rgba(0,0,0,0.07)'; x.fillRect(0, i, S, 2); x.fillRect(i, 0, 2, S); }
    }
    if (kind === 'poplin') { for (let i = 0; i < S; i += 3) { x.fillStyle = 'rgba(0,0,0,0.035)'; x.fillRect(0, i, S, 1); } }
    if (kind === 'linen' || kind === 'shirtlinen') {
      for (let i = 0; i < 260; i++) {
        const a = 0.03 + rnd() * 0.1; x.fillStyle = 'rgba(0,0,0,' + a + ')';
        if (rnd() > 0.5) x.fillRect(0, Math.floor(rnd() * S), S, 1 + Math.floor(rnd() * 2));
        else x.fillRect(Math.floor(rnd() * S), 0, 1 + Math.floor(rnd() * 2), S);
      }
    }
    if (kind === 'silk') {
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const cx = c * 32 + (r % 2 ? 16 : 0) + 8, cy = r * 32 + 8;
        x.fillStyle = '#c9a25e'; x.beginPath(); x.arc(cx % S, cy, 3.2, 0, TAU); x.fill();
        x.strokeStyle = 'rgba(201,162,94,0.55)'; x.lineWidth = 1.2; x.beginPath(); x.arc(cx % S, cy, 8, 0, TAU); x.stroke();
      }
    }
    if (kind !== 'silk') {
      for (let i = 0; i < 3500; i++) { x.fillStyle = 'rgba(0,0,0,' + (rnd() * (kind === 'blend' ? 0.04 : 0.05)) + ')'; x.fillRect(rnd() * S, rnd() * S, 1, 1); }
    }
    const t = new T.CanvasTexture(cv);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.repeat.set(kind === 'silk' ? 8 : 6, kind === 'silk' ? 8 : 6);
    t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = 8;
    this._texCache[kind] = t;
    return t;
  }

  // ---------- body frame: maps the base mannequin onto the customer's figure
  _frameFor(c) {
    const A = this.A;
    const H = clamp(c.heightM || 1.78, 1.45, 2.12);
    const Wt = clamp(c.weightKg || 78, 40, 180);
    const g = clamp(Math.sqrt(Wt / (H * H) / 24.2), 0.8, 1.45);
    const hs = H / A.H, u = Math.sqrt(hs);
    const row = (grid, y) => grid[clamp(Math.round((y - A.y0) / A.dy), 0, grid.length - 1)];
    const perim = (y) => {
      const r = row(A.hullTorso, y); let p = 0;
      for (let i = 0; i < A.na; i++) {
        const a0 = i / A.na * TAU, a1 = (i + 1) / A.na * TAU, r0 = r[i], r1 = r[(i + 1) % A.na];
        p += Math.hypot(r1 * Math.sin(a1) - r0 * Math.sin(a0), r1 * Math.cos(a1) - r0 * Math.cos(a0));
      }
      return p;
    };
    const chestB = perim(A.chestY) * u, waistB = perim(A.waistY) * u, hipB = perim(A.hipY) * u;
    const chest = clamp(c.chestM || 0.99 * g * Math.sqrt(hs), 0.7, 1.7);
    const waist = clamp(c.waistM || 0.84 * Math.pow(g, 1.8) * Math.sqrt(hs), 0.56, 1.65);
    const hip = clamp(c.hipM || 0.99 * Math.pow(g, 1.15) * Math.sqrt(hs), 0.7, 1.7);
    const shoulder = clamp(c.shoulderM || 0.46 * Math.sqrt(hs) * Math.pow(g, 0.3), 0.36, 0.62);
    const fC = clamp(chest / chestB, 0.72, 1.7), fW0 = clamp(waist / waistB, 0.68, 2.1), fH = clamp(hip / hipB, 0.72, 1.7);
    // waist beyond the chest/hip line grows forward as a belly instead of widening evenly
    const fW = Math.min(fW0, Math.max(fC, fH) * 1.02);
    const bellyK = clamp((fW0 / fW - 1) / 0.42, 0, 1.0);
    const shBase = 2 * (A.shoulder[0] + 0.02) * u;
    const fS = clamp(shoulder / shBase, 0.8, 1.35);
    const neckF = 1 + (fC - 1) * 0.35;
    const cr = A.crotchY, nk = A.neckY;
    const FX = [[cr - 0.12, fH], [A.hipY, fH], [A.waistY, fW], [A.chestY, fC], [A.armpitY + 0.04, (fC + fS) / 2], [A.shoulder[1], fS], [nk - 0.02, neckF], [nk + 0.03, 1]];
    const FZ = [[cr - 0.12, fH], [A.hipY, fH], [A.waistY, fW], [A.chestY, fC], [A.shoulder[1], (fC + 1) / 2], [nk - 0.02, neckF], [nk + 0.03, 1]];
    // vertical mapping: legs by inseam, torso to neck by height, head by u
    const crotchT = clamp(c.inseamM ? c.inseamM + 0.02 : cr * hs, 0.40 * H, 0.53 * H);
    const neckT = nk * hs;
    const kL = crotchT / cr, kT = (neckT - crotchT) / (nk - cr);
    const Y = (y) => y <= cr ? y * kL : (y <= nk ? crotchT + (y - cr) * kT : neckT + (y - nk) * u);
    const Yinv = (w) => w <= crotchT ? w / kL : (w <= neckT ? cr + (w - crotchT) / kT : nk + (w - neckT) / u);
    const fx = (y) => pl(FX, y), fz = (y) => pl(FZ, y);
    const kA = u * Math.pow(g, 0.55), kLg = u * Math.pow(g, 0.6) * Math.sqrt(fH);
    const dxA = A.shoulder[0] * (u * fS - 1);
    const dxL = 0.095 * (u * fH - 1);
    const bellyY = A.waistY - 0.01;
    const belly = (yb, c) => c <= 0 || bellyK <= 0 ? 1 : 1 + bellyK * Math.exp(-Math.pow((yb - bellyY) / (yb < bellyY ? 0.14 : 0.17), 2)) * Math.pow(c, 1.25);
    const fr = { A, H, g, hs, u, fx, fz, Y, Yinv, kA, kLg, dxA, dxL, crotchT, kL, belly, bellyK };
    // deformed limb chains
    const chainDef = (ch, isArm) => ch.map(p => {
      const s = Math.sign(p[0]) || 1;
      return { p: new T.Vector3(p[0] * u + s * (isArm ? dxA + A.shoulder[0] * (1 - u) * 0 : dxL), Y(p[1]), p[2] * u), r: p[3] * (isArm ? kA : kLg), b: p };
    });
    fr.arms = [chainDef(A.armL, true), chainDef(A.armR, true)];
    fr.legs = [chainDef(A.legL, false), chainDef(A.legR, false)];
    // arms clear a wider body: where hips/waist widen, the lower arm swings outward so hands never sink in
    const hr = (yb, th) => {
      const G = A.hullTorso, fy = clamp((yb - A.y0) / A.dy, 0, G.length - 1.001), i = Math.floor(fy), t = fy - i;
      const fa = (((th / TAU) % 1) + 1) % 1 * A.na, j = Math.floor(fa) % A.na, j2 = (j + 1) % A.na, s2 = fa - Math.floor(fa);
      return lerp(lerp(G[i][j], G[i][j2], s2), lerp(G[i + 1][j], G[i + 1][j2], s2), t);
    };
    fr.arms.forEach(chn => {
      // swing the whole arm out from the shoulder (a rotation), by the least angle that clears the body
      const s = Math.sign(chn[chn.length - 1].p.x) || 1, j0 = chn[0].p.clone();
      let ratio = 0;
      chn.forEach(q => {
        const yb = Yinv(q.p.y), dist = j0.distanceTo(q.p);
        if (yb < A.waistY + 0.04 && yb > A.y0 && dist > 0.2) {
          const side = hr(yb, s * Math.PI / 2) * u * fx(yb);
          ratio = Math.max(ratio, (side + q.r * 0.9 + 0.012 - Math.abs(q.p.x)) / dist);
        }
      });
      if (ratio > 0) {
        const ang = Math.min(Math.atan(ratio), 0.3), ax = new T.Vector3(0, 0, 1), rot = new T.Quaternion().setFromAxisAngle(ax, s * ang);
        chn.forEach(q => { q.p.sub(j0).applyQuaternion(rot).add(j0); });
      }
    });
    fr.Hfinal = Y(A.H);
    return fr;
  }

  _deformMannequin(fr) {
    const out = this._deformPositions(fr, this._basePos, this._region);
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(out, 3));
    geo.setIndex(this._index);
    geo.computeVertexNormals();
    return geo;
  }
  _deformPositions(fr, src, reg) {
    const A = this.A, n = src.length / 3, out = new Float32Array(src.length);
    const nearest = (chains, x, y, z) => {
      const ch = x >= 0 ? chains[0] : chains[1];
      let best = 0, bd = 1e9;
      for (let k = 0; k < ch.length; k++) {
        const b = ch[k].b, d = (b[0] - x) ** 2 + (b[1] - y) ** 2 + (b[2] - z) ** 2;
        if (d < bd) { bd = d; best = k; }
      }
      return ch[best];
    };
    for (let i = 0; i < n; i++) {
      const x = src[i * 3], y = src[i * 3 + 1], z = src[i * 3 + 2];
      const wa = reg.getX(i) / (reg.normalized ? 1 : 255), wl = reg.getY(i) / (reg.normalized ? 1 : 255);
      const wt = Math.max(0, 1 - wa - wl);
      let ox = 0, oy = 0, oz = 0;
      if (wt > 0) {
        const rr = Math.hypot(x, z) || 1;
        const tx = x * fr.u * fr.fx(y), tz = z * fr.u * fr.fz(y) * fr.belly(y, z / rr), ty = fr.Y(y);
        ox += wt * tx; oy += wt * ty; oz += wt * tz;
      }
      if (wa > 0) {
        const c = nearest(fr.arms, x, y, z), b = c.b, k = fr.kA;
        ox += wa * (c.p.x + (x - b[0]) * k); oy += wa * (c.p.y + (y - b[1]) * k); oz += wa * (c.p.z + (z - b[2]) * k);
      }
      if (wl > 0) {
        const c = nearest(fr.legs, x, y, z), b = c.b, k = fr.kLg;
        ox += wl * (c.p.x + (x - b[0]) * k); oy += wl * (c.p.y + (y - b[1]) * fr.kL); oz += wl * (c.p.z + (z - b[2]) * k);
      }
      out[i * 3] = ox; out[i * 3 + 1] = oy; out[i * 3 + 2] = oz;
    }
    return out;
  }

  _build() {
    const c = this._cfg || {};
    if (this.model) {
      this.rig.remove(this.model);
      this.model.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); });
    }
    const M = new T.Group(); M.position.y = 0.04; this.model = M; this.rig.add(M);
    const add = (geo, mat, parent) => { const m = new T.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; (parent || M).add(m); return m; };

    const fr = this._frameFor(c), A = this.A;
    this._frame = { H: fr.Hfinal + 0.04, chestY: fr.Y(A.chestY) + 0.04 };

    // mannequin: warm ivory fibreglass
    const body = add(this._deformMannequin(fr), new T.MeshPhysicalMaterial({ color: 0xece6db, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.35, sheen: 0.2, sheenColor: new T.Color(0xffffff) }));

    if (c.hideBody) body.visible = false;
    // display stand (after the store mannequin): steel calf rod on a brushed disc
    {
      const steel = new T.MeshStandardMaterial({ color: 0xb8b9bb, metalness: 0.9, roughness: 0.32 });
      const leg = fr.legs[1], k = Math.floor(leg.length * 0.72), p = leg[k].p;
      const rod = add(new T.CylinderGeometry(0.009, 0.009, p.y, 20), steel);
      rod.position.set(p.x, p.y / 2 - 0.02, p.z - leg[k].r - 0.006);
      const cup = add(new T.CylinderGeometry(0.016, 0.016, 0.05, 20), steel);
      cup.position.set(p.x, p.y - 0.02, p.z - leg[k].r - 0.004);
      const disc = add(new T.CylinderGeometry(0.2, 0.21, 0.012, 64), steel);
      disc.position.set(0, 0.006, 0);
    }
    const pieces = OUTFITS[c.garment] || [];
    if (!pieces.length) return;
    const wear = (p) => pieces.includes(p);
    const fit = c.fit || 'regular';

    // ---- materials
    const shirtMain = c.garment === 'shirt';
    const kind = c.fabric || 'wool';
    const col = new T.Color(c.color || '#1c2a44');
    const white = new T.Color('#ffffff');
    const rough = { wool: 0.8, cotton: 0.92, linen: 0.96, blend: 0.5, poplin: 0.78, oxford: 0.9, twill: 0.82, shirtlinen: 0.95 }[kind] ?? 0.85;
    const fabMat = (mul, side) => new T.MeshPhysicalMaterial({
      color: col.clone().multiplyScalar(mul || 1), map: this._tex(kind), roughness: rough,
      sheen: kind === 'blend' ? 0.45 : 0.8, sheenRoughness: 0.6, sheenColor: col.clone().lerp(white, 0.35),
      side: side || T.FrontSide
    });
    const shirtCol = shirtMain ? col : new T.Color('#f3f1ea');
    const shirtMat = (mul) => new T.MeshPhysicalMaterial({
      color: shirtCol.clone().multiplyScalar(mul || 1), map: this._tex(shirtMain ? kind : 'poplin'), roughness: 0.78,
      sheen: 0.5, sheenRoughness: 0.5, sheenColor: shirtCol.clone().lerp(white, 0.4), side: T.DoubleSide
    });
    const darkMat = (base) => new T.MeshStandardMaterial({ color: (base || col).clone().multiplyScalar(0.35), roughness: 0.9, side: T.DoubleSide });
    const liningMat = (side) => {
      const l = c.lining || 'bemberg';
      if (l === 'silk') return new T.MeshPhysicalMaterial({ color: 0xffffff, map: this._tex('silk'), roughness: 0.3, sheen: 0.4, side });
      if (l === 'none') return fabMat(0.8, side);
      return new T.MeshPhysicalMaterial({ color: col.clone().lerp(new T.Color('#c2a074'), 0.5), roughness: 0.32, sheen: 0.5, sheenColor: new T.Color('#fff1d8'), side });
    };
    const btnMat = () => {
      const b = c.button || 'horn';
      if (b === 'pearl') return new T.MeshPhysicalMaterial({ color: 0xece6da, roughness: 0.15, iridescence: 0.7, clearcoat: 0.6 });
      if (b === 'corozo') return new T.MeshStandardMaterial({ color: 0x7a5a3c, roughness: 0.45 });
      return new T.MeshStandardMaterial({ color: 0x2b1f17, roughness: 0.3 });
    };

    // =====================================================================
    //  Runtime body measurement: every garment is built on the *actual*
    //  reshaped mannequin (and the layers beneath it), so nothing can poke
    //  through at any height, weight or belly size.
    // =====================================================================
    const czAt = (yb) => {
      const fy = clamp((yb - A.y0) / A.dy, 0, A.cz.length - 1.001), i = Math.floor(fy);
      return lerp(A.cz[i], A.cz[i + 1], fy - i) * fr.u;
    };
    const czW = (yw) => czAt(fr.Yinv(yw));
    const NA = 72, gdy = 0.01;
    const gy0 = fr.Y(A.crotchY) - 0.15;
    const gny = Math.ceil((fr.Y(A.neckY) + 0.14 - gy0) / gdy) + 1;
    const hull2 = (pts) => {
      pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      const lo = [], up = [];
      for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
      for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
      return lo.slice(0, -1).concat(up.slice(0, -1));
    };
    const rayHull = (poly, a) => {
      const dx = Math.sin(a), dz = Math.cos(a); let best = 0;
      for (let k = 0; k < poly.length; k++) {
        const p = poly[k], q = poly[(k + 1) % poly.length], ex = q[0] - p[0], ez = q[1] - p[1];
        const det = dx * (-ez) - dz * (-ex); if (Math.abs(det) < 1e-12) continue;
        const s = (p[0] * (-ez) - p[1] * (-ex)) / det, u = (dx * p[1] - dz * p[0]) / det;
        if (s > 0 && u >= -1e-6 && u <= 1 + 1e-6) best = Math.max(best, s);
      }
      return best;
    };
    const gridFrom = (pos, keep) => {
      const mx = new Float32Array(gny * NA);
      for (let i = 0, k = 0; i < pos.length; i += 3, k++) {
        if (!keep(k)) continue;
        const y = pos[i + 1], row = Math.round((y - gy0) / gdy);
        if (row < -1 || row > gny) continue;
        const cz = czW(y), x = pos[i], z = pos[i + 2] - cz, r = Math.hypot(x, z);
        let j = Math.round(Math.atan2(x, z) / TAU * NA); j = ((j % NA) + NA) % NA;
        for (let rr = row - 1; rr <= row + 1; rr++) if (rr >= 0 && rr < gny) { const q = rr * NA + j; if (r > mx[q]) mx[q] = r; }
      }
      const out = new Float32Array(gny * NA), have = new Uint8Array(gny);
      for (let row = 0; row < gny; row++) {
        const pts = [];
        for (let j = 0; j < NA; j++) { const r = mx[row * NA + j]; if (r > 0) { const a = j / NA * TAU; pts.push([Math.sin(a) * r, Math.cos(a) * r]); } }
        if (pts.length < 3) continue;
        const hp = hull2(pts); have[row] = 1;
        for (let j = 0; j < NA; j++) out[row * NA + j] = rayHull(hp, j / NA * TAU);
      }
      let last = -1;
      for (let row = 0; row < gny; row++) { if (have[row]) last = row; else if (last >= 0) out.set(out.subarray(last * NA, last * NA + NA), row * NA); }
      let first = have.indexOf(1);
      for (let row = 0; row < first; row++) out.set(out.subarray(first * NA, first * NA + NA), row * NA);
      return out;
    };
    const gSample = (g, yw, th) => {
      const fy = clamp((yw - gy0) / gdy, 0, gny - 1.001), i = Math.floor(fy), t = fy - i;
      const fa = (((th / TAU) % 1) + 1) % 1 * NA, j = Math.floor(fa) % NA, j2 = (j + 1) % NA, s = fa - Math.floor(fa);
      return lerp(lerp(g[i * NA + j], g[i * NA + j2], s), lerp(g[(i + 1) * NA + j], g[(i + 1) * NA + j2], s), t);
    };
    const gMax = (a, b) => { const o = new Float32Array(a.length); for (let k = 0; k < a.length; k++) o[k] = Math.max(a[k], b[k]); return o; };
    const rowOf = (yw) => clamp(Math.round((yw - gy0) / gdy), 0, gny - 1);
    // cloth bridges hollows: dilate, smooth; keep the true shoulder/neck line above the chest
    const gDrape = (g) => {
      const D1 = new Float32Array(g.length), o = new Float32Array(g.length);
      for (let i = 0; i < gny; i++) for (let j = 0; j < NA; j++) {
        let m = 0; for (let k = -3; k <= 3; k++) { const r = clamp(i + k, 0, gny - 1) * NA; m = Math.max(m, g[r + j], g[r + (j + 1) % NA], g[r + (j + NA - 1) % NA]); }
        D1[i * NA + j] = m;
      }
      const lim = rowOf(fr.Y(A.armpitY - 0.04));
      for (let i = 0; i < gny; i++) for (let j = 0; j < NA; j++) {
        let s = 0, w = 0; for (let k = -4; k <= 4; k++) { const ww = Math.exp(-k * k / 8); s += D1[clamp(i + k, 0, gny - 1) * NA + j] * ww; w += ww; }
        o[i * NA + j] = Math.max(lerp(s / w, g[i * NA + j], clamp((i - lim) / 5, 0, 1)), g[i * NA + j]);
      }
      return o;
    };
    const gAng = (g, k0) => {
      const o = new Float32Array(g.length);
      for (let i = 0; i < gny; i++) for (let j = 0; j < NA; j++) {
        let s = 0, w = 0; for (let k = -k0; k <= k0; k++) { const ww = Math.exp(-k * k / (k0 * k0 / 2.5)); s += g[i * NA + (j + k + NA) % NA] * ww; w += ww; }
        o[i * NA + j] = Math.max(s / w, g[i * NA + j]);
      }
      return o;
    };
    // a front that hangs: below the chest the cloth falls straight over the belly instead of tucking under it
    const gDrop = (g, fromW, toW, taper) => {
      const o = g.slice(), r0 = rowOf(fromW), r1 = rowOf(toW);
      for (let j = 0; j < NA; j++) {
        const a = Math.abs(wrapPi(j / NA * TAU)), f = sstep(1.75, 0.9, a);
        if (f <= 0) continue;
        for (let i = r0 - 1; i >= r1; i--) {
          const hang = o[(i + 1) * NA + j] - taper * gdy;
          o[i * NA + j] = Math.max(o[i * NA + j], lerp(o[i * NA + j], hang, f));
        }
      }
      return o;
    };
    // surface point on a grid: yb is the base-mannequin height, th the angle (0 = front)
    const S = (g, yb, th, off) => {
      const yw = fr.Y(yb), R = gSample(g, yw, th) + off, cz = czW(yw);
      return [Math.sin(th) * R, yw, Math.cos(th) * R + cz];
    };
    const Sw = (g, yw, th, off) => { const R = gSample(g, yw, th) + off; return [Math.sin(th) * R, yw, Math.cos(th) * R + czW(yw)]; };
    const radAt = (g, yb, th, off) => gSample(g, fr.Y(yb), th) + off;
    // push torso vertices of a mesh outside a grid
    // push torso vertices outside a grid with a smooth per-bin field, so double-layered cloth keeps its thickness
    const clearOf = (pos, reg, g, gap) => {
      const need = new Float32Array(gny * NA), rows = [], bins = [], rs = [];
      const wts = [];
      for (let i = 0, k = 0; i < pos.length; i += 3, k++) {
        rows.push(-1); bins.push(0); rs.push(0);
        const wa = reg ? reg.getX(k) : 0, wl = reg ? reg.getY(k) : 0;
        wts.push(clamp(1.8 * (1 - Math.max(wa, wl)), 0, 1));
        const y = pos[i + 1]; if (y < gy0 || y > gy0 + gdy * (gny - 1)) continue;
        const cz = czW(y), x = pos[i], z = pos[i + 2] - cz, r = Math.hypot(x, z), th = Math.atan2(x, z);
        const row = rowOf(y); let j = Math.round(th / TAU * NA); j = ((j % NA) + NA) % NA;
        rows[k] = row; bins[k] = j; rs[k] = r;
        if (wa > 0.5 || wl > 0.5) continue;
        const d = gSample(g, y, th) + gap - r;
        if (d > need[row * NA + j]) need[row * NA + j] = d;
      }
      const sm = new Float32Array(gny * NA);
      for (let i = 0; i < gny; i++) for (let j = 0; j < NA; j++) {
        let m = 0; for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) { const ii = clamp(i + a, 0, gny - 1); m = Math.max(m, need[ii * NA + (j + b + NA) % NA] * (1 - 0.15 * (Math.abs(a) + Math.abs(b)))); }
        sm[i * NA + j] = m;
      }
      for (let i = 0, k = 0; i < pos.length; i += 3, k++) {
        if (rows[k] < 0) continue;
        const push = sm[rows[k] * NA + bins[k]] * wts[k]; if (push <= 0) continue;
        const y = pos[i + 1], cz = czW(y), x = pos[i], z = pos[i + 2] - cz, r = rs[k] || 1e-6, kk = (r + push) / r;
        pos[i] = x * kk; pos[i + 2] = z * kk + cz;
      }
    };
    const bodyPos = body.geometry.getAttribute('position').array, bReg = this._region;
    const isTorso = (reg) => (k) => (reg.getX(k) / (reg.normalized ? 1 : 255)) < 0.5;
    const gBody = gridFrom(bodyPos, isTorso(bReg));

    // ---------- geometry helpers ----------
    const shellGeo = (o) => {
      const { grid, ny, nt } = o, rot = o.rot || 0;
      const y0f = typeof o.y0 === 'function' ? o.y0 : () => o.y0, y1f = typeof o.y1 === 'function' ? o.y1 : () => o.y1;
      const af = o.a || (() => 0), off = typeof o.off === 'function' ? o.off : () => (o.off || 0);
      const pos = [], uv = [], idx = [];
      for (let i = 0; i <= ny; i++) {
        const v = i / ny;
        for (let j = 0; j <= nt; j++) {
          const u = j / nt, th0 = lerp(0, TAU, u) + rot;
          let yb = lerp(y0f(th0), y1f(th0), v);
          const a = af(yb), th = lerp(a, TAU - a, u) + rot;
          yb = lerp(y0f(th), y1f(th), v);
          const p = S(grid, yb, th, off(yb, th));
          pos.push(p[0], p[1], p[2]); uv.push(th * 0.16, p[1]);
        }
      }
      for (let i = 0; i < ny; i++) for (let j = 0; j < nt; j++) { const a = i * (nt + 1) + j, b = a + 1, cc = a + nt + 1, d = cc + 1; idx.push(a, b, cc, b, d, cc); }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.computeVertexNormals(); return geo;
    };
    const normalAt = (grid, yb, th, off) => {
      const e = 0.003, p = new T.Vector3(...S(grid, yb, th, off));
      const pu = new T.Vector3(...S(grid, yb, th + e, off)).sub(p), pv = new T.Vector3(...S(grid, yb + e, th, off)).sub(p);
      return { p, n: pu.cross(pv).normalize().negate() };
    };
    const placeOn = (mesh, grid, yb, th, off) => {
      const { p, n } = normalAt(grid, yb, th, off);
      if (n.dot(new T.Vector3(p.x, 0, p.z - czAt(yb))) < 0) n.negate();
      mesh.position.copy(p); mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), n);
    };
    const tubeGeo = (pts, seg) => {
      seg = seg || 32;
      const pos = [], uv = [], idx = [], n = pts.length;
      let prevN = null;
      for (let i = 0; i < n; i++) {
        const a = pts[Math.max(0, i - 1)].p, b = pts[Math.min(n - 1, i + 1)].p;
        const tg = new T.Vector3().subVectors(b, a).normalize();
        const nn = prevN ? prevN.clone().sub(tg.clone().multiplyScalar(prevN.dot(tg))).normalize() : new T.Vector3(0, 0, 1).sub(tg.clone().multiplyScalar(tg.z)).normalize();
        prevN = nn;
        const bn = new T.Vector3().crossVectors(tg, nn);
        for (let j = 0; j <= seg; j++) {
          const th = j / seg * TAU, cs = Math.cos(th), sn = Math.sin(th), r = pts[i].r, rx = pts[i].rx || r;
          pos.push(pts[i].p.x + nn.x * cs * r + bn.x * sn * rx, pts[i].p.y + nn.y * cs * r + bn.y * sn * rx, pts[i].p.z + nn.z * cs * r + bn.z * sn * rx);
          uv.push(th * 0.05, pts[i].p.y);
        }
      }
      for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) { const a = i * (seg + 1) + j, b = a + 1, cc = a + seg + 1, d = cc + 1; idx.push(a, b, cc, b, d, cc); }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.computeVertexNormals(); return geo;
    };
    const chainPath = (ch, t0, t1, n, rfn) => {
      const L = [0];
      for (let i = 1; i < ch.length; i++) L.push(L[i - 1] + ch[i].p.distanceTo(ch[i - 1].p));
      const tot = L[L.length - 1], out = [];
      for (let k = 0; k <= n; k++) {
        const t = lerp(t0, t1, k / n), s = t * tot;
        let i = 0; while (i < ch.length - 2 && s > L[i + 1]) i++;
        const f = clamp((s - L[i]) / (L[i + 1] - L[i]), -2, 3);
        const p = ch[i].p.clone().lerp(ch[i + 1].p, f), r = lerp(ch[i].r, ch[i + 1].r, clamp(f, 0, 1));
        out.push({ p, r: rfn(k / n, r, t), t });
      }
      const R0 = out.map(q => q.r), m = R0.length, Dd = R0.slice();
      for (let i = m - 2; i >= 0; i--) Dd[i] = Math.max(Dd[i], Dd[i + 1]);
      out.forEach((q, i) => { let s = 0, w = 0; for (let k = -5; k <= 5; k++) { const ww = Math.exp(-k * k / 10); s += Dd[clamp(i + k, 0, m - 1)] * ww; w += ww; } q.r = s / w; });
      return out;
    };
    const sleeveCap = (path, mat) => {
      const p0 = path[0].p, dir = new T.Vector3().subVectors(p0, path[3].p).normalize();
      const cap = add(new T.SphereGeometry(path[0].r * 0.97, 32, 14, 0, TAU, 0, Math.PI / 2), mat);
      cap.position.copy(p0); cap.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir); cap.scale.set(0.94, 0.42, 0.94);
      return cap;
    };
    const wristT = (ch) => {
      const L = [0];
      for (let i = 1; i < ch.length; i++) L.push(L[i - 1] + ch[i].p.distanceTo(ch[i - 1].p));
      let bi = 16, br = 9;
      for (let i = 16; i < ch.length - 1; i++) if (ch[i].r < br) { br = ch[i].r; bi = i; }
      return L[bi] / L[L.length - 1];
    };
    const V3 = (a) => new T.Vector3(a[0], a[1], a[2]);
    const outward = (p, n) => { if (n.x * p.x + n.z * p.z < 0) n.negate(); return n; };
    const slabGeo = (nu, nv, P, th, opts) => {
      opts = opts || {};
      const base = [], top = [];
      const at = (i, j) => base[i * (nu + 1) + j];
      for (let i = 0; i <= nv; i++) for (let j = 0; j <= nu; j++) base.push(P(j / nu, i / nv));
      for (let i = 0; i <= nv; i++) for (let j = 0; j <= nu; j++) {
        const p = at(i, j);
        const pu = at(i, Math.min(nu, j + 1)).clone().sub(at(i, Math.max(0, j - 1)));
        const pv = at(Math.min(nv, i + 1), j).clone().sub(at(Math.max(0, i - 1), j));
        const n = outward(p, pu.cross(pv).normalize());
        top.push(p.clone().addScaledVector(n, typeof th === 'function' ? th(j / nu, i / nv) : th));
      }
      const pos = [], idx = [];
      const quad = (a, b, c2, d) => { const k = pos.length / 3; [a, b, c2, d].forEach(q => pos.push(q.x, q.y, q.z)); idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); };
      const gridm = (arr, flip) => {
        const k0 = pos.length / 3; arr.forEach(q => pos.push(q.x, q.y, q.z));
        for (let i = 0; i < nv; i++) for (let j = 0; j < nu; j++) { const a = k0 + i * (nu + 1) + j, b = a + 1, c2 = a + nu + 1, d = c2 + 1; if (flip) idx.push(a, c2, b, b, c2, d); else idx.push(a, b, c2, b, d, c2); }
      };
      gridm(top, false); gridm(base, true);
      const T_ = (i, j) => top[i * (nu + 1) + j], B_ = (i, j) => base[i * (nu + 1) + j];
      for (let j = 0; j < nu; j++) { quad(B_(0, j), B_(0, j + 1), T_(0, j), T_(0, j + 1)); quad(T_(nv, j), T_(nv, j + 1), B_(nv, j), B_(nv, j + 1)); }
      for (let i = 0; i < nv; i++) quad(B_(i, nu), B_(i + 1, nu), T_(i, nu), T_(i + 1, nu));
      if (!opts.roundU0) for (let i = 0; i < nv; i++) quad(T_(i, 0), T_(i + 1, 0), B_(i, 0), B_(i + 1, 0));
      else {
        const K = 6;
        for (let i = 0; i < nv; i++) {
          const ring = (ii) => {
            const b = B_(ii, 0), t = T_(ii, 0), m = b.clone().add(t).multiplyScalar(0.5), r = t.distanceTo(b) / 2;
            const tang = B_(ii, 0).clone().sub(B_(ii, Math.min(1, nu))).normalize(), up = t.clone().sub(b).normalize(), out = [];
            for (let k = 0; k <= K; k++) { const a = Math.PI * k / K; out.push(m.clone().addScaledVector(up, -Math.cos(a) * r).addScaledVector(tang, Math.sin(a) * r * 1.1)); }
            return out;
          };
          const r0 = ring(i), r1 = ring(i + 1);
          for (let k = 0; k < K; k++) quad(r0[k + 1], r1[k + 1], r0[k], r1[k]);
        }
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      const uv = []; for (let k = 0; k < pos.length; k += 3) uv.push(pos[k] * 1.6 + pos[k + 2] * 1.6, pos[k + 1] * 1.6);
      geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.computeVertexNormals(); return geo;
    };
    const slabOn = (grid, y0, y1, thc, w, off, th, mat, o) => {
      o = o || {};
      return add(slabGeo(o.nu || 8, o.nv || Math.max(2, Math.ceil(Math.abs(y1 - y0) / 0.012)), (u, v) => {
        const yb = lerp(y0, y1, v), R = radAt(grid, yb, thc, off), shear = (o.slant || 0) * (v - 0.5);
        return V3(S(grid, yb, thc + ((u - 0.5) * w + shear) / R, off));
      }, th, o), mat);
    };
    const panelGeo = (o) => {
      const { grid, ny, nt } = o;
      const y0f = typeof o.y0 === 'function' ? o.y0 : () => o.y0, y1f = typeof o.y1 === 'function' ? o.y1 : () => o.y1;
      const off = typeof o.off === 'function' ? o.off : () => o.off;
      const pos = [], uv = [], idx = [];
      for (let i = 0; i <= ny; i++) {
        const v = i / ny;
        for (let j = 0; j <= nt; j++) {
          const u = j / nt;
          let th = lerp(o.th0(lerp(y0f(0), y1f(0), v)), o.th1(lerp(y0f(0), y1f(0), v)), u);
          let yb = lerp(y0f(th), y1f(th), v);
          th = lerp(o.th0(yb), o.th1(yb), u);
          yb = lerp(y0f(th), y1f(th), v);
          const p = S(grid, yb, th, off(yb, th));
          pos.push(p[0], p[1], p[2]); uv.push(th * 0.16, p[1]);
        }
      }
      for (let i = 0; i < ny; i++) for (let j = 0; j < nt; j++) { const a = i * (nt + 1) + j, b = a + 1, cc = a + nt + 1, d = cc + 1; idx.push(a, b, cc, b, d, cc); }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.computeVertexNormals(); return geo;
    };
    const edgeWall = (grid, ys, thf, offTop, depth, mat) => {
      const pos = [], idx = [];
      ys.forEach(yb => { const th = thf(yb); const a = S(grid, yb, th, offTop(yb, th)), b = S(grid, yb, th, offTop(yb, th) - depth); pos.push(...a, ...b); });
      for (let i = 0; i < ys.length - 1; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
      return add(geo, mat);
    };
    const btn3d = (r, mat) => {
      const g = new T.Group();
      const b0 = new T.Mesh(new T.CylinderGeometry(r, r * 0.94, 0.0042, 28), mat); b0.castShadow = true; g.add(b0);
      const rim = new T.Mesh(new T.TorusGeometry(r * 0.86, r * 0.13, 8, 28), mat); rim.rotation.x = Math.PI / 2; rim.position.y = 0.0022; g.add(rim);
      const hm = new T.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
      [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([a, b]) => { const h = new T.Mesh(new T.CylinderGeometry(r * 0.1, r * 0.1, 0.0046, 8), hm); h.position.set(a * r * 0.24, 0.0003, b * r * 0.24); g.add(h); });
      return g;
    };
    const putBtn = (r, mat, grid, yb, th, off) => { const b = btn3d(r, mat); placeOn(b, grid, yb, th, off + 0.0022); M.add(b); return b; };
    const ringSlab = (path, thick, mat) => {
      add(tubeGeo(path, 36), mat);
      add(tubeGeo(path.map(q => ({ p: q.p, r: q.r - thick, rx: q.rx ? q.rx - thick : undefined })), 36), mat);
    };
    const shirtBtnMat = () => new T.MeshPhysicalMaterial({ color: 0xf4f1ea, roughness: 0.18, clearcoat: 0.6 });
    const welt = (grid, yb, thc, w, off, mat, h) => {
      slabOn(grid, yb - 0.0035, yb + 0.0035, thc, w + 0.004, off + 0.0004, 0.0012, darkMat());
      slabOn(grid, yb - (h || 0.009), yb - 0.0032, thc, w, off, 0.0028, mat);
      slabOn(grid, yb + 0.0032, yb + 0.0065, thc, w, off, 0.0022, mat);
    };
    const flap = (grid, yb, thc, w, h, off, mat) => {
      slabOn(grid, yb - 0.0025, yb + 0.0025, thc, w + 0.004, off + 0.0004, 0.0012, darkMat());
      slabOn(grid, yb - h, yb + 0.002, thc, w, off + 0.0012, (u, v) => 0.0024 + 0.0012 * v, mat);
    };
    const patchPocket = (grid, yb, thc, w, h, off, mat) => slabOn(grid, yb - h, yb, thc, w, off, 0.0022, mat);

    const cr = A.crotchY, wy = A.waistY, ch = A.chestY, ap = A.armpitY, nk = A.neckY, shY = A.shoulder[1];
    const nkC = nk + 0.014;
    const hasCoat = wear('coat'), hasWc = wear('waistcoat'), hasPants = wear('pants'), hasShirt = wear('shirt');
    const fitE = { slim: 0, regular: 0.004, relaxed: 0.009 }[fit] ?? 0.004;
    const MS = this.models || {};

    // =============== SHIRT: the fitted real-pattern shirt, recoloured ===============
    let gShirt = null, shirtPos = null, shirtArmR = null;
    if (hasShirt && MS.shirt) {
      const m = MS.shirt;
      shirtPos = this._deformPositions(fr, m.base, m.region);
      clearOf(shirtPos, m.region, gBody, 0.003);
      if (hasPants) {
        // tucked: below the waistband the shirt lies close on the body
        const tuckTop = fr.Y(wy - 0.004);
        for (let i = 0, k = 0; i < shirtPos.length; i += 3, k++) {
          if (m.region.getX(k) > 0.5) continue;
          const y = shirtPos[i + 1]; if (y > tuckTop + 0.012) continue;
          const cz = czW(y), x = shirtPos[i], z = shirtPos[i + 2] - cz, r = Math.hypot(x, z);
          const Rb = gSample(gBody, y, Math.atan2(x, z)) + 0.004, w = sstep(tuckTop + 0.012, tuckTop - 0.025, y);
          if (r > Rb) { const kk = lerp(1, Rb / r, w); shirtPos[i] = x * kk; shirtPos[i + 2] = z * kk + cz; }
        }
      }
      // the shirt's measured surface includes its shoulders (sleeve heads above the armpit), so straps sit on top
      const apW = fr.Y(ap + 0.01), jx = Math.abs(fr.arms[0][0].p.x);
      gShirt = gridFrom(shirtPos, (k) => isTorso(m.region)(k) || (shirtPos[k * 3 + 1] > apW && Math.abs(shirtPos[k * 3]) < jx - 0.015));
      // how far the shirt sleeve stands off each arm, sampled along the arm chain
      shirtArmR = fr.arms.map(() => new Float32Array(A.armL.length));
      for (let i = 0, k = 0; i < shirtPos.length; i += 3, k++) {
        if (m.region.getX(k) < 0.5) continue;
        const side = shirtPos[i] >= 0 ? 0 : 1, chn = fr.arms[side];
        let best = 0, bd = 1e9;
        for (let q = 0; q < chn.length; q++) { const p = chn[q].p, d = (p.x - shirtPos[i]) ** 2 + (p.y - shirtPos[i + 1]) ** 2 + (p.z - shirtPos[i + 2]) ** 2; if (d < bd) { bd = d; best = q; } }
        shirtArmR[side][best] = Math.max(shirtArmR[side][best], Math.sqrt(bd));
      }
      const sCol = shirtCol;
      const sMat = () => new T.MeshPhysicalMaterial({ color: sCol.clone(), map: this._tex(shirtMain ? kind : 'poplin', 14), roughness: 0.78,
        sheen: 0.5, sheenRoughness: 0.5, sheenColor: sCol.clone().lerp(white, 0.4), side: T.FrontSide });
      const posAttr = new T.BufferAttribute(shirtPos, 3);
      m.parts.forEach(p => {
        const geo = new T.BufferGeometry();
        geo.setAttribute('position', posAttr); geo.setAttribute('uv', m.uv); geo.setIndex(p.index); geo.computeVertexNormals();
        add(geo, /Button/i.test(p.part) ? shirtBtnMat() : sMat());
      });
    }

    // ---------- layer surfaces ----------
    const gUnder = gShirt ? gMax(gBody, gShirt) : gBody;
    const D = gDrape(gUnder);
    const DW = gDrop(D, fr.Y(ch), fr.Y(cr - 0.02), 0.12);
    const DC = gMax(gAng(gDrop(D, fr.Y(ch + 0.02), fr.Y(cr - 0.1), 0.1), 7), DW);
    const neckR = (th) => gSample(gBody, fr.Y(nkC + 0.016), th);
    const L = {};
    L.pants = 0.004 + fitE;
    L.wc = L.pants + 0.005 + fitE * 0.5;
    L.coat = (hasWc ? L.wc + 0.008 : L.pants + 0.008) + 0.006 + fitE;

    // =============== TROUSERS: one continuous piece, seat flowing into the legs ===============
    if (hasPants) {
      const tOff = L.pants;
      const topB = wy - 0.004, topW = fr.Y(topB), crW = fr.Y(cr), hemW = 0.035;
      const hemR = ({ slim: 0.06, regular: 0.068, relaxed: 0.078 }[fit] || 0.068) * fr.kLg / fr.u;
      const MP = 60;
      const ysW = [];
      for (let k = 0; k <= 24; k++) ysW.push(lerp(topW, crW + 0.01, k / 24));
      for (let k = 1; k <= 64; k++) ysW.push(lerp(crW + 0.01, hemW, Math.pow(k / 64, 1.15)));
      const legAt = (chn, yw) => {
        const topP = chn[0].p, ank = chn[chn.length - 1].p;
        const f = clamp((topP.y - yw) / (topP.y - ank.y), 0, 1.2);
        const p = topP.clone().lerp(ank, f);
        let i = 1; while (i < chn.length - 2 && chn[i + 1].p.y > yw) i++;
        const ff = clamp((chn[i].p.y - yw) / (chn[i].p.y - chn[i + 1].p.y), 0, 1);
        const cc = chn[i].p.clone().lerp(chn[i + 1].p, ff);
        if (yw < fr.Y(cr - 0.1) && yw > ank.y) { const bl = sstep(fr.Y(cr - 0.1), fr.Y(cr - 0.2), yw); p.x = lerp(p.x, cc.x, 0.5 * bl); p.z = lerp(p.z, cc.z, 0.7 * bl); }
        const rr = Math.min(lerp(chn[i].r, chn[i + 1].r, ff), 0.09 * fr.kLg) * 1.05 + 0.004;
        const rTop = Math.min(chn[2].r, 0.088 * fr.kLg) + tOff + 0.006;
        const t = clamp((crW - yw) / (crW - hemW), 0, 1);
        return { p, r: Math.max(rr + tOff, lerp(rTop, hemR, Math.pow(t, 0.85))) };
      };
      const legRows = (s, chn) => {
        // smooth leg radius down the leg so it hangs, never pinches
        const rows = ysW.map(yw => ({ yw, ...legAt(chn, yw) }));
        const R0 = rows.map(q => q.r);
        rows.forEach((q, i) => { let a = 0, w = 0; for (let k = -4; k <= 4; k++) { const ww = Math.exp(-k * k / 8); a += R0[clamp(i + k, 0, R0.length - 1)] * ww; w += ww; } q.r = Math.max(a / w, R0[i] * 0.985); });
        return rows;
      };
      const pos = [], uv = [], idx = [];
      const hemPos = [], hemIdx = [];
      [[1, fr.legs[0]], [-1, fr.legs[1]]].forEach(([s, chn]) => {
        const rows = legRows(s, chn), base = pos.length / 3;
        rows.forEach((q, ri) => {
          const yw = q.yw, w = sstep(crW - 0.07, crW + 0.03, yw);
          const back = Sw(D, yw, s * Math.PI, tOff), front = Sw(D, yw, 0, tOff);
          for (let mI = 0; mI <= MP; mI++) {
            const t = (mI % MP) / MP;
            let up;
            if (t <= 0.62) up = Sw(D, yw, s * (t / 0.62) * Math.PI, tOff);
            else { const u2 = (t - 0.62) / 0.38; up = [0, yw, lerp(back[2], front[2], u2)]; }
            const a = t <= 0.62 ? lerp(-0.45, Math.PI + 0.45, t / 0.62) : lerp(Math.PI + 0.45, TAU - 0.45, (t - 0.62) / 0.38);
            const lg = [q.p.x + s * Math.sin(a) * q.r, yw, q.p.z + Math.cos(a) * q.r * 1.04];
            const P = [lerp(lg[0], up[0], w), yw, lerp(lg[2], up[2], w)];
            pos.push(P[0], P[1], P[2]); uv.push(mI / MP * 0.55, yw);
            if (ri >= rows.length - 4) {
              const dx = P[0] - q.p.x, dz = P[2] - q.p.z, dl = Math.hypot(dx, dz) || 1;
              hemPos.push(P[0] + dx / dl * 0.0016, yw, P[2] + dz / dl * 0.0016);
            }
          }
        });
        for (let ri = 0; ri < rows.length - 1; ri++) for (let mI = 0; mI < MP; mI++) {
          const a = base + ri * (MP + 1) + mI, b = a + 1, c2 = a + MP + 1, d = c2 + 1;
          if (s > 0) idx.push(a, c2, b, b, c2, d); else idx.push(a, b, c2, b, d, c2);
        }
        const hb = hemPos.length / 3 - 4 * (MP + 1);
        for (let ri = 0; ri < 3; ri++) for (let mI = 0; mI < MP; mI++) {
          const a = hb + ri * (MP + 1) + mI, b = a + 1, c2 = a + MP + 1, d = c2 + 1;
          hemIdx.push(a, b, c2, b, d, c2);
        }
      });
      const tg = new T.BufferGeometry();
      tg.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); tg.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      tg.setIndex(idx); tg.computeVertexNormals();
      add(tg, fabMat(1, T.DoubleSide));
      const hg = new T.BufferGeometry(); hg.setAttribute('position', new T.Float32BufferAttribute(hemPos, 3)); hg.setIndex(hemIdx); hg.computeVertexNormals();
      add(hg, fabMat(0.94, T.DoubleSide));

      // waistband, belt loops, fly, pockets: all on the same trouser surface
      const wbH = 0.038;
      add(slabGeo(96, 3, (u, v) => V3(S(D, lerp(topB - wbH, topB, v), lerp(0, TAU, u) + 0.15, tOff + 0.0005)), 0.003, {}), fabMat(0.95));
      slabOn(D, topB - wbH, topB, 0.09, 0.05, tOff + 0.0035, 0.0024, fabMat(0.97), { nu: 4 });
      putBtn(0.0068, btnMat(), D, topB - wbH / 2, 0.075, tOff + 0.006);
      [-1.3, -0.55, 0.55, 1.3, Math.PI - 0.45, Math.PI + 0.45, Math.PI].forEach(th => slabOn(D, topB - wbH - 0.008, topB + 0.003, th, 0.011, tOff + 0.0036, 0.0024, fabMat(0.97), { nu: 2 }));
      slabOn(D, cr + 0.05, topB - wbH, 0.1, 0.034, tOff + 0.0003, (u, v) => 0.0018 * (1 - 0.6 * u), fabMat(0.98), { nu: 4, roundU0: true });
      [-1, 1].forEach(s => {
        const y0p = topB - wbH - 0.003, y1p = Math.max(topB - wbH - 0.14, cr + 0.12);
        add(slabGeo(3, 14, (u, v) => {
          const yb = lerp(y0p, y1p, v), th = s * lerp(0.62, 1.18, v) + s * u * 0.016 / radAt(D, yb, 0.9, tOff);
          return V3(S(D, yb, th, tOff + 0.0003));
        }, (u, v) => 0.003 * (1 - u), { roundU0: true }), fabMat(0.96));
        add(slabGeo(2, 14, (u, v) => {
          const yb = lerp(y0p, y1p, v), th = s * lerp(0.62, 1.18, v) - s * (0.003 + u * 0.003) / radAt(D, yb, 0.9, tOff);
          return V3(S(D, yb, th, tOff + 0.0002));
        }, 0.0008), darkMat());
      });
      const st = c.pockets || 'jetted';
      [-1, 1].forEach(s => {
        const yb = topB - wbH - 0.045, thc = Math.PI + s * 0.48;
        welt(D, yb, thc, 0.12, tOff, fabMat(0.96));
        if (st === 'flap' || st === 'ticket') { flap(D, yb + 0.006, thc, 0.128, 0.048, tOff + 0.0028, fabMat(0.98)); putBtn(0.0055, btnMat(), D, yb - 0.028, thc, tOff + 0.0066); }
        else if (st === 'patch') patchPocket(D, yb + 0.01, thc, 0.13, 0.13, tOff + 0.0005, fabMat(0.98));
      });
    }

    // two fronts: the wearer's left front (+x) laps over the right; edges given as angles
    const frontPair = (o) => {
      const lft = { grid: o.grid, ny: o.ny, nt: o.nt, y0: o.y0, y1: o.y1, th0: o.eL, th1: () => Math.PI, off: (yb, th) => o.off(yb, th) + 0.0026 * sstep(0.35, -0.2, th) };
      const rgt = { grid: o.grid, ny: o.ny, nt: o.nt, y0: o.y0, y1: o.y1, th0: () => Math.PI, th1: (yb) => TAU - o.eR(yb), off: o.off };
      const gl = panelGeo(lft), gr = panelGeo(rgt);
      add(gl, o.mat()); add(gr, o.mat());
      if (o.lining) { add(gl.clone(), o.lining()); add(gr.clone(), o.lining()); }
      const ys = []; for (let k = 0; k <= 60; k++) ys.push(lerp(o.edgeY0, o.edgeY1, k / 60));
      edgeWall(o.grid, ys, o.eL, (yb, th) => o.off(yb, th) + 0.0026, 0.004, o.mat());
      edgeWall(o.grid, ys, (yb) => -o.eR(yb), (yb, th) => o.off(yb, th), 0.003, o.mat());
    };

    // =============== WAISTCOAT: four styles, snug on the shirt ===============
    if (hasWc) {
      const style = c.wcStyle || 'classic';
      const wTop = nkC - 0.012, wHem = wy - 0.11;
      const opened = c.openFront && !hasCoat ? 1 : 0;
      const R0 = (yb) => radAt(DW, yb, 0, L.wc);
      const toA = (m, yb) => m / Math.max(0.05, R0(yb));                    // metres across the chest -> angle
      const cfg = {
        classic: { btnTop: ch - 0.06, btnBot: wy - 0.05, n: 4, ovm: 0.012 },
        two: { btnTop: wy + 0.045, btnBot: wy - 0.03, n: 2, ovm: 0.012 },
        double: { btnTop: ch - 0.03, btnBot: wy - 0.03, n: 4, ovm: 0.06 },
        wrap: { btnTop: ch - 0.045, btnBot: wy - 0.06, n: 4, ovm: 0.012 }
      }[style] || {};
      const { btnTop, btnBot } = cfg;
      // V neckline half-angle of the opening, same for both fronts above the top button
      const vA = (yb) => {
        let a;
        if (yb >= btnTop) a = 0.02 + 0.76 * Math.pow((yb - btnTop) / (wTop - btnTop), style === 'two' ? 0.75 : 0.85);
        else if (yb >= wy - 0.04) a = 0.02;
        else a = 0.02 + 0.32 * (wy - 0.04 - yb) / (wy - 0.04 - wHem);
        return a + opened * 0.35 * (1 - sstep(btnTop, wTop, yb));
      };
      const lap = (yb) => opened ? 0 : toA(cfg.ovm, yb) * sstep(btnTop + 0.03, btnTop - 0.01, yb) * sstep(wHem, wy - 0.03, yb);
      let eL = (yb) => vA(yb) - lap(yb), eR = (yb) => vA(yb) - lap(yb);
      if (style === 'wrap' && !opened) {
        // asymmetric: the left front sweeps across, buttoning down a diagonal on the wearer's right
        const diag = (yb) => lerp(0.62, -0.42, clamp((wTop - 0.02 - yb) / (wTop - 0.02 - wHem), 0, 1));
        eL = (yb) => Math.min(vA(yb), diag(yb));
        eR = (yb) => Math.max(vA(yb) - 0.02, 0.02);
      }
      const y0 = (th) => wHem + 0.04 * sstep(0.25, 1.4, Math.abs(wrapPi(th))) - (style === 'wrap' ? 0.02 * sstep(-0.1, -0.5, wrapPi(th)) : 0);
      const y1 = (th) => lerp(wTop, ap - 0.035, sstep(0.72, 0.93, Math.abs(Math.sin(th))));
      const off = (yb, th) => lerp(L.wc + 0.003 * sstep(wy, wHem, yb), 0.004, sstep(shY - 0.03, wTop, yb)) + 0.01 * Math.exp(-Math.pow((yb - ap - 0.03) / 0.05, 2)) * Math.pow(Math.abs(Math.sin(th || 0)), 4);
      frontPair({ grid: DW, y0, y1, eL, eR, off, ny: 64, nt: 50, mat: () => fabMat(1),
        lining: () => (c.lining === 'half' ? fabMat(0.8, T.BackSide) : liningMat(T.BackSide)), edgeY0: wHem - 0.03, edgeY1: wTop });
      if (!opened) {
        const bm = btnMat();
        if (style === 'double') {
          const cols = [0.052, -0.052];
          [lerp(btnTop, btnBot, 0.2), lerp(btnTop, btnBot, 0.85)].forEach(yb => cols.forEach(xm => putBtn(0.0078, bm, DW, yb, toA(xm, yb), off(yb, 0) + 0.0028)));
        } else {
          for (let k = 0; k < cfg.n; k++) {
            const yb = cfg.n === 1 ? btnTop : lerp(btnTop - 0.008, btnBot, k / (cfg.n - 1));
            putBtn(0.0076, bm, DW, yb, eL(yb) + toA(0.016, yb), off(yb, 0) + 0.0028);
          }
        }
      }
      const st = c.pockets || 'jetted';
      [-1, 1].forEach(s => {
        const o2 = off(wy - 0.03, s) + 0.0026 * (s > 0);
        if (st === 'flap' || st === 'ticket') flap(DW, wy - 0.03, s * 0.88, 0.095, 0.034, o2, fabMat(0.98));
        else welt(DW, wy - 0.03, s * 0.88, 0.095, o2, fabMat(0.98));
      });
      if (style !== 'wrap') welt(DW, ch - 0.005, 0.82, 0.075, off(ch, 0.8) + 0.0026, fabMat(0.98));
      slabOn(DW, wy + 0.01, wy + 0.03, Math.PI, 0.13, off(wy, Math.PI) + 0.0004, 0.002, liningMat(T.DoubleSide), { nu: 6 });
    }

    // =============== COAT ===============
    if (hasCoat) {
      const G = DC;
      const hemY = cr - 0.045, btnY = wy + 0.01, topY = nkC - 0.01, open = c.openFront ? 1 : 0;
      const off = (yb, th) => {
        let o = L.coat;
        if (yb < wy) o += (wy - yb) * 0.04;
        if (yb > ap && yb < shY + 0.04) o += 0.006 * sstep(ap, shY, yb);
        if (fit === 'slim') o -= 0.004 * Math.exp(-Math.pow((yb - wy) / 0.06, 2));
        o += 0.014 * Math.exp(-Math.pow((yb - ap - 0.03) / 0.06, 2)) * Math.pow(Math.abs(Math.sin(th || 0)), 6);
        return lerp(o, 0.009, sstep(shY - 0.03, topY + 0.004, yb));
      };
      const jA = (yb) => {
        let a;
        if (yb >= btnY) a = 0.62 * Math.pow((yb - btnY) / (topY - btnY), 1.05);
        else a = 0.34 * Math.pow((btnY - yb) / (btnY - hemY), 1.6);
        if (open) { const t = clamp((yb - hemY) / (shY - hemY), 0, 1); a += 0.42 * (1 - t * t); }
        return a;
      };
      const ovA = (yb) => open ? 0 : (0.016 / Math.max(0.08, radAt(G, yb, 0, L.coat))) * sstep(btnY + 0.05, btnY + 0.005, yb) * sstep(btnY - 0.13, btnY - 0.06, yb);
      const y0 = (th) => hemY + 0.02 * Math.pow(Math.abs(Math.cos(th)), 4);
      const lin = c.lining || 'bemberg';
      frontPair({ grid: G, y0, y1: topY, eL: (yb) => jA(yb) - ovA(yb), eR: (yb) => jA(yb) - ovA(yb), off, ny: 84, nt: 48, mat: () => fabMat(1),
        lining: () => (lin === 'half' ? fabMat(0.85, T.BackSide) : liningMat(T.BackSide)), edgeY0: hemY, edgeY1: topY });

      const lapel = c.lapel || 'notch';
      const satin = kind === 'blend' && lapel !== 'notch';
      const lapMat = () => satin
        ? new T.MeshPhysicalMaterial({ color: col.clone().multiplyScalar(0.8), roughness: 0.22, clearcoat: 0.35, side: T.DoubleSide })
        : fabMat(1.03, T.DoubleSide);
      const Wp = {
        notch: [[0, 0.004], [0.25, 0.04], [0.6, 0.072], [0.82, 0.084], [0.84, 0.05], [0.87, 0.024], [0.9, 0.05], [1, 0.046]],
        peak: [[0, 0.004], [0.25, 0.042], [0.6, 0.078], [0.84, 0.096], [0.9, 0.11], [0.92, 0.04], [1, 0.042]],
        shawl: [[0, 0.004], [0.3, 0.046], [0.65, 0.07], [0.85, 0.064], [1, 0.05]]
      }[lapel];
      const lift = lapel === 'peak' ? [[0, 0], [0.72, 0], [0.9, 0.034], [0.92, 0], [1, 0]] : [[0, 0], [1, 0]];
      const lBot = btnY + 0.006, lTop = lapel === 'shawl' ? topY : lerp(btnY, topY, 0.9);
      const lapelPiece = (s) => add(slabGeo(7, 60, (u, v) => {
        const yb = lerp(lBot, lTop, v), yy = Math.min(yb + pl(lift, v) * u, topY + 0.01);
        const a = jA(yb) - ovA(yb) * (s > 0 ? 1 : 0), base = off(yb, a) + (s > 0 ? 0.0026 : 0);
        const R = radAt(G, yb, a, base), th = a + u * pl(Wp, v) / R;
        const rollLift = 0.0045 * Math.pow(1 - u, 1.6) * sstep(0, 0.35, v);
        const p = S(G, yy, th, base + 0.0004 + rollLift);
        return V3([p[0] * s, p[1], p[2]]);
      }, () => 0.0032, { roundU0: true }), lapMat());
      lapelPiece(1); lapelPiece(-1);
      add(slabGeo(56, 5, (u, v) => {
        const th = lerp(0.6, TAU - 0.6, u), yb = lerp(nkC + 0.012, nkC - 0.022, v);
        const r = Math.max(neckR(th) + 0.0095 + 0.006 * v, gSample(gUnder, fr.Y(Math.min(yb, nkC + 0.01)), th) + 0.005 + 0.006 * v);
        const yw = fr.Y(yb), cz = czW(yw);
        return V3([Math.sin(th) * r, yw, Math.cos(th) * r + cz]);
      }, 0.0034, {}), fabMat(1.0, T.DoubleSide));

      if (!open) [btnY, btnY - 0.1].forEach((yb) => putBtn(0.0105, btnMat(), G, yb, -ovA(yb) * 0.15, off(yb, 0) + 0.0026));
      const st = c.pockets || 'flap';
      const pY = cr + 0.1;
      [-1, 1].forEach(s => {
        const o = off(pY, 1.1);
        if (st === 'patch') patchPocket(G, pY + 0.02, s * 1.1, 0.16, 0.17, o, fabMat(0.98));
        else if (st === 'jetted') welt(G, pY, s * 1.1, 0.15, o, fabMat(0.98), 0.005);
        else flap(G, pY, s * 1.1, 0.155, 0.055, o, fabMat(0.98));
      });
      if (st === 'ticket') flap(G, pY + 0.06, -1.03, 0.1, 0.04, off(pY + 0.06, 1), fabMat(0.98));
      const bY = ch + 0.02;
      if (st === 'patch') patchPocket(G, bY + 0.02, 0.78, 0.1, 0.11, off(bY, 0.78) + 0.0026, fabMat(0.98));
      else slabOn(G, bY - 0.002, bY + 0.022, 0.78, 0.098, off(bY, 0.78) + 0.0026, 0.003, fabMat(0.98), { slant: 0.004 });
      add(slabGeo(8, 2, (u, v) => {
        const yb = bY + 0.02 + v * (0.006 + 0.016 * Math.max(0, 1 - Math.abs(u - 0.35) * 3.2, 1 - Math.abs(u - 0.72) * 3.2));
        const R = radAt(G, yb, 0.78, off(yb, 0.78));
        return V3(S(G, yb, 0.78 + (u - 0.5) * 0.072 / R, off(yb, 0.78) + 0.0026));
      }, 0.0028), new T.MeshStandardMaterial({ color: 0xf3f0e8, roughness: 0.7, side: T.DoubleSide }));
      if (lapel !== 'shawl') {
        const yb = lerp(lBot, lTop, 0.74), a = jA(yb), R = radAt(G, yb, a, off(yb, a));
        const hole = new T.Mesh(new T.BoxGeometry(0.017, 0.0022, 0.004), new T.MeshStandardMaterial({ color: 0x9a2a2a, roughness: 0.6 }));
        placeOn(hole, G, yb, a + 0.05 / R, off(yb, a) + 0.0026 + 0.0075); M.add(hole);
      }
      fr.arms.forEach((chn0, si) => {
        const chn = shirtArmR ? chn0.map((q, k) => Object.assign({}, q, { r: Math.max(q.r, shirtArmR[si][k] - 0.006) })) : chn0;
        const wt = wristT(chn0);
        const sE = { slim: 0.012, regular: 0.017, relaxed: 0.025 }[fit] || 0.017;
        const rTop = 0.064 * fr.kA + sE, rCuff = 0.05 * fr.kA + 0.005;
        const path = chainPath(chn, 0.0, wt - 0.014, 36, (t, r) => Math.max(r + sE * 0.8, Math.min(rTop + 0.006, lerp(rTop, rCuff, Math.pow(t, 0.9)))));
        ringSlab(path.slice(-3).map(q => ({ p: q.p, r: q.r + 0.0008 })), 0.0028, fabMat(1));
        add(tubeGeo(path, 44), fabMat(1, T.DoubleSide));
        sleeveCap(path, fabMat(1));
        const endP = path[path.length - 1].p, endD = endP.clone().sub(path[path.length - 3].p).normalize();
        const o = new T.Vector3(si ? -0.75 : 0.75, 0, -0.66).normalize();
        for (let k = 0; k < 4; k++) {
          const d = 0.03 + k * 0.017, q = path[path.length - 1];
          const b = btn3d(0.0062, btnMat());
          b.position.copy(endP).addScaledVector(endD, -d).addScaledVector(o, q.r + 0.0015);
          b.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), o); M.add(b);
        }
      });
    }
  }
}
if (!customElements.get('suit-viewer')) customElements.define('suit-viewer', SuitViewer);
export default SuitViewer;
