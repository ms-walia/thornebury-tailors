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
      new GLTFLoader().loadAsync(base + 'mannequin.glb')
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
    const geomKeys = ['garment', 'fabric', 'color', 'lapel', 'button', 'fit', 'pockets', 'lining', 'collar', 'cuff', 'heightM', 'weightKg', 'chestM', 'waistM', 'hipM', 'shoulderM', 'sleeveM', 'inseamM', 'openFront'];
    if (!prev || geomKeys.some(k => prev[k] !== c[k])) this._dirty = true;
  }
  connectedCallback() {
    Object.assign(this.style, { display: 'block', width: '100%', height: '100%', position: 'relative' });
    this._msg = document.createElement('div');
    Object.assign(this._msg.style, { position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '12px Karla, sans-serif', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#8c877c' });
    this._msg.textContent = 'Preparing fitting room…';
    this.appendChild(this._msg);
    const base = this.getAttribute('assets') || '/assets/';
    loadData(base).then(([A, gltf]) => { if (this.isConnected) this._init(A, gltf); })
      .catch(() => { this._msg.textContent = '3D preview unavailable'; });
  }
  disconnectedCallback() {
    cancelAnimationFrame(this._raf);
    if (this._ro) this._ro.disconnect();
    if (this._io) this._io.disconnect();
    if (this.renderer) { this.renderer.dispose(); this.renderer.domElement.remove(); this.renderer = null; }
  }

  _init(A, gltf) {
    if (this.renderer) return;
    this.A = A;
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

  _tex(kind) {
    this._texCache = this._texCache || {};
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
    const fx = (y) => pl(FX, y), fz = (y) => pl(FZ, y);
    const kA = u * Math.pow(g, 0.55), kLg = u * Math.pow(g, 0.6) * Math.sqrt(fH);
    const dxA = A.shoulder[0] * (u * fS - 1);
    const dxL = 0.095 * (u * fH - 1);
    const bellyY = A.waistY - 0.01;
    const belly = (yb, c) => c <= 0 || bellyK <= 0 ? 1 : 1 + bellyK * Math.exp(-Math.pow((yb - bellyY) / (yb < bellyY ? 0.14 : 0.17), 2)) * Math.pow(c, 1.25);
    const fr = { A, H, g, hs, u, fx, fz, Y, kA, kLg, dxA, dxL, crotchT, kL, belly, bellyK };
    // deformed limb chains
    const chainDef = (ch, isArm) => ch.map(p => {
      const s = Math.sign(p[0]) || 1;
      return { p: new T.Vector3(p[0] * u + s * (isArm ? dxA + A.shoulder[0] * (1 - u) * 0 : dxL), Y(p[1]), p[2] * u), r: p[3] * (isArm ? kA : kLg), b: p };
    });
    fr.arms = [chainDef(A.armL, true), chainDef(A.armR, true)];
    fr.legs = [chainDef(A.legL, false), chainDef(A.legR, false)];
    fr.Hfinal = Y(A.H);
    return fr;
  }

  _deformMannequin(fr) {
    const A = this.A, src = this._basePos, n = src.length / 3, out = new Float32Array(src.length);
    const reg = this._region, nrm = reg.normalized ? 1 : 255;
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
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(out, 3));
    geo.setIndex(this._index);
    geo.computeVertexNormals();
    return geo;
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

    // ---- surface helpers (yb = base-mannequin height, th = angle, 0 = front)
    const hullR = (grid, yb, th) => {
      const fy = clamp((yb - A.y0) / A.dy, 0, grid.length - 1.001), i = Math.floor(fy), t = fy - i;
      const fa = (((th / TAU) % 1) + 1) % 1 * A.na, j = Math.floor(fa) % A.na, j2 = (j + 1) % A.na, s = fa - Math.floor(fa);
      const r0 = lerp(grid[i][j], grid[i][j2], s), r1 = lerp(grid[i + 1][j], grid[i + 1][j2], s);
      return lerp(r0, r1, t);
    };
    const czAt = (yb) => {
      const fy = clamp((yb - A.y0) / A.dy, 0, A.cz.length - 1.001), i = Math.floor(fy);
      return lerp(A.cz[i], A.cz[i + 1], fy - i) * fr.u;
    };
    const S = (grid, yb, th, off) => {
      const R = hullR(grid, yb, th);
      const c = Math.cos(th);
      return [Math.sin(th) * (R * fr.u * fr.fx(yb) + off), fr.Y(yb), c * (R * fr.u * fr.fz(yb) * fr.belly(yb, c) + off) + czAt(yb)];
    };
    const radAt = (grid, yb, th, off) => { const p = S(grid, yb, th, off); return Math.hypot(p[0], p[2] - czAt(yb)); };
    const GT = A.drape, G = GT;

    // generic shell: rows over yb in [y0(th), y1(th)], columns th in [a(yb), TAU - a(yb)] (+rot)
    const gusset = (yb, th) => 0.032 * Math.exp(-Math.pow((yb - ap - 0.02) / 0.06, 2)) * Math.pow(Math.abs(Math.sin(th)), 10);
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
          const p = S(grid, yb, th, off(yb, th) + (o.gusset ? gusset(yb, th) : 0));
          pos.push(p[0], p[1], p[2]);
          uv.push(th * 0.16, p[1]);
        }
      }
      for (let i = 0; i < ny; i++) for (let j = 0; j < nt; j++) {
        const a = i * (nt + 1) + j, b = a + 1, cc = a + nt + 1, d = cc + 1;
        idx.push(a, b, cc, b, d, cc);
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.computeVertexNormals();
      return geo;
    };
    const gridGeo = (nu, nv, fn) => {
      const pos = [], uv = [], idx = [];
      for (let i = 0; i <= nv; i++) for (let j = 0; j <= nu; j++) {
        const p = fn(j / nu, i / nv); pos.push(p[0], p[1], p[2]); uv.push(p[0] * 1.5 + p[2], p[1] * 1.5);
      }
      for (let i = 0; i < nv; i++) for (let j = 0; j < nu; j++) {
        const a = i * (nu + 1) + j, b = a + 1, cc = a + nu + 1, d = cc + 1;
        idx.push(a, b, cc, b, d, cc);
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.computeVertexNormals();
      return geo;
    };
    // a patch lying on a shell: centred at angle thc, width in metres
    const patch = (grid, y0, y1, thc, width, off, mat) => add(gridGeo(10, Math.max(2, Math.ceil(Math.abs(y1 - y0) / 0.015)), (u, v) => {
      const yb = lerp(y0, y1, v), R = radAt(grid, yb, thc, off);
      return S(grid, yb, thc + (u - 0.5) * width / R, off);
    }), mat);
    const normalAt = (grid, yb, th, off) => {
      const e = 0.003, p = new T.Vector3(...S(grid, yb, th, off));
      const pu = new T.Vector3(...S(grid, yb, th + e, off)).sub(p), pv = new T.Vector3(...S(grid, yb + e, th, off)).sub(p);
      return { p, n: pu.cross(pv).normalize().negate() };
    };
    const placeOn = (mesh, grid, yb, th, off) => {
      const { p, n } = normalAt(grid, yb, th, off);
      if (n.dot(new T.Vector3(p.x, 0, p.z - czAt(yb))) < 0) n.negate();
      mesh.position.copy(p);
      mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), n);
    };
    const button = (r, mat) => new T.Mesh(new T.CylinderGeometry(r, r * 0.92, 0.0045, 24), mat);
    const pocketSet = (grid, yb, thc, width, style, off, flapH) => {
      if (style === 'patch') { patch(grid, yb - width * 0.95 / fr.kL, yb, thc, width, off + 0.0035, fabMat(0.88, T.DoubleSide)); return; }
      patch(grid, yb - 0.007, yb, thc, width, off + 0.0035, darkMat());
      if (style === 'flap' || style === 'ticket') patch(grid, yb - (flapH || 0.05), yb - 0.003, thc, width * 0.99, off + 0.0048, fabMat(0.92, T.DoubleSide));
    };
    // tube along a polyline of {p, r}
    const tubeGeo = (pts, seg) => {
      seg = seg || 32;
      const pos = [], uv = [], idx = [];
      const n = pts.length;
      let prevN = null;
      for (let i = 0; i < n; i++) {
        const a = pts[Math.max(0, i - 1)].p, b = pts[Math.min(n - 1, i + 1)].p;
        const tg = new T.Vector3().subVectors(b, a).normalize();
        let nn = prevN ? prevN.clone().sub(tg.clone().multiplyScalar(prevN.dot(tg))).normalize() : new T.Vector3(0, 0, 1).sub(tg.clone().multiplyScalar(tg.z)).normalize();
        prevN = nn;
        const bn = new T.Vector3().crossVectors(tg, nn);
        for (let j = 0; j <= seg; j++) {
          const th = j / seg * TAU, cs = Math.cos(th), sn = Math.sin(th), r = pts[i].r;
          const rx = pts[i].rx || r;
          pos.push(pts[i].p.x + (nn.x * cs * r + bn.x * sn * rx), pts[i].p.y + (nn.y * cs * r + bn.y * sn * rx), pts[i].p.z + (nn.z * cs * r + bn.z * sn * rx));
          uv.push(th * 0.05, pts[i].p.y);
        }
      }
      for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) {
        const a = i * (seg + 1) + j, b = a + 1, cc = a + seg + 1, d = cc + 1;
        idx.push(a, b, cc, b, d, cc);
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.computeVertexNormals();
      return geo;
    };
    // resample a chain between arc-length fractions, with radius fn(t, chainR)
    const chainPath = (ch, t0, t1, n, rfn, extend) => {
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
      // smooth the radius envelope so sleeves hang rather than shrink-wrap
      const R0 = out.map(q => q.r), m = R0.length;
      const D = R0.slice();
      for (let i = m - 2; i >= 0; i--) D[i] = Math.max(D[i], D[i + 1]); // taper only: never pinch then swell
      out.forEach((q, i) => { let s = 0, w = 0; for (let k = -5; k <= 5; k++) { const ww = Math.exp(-k * k / 10); s += D[clamp(i + k, 0, m - 1)] * ww; w += ww; } q.r = s / w; });
      return out;
    };
    const sleeveCap = (path, mat) => {
      const p0 = path[0].p, dir = new T.Vector3().subVectors(p0, path[3].p).normalize();
      const cap = add(new T.SphereGeometry(path[0].r * 0.97, 32, 14, 0, TAU, 0, Math.PI / 2), mat);
      cap.position.copy(p0); cap.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir);
      cap.scale.set(0.94, 0.42, 0.94);
      return cap;
    };
    const tAtY = (ch, yb) => {
      const L = [0];
      for (let i = 1; i < ch.length; i++) L.push(L[i - 1] + ch[i].p.distanceTo(ch[i - 1].p));
      for (let i = 0; i < ch.length - 1; i++) if (ch[i + 1].b[1] <= yb) {
        const f = (ch[i].b[1] - yb) / (ch[i].b[1] - ch[i + 1].b[1]);
        return lerp(L[i], L[i + 1], f) / L[L.length - 1];
      }
      return 0;
    };
    const wristT = (ch) => {
      const L = [0];
      for (let i = 1; i < ch.length; i++) L.push(L[i - 1] + ch[i].p.distanceTo(ch[i - 1].p));
      let bi = 16, br = 9;
      for (let i = 16; i < ch.length - 1; i++) if (ch[i].r < br) { br = ch[i].r; bi = i; }
      return L[bi] / L[L.length - 1];
    };

    const cr = A.crotchY, wy = A.waistY, ch = A.chestY, ap = A.armpitY, nk = A.neckY, shY = A.shoulder[1];
    const hasCoat = wear('coat'), hasWc = wear('waistcoat'), hasPants = wear('pants'), hasShirt = wear('shirt');
    const D = A.drape, DC = A.drapeCoat;
    const nkC = nk + 0.014;                                   // visual base of the neck (collar line)
    const neckR = (th) => radAt(A.hullTorso, nkC + 0.016, th, 0);

    // ---------- layer stack: each garment sits just outside the one beneath it ----------
    const fitE = { slim: 0, regular: 0.004, relaxed: 0.009 }[fit] ?? 0.004;
    const L = {};
    L.shirt = 0.0035 + fitE * 0.6;
    L.pants = (hasShirt ? L.shirt + 0.0055 : 0.004) + fitE;
    L.wc = Math.max(hasShirt ? L.shirt : 0, hasPants ? L.pants : 0) + 0.006 + fitE * 0.5;
    L.coat = (hasWc ? L.wc + 0.008 : Math.max(hasPants ? L.pants : 0, hasShirt ? L.shirt : 0) + 0.01) + 0.008 + fitE;

    const V3 = (a) => new T.Vector3(a[0], a[1], a[2]);
    const outward = (p, n) => { if (n.x * p.x + n.z * p.z < 0) n.negate(); return n; };

    // ---------- 3D slab: a piece of cloth with real thickness, edges and shadows ----------
    // P(u, v) -> Vector3 on the underside; the top sits `th` along the outward normal.
    // roundU0: the u = 0 edge is a rolled fold (half-round) instead of a cut edge.
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
        const t = typeof th === 'function' ? th(j / nu, i / nv) : th;
        top.push(p.clone().addScaledVector(n, t));
      }
      const pos = [], idx = [];
      const quad = (a, b, c, d) => { const k = pos.length / 3; [a, b, c, d].forEach(q => pos.push(q.x, q.y, q.z)); idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); };
      const grid = (arr, flip) => {
        const k0 = pos.length / 3;
        arr.forEach(q => pos.push(q.x, q.y, q.z));
        for (let i = 0; i < nv; i++) for (let j = 0; j < nu; j++) {
          const a = k0 + i * (nu + 1) + j, b = a + 1, c = a + nu + 1, d = c + 1;
          if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
        }
      };
      grid(top, false); grid(base, true);
      const T_ = (i, j) => top[i * (nu + 1) + j], B_ = (i, j) => base[i * (nu + 1) + j];
      // side walls: v = 0, v = 1, u = 1 (cut edges)
      for (let j = 0; j < nu; j++) { quad(B_(0, j), B_(0, j + 1), T_(0, j), T_(0, j + 1)); quad(T_(nv, j), T_(nv, j + 1), B_(nv, j), B_(nv, j + 1)); }
      for (let i = 0; i < nv; i++) quad(B_(i, nu), B_(i + 1, nu), T_(i, nu), T_(i + 1, nu));
      // u = 0 edge: flat cut, or a rolled half-round fold
      if (!opts.roundU0) for (let i = 0; i < nv; i++) quad(T_(i, 0), T_(i + 1, 0), B_(i, 0), B_(i + 1, 0));
      else {
        const K = 6;
        for (let i = 0; i < nv; i++) {
          const ring = (ii) => {
            const b = B_(ii, 0), t = T_(ii, 0), m = b.clone().add(t).multiplyScalar(0.5), r = t.distanceTo(b) / 2;
            const tang = B_(ii, 0).clone().sub(B_(ii, Math.min(1, nu))).normalize();
            const up = t.clone().sub(b).normalize();
            const out = [];
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
      geo.setIndex(idx); geo.computeVertexNormals();
      return geo;
    };
    // slab lying on a body surface: rectangle centred at angle thc, width w (m), from y0 to y1 (base heights)
    const slabOn = (grid, y0, y1, thc, w, off, th, mat, o) => {
      o = o || {};
      return add(slabGeo(o.nu || 8, o.nv || Math.max(2, Math.ceil(Math.abs(y1 - y0) / 0.012)), (u, v) => {
        const yb = lerp(y0, y1, v), R = radAt(grid, yb, thc, off);
        const shear = (o.slant || 0) * (v - 0.5);
        return V3(S(grid, yb, thc + ((u - 0.5) * w + shear) / R, off));
      }, th, o), mat);
    };
    // panel shell between two angle edges th0(yb)..th1(yb) (columns) and y0(th)..y1(th) (rows)
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
      for (let i = 0; i < ny; i++) for (let j = 0; j < nt; j++) {
        const a = i * (nt + 1) + j, b = a + 1, cc = a + nt + 1, d = cc + 1;
        idx.push(a, b, cc, b, d, cc);
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.computeVertexNormals();
      return geo;
    };
    // cut-edge wall along a panel's front edge, so an overlapping front reads as a separate layer
    const edgeWall = (grid, ys, thf, offTop, depth, mat) => {
      const pos = [], idx = [];
      ys.forEach(yb => { const th = thf(yb); const a = S(grid, yb, th, offTop(yb, th)), b = S(grid, yb, th, offTop(yb, th) - depth); pos.push(...a, ...b); });
      for (let i = 0; i < ys.length - 1; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
      return add(geo, mat);
    };
    const btn3d = (r, mat) => {
      const g = new T.Group();
      const body = new T.Mesh(new T.CylinderGeometry(r, r * 0.94, 0.0042, 28), mat); body.castShadow = true; g.add(body);
      const rim = new T.Mesh(new T.TorusGeometry(r * 0.86, r * 0.13, 8, 28), mat); rim.rotation.x = Math.PI / 2; rim.position.y = 0.0022; g.add(rim);
      const hm = new T.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
      [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([a, b]) => { const h = new T.Mesh(new T.CylinderGeometry(r * 0.1, r * 0.1, 0.0046, 8), hm); h.position.set(a * r * 0.24, 0.0003, b * r * 0.24); g.add(h); });
      return g;
    };
    const putBtn = (r, mat, grid, yb, th, off) => { const b = btn3d(r, mat); placeOn(b, grid, yb, th, off + 0.0022); M.add(b); return b; };
    // tube with wall thickness and end rings (cuffs, waistband-like bands on limbs)
    const ringSlab = (path, thick, mat) => {
      add(tubeGeo(path, 36), mat);
      add(tubeGeo(path.map(q => ({ p: q.p, r: q.r - thick })), 36), mat);
      [0, path.length - 1].forEach(k => {
        const q = path[k], d = path[Math.min(path.length - 1, k + 1)].p.clone().sub(path[Math.max(0, k - 1)].p).normalize();
        const ring = new T.Mesh(new T.RingGeometry(q.r - thick, q.r, 36), mat);
        ring.position.copy(q.p); ring.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), d); M.add(ring);
      });
    };
    const shirtBtnMat = () => new T.MeshPhysicalMaterial({ color: 0xf4f1ea, roughness: 0.18, clearcoat: 0.6 });
    const welt = (grid, yb, thc, w, off, mat, h) => {
      slabOn(grid, yb - 0.0035, yb + 0.0035, thc, w + 0.004, off + 0.0004, 0.0012, darkMat());            // the opening
      slabOn(grid, yb - (h || 0.009), yb - 0.0032, thc, w, off, 0.0028, mat);                                // lower welt lip
      slabOn(grid, yb + 0.0032, yb + 0.0065, thc, w, off, 0.0022, mat);                                       // upper jet
    };
    const flap = (grid, yb, thc, w, h, off, mat) => {
      slabOn(grid, yb - 0.0025, yb + 0.0025, thc, w + 0.004, off + 0.0004, 0.0012, darkMat());
      slabOn(grid, yb - h, yb + 0.002, thc, w, off + 0.0012, (u, v) => 0.0026 + 0.0018 * v, mat);           // flap, thicker at the seam
    };
    const patchPocket = (grid, yb, thc, w, h, off, mat) => slabOn(grid, yb - h, yb, thc, w, off, 0.0022, mat);

    // ---------- shared sleeve radii (shirt inside, coat outside) ----------
    const shirtSleeve = (chn) => {
      const wt = wristT(chn);
      const ease = 0.008 + fitE * 1.2;
      return { wt, path: chainPath(chn, 0.025, wt + 0.004, 32, (t, r) => Math.min(0.056 * fr.kA + ease, Math.max(r + ease, lerp(0.058 * fr.kA, 0.04 * fr.kA, t)))) };
    };

    // =============== SHIRT (full garment) ===============
    if (hasShirt) {
      const tucked = hasPants;
      const hemY = tucked ? wy - 0.11 : cr + 0.01;
      const y0 = tucked ? () => hemY : (th) => hemY - 0.04 * Math.pow(Math.abs(Math.cos(th)), 2) + 0.012 * Math.pow(Math.abs(Math.sin(th)), 4);
      const sTop = nkC;
      const off = (yb, th) => L.shirt * sstep(sTop + 0.01, sTop - 0.05, yb) + 0.0025 + 0.032 * Math.exp(-Math.pow((yb - ap - 0.05) / 0.07, 2)) * Math.pow(Math.abs(Math.sin(th || 0)), 3);
      add(shellGeo({ grid: D, y0, y1: sTop, ny: 70, nt: 84, off }), shirtMat());
      // front placket: a real doubled strip of cloth, buttoned
      const plTop = nkC - 0.016;
      slabOn(D, hemY + (tucked ? 0.0 : 0.004), plTop, 0, 0.032, off(ch, 0), 0.0022, shirtMat(0.985), { nu: 4 });
      const nb = 7;
      for (let k = 0; k < nb; k++) {
        const yb = lerp(plTop - 0.035, Math.max(hemY + 0.07, wy - 0.07), k / (nb - 1));
        putBtn(0.0052, shirtBtnMat(), D, yb, 0, off(yb, 0) + 0.0022);
      }
      // collar band: hugs the neck, closed at the front
      const bandOff = 0.0032;
      const bandTop = nkC + 0.026, bandBot = nkC - 0.014;
      add(slabGeo(48, 4, (u, v) => {
        const th = lerp(0.07, TAU - 0.07, u), yb = lerp(bandBot, bandTop, v);
        return V3(S(D, yb, th, neckR(th) + bandOff - radAt(D, yb, th, 0)));
      }, 0.0024), shirtMat(1.0));
      putBtn(0.0042, shirtBtnMat(), D, nkC + 0.004, 0.09, neckR(0.09) + bandOff + 0.0024 - radAt(D, nkC + 0.004, 0.09, 0));
      // pointed collar leaves: fold at the top of the band, points lying on the chest
      const cst = c.collar || 'spread';
      const thPt = { spread: 0.48, button: 0.34, cutaway: 0.72 }[cst] ?? 0.48;
      const thF = 0.1, foldY = bandTop + 0.004, ptY = nk - 0.062;
      add(slabGeo(64, 8, (u, v) => {
        // u: 0 = left front edge -> back -> 1 = right front edge
        const side = u < 0.5 ? 1 : -1, uu = u < 0.5 ? u * 2 : (1 - u) * 2;      // 0 at front edge, 1 at centre back
        const phiTop = lerp(thF, Math.PI, uu);
        const phiBot = lerp(thPt, Math.PI, uu);
        const phi = lerp(phiTop, phiBot, v);
        const yBot = lerp(ptY, nkC + 0.004, sstep(0, 0.15, uu));
        const yb = lerp(foldY, yBot, v);
        const neckLay = neckR(phi) + bandOff + 0.0024 + 0.0014 + 0.004 * v;
        const lie = (radAt(D, yb, phi, off(yb, phi)) + 0.0014) * (phi < 0.95 ? 1 : 0);
        const r = Math.max(neckLay, lie);
        return V3(S(D, yb, side * phi, r - radAt(D, yb, side * phi, 0)));
      }, 0.0022, {}), shirtMat(1.0));
      if (cst === 'button') [-1, 1].forEach(s => putBtn(0.0033, shirtBtnMat(), D, ptY + 0.012, s * (thPt - 0.03), off(ptY, thPt) + 0.0052));
      // sleeves + cuffs joined to them
      const french = (c.cuff || 'barrel') === 'french';
      fr.arms.forEach((chn, si) => {
        const { wt, path } = shirtSleeve(chn);
        add(tubeGeo(path, 36), shirtMat());
        sleeveCap(path, shirtMat());
        const wr = chainPath(chn, wt - 0.002, wt + 0.002, 1, (t, r) => r)[0].r;
        const cuffR = wr + (french ? 0.012 : 0.0095);
        const cuff = chainPath(chn, wt - 0.05, wt + (french ? 0.03 : 0.02), 6, () => cuffR).map(q => ({ p: q.p, r: cuffR }));
        ringSlab(cuff, 0.0026, shirtMat(1.0));
        const endP = cuff[cuff.length - 1].p, endD = endP.clone().sub(cuff[0].p).normalize();
        const o = new T.Vector3(si ? -0.55 : 0.55, 0, 0.83).normalize();
        if (french) {
          const gold = new T.MeshStandardMaterial({ color: 0xc9a25e, metalness: 0.9, roughness: 0.25 });
          const link = add(new T.CylinderGeometry(0.0055, 0.0055, 0.003, 20), gold);
          link.position.copy(endP).addScaledVector(endD, -0.02).addScaledVector(o, cuffR + 0.002);
          link.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), o);
        } else {
          const b = btn3d(0.0042, shirtBtnMat());
          b.position.copy(endP).addScaledVector(endD, -0.018).addScaledVector(o, cuffR + 0.0015);
          b.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), o); M.add(b);
        }
      });
    }

    // =============== TROUSERS (full garment) ===============
    if (hasPants) {
      const tOff = L.pants;
      const top = wy - 0.004;
      add(shellGeo({ grid: D, y0: cr - 0.03, y1: top, ny: 30, nt: 80, rot: Math.PI, off: (yb) => tOff - 0.003 * sstep(cr + 0.04, cr - 0.02, yb) }), fabMat(1, T.DoubleSide));
      // waistband: a real band of cloth with its own thickness
      const wbH = 0.038;
      add(slabGeo(96, 3, (u, v) => V3(S(D, lerp(top - wbH, top, v), lerp(0, TAU, u) + 0.15, tOff + 0.0006)), 0.0032, {}), fabMat(0.95));
      // extension tab + button at the front
      slabOn(D, top - wbH, top, 0.09, 0.05, tOff + 0.0035, 0.0025, fabMat(0.97), { nu: 4 });
      putBtn(0.0068, btnMat(), D, top - wbH / 2, 0.075, tOff + 0.006);
      // belt loops
      [-1.3, -0.55, 0.55, 1.3, Math.PI - 0.45, Math.PI + 0.45, Math.PI].forEach(th => slabOn(D, top - wbH - 0.008, top + 0.004, th, 0.011, tOff + 0.0038, 0.0026, fabMat(0.97), { nu: 2 }));
      // fly: a stitched fold of cloth on the wearer's left
      slabOn(D, cr + 0.035, top - wbH, 0.11, 0.036, tOff + 0.0004, (u, v) => 0.0022 * (1 - 0.6 * u), fabMat(0.98), { nu: 4, roundU0: true });
      // front pockets: slanted openings with a facing that lifts off the leg
      [-1, 1].forEach(s => {
        const y0p = top - wbH - 0.002, y1p = top - wbH - 0.16;
        add(slabGeo(3, 16, (u, v) => {
          const yb = lerp(y0p, y1p, v), th = s * lerp(0.62, 1.2, v) + s * u * 0.016 / radAt(D, yb, 0.9, tOff);
          return V3(S(D, yb, th, tOff + 0.0004));
        }, (u, v) => 0.0035 * (1 - u), { roundU0: true }), fabMat(0.96));
        add(slabGeo(2, 16, (u, v) => {
          const yb = lerp(y0p, y1p, v), th = s * lerp(0.62, 1.2, v) - s * (0.004 + u * 0.003) / radAt(D, yb, 0.9, tOff);
          return V3(S(D, yb, th, tOff + 0.0002));
        }, 0.0008), darkMat());
      });
      // back pockets: welts or flaps
      const st = c.pockets || 'jetted';
      [-1, 1].forEach(s => {
        const yb = top - wbH - 0.045, thc = Math.PI + s * 0.48;
        welt(D, yb, thc, 0.12, tOff, fabMat(0.96));
        if (st === 'flap' || st === 'ticket') { flap(D, yb + 0.006, thc, 0.128, 0.05, tOff + 0.003, fabMat(0.98)); putBtn(0.0055, btnMat(), D, yb - 0.03, thc, tOff + 0.0075); }
        else if (st === 'patch') patchPocket(D, yb + 0.01, thc, 0.13, 0.14, tOff + 0.0005, fabMat(0.98));
      });
      // legs
      const hemR = { slim: 0.06, regular: 0.068, relaxed: 0.078 }[fit] || 0.068;
      fr.legs.forEach((chn) => {
        const topP = chn[0].p, ank = chn[chn.length - 1].p;
        const y0w = fr.Y(cr + 0.05), y1w = 0.035;
        const n = 36, path = [];
        for (let k = 0; k <= n; k++) {
          const t = k / n, yw = lerp(y0w, y1w, t);
          const f = clamp((topP.y - yw) / (topP.y - ank.y), 0, 1.2);
          const p = topP.clone().lerp(ank, f);
          let i = 1; while (i < chn.length - 2 && chn[i + 1].p.y > yw) i++;
          const ff = clamp((chn[i].p.y - yw) / (chn[i].p.y - chn[i + 1].p.y), 0, 1);
          const cc = chn[i].p.clone().lerp(chn[i + 1].p, ff);
          if (yw < fr.Y(cr - 0.1) && yw > ank.y) { const bl = sstep(fr.Y(cr - 0.1), fr.Y(cr - 0.2), yw); p.x = lerp(p.x, cc.x, 0.5 * bl); p.z = lerp(p.z, cc.z, 0.7 * bl); }
          const rr = Math.min(lerp(chn[i].r, chn[i + 1].r, ff), 0.088 * fr.kLg) * 1.04 + 0.004;
          const rTop = Math.max(Math.min(chn[2].r, 0.086 * fr.kLg) + tOff + 0.004, radAt(D, cr + 0.06, Math.PI / 2, tOff) * 0.5 + 0.004);
          const q = { p, r: Math.max(rr + tOff * 0.8, lerp(rTop, hemR * fr.kLg / fr.u, Math.pow(t, 0.85))) };
          // near the crotch the leg fills its half of the seat, so seat and leg are one surface
          const yb = yw / fr.kL, w = 1 - sstep(cr - 0.01, cr - 0.17, yb);
          if (w > 0) {
            const sd = Math.sign(p.x) || 1;
            const zf = S(D, yb, 0, tOff)[2], zb = S(D, yb, Math.PI, tOff)[2], xs = Math.abs(S(D, yb, sd * Math.PI / 2, tOff)[0]);
            q.p = p.clone(); q.p.z = lerp(p.z, (zf + zb) / 2, w); q.p.x = lerp(p.x, sd * xs / 2, w);
            q.rx = lerp(q.r, Math.max(q.r, xs / 2 + 0.002), w);
            q.r = lerp(q.r, Math.max(q.r, (zf - zb) / 2), w);
          }
          path.push(q);
        }
        { const R0 = path.map(q => q.r), X0 = path.map(q => q.rx || q.r); path.forEach((q, i) => { if (q.rx) { let s2 = 0, w2 = 0; for (let k = -4; k <= 4; k++) { const ww = Math.exp(-k * k / 8); s2 += X0[clamp(i + k, 0, X0.length - 1)] * ww; w2 += ww; } q.rx = Math.max(s2 / w2, X0[i] * 0.985); } let s = 0, w = 0; for (let k = -4; k <= 4; k++) { const ww = Math.exp(-k * k / 8); s += R0[clamp(i + k, 0, R0.length - 1)] * ww; w += ww; } q.r = Math.max(s / w, R0[i] * 0.985); }); }
        add(tubeGeo(path, 44), fabMat(1, T.DoubleSide));
        ringSlab(path.slice(-4).map(q => ({ p: q.p, r: q.r + 0.0012 })), 0.003, fabMat(0.96));
      });
    }

    // two overlapping fronts: left front (wearer's left, +x) laps over the right
    const frontPair = (o) => {
      // o: grid, y0, y1, a(yb) half-opening, ov(yb) overlap angle, off(yb,th), ny, nt, mat(), lining()
      const lft = { grid: o.grid, ny: o.ny, nt: o.nt, y0: o.y0, y1: o.y1, th0: (yb) => o.a(yb) - o.ov(yb), th1: () => Math.PI, off: (yb, th) => o.off(yb, th) + 0.0026 * sstep(0.35, -0.2, th) };
      const rgt = { grid: o.grid, ny: o.ny, nt: o.nt, y0: o.y0, y1: o.y1, th0: () => Math.PI, th1: (yb) => TAU - o.a(yb) + o.ov(yb), off: o.off };
      const gl = panelGeo(lft), gr = panelGeo(rgt);
      add(gl, o.mat()); add(gr, o.mat());
      if (o.lining) { add(gl.clone(), o.lining()); add(gr.clone(), o.lining()); }
      // cut edge of the top (left) front, so the overlap reads as a separate layer
      const ys = []; for (let k = 0; k <= 60; k++) ys.push(lerp(o.edgeY0, o.edgeY1, k / 60));
      edgeWall(o.grid, ys, (yb) => o.a(yb) - o.ov(yb), (yb, th) => o.off(yb, th) + 0.0026, 0.004, o.mat());
      edgeWall(o.grid, ys, (yb) => -(o.a(yb) - o.ov(yb)), (yb, th) => o.off(yb, th), 0.003, o.mat());
    };

    // =============== WAISTCOAT (full garment) ===============
    if (hasWc) {
      const btnTop = ch - 0.035, wTop = nkC - 0.012, wHem = wy - 0.105;
      const opened = c.openFront && !hasCoat ? 1 : 0;
      const wA = (yb) => {
        let a;
        if (yb >= btnTop) a = 0.02 + 0.76 * Math.pow((yb - btnTop) / (wTop - btnTop), 0.85);
        else if (yb >= wy - 0.04) a = 0.02;
        else a = 0.02 + 0.32 * (wy - 0.04 - yb) / (wy - 0.04 - wHem);
        return a + opened * 0.35 * (1 - sstep(btnTop, wTop, yb));
      };
      const ovA = (yb) => opened ? 0 : (0.014 / 0.15) * sstep(btnTop + 0.03, btnTop - 0.01, yb) * sstep(wHem, wy - 0.03, yb);
      const y0 = (th) => wHem + 0.04 * sstep(0.25, 1.4, Math.abs(wrapPi(th)));
      const y1 = (th) => lerp(wTop, ap - 0.035, sstep(0.72, 0.93, Math.abs(Math.sin(th))));
      const off = (yb, th) => lerp(L.wc + 0.003 * sstep(wy, wHem, yb), L.shirt + 0.006, sstep(shY - 0.03, wTop, yb)) + 0.037 * Math.exp(-Math.pow((yb - ap - 0.05) / 0.07, 2)) * Math.pow(Math.abs(Math.sin(th || 0)), 3) + 0.01 * Math.exp(-Math.pow((yb - shY + 0.02) / 0.05, 2)) * sstep(0.6, 1.0, Math.abs(Math.sin(th || 0)));
      frontPair({ grid: D, y0, y1, a: wA, ov: ovA, off, ny: 60, nt: 46, mat: () => fabMat(1), lining: () => (c.lining === 'half' ? fabMat(0.8, T.BackSide) : liningMat(T.BackSide)), edgeY0: wHem - 0.01, edgeY1: wTop });
      if (!opened) for (let k = 0; k < 5; k++) {
        const yb = lerp(btnTop - 0.01, wy - 0.045, k / 4);
        putBtn(0.0075, btnMat(), D, yb, wA(yb) + 0.004, off(yb) + 0.0028);
      }
      const st = c.pockets || 'jetted';
      [-1, 1].forEach(s => {
        if (st === 'flap' || st === 'ticket') flap(D, wy - 0.03, s * 0.85, 0.095, 0.034, off(wy) + 0.0028 * (s > 0), fabMat(0.98));
        else welt(D, wy - 0.03, s * 0.85, 0.095, off(wy) + 0.0026 * (s > 0), fabMat(0.98));
      });
      welt(D, ch - 0.005, 0.8, 0.075, off(ch) + 0.0026, fabMat(0.98));
      // back cinch strap with buckle
      slabOn(D, wy + 0.01, wy + 0.03, Math.PI, 0.13, off(wy) + 0.0004, 0.002, liningMat(T.DoubleSide), { nu: 6 });
    }

    // =============== COAT (full garment) ===============
    if (hasCoat) {
      const G = DC;
      const hemY = cr - 0.045, btnY = wy + 0.01, topY = nkC - 0.01, open = c.openFront ? 1 : 0;
      const off = (yb, th) => {
        let o = L.coat;
        if (yb < wy) o += (wy - yb) * 0.05;
        if (yb > ap && yb < shY + 0.04) o += 0.006 * sstep(ap, shY, yb);
        if (fit === 'slim') o -= 0.005 * Math.exp(-Math.pow((yb - wy) / 0.06, 2));
        o += 0.04 * Math.exp(-Math.pow((yb - ap - 0.05) / 0.07, 2)) * Math.pow(Math.abs(Math.sin(th || 0)), 3);
        // the neckline closes in to sit on the shirt collar instead of standing off the body
        return lerp(o, L.shirt + 0.011, sstep(shY - 0.03, topY + 0.004, yb));
      };
      const jA = (yb) => {
        let a;
        if (yb >= btnY) a = 0.62 * Math.pow((yb - btnY) / (topY - btnY), 1.05);
        else a = 0.5 * Math.pow((btnY - yb) / (btnY - hemY), 1.6);
        if (open) { const t = clamp((yb - hemY) / (shY - hemY), 0, 1); a += 0.42 * (1 - t * t); }
        return a;
      };
      const ovA = (yb) => open ? 0 : (0.016 / 0.16) * sstep(btnY + 0.05, btnY + 0.005, yb) * sstep(btnY - 0.13, btnY - 0.06, yb);
      const y0 = (th) => hemY + 0.02 * Math.pow(Math.abs(Math.cos(th)), 4);
      const lin = c.lining || 'bemberg';
      frontPair({ grid: G, y0, y1: topY, a: jA, ov: ovA, off, ny: 84, nt: 48, mat: () => fabMat(1), lining: () => (lin === 'half' ? fabMat(0.85, T.BackSide) : liningMat(T.BackSide)), edgeY0: hemY, edgeY1: topY });

      // lapels: turned-back cloth with a rolled fold edge, lying on the fronts
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
        const R = radAt(G, yb, a, base);
        const th = a + u * pl(Wp, v) / R;
        const rollLift = 0.0045 * Math.pow(1 - u, 1.6) * sstep(0, 0.35, v);   // lapel rolls up off the chest near the fold
        const p = S(G, yy, th, base + 0.0004 + rollLift);
        return V3([p[0] * s, p[1], p[2]]);
      }, (u, v) => 0.0032, { roundU0: true }), lapMat());
      lapelPiece(1); lapelPiece(-1);
      // upper collar: a folded band round the back of the neck meeting the lapels at the gorge
      add(slabGeo(56, 5, (u, v) => {
        const th = lerp(0.6, TAU - 0.6, u), yb = lerp(nkC + 0.012, nkC - 0.022, v);
        const r = neckR(th) + (hasShirt ? 0.0095 : 0.004) + 0.006 * v;
        return V3(S(G, yb, th, r - radAt(G, yb, th, 0)));
      }, 0.0034, { roundU0: false }), fabMat(1.0, T.DoubleSide));

      if (!open) [btnY, btnY - 0.1].forEach((yb, k) => putBtn(0.0105, btnMat(), G, yb, -ovA(yb) * 0.15, off(yb, 0) + 0.0026));
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
      // pocket square: two folded points
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
      // sleeves: always outside the shirt sleeve
      fr.arms.forEach((chn, si) => {
        const wt = wristT(chn);
        const inner = hasShirt ? shirtSleeve(chn).path : null;
        const sE = { slim: 0.012, regular: 0.017, relaxed: 0.025 }[fit] || 0.017;
        const rTop = 0.064 * fr.kA + sE, rCuff = 0.05 * fr.kA + 0.005;
        const path = chainPath(chn, 0.0, wt - 0.014, 36, (t, r) => Math.min(rTop + 0.006, Math.max(r + sE * 0.8, lerp(rTop, rCuff, Math.pow(t, 0.9)))));
        if (inner) path.forEach(q => {
          let best = inner[0]; inner.forEach(z => { if (z.p.distanceToSquared(q.p) < best.p.distanceToSquared(q.p)) best = z; });
          q.r = Math.max(q.r, best.r + 0.007);
        });
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
