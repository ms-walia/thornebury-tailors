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
    const fC = clamp(chest / chestB, 0.72, 1.7), fW = clamp(waist / waistB, 0.68, 1.9), fH = clamp(hip / hipB, 0.72, 1.7);
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
    const fr = { A, H, g, hs, u, fx, fz, Y, kA, kLg, dxA, dxL, crotchT, kL };
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
        const tx = x * fr.u * fr.fx(y), tz = z * fr.u * fr.fz(y), ty = fr.Y(y);
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
      return [Math.sin(th) * (R * fr.u * fr.fx(yb) + off), fr.Y(yb), Math.cos(th) * (R * fr.u * fr.fz(yb) + off) + czAt(yb)];
    };
    const radAt = (grid, yb, th, off) => { const p = S(grid, yb, th, off); return Math.hypot(p[0], p[2] - czAt(yb)); };
    const GT = A.drape, G = GT;

    // generic shell: rows over yb in [y0(th), y1(th)], columns th in [a(yb), TAU - a(yb)] (+rot)
    const gusset = (yb, th) => 0.045 * Math.exp(-Math.pow((yb - ap - 0.03) / 0.065, 2)) * Math.pow(Math.abs(Math.sin(th)), 2.5);
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
      const cap = add(new T.SphereGeometry(path[0].r, 32, 14, 0, TAU, 0, Math.PI / 2), mat);
      cap.position.copy(p0); cap.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir);
      cap.scale.set(1, 0.55, 1);
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

    // =============== SHIRT ===============
    if (hasShirt) {
      const sOff = { slim: 0.004, regular: 0.007, relaxed: 0.012 }[fit] || 0.006;
      const tucked = hasPants;
      const hemY = tucked ? wy - 0.1 : cr + 0.015;
      const y0 = tucked ? () => hemY : (th) => hemY - 0.035 * Math.pow(Math.abs(Math.cos(th)), 2);
      const sTop = nk - 0.012;
      const off = (yb) => sOff * sstep(sTop, sTop - 0.06, yb) + 0.002;
      add(shellGeo({ grid: GT, y0, y1: sTop, ny: 60, nt: 72, off, gusset: true }), shirtMat());
      // placket + buttons
      patch(G, hemY + 0.02, nk - 0.01, 0, 0.032, off(ch) + 0.0012, shirtMat(0.97));
      const nb = 7;
      for (let k = 0; k < nb; k++) {
        const yb = lerp(nk - 0.06, Math.max(hemY + 0.06, wy - 0.06), k / (nb - 1));
        const b = button(0.0052, new T.MeshPhysicalMaterial({ color: 0xf2efe8, roughness: 0.2, clearcoat: 0.5 }));
        placeOn(b, G, yb, 0, off(yb) + 0.002); b.castShadow = true; M.add(b);
      }
      // collar: stand + turned-down leaves
      const cst = c.collar || 'spread';
      const standOff = 0.008;
      add(shellGeo({ grid: GT, y0: nk - 0.006, y1: nk + 0.016, ny: 3, nt: 48, a: () => 0.12, off: standOff }), shirtMat());
      const spread = { spread: 0.55, button: 0.36, cutaway: 0.85 }[cst] ?? 0.55;
      add(shellGeo({
        grid: GT, ny: 6, nt: 56,
        y0: (th) => nk - 0.012 - 0.066 * Math.pow(Math.abs(Math.cos(th / 2)), 6),
        y1: nk + 0.018,
        a: (yb) => lerp(spread, 0.1, sstep(nk - 0.08, nk + 0.012, yb)),
        off: (yb, th) => {
          const base = radAt(GT, yb, th, 0);
          const neckR = radAt(GT, nk + 0.004, th, 0) + standOff + 0.004 + 0.016 * sstep(nk + 0.012, nk - 0.06, yb);
          const lie = Math.max(radAt(GT, yb, th, off(yb)), yb > nk - 0.008 ? radAt(GT, yb, th, standOff) : 0) + 0.004;
          return Math.max(neckR, lie) - base;
        }
      }), shirtMat(0.95));
      if (cst === 'button') [-1, 1].forEach(s => {
        const b = button(0.0035, new T.MeshPhysicalMaterial({ color: 0xf2efe8, roughness: 0.2 }));
        placeOn(b, GT, nk - 0.07, s * 0.62, standOff + 0.026); M.add(b);
      });
      // sleeves
      const cuffFrench = (c.cuff || 'barrel') === 'french';
      fr.arms.forEach((chn, si) => {
        const wt = wristT(chn);
        const ease = { slim: 0.01, regular: 0.014, relaxed: 0.02 }[fit] || 0.014;
        if (!hasCoat) {
          const path = chainPath(chn, 0.035, wt + 0.01, 30, (t, r) => Math.min(0.056 * fr.kA + ease, Math.max(r + ease, lerp(0.06 * fr.kA, 0.043 * fr.kA, t))));
          add(tubeGeo(path, 36), shirtMat());
          sleeveCap(path, shirtMat());
        }
        const cuff = chainPath(chn, wt - (hasCoat ? 0.0 : 0.04), wt + (cuffFrench ? 0.03 : 0.022), 4, () => (cuffFrench ? 0.044 : 0.041) * fr.kA);
        add(tubeGeo(cuff, 32), shirtMat(1.02));
        const endP = cuff[cuff.length - 1].p, endD = new T.Vector3().subVectors(endP, cuff[0].p).normalize();
        if (cuffFrench) {
          const link = add(new T.SphereGeometry(0.0055, 16, 12), new T.MeshStandardMaterial({ color: 0xc9a25e, metalness: 0.9, roughness: 0.25 }));
          link.position.copy(endP).addScaledVector(endD, -0.012).add(new T.Vector3(si ? 0.02 : -0.02, 0, 0.034));
        } else {
          const b = button(0.0042, new T.MeshPhysicalMaterial({ color: 0xf2efe8, roughness: 0.2 }));
          const o = new T.Vector3(si ? -0.6 : 0.6, 0, 0.8).normalize();
          b.position.copy(endP).addScaledVector(endD, -0.012).addScaledVector(o, 0.043 * fr.kA);
          b.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), o); M.add(b);
        }
      });
    }

    // =============== TROUSERS ===============
    if (hasPants) {
      const tOff = { slim: 0.01, regular: 0.016, relaxed: 0.024 }[fit] || 0.016;
      const GT = A.hullTorso;
      const top = wy - 0.015;
      const pMat = fabMat(1, T.DoubleSide);
      add(shellGeo({ grid: GT, y0: cr - 0.05, y1: top, ny: 30, nt: 72, rot: Math.PI, off: (yb) => tOff + 0.006 * sstep(cr + 0.05, cr - 0.05, yb) }), pMat);
      add(shellGeo({ grid: GT, y0: top - 0.035, y1: top + 0.002, ny: 2, nt: 72, rot: Math.PI, off: tOff + 0.003 }), fabMat(0.88));
      // fly + belt loops
      patch(GT, cr + 0.03, top - 0.035, 0.05, 0.004, tOff + 0.0035, darkMat());
      [-1.25, -0.45, 0.45, 1.25, Math.PI].forEach(th => patch(GT, top - 0.04, top + 0.004, th, 0.01, tOff + 0.005, fabMat(0.9, T.DoubleSide)));
      const btn = button(0.0068, btnMat()); placeOn(btn, GT, top - 0.018, 0.0, tOff + 0.005); M.add(btn);
      const hemR = { slim: 0.06, regular: 0.068, relaxed: 0.078 }[fit] || 0.068;
      fr.legs.forEach((chn) => {
        const topP = chn[0].p, ank = chn[chn.length - 1].p;
        const y0w = fr.Y(cr + 0.04), y1w = 0.035;
        const n = 34, path = [];
        for (let k = 0; k <= n; k++) {
          const t = k / n, yw = lerp(y0w, y1w, t);
          const f = clamp((topP.y - yw) / (topP.y - ank.y), 0, 1.2);
          const p = topP.clone().lerp(ank, f);
          let i = 1; while (i < chn.length - 2 && chn[i + 1].p.y > yw) i++;
          const ff = clamp((chn[i].p.y - yw) / (chn[i].p.y - chn[i + 1].p.y), 0, 1);
          const cc = chn[i].p.clone().lerp(chn[i + 1].p, ff);
          if (yw < fr.Y(cr - 0.1) && yw > ank.y) { const bl = sstep(fr.Y(cr - 0.1), fr.Y(cr - 0.2), yw); p.x = lerp(p.x, cc.x, 0.5 * bl); p.z = lerp(p.z, cc.z, 0.7 * bl); }
          const rr = Math.min(lerp(chn[i].r, chn[i + 1].r, ff), 0.088 * fr.kLg) * 1.04 + 0.004;
          const rTop = Math.min(chn[2].r, 0.086 * fr.kLg) + tOff;
          path.push({ p, r: Math.max(rr + tOff * 0.8, lerp(rTop, hemR * fr.kLg / fr.u, Math.pow(t, 0.85))) });
        }
        add(tubeGeo(path, 40), fabMat(1, T.DoubleSide));
        // turned hem band
        add(tubeGeo(path.slice(-3).map(q => ({ p: q.p, r: q.r + 0.0015 })), 40), fabMat(0.93, T.DoubleSide));
      });
      const st = c.pockets || 'jetted';
      [-1, 1].forEach(s => patch(GT, cr + 0.055, top - 0.04, s * 1.15, 0.005, tOff + 0.003, darkMat()));
      [-1, 1].forEach(s => pocketSet(GT, top - 0.05, Math.PI + s * 0.45, 0.12, c.garment === 'pants' && st !== 'ticket' ? st : 'jetted', tOff, 0.045));
    }

    // =============== WAISTCOAT ===============
    if (hasWc) {
      const e = { slim: 0.008, regular: 0.012, relaxed: 0.018 }[fit] || 0.012;
      const wOff = (hasShirt ? 0.009 : 0) + e;
      const btnTop = ch - 0.035, wTop = nk - 0.012, wHem = wy - 0.1;
      const opened = c.openFront && !hasCoat ? 0.35 : 0;
      const wA = (yb) => {
        let a;
        if (yb >= btnTop) a = 0.035 + 0.74 * Math.pow((yb - btnTop) / (wTop - btnTop), 0.85);
        else if (yb >= wy - 0.04) a = 0.035;
        else a = 0.035 + 0.3 * (wy - 0.04 - yb) / (wy - 0.04 - wHem);
        return a + opened * (1 - sstep(btnTop, wTop, yb));
      };
      const y0 = (th) => wHem + 0.035 * sstep(0.3, 1.4, Math.abs(wrapPi(th)));
      const y1 = (th) => lerp(wTop, ap - 0.03, sstep(0.72, 0.93, Math.abs(Math.sin(th))));
      const off = (yb) => wOff + 0.004 * sstep(wy, wHem, yb);
      const outer = shellGeo({ grid: GT, y0, y1, ny: 56, nt: 84, a: wA, off });
      add(outer, fabMat(1));
      add(outer.clone(), (c.lining === 'half' ? fabMat(0.8, T.BackSide) : liningMat(T.BackSide)));
      if (!opened) for (let k = 0; k < 5; k++) {
        const yb = lerp(btnTop - 0.008, wy - 0.045, k / 4);
        const b = button(0.0078, btnMat()); b.castShadow = true;
        placeOn(b, GT, yb, wA(yb) + 0.032, off(yb) + 0.003); M.add(b);
      }
      const st = c.pockets || 'jetted';
      if (!hasCoat || true) {
        [-1, 1].forEach(s => pocketSet(GT, wy - 0.035, s * 0.85, 0.095, st === 'ticket' || st === 'patch' ? 'jetted' : st, off(wy - 0.035), 0.032));
        patch(GT, ch - 0.01, ch + 0.006, 0.8, 0.075, off(ch) + 0.0035, darkMat());
      }
      // back cinch strap
      patch(GT, wy + 0.01, wy + 0.03, Math.PI, 0.12, off(wy) + 0.004, liningMat(T.DoubleSide));
    }

    // =============== COAT ===============
    if (hasCoat) {
      const eJ = { slim: 0.016, regular: 0.024, relaxed: 0.036 }[fit] || 0.024;
      const under = hasWc ? 0.016 : (hasShirt ? 0.008 : 0);
      const hemY = cr - 0.045, btnY = wy + 0.01, topY = nk - 0.018, open = c.openFront ? 1 : 0;
      const off = (yb, th) => {
        let o = eJ + under;
        if (yb < wy) o += (wy - yb) * 0.11;               // skirt falls away from the seat
        if (yb > ap && yb < shY + 0.04) o += 0.006 * sstep(ap, shY, yb); // shoulder pad
        if (fit === 'slim') o -= 0.006 * Math.exp(-Math.pow((yb - wy) / 0.06, 2));
        return o;
      };
      const jA = (yb) => {
        let a;
        if (yb >= btnY) a = 0.6 * Math.pow((yb - btnY) / (topY - btnY), 1.05);
        else a = 0.5 * Math.pow((btnY - yb) / (btnY - hemY), 1.6);
        if (open) { const t = clamp((yb - hemY) / (shY - hemY), 0, 1); a += 0.42 * (1 - t * t); }
        return a;
      };
      const y0 = (th) => hemY + 0.02 * Math.pow(Math.abs(Math.cos(th)), 4);
      const outer = shellGeo({ grid: G, y0, y1: topY, ny: 80, nt: 88, a: jA, off, gusset: true });
      add(outer, fabMat(1));
      const lin = c.lining || 'bemberg';
      if (lin === 'half') {
        add(shellGeo({ grid: G, y0: wy - 0.02, y1: topY, ny: 50, nt: 88, a: jA, off }), liningMat(T.BackSide));
        add(shellGeo({ grid: G, y0, y1: wy - 0.02, ny: 24, nt: 88, a: jA, off }), fabMat(0.8, T.BackSide));
      } else add(outer.clone(), liningMat(T.BackSide));

      // collar band round the back of the neck
      add(shellGeo({ grid: GT, y0: nk - 0.035, y1: nk + 0.0, ny: 4, nt: 56, a: () => 1.05, off: (yb) => off(nk, 0) + 0.004 }), fabMat(0.96, T.DoubleSide));

      // lapels
      const lapel = c.lapel || 'notch';
      const satin = kind === 'blend' && lapel !== 'notch';
      const lapMat = satin
        ? new T.MeshPhysicalMaterial({ color: col.clone().multiplyScalar(0.75), roughness: 0.22, clearcoat: 0.3, side: T.DoubleSide })
        : fabMat(1.06, T.DoubleSide);
      const W = {
        notch: [[0, 0.006], [0.25, 0.042], [0.6, 0.074], [0.8, 0.086], [0.83, 0.05], [0.86, 0.028], [0.885, 0.05], [1, 0.044]],
        peak: [[0, 0.006], [0.25, 0.044], [0.6, 0.08], [0.82, 0.096], [0.88, 0.108], [0.9, 0.038], [1, 0.04]],
        shawl: [[0, 0.006], [0.3, 0.048], [0.65, 0.072], [0.85, 0.066], [1, 0.05]]
      }[lapel];
      const lift = lapel === 'peak' ? [[0, 0], [0.7, 0], [0.88, 0.035], [0.9, 0], [1, 0]] : [[0, 0], [1, 0]];
      const lTop = lapel === 'shawl' ? topY - 0.004 : lerp(btnY, topY, 0.86);
      [1, -1].forEach(s => add(gridGeo(6, 56, (u, v) => {
        const yb = lerp(btnY, lTop, v), yy = yb + pl(lift, v) * u;
        const a = jA(yb), R = radAt(G, yb, a, off(yb, a));
        const th = a + u * pl(W, v) / R;
        const p = S(G, Math.min(yy, topY), th, off(yb, th) + 0.004 + 0.002 * (1 - u));
        return [p[0] * s, p[1], p[2]];
      }), lapMat));

      if (!open) {
        [btnY, btnY - 0.1].forEach((yb, k) => {
          const b = button(0.0105, btnMat()); b.castShadow = true;
          placeOn(b, G, yb, jA(yb) + 0.045 + (k ? 0.01 : 0), off(yb, 0) + 0.004); M.add(b);
        });
      }
      const st = c.pockets || 'flap';
      const pY = cr + 0.1;
      [-1, 1].forEach(s => pocketSet(G, pY, s * 1.1, 0.15, st === 'ticket' ? 'flap' : st, off(pY, 1.1)));
      if (st === 'ticket') pocketSet(G, pY + 0.06, -1.03, 0.1, 'flap', off(pY + 0.06, 1), 0.038);
      const bY = ch + 0.02;
      if (st === 'patch') pocketSet(G, bY + 0.015, 0.78, 0.095, 'patch', off(bY, 0.8));
      else patch(G, bY, bY + 0.022, 0.78, 0.095, off(bY, 0.8) + 0.0035, fabMat(0.92, T.DoubleSide));
      // pocket square
      add(gridGeo(8, 1, (u, v) => {
        const yb = bY + 0.021 + v * (0.006 + 0.014 * (1 - Math.abs(u - 0.62) * 1.6));
        const R = radAt(G, yb, 0.78, off(yb, 0.78));
        return S(G, yb, 0.78 + (u - 0.5) * 0.07 / R, off(yb, 0.78) + 0.0045);
      }), new T.MeshStandardMaterial({ color: 0xf3f0e8, roughness: 0.7, side: T.DoubleSide }));
      if (lapel !== 'shawl') {
        const yb = lerp(btnY, lTop, 0.72), hole = new T.Mesh(new T.BoxGeometry(0.016, 0.002, 0.0045), new T.MeshStandardMaterial({ color: 0x9a2a2a, roughness: 0.6 }));
        const a = jA(yb), R = radAt(G, yb, a, off(yb, a));
        placeOn(hole, G, yb, a + 0.045 / R, off(yb, a) + 0.0085); M.add(hole);
      }
      // sleeves
      fr.arms.forEach((chn, si) => {
        const wt = wristT(chn);
        const sE = { slim: 0.012, regular: 0.018, relaxed: 0.026 }[fit] || 0.018;
        const rTop = (0.064 * fr.kA + sE), rCuff = 0.048 * fr.kA + 0.004;
        const path = chainPath(chn, 0.035, wt - 0.012, 34, (t, r) => Math.min(rTop + 0.006, Math.max(r + sE * 0.8, lerp(rTop, rCuff, Math.pow(t, 0.9)))));
        add(tubeGeo(path, 40), fabMat(1, T.DoubleSide));
        sleeveCap(path, fabMat(1));
        // cuff buttons
        const endP = path[path.length - 1].p, endD = new T.Vector3().subVectors(endP, path[path.length - 3].p).normalize();
        const o = new T.Vector3(si ? -0.75 : 0.75, 0, -0.66).normalize();
        for (let k = 0; k < 4; k++) {
          const d = 0.028 + k * 0.018;
          const b = button(0.0064, btnMat());
          b.position.copy(endP).addScaledVector(endD, -d).addScaledVector(o, rCuff + 0.002);
          b.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), o);
          b.castShadow = true; M.add(b);
        }
      });
    }
  }
}
if (!customElements.get('suit-viewer')) customElements.define('suit-viewer', SuitViewer);
export default SuitViewer;
