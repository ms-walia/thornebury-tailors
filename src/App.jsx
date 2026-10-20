import React from 'react';
import { GARMENTS, SUIT_FABRICS, SHIRT_FABRICS, GROUPS, FIELDS, STEP_TITLES } from './data.js';

const CONFIG = { defaultUnit: 'in', depositPercent: 40, rushService: false, autoRotate: true };
const isNum = (s) => /^\d+(\.\d+)?$/.test((s || '').trim());
const cache = new Map();
// 'a:b;c-d:e' -> { a: 'b', cD: 'e' }
function css(str) {
  if (!str) return undefined;
  if (cache.has(str)) return cache.get(str);
  const o = {};
  str.split(';').forEach(d => {
    const i = d.indexOf(':');
    if (i < 0) return;
    const k = d.slice(0, i).trim(), v = d.slice(i + 1).trim();
    if (!k) return;
    o[k.startsWith('--') ? k : k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
  });
  cache.set(str, o);
  return o;
}
const serif = "'Cormorant Garamond', Georgia, serif";
const eyebrow = (color, mb) => ({ fontSize: 12, letterSpacing: '0.3em', textTransform: 'uppercase', color, marginBottom: mb });

export default class App extends React.Component {
  state = {
    step: 1, garment: null, fabric: 'wool', color: 'W-104',
    opts: { lapel: 'notch', wcStyle: 'classic', collar: 'spread', cuff: 'barrel', button: 'horn', fit: 'regular', pockets: 'flap', lining: 'bemberg' },
    unit: null,
    m: { height: '', weight: '', neck: '', chest: '', waist: '', hip: '', shoulder: '', sleeve: '', inseam: '' },
    touched: false, placed: false, pickHint: false,
    autoRotate: null, closeUp: false, openFront: false, viewYaw: 0, viewNonce: 0,
    wide: typeof window !== 'undefined' ? window.innerWidth >= 960 : true,
    narrow: typeof window !== 'undefined' ? window.innerWidth < 640 : false,
    booking: { name: '', email: '', phone: '', date: '' }, interest: 'Full suit', notes: '',
    bookingSent: false, bookingError: ''
  };
  static defaultProps = CONFIG;

  componentDidMount() {
    this._onResize = () => {
      const w = window.innerWidth >= 960, n = window.innerWidth < 640;
      if (w !== this.state.wide || n !== this.state.narrow) this.setState({ wide: w, narrow: n });
    };
    this._onResize();
    window.addEventListener('resize', this._onResize);
  }
  componentWillUnmount() { window.removeEventListener('resize', this._onResize); }

  unit() { return this.state.unit || this.props.defaultUnit || 'in'; }
  metric() { return this.unit() === 'cm'; }
  garment() { return GARMENTS.find(g => g.id === this.state.garment) || null; }
  fabricList(gid) { return (gid || this.state.garment) === 'shirt' ? SHIRT_FABRICS : SUIT_FABRICS; }
  fabric() { const l = this.fabricList(); return l.find(f => f.id === this.state.fabric) || l[0]; }
  color() { const f = this.fabric(); return f.colors.find(c => c.code === this.state.color) || f.colors[0]; }
  activeGroups() { return GROUPS.filter(g => g.applies.includes(this.state.garment)); }
  activeFields() { return this.state.garment ? FIELDS.filter(f => f.for.includes(this.state.garment)) : FIELDS.filter(f => f.key === 'height' || f.key === 'weight'); }
  factor(f) { return this.metric() ? (f.type === 'wt' ? 0.4536 : 2.54) : 1; }
  unitOf(f) { return f.type === 'wt' ? (this.metric() ? 'kg' : 'lb') : (this.metric() ? 'cm' : 'in'); }

  optionsTotal() {
    return this.activeGroups().reduce((sum, g) => {
      const o = g.options.find(o => o.id === this.state.opts[g.key]);
      return sum + (o ? o.add : 0);
    }, 0);
  }
  clothCost() { const g = this.garment(); return g ? Math.round(g.meters * this.fabric().rate) : 0; }
  rushFee() { const g = this.garment(); return g && this.props.rushService ? Math.round((g.base + this.clothCost() + this.optionsTotal()) * 0.2) : 0; }
  total() { const g = this.garment(); return g ? g.base + this.clothCost() + this.optionsTotal() + this.rushFee() : 0; }
  money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  weeks() { const g = this.garment(); const w = g ? g.weeks : 0; return this.props.rushService ? Math.max(2, w - 2) : w; }
  delivery() {
    const d = new Date(); d.setDate(d.getDate() + this.weeks() * 7);
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  fieldError(f) {
    const raw = (this.state.m[f.key] || '').trim();
    if (!raw) return 'Required';
    if (!isNum(raw)) return 'Numbers only';
    const v = parseFloat(raw), k = this.factor(f);
    const lo = f.min * k, hi = f.max * k;
    if (v < lo || v > hi) return 'Expected ' + Math.round(lo) + '–' + Math.round(hi) + ' ' + this.unitOf(f);
    return '';
  }
  measurementsValid() { return !!this.state.garment && this.activeFields().every(f => !this.fieldError(f)); }
  si(key) {
    const f = FIELDS.find(x => x.key === key), raw = this.state.m[key];
    if (!isNum(raw)) return null;
    const v = parseFloat(raw), k = this.factor(f);
    if (v < f.min * k || v > f.max * k) return null;
    if (f.type === 'wt') return this.metric() ? v : v * 0.4536;
    return this.metric() ? v / 100 : v * 0.0254;
  }

  scrollToConfig() {
    const el = document.getElementById('configure');
    if (el) window.scrollTo({ top: el.offsetTop - 70, behavior: 'smooth' });
  }
  go(step) {
    if (step > 1 && !this.state.garment) { this.setState({ step: 1, pickHint: true }); this.scrollToConfig(); return; }
    this.setState({ step: Math.min(6, Math.max(1, step)) }); this.scrollToConfig();
  }
  pickGarment(id) {
    const st = this.state;
    const wasShirt = st.garment === 'shirt', isShirt = id === 'shirt';
    const patch = { garment: id, pickHint: false, placed: false };
    if (!st.garment || wasShirt !== isShirt) {
      const f = this.fabricList(id)[0];
      patch.fabric = f.id; patch.color = f.colors[isShirt ? 0 : 0].code;
    }
    if (id === 'pants' || id === 'shirt') patch.openFront = false;
    this.setState(patch);
  }
  pickFabric(id) {
    const f = this.fabricList().find(x => x.id === id);
    if (!f) return;
    this.setState({ fabric: id, color: f.colors[0].code });
  }
  setUnit(u) {
    if (u === this.unit()) return;
    const m = {};
    FIELDS.forEach(f => {
      const raw = (this.state.m[f.key] || '').trim();
      const k = f.type === 'wt' ? 0.4536 : 2.54, fac = u === 'cm' ? k : 1 / k;
      m[f.key] = isNum(raw) ? String(Math.round(parseFloat(raw) * fac * 10) / 10) : raw;
    });
    this.setState({ unit: u, m });
  }
  view(yaw) { this.setState(s => ({ viewYaw: yaw, viewNonce: s.viewNonce + 1, autoRotate: false })); }

  chip(active) {
    return 'display:flex;align-items:center;gap:8px;white-space:nowrap;padding:9px 14px;border:1px solid ' +
      (active ? '#14202f' : '#ded7c9') + ';background:' + (active ? '#14202f' : 'transparent') +
      ';color:' + (active ? '#f6f3ee' : '#6d6a62') + ';font-size:12px;letter-spacing:0.12em;text-transform:uppercase;cursor:pointer;';
  }
  vbtn(active) {
    return 'padding:8px 12px;border:1px solid ' + (active ? '#14202f' : 'rgba(20,32,47,0.18)') + ';background:' +
      (active ? '#14202f' : 'rgba(255,253,249,0.88)') + ';color:' + (active ? '#f6f3ee' : '#14202f') +
      ';font-size:11px;letter-spacing:0.14em;text-transform:uppercase;cursor:pointer;backdrop-filter:blur(6px);';
  }
  card(active) {
    return 'text-align:left;padding:16px;background:' + (active ? '#fffdf9' : 'transparent') +
      ';border:1px solid ' + (active ? '#14202f' : '#e0d9cd') + ';cursor:pointer;transition:border-color .18s,box-shadow .18s;' +
      (active ? 'box-shadow:0 10px 30px -22px rgba(20,32,47,.6);' : '');
  }
  pill(active) {
    return 'display:flex;flex-direction:column;gap:3px;align-items:flex-start;text-align:left;padding:12px 18px;background:' +
      (active ? '#efe9df' : '#fffdf9') + ';border:1px solid ' + (active ? '#14202f' : '#e0d9cd') + ';cursor:pointer;';
  }

  render() {
    const st = this.state, g = this.garment(), fab = this.fabric(), col = this.color();
    const deposit = Math.max(0, Math.min(100, this.props.depositPercent ?? 40));
    const auto = st.autoRotate ?? (this.props.autoRotate ?? true);
    const hasShell = !!g && g.id !== 'pants' && g.id !== 'shirt';

    const hM = this.si('height'), wK = this.si('weight');
    const H = hM || 1.78, W = wK || 78, bmi = W / (H * H);
    const build = bmi < 20 ? 'Slender' : bmi < 25 ? 'Athletic' : bmi < 29 ? 'Solid' : 'Broad';
    const hTxt = this.metric() ? Math.round(H * 100) + ' cm' : Math.floor(H / 0.0254 / 12) + '′' + Math.round((H / 0.0254) % 12) + '″';
    const wTxt = this.metric() ? Math.round(W) + ' kg' : Math.round(W / 0.4536) + ' lb';
    const fitName = (GROUPS.find(x => x.key === 'fit').options.find(o => o.id === st.opts.fit) || {}).name;
    const profileLine = (hM && wK ? '' : 'Default figure · ') + hTxt + ' · ' + wTxt + ' · ' + build + ' build' + (g ? ' · ' + fitName + ' fit' : '');

    const viewerConfig = JSON.stringify({
      garment: st.garment, fabric: fab.id, color: col.hex,
      lapel: st.opts.lapel, wcStyle: st.opts.wcStyle, collar: st.opts.collar, cuff: st.opts.cuff, button: st.opts.button, fit: st.opts.fit, pockets: st.opts.pockets, lining: st.opts.lining,
      heightM: hM, weightKg: wK, chestM: this.si('chest'), waistM: this.si('waist'), hipM: this.si('hip'),
      shoulderM: this.si('shoulder'), sleeveM: this.si('sleeve'), inseamM: this.si('inseam'),
      openFront: hasShell && st.openFront, closeUp: st.closeUp, autoRotate: auto, viewYaw: st.viewYaw, viewNonce: st.viewNonce
    });

    const viewButtons = [
      { label: 'Front', active: false, onClick: () => this.view(0) },
      { label: 'Side', active: false, onClick: () => this.view(-Math.PI / 2) },
      { label: 'Back', active: false, onClick: () => this.view(Math.PI) },
      { label: 'Close-up', active: st.closeUp, onClick: () => this.setState({ closeUp: !st.closeUp }) },
      { label: auto ? 'Pause' : 'Spin', active: auto, onClick: () => this.setState({ autoRotate: !auto }) }
    ];
    if (hasShell) viewButtons.push({ label: 'Show lining', active: st.openFront, onClick: () => this.setState({ openFront: !st.openFront, viewYaw: 0, viewNonce: st.viewNonce + 1, autoRotate: false }) });

    const valid = this.measurementsValid(), placed = st.placed;
    const viewerTitle = g ? g.name + ' · ' + col.name : 'The bare dummy';
    const priceLabel = g ? this.money(this.total()) : '—';
    const fabrics = this.fabricList();
    const nextDisabled = st.step === 6 || (st.step === 1 && !g);

    const measureFields = this.activeFields().map(f => {
      const err = st.touched ? this.fieldError(f) : '';
      return { f, err };
    });
    const optionSummary = this.activeGroups().map(grp => {
      const o = grp.options.find(o => o.id === st.opts[grp.key]);
      return { label: grp.label, value: o ? o.name : '—' };
    });
    const summaryRows = g ? [
      { label: 'Garment', value: g.name },
      { label: 'Cloth', value: fab.name + ' · ' + fab.cloth },
      { label: 'Colour', value: col.name + ' (' + col.code + ')' },
      { label: 'Figure', value: build + ' · ' + hTxt }
    ].concat(optionSummary, [{ label: 'Service', value: (this.props.rushService ? 'Rush — ' : 'Standard — ') + this.weeks() + ' weeks' }]) : [];
    const priceLines = g ? [
      { label: g.name + ' — making', value: this.money(g.base) },
      { label: g.meters + ' m ' + fab.name + ' @ ' + this.money(fab.rate), value: this.money(this.clothCost()) },
      { label: 'Finishing options', value: (this.optionsTotal() < 0 ? '−' : '') + this.money(Math.abs(this.optionsTotal())) }
    ] : [];
    if (this.rushFee()) priceLines.push({ label: 'Rush service (20%)', value: this.money(this.rushFee()) });

    const bookingFields = [
      { key: 'name', label: 'Name', type: 'text', placeholder: 'James Aldridge' },
      { key: 'email', label: 'Email', type: 'email', placeholder: 'james@example.com' },
      { key: 'phone', label: 'Telephone', type: 'tel', placeholder: '+44 …' },
      { key: 'date', label: 'Preferred date', type: 'date', placeholder: '' }
    ];

    return (
      <div style={{ maxWidth: '100%', overflowX: 'hidden' }}>
        <header style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(246,243,238,0.94)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', borderBottom: '1px solid #e0d9cd' }}>
          <div style={{ maxWidth: 1240, margin: '0 auto', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <a href="#top" style={{ fontFamily: serif, fontSize: 22, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#14202f' }}>Thornebury</a>
            <nav style={{ display: 'flex', alignItems: 'center', gap: 22, fontSize: 13, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              <a href="#fabrics" className="nav-link hide-narrow">Fabrics</a>
              <a href="#atelier" className="nav-link hide-narrow">Atelier</a>
              <a href="#appointment" className="nav-link">Visit</a>
              <a href="#configure" className="nav-cta">Start order</a>
            </nav>
          </div>
        </header>

        <section id="top" style={{ background: '#14202f', color: '#f0ece4', padding: '96px 20px 104px' }}>
          <div style={{ maxWidth: 1240, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 56, alignItems: 'center' }}>
            <div style={{ animation: 'riseIn 0.7s ease both' }}>
              <div style={{ ...eyebrow('#c2a074', 28) }}>Bespoke since 1948</div>
              <h1 style={{ fontFamily: serif, fontWeight: 400, fontSize: 'clamp(44px, 8vw, 78px)', lineHeight: 1.02, margin: '0 0 24px', letterSpacing: '-0.01em' }}>A suit cut to<br /><em style={{ color: '#c2a074' }}>one man only.</em></h1>
              <p style={{ fontSize: 17, lineHeight: 1.7, color: '#b9bdc4', maxWidth: '44ch', margin: '0 0 40px' }}>Coats, trousers, waistcoats, shirts and formal suits drafted from your own measurements, hand-finished in our Bishopsgate workroom over four to six weeks.</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
                <a href="#configure" className="hero-cta">Start custom order</a>
                <a href="#fabrics" className="hero-ghost">Browse cloth</a>
              </div>
            </div>
            <div style={{ aspectRatio: '4/5', minHeight: 320, border: '1px solid #2c3746', backgroundColor: '#16212f', backgroundImage: "linear-gradient(to top, rgba(20,32,47,.55), rgba(20,32,47,0) 55%), url('https://images.unsplash.com/photo-1618886614638-80e3c103d31a?w=1200&q=70&auto=format&fit=crop')", backgroundSize: 'cover', backgroundPosition: 'center 20%', animation: 'riseIn 0.9s ease both' }} />
          </div>
        </section>

        <section id="configure" style={{ padding: '88px 20px 40px', maxWidth: 1240, margin: '0 auto' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, marginBottom: 36 }}>
            <div>
              <div style={eyebrow('#b06a3b', 14)}>The commission</div>
              <h2 style={{ fontFamily: serif, fontWeight: 400, fontSize: 'clamp(32px, 5vw, 50px)', margin: 0, lineHeight: 1.1 }}>Configure your garment</h2>
            </div>
            <div style={{ fontSize: 14, color: '#6d6a62' }}>Step {st.step} of 6 · {STEP_TITLES[st.step - 1]}</div>
          </div>

          <div style={{ position: 'sticky', top: 61, zIndex: 30, background: '#f6f3ee', padding: '14px 0 16px', borderBottom: '1px solid #e0d9cd', marginBottom: 32 }}>
            <div className="steps">
              {STEP_TITLES.map((label, i) => (
                <button key={label} type="button" onClick={() => this.go(i + 1)} style={css(this.chip(st.step === i + 1))}>
                  <span style={{ opacity: 0.65 }}>{'0' + (i + 1)}</span><span>{label}</span>
                </button>
              ))}
            </div>
            <div style={{ height: 2, background: '#e0d9cd', marginTop: 12 }}>
              <div style={{ height: 2, background: '#b06a3b', width: Math.round((st.step / 6) * 100) + '%', transition: 'width .3s ease' }} />
            </div>
          </div>

          <div style={{ display: 'grid', gap: st.wide ? 44 : 28, alignItems: 'start', gridTemplateColumns: st.wide ? 'minmax(0,5fr) minmax(0,6fr)' : 'minmax(0,1fr)' }}>
            <div style={st.wide ? { position: 'sticky', top: 150 } : undefined}>
              <div style={{ position: 'relative', overflow: 'hidden', border: '1px solid #e0d9cd', background: 'radial-gradient(ellipse at 50% 32%, #fdfaf4 0%, #efe8dc 62%, #e3dbcc 100%)', height: st.wide ? 'clamp(520px, calc(100vh - 220px), 760px)' : 460 }}>
                <suit-viewer config={viewerConfig} assets="/assets/" style={{ position: 'absolute', inset: 0 }}></suit-viewer>
                <div style={{ position: 'absolute', top: 16, left: 16, right: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, pointerEvents: 'none' }}>
                  <div>
                    <div style={{ fontSize: 11, letterSpacing: '0.24em', textTransform: 'uppercase', color: '#b06a3b' }}>Live fitting</div>
                    <div style={{ fontFamily: serif, fontSize: 22, color: '#14202f', marginTop: 4 }}>{viewerTitle}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#8c877c' }}>Estimate</div>
                    <div style={{ fontFamily: serif, fontSize: 22, color: '#14202f', marginTop: 4 }}>{priceLabel}</div>
                  </div>
                </div>
                {!g && (
                  <div style={{ position: 'absolute', left: 16, right: 16, bottom: 64, textAlign: 'center', pointerEvents: 'none', fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#8c877c' }}>Choose a piece and the dummy dresses itself</div>
                )}
                <div style={{ position: 'absolute', left: 12, right: 12, bottom: 12, display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
                  {viewButtons.map(v => <button key={v.label} type="button" onClick={v.onClick} style={css(this.vbtn(v.active))}>{v.label}</button>)}
                </div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '8px 16px', marginTop: 12, fontSize: 13, color: '#6d6a62' }}>
                <span>{profileLine}</span>
                <span style={{ color: '#a09a8d' }}>Drag to turn</span>
              </div>
            </div>

            <div style={{ minWidth: 0 }}>
              {st.step === 1 && (
                <div>
                  <p style={{ fontSize: 16, lineHeight: 1.7, color: '#55524b', maxWidth: '56ch', margin: '0 0 24px' }}>Begin with the piece. The dummy stands bare until you choose — then it dresses itself in exactly what you order. Every price is a starting point; cloth and finishing are costed as you go.</p>
                  {st.pickHint && <div style={{ margin: '-8px 0 18px', padding: '12px 14px', border: '1px solid #d9c4a0', background: '#f6efe2', fontSize: 14, color: '#4a463f' }}>Choose a garment first — the rest of the commission depends on it.</div>}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
                    {GARMENTS.map(x => {
                      const on = st.garment === x.id;
                      const sw = x.img
                        ? 'height:120px;background-color:' + x.swatch + ';background-image:url(' + x.img + ');background-size:cover;background-position:' + x.pos + ';filter:' + (on ? 'none' : 'grayscale(.45)') + ';transition:filter .25s;'
                        : 'height:120px;background-color:' + x.swatch + ';background-image:repeating-linear-gradient(90deg, rgba(20,32,47,.07) 0 2px, transparent 2px 9px), linear-gradient(160deg, #f4f3ef 0%, #dfe6ef 100%);filter:' + (on ? 'none' : 'grayscale(.45)') + ';transition:filter .25s;';
                      return (
                        <button key={x.id} type="button" onClick={() => this.pickGarment(x.id)} style={css(this.card(on))} className="card-btn">
                          <div style={css(sw)} />
                          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginTop: 16 }}>
                            <span style={{ fontFamily: serif, fontSize: 24, color: '#14202f' }}>{x.name}</span>
                            <span style={{ fontSize: 13, color: '#b06a3b', letterSpacing: '0.04em' }}>{'from ' + this.money(x.base)}</span>
                          </div>
                          <p style={{ fontSize: 14, lineHeight: 1.6, color: '#6d6a62', margin: '8px 0 0' }}>{x.desc}</p>
                          <div style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#8c877c', marginTop: 12 }}>{x.meta}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {st.step === 2 && (
                <div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 22 }}>
                    <p style={{ fontSize: 15, lineHeight: 1.6, color: '#55524b', margin: 0, maxWidth: '40ch' }}>Taken over a shirt, tape snug but not tight. The dummy re-drafts to your figure as you type; we verify every number at the first fitting.</p>
                    <div style={{ display: 'flex', border: '1px solid #d8d0c2' }}>
                      <button type="button" onClick={() => this.setUnit('in')} style={{ padding: '9px 14px', border: 'none', cursor: 'pointer', fontSize: 13, background: !this.metric() ? '#14202f' : 'transparent', color: !this.metric() ? '#f6f3ee' : '#6d6a62' }}>in · lb</button>
                      <button type="button" onClick={() => this.setUnit('cm')} style={{ padding: '9px 14px', border: 'none', cursor: 'pointer', fontSize: 13, background: this.metric() ? '#14202f' : 'transparent', color: this.metric() ? '#f6f3ee' : '#6d6a62' }}>cm · kg</button>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px 18px' }}>
                    {measureFields.map(({ f, err }) => (
                      <label key={f.key} style={{ display: 'grid', gap: 6, alignContent: 'start' }}>
                        <span style={{ fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#4a4a46' }}>{f.label}</span>
                        <span style={{ position: 'relative', display: 'block' }}>
                          <input type="text" inputMode="decimal" value={st.m[f.key]} onChange={(e) => this.setState({ m: Object.assign({}, st.m, { [f.key]: e.target.value }) })} placeholder={String(Math.round(f.ph * this.factor(f)))}
                            style={{ width: '100%', padding: '13px 46px 13px 14px', background: '#fffdf9', border: '1px solid ' + (err ? '#b04b3b' : '#ded7c9'), fontSize: 16, color: '#191b1e', outline: 'none' }} />
                          <span style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: '#a8a295' }}>{this.unitOf(f)}</span>
                        </span>
                        <span style={{ fontSize: 12, color: '#8c877c' }}>{f.hint}</span>
                        {err && <span style={{ fontSize: 12, color: '#b04b3b' }}>{err}</span>}
                      </label>
                    ))}
                  </div>
                  <div style={{ marginTop: 24, padding: '16px 18px', borderLeft: '2px solid #c2a074', background: '#efe9df', fontSize: 14, lineHeight: 1.6, color: '#4a463f' }}>
                    {hM && wK ? 'Figure read as ' + build.toLowerCase() + ' at ' + hTxt + '. Any girths you add override the estimate from height and weight.' : 'Start with height and weight — the dummy estimates your figure from those, then refines with each girth you enter.'}
                  </div>
                </div>
              )}

              {st.step === 3 && (
                <div>
                  <p style={{ fontSize: 16, lineHeight: 1.7, color: '#55524b', maxWidth: '56ch', margin: '0 0 24px' }}>{'Cloth is costed by the metre; a ' + (g ? g.name.toLowerCase() : 'garment') + ' takes about ' + (g ? g.meters : '—') + ' m. Each cloth reads differently on the dummy — linen slubs, cotton twill, a lustre on the blend.'}</p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 14 }}>
                    {fabrics.map(x => (
                      <button key={x.id} type="button" onClick={() => this.pickFabric(x.id)} style={css(this.card(fab.id === x.id))} className="card-btn">
                        <div style={{ height: 64, backgroundColor: x.colors[0].hex === '#f4f3ef' || x.colors[0].hex.startsWith('#f') ? x.colors[1].hex : x.colors[0].hex, backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,.10) 0 3px, transparent 3px 6px)' }} />
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginTop: 16 }}>
                          <span style={{ fontFamily: serif, fontSize: 24, color: '#14202f' }}>{x.name}</span>
                          <span style={{ fontSize: 13, color: '#b06a3b' }}>{this.money(x.rate) + ' / m'}</span>
                        </div>
                        <p style={{ fontSize: 14, lineHeight: 1.6, color: '#6d6a62', margin: '8px 0 0' }}>{x.desc}</p>
                        <div style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#8c877c', marginTop: 12 }}>{x.cloth}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {st.step === 4 && (
                <div>
                  <p style={{ fontSize: 16, lineHeight: 1.7, color: '#55524b', maxWidth: '56ch', margin: '0 0 24px' }}>{fab.name + ' is woven in ' + fab.colors.length + ' house colourways this season.'}</p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14 }}>
                    {fab.colors.map(c => (
                      <button key={c.code} type="button" onClick={() => this.setState({ color: c.code })} style={css(this.card(col.code === c.code))} className="card-btn">
                        <div style={{ height: 64, background: c.hex, border: '1px solid rgba(0,0,0,.06)' }} />
                        <div style={{ fontSize: 15, color: '#14202f', marginTop: 12 }}>{c.name}</div>
                        <div style={{ fontSize: 12, color: '#8c877c', marginTop: 4 }}>{c.code}</div>
                      </button>
                    ))}
                  </div>
                  <div style={{ marginTop: 24, padding: '18px 20px', borderLeft: '2px solid #c2a074', background: '#efe9df' }}>
                    <div style={{ fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#8c877c', marginBottom: 8 }}>Selected</div>
                    <div style={{ fontSize: 16, color: '#2b2d31' }}>{col.name + ' · ' + col.code + ' · ' + fab.name}</div>
                  </div>
                </div>
              )}

              {st.step === 5 && (
                <div style={{ display: 'grid', gap: 30 }}>
                  {this.activeGroups().map(grp => (
                    <div key={grp.key}>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                        <h3 style={{ fontFamily: serif, fontWeight: 500, fontSize: 24, margin: 0, color: '#14202f' }}>{grp.label}</h3>
                        <span style={{ fontSize: 13, color: '#8c877c' }}>{grp.note}</span>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                        {grp.options.map(o => (
                          <button key={o.id} type="button" style={css(this.pill(st.opts[grp.key] === o.id))}
                            onClick={() => this.setState({ opts: Object.assign({}, st.opts, { [grp.key]: o.id }), openFront: grp.key === 'lining' ? true : st.openFront })}>
                            <span style={{ fontSize: 15, color: '#14202f' }}>{o.name}</span>
                            <span style={{ fontSize: 12, color: '#8c877c', letterSpacing: '0.06em' }}>{o.add === 0 ? 'included' : (o.add > 0 ? '+' + this.money(o.add) : '−' + this.money(-o.add))}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {st.step === 6 && g && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 24, alignItems: 'start' }}>
                  <div style={{ border: '1px solid #e0d9cd', background: '#fffdf9' }}>
                    <div style={{ padding: '22px 24px', borderBottom: '1px solid #e0d9cd' }}>
                      <div style={{ fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#8c877c' }}>Commission</div>
                      <div style={{ fontFamily: serif, fontSize: 28, color: '#14202f', marginTop: 6 }}>{g.name + ' in ' + col.name}</div>
                    </div>
                    <div style={{ padding: '8px 24px 18px' }}>
                      {summaryRows.map(r => (
                        <div key={r.label} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, padding: '10px 0', borderBottom: '1px dotted #e3ddd1' }}>
                          <span style={{ fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8c877c' }}>{r.label}</span>
                          <span style={{ fontSize: 15, color: '#2b2d31', textAlign: 'right' }}>{r.value}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ padding: '0 24px 24px' }}>
                      <div style={{ fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#8c877c', margin: '6px 0 10px' }}>Measurements</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8 }}>
                        {this.activeFields().map(f => (
                          <div key={f.key} style={{ border: '1px solid #ece5d9', padding: '9px 11px' }}>
                            <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8c877c' }}>{f.label}</div>
                            <div style={{ fontSize: 16, color: '#2b2d31', marginTop: 4 }}>{st.m[f.key] ? st.m[f.key] + ' ' + this.unitOf(f) : '—'}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div>
                    <div style={{ background: '#14202f', color: '#f0ece4', padding: 26 }}>
                      <div style={{ fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#c2a074' }}>Estimated total</div>
                      <div style={{ fontFamily: serif, fontSize: 50, lineHeight: 1, margin: '12px 0 18px' }}>{priceLabel}</div>
                      {priceLines.map(p => (
                        <div key={p.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, fontSize: 14, padding: '7px 0', color: '#b9bdc4', borderTop: '1px solid #263243' }}>
                          <span>{p.label}</span><span style={{ color: '#f0ece4' }}>{p.value}</span>
                        </div>
                      ))}
                      <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #263243', fontSize: 14, lineHeight: 1.7, color: '#b9bdc4' }}>
                        Deposit due today <strong style={{ color: '#c2a074' }}>{this.money(this.total() * deposit / 100) + ' (' + deposit + '%)'}</strong><br />
                        Ready by <strong style={{ color: '#c2a074' }}>{this.delivery()}</strong>
                      </div>
                    </div>
                    {(placed || !valid) && (
                      <div style={{ marginTop: 16, padding: '14px 16px', border: '1px solid ' + (placed ? '#c2a074' : '#d9c4a0'), background: placed ? '#efe9df' : '#f6efe2', fontSize: 14, lineHeight: 1.6, color: '#4a463f' }}>
                        {placed ? 'Order placed — our cutter will call within two working days to confirm your fitting.' : 'Enter all measurements as numbers to place the order.'}
                      </div>
                    )}
                    <button type="button" onClick={() => { this.setState({ touched: true }); if (this.measurementsValid()) this.setState({ placed: true }); else this.go(2); }}
                      style={{ width: '100%', marginTop: 16, padding: 18, border: 'none', fontSize: 13, letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 600, cursor: valid && !placed ? 'pointer' : 'not-allowed', background: placed ? '#2f4a36' : (valid ? '#b06a3b' : '#cfc8ba'), color: placed || valid ? '#f6f3ee' : '#6d6a62' }}>
                      {placed ? 'Order confirmed ✓' : 'Place order · ' + priceLabel}
                    </button>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginTop: 40, paddingTop: 22, borderTop: '1px solid #e0d9cd' }}>
                <button type="button" onClick={() => this.go(st.step - 1)} style={{ padding: '14px 24px', background: 'transparent', border: '1px solid ' + (st.step === 1 ? '#ece5d9' : '#14202f'), color: st.step === 1 ? '#c3bcae' : '#14202f', fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase', cursor: st.step === 1 ? 'not-allowed' : 'pointer' }}>← Back</button>
                <button type="button" onClick={() => { if (nextDisabled) { if (st.step === 1) this.setState({ pickHint: true }); return; } if (st.step === 2) this.setState({ touched: true }); this.go(st.step + 1); }}
                  style={{ padding: '14px 26px', border: 'none', fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 600, background: nextDisabled ? '#cfc8ba' : '#14202f', color: nextDisabled ? '#6d6a62' : '#f6f3ee', cursor: nextDisabled ? 'not-allowed' : 'pointer' }}>
                  {st.step === 6 ? 'Review complete' : (st.step === 1 && !g ? 'Choose a garment' : 'Continue to ' + STEP_TITLES[st.step].toLowerCase() + ' →')}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section id="fabrics" style={{ padding: '88px 20px', background: '#efe9df', marginTop: 60 }}>
          <div style={{ maxWidth: 1240, margin: '0 auto' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, marginBottom: 40 }}>
              <div>
                <div style={eyebrow('#b06a3b', 14)}>The cloth room</div>
                <h2 style={{ fontFamily: serif, fontWeight: 400, fontSize: 'clamp(32px, 5vw, 50px)', margin: 0, lineHeight: 1.1 }}>Fabric gallery</h2>
              </div>
              <p style={{ fontSize: 15, lineHeight: 1.7, color: '#55524b', maxWidth: '42ch', margin: 0 }}>Four house suitings and four shirtings. Tap any cloth to drape it straight onto your fitting dummy.</p>
            </div>
            {[['Suiting', SUIT_FABRICS, 'suit'], ['Shirting', SHIRT_FABRICS, 'shirt']].map(([title, list, gid]) => (
              <div key={title} style={{ marginBottom: 36 }}>
                <div style={{ fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#8c877c', margin: '0 0 16px' }}>{title}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 20 }}>
                  {list.map(x => (
                    <div key={x.id} style={{ background: '#fffdf9', border: '1px solid #e0d9cd' }}>
                      <div style={{ height: 150, backgroundColor: gid === 'shirt' ? x.colors[1].hex : x.colors[0].hex, backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,.10) 0 4px, transparent 4px 8px)' }} />
                      <div style={{ padding: '20px 22px 24px' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                          <span style={{ fontFamily: serif, fontSize: 24, color: '#14202f' }}>{x.name}</span>
                          <span style={{ fontSize: 13, color: '#b06a3b' }}>{this.money(x.rate) + ' / m'}</span>
                        </div>
                        <p style={{ fontSize: 14, lineHeight: 1.6, color: '#6d6a62', margin: '10px 0 16px' }}>{x.desc}</p>
                        <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
                          {x.colors.map(c => <span key={c.code} title={c.name} style={{ width: 22, height: 22, borderRadius: 999, background: c.hex, border: '1px solid rgba(0,0,0,.12)', display: 'block' }} />)}
                        </div>
                        <button type="button" className="use-cloth" onClick={() => {
                          const needShirt = gid === 'shirt';
                          const cur = st.garment;
                          const garment = needShirt ? 'shirt' : (cur && cur !== 'shirt' ? cur : 'suit');
                          this.setState({ garment, fabric: x.id, color: x.colors[0].code, step: 4, pickHint: false });
                          this.scrollToConfig();
                        }}>Use this cloth</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="atelier" style={{ padding: '96px 20px' }}>
          <div style={{ maxWidth: 1240, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 56, alignItems: 'center' }}>
            <div style={{ aspectRatio: '5/4', border: '1px solid #e0d9cd', backgroundColor: '#e7dfd1', backgroundImage: "url('https://images.unsplash.com/photo-1585412459212-8def26f7e84c?w=1200&q=70&auto=format&fit=crop')", backgroundSize: 'cover', backgroundPosition: 'center' }} />
            <div>
              <div style={eyebrow('#b06a3b', 18)}>The atelier</div>
              <h2 style={{ fontFamily: serif, fontWeight: 400, fontSize: 'clamp(30px, 4.4vw, 44px)', lineHeight: 1.12, margin: '0 0 22px' }}>Three fittings, one pattern, kept for life.</h2>
              <p style={{ fontSize: 16, lineHeight: 1.8, color: '#55524b', margin: '0 0 18px' }}>Every commission begins with a paper pattern drafted by hand to your measurements — never a block, never graded from a size. Canvas is floated, not fused; buttonholes are worked by hand; the collar is set by the same coatmaker who cut it.</p>
              <p style={{ fontSize: 16, lineHeight: 1.8, color: '#55524b', margin: '0 0 30px' }}>Your pattern stays in our racks, so the second suit takes half the time and fits the way the first one did.</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 24, borderTop: '1px solid #e0d9cd', paddingTop: 26 }}>
                {[{ value: '78 yrs', label: 'On Bishopsgate' }, { value: '62 hrs', label: 'Handwork per suit' }, { value: '3', label: 'Fittings included' }].map(s => (
                  <div key={s.label}>
                    <div style={{ fontFamily: serif, fontSize: 36, color: '#14202f', lineHeight: 1 }}>{s.value}</div>
                    <div style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#8c877c', marginTop: 8 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="appointment" style={{ padding: '88px 20px 96px', background: '#14202f', color: '#f0ece4' }}>
          <div style={{ maxWidth: 1240, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 56, alignItems: 'start' }}>
            <div>
              <div style={eyebrow('#c2a074', 18)}>Visit us</div>
              <h2 style={{ fontFamily: serif, fontWeight: 400, fontSize: 'clamp(30px, 4.4vw, 44px)', lineHeight: 1.12, margin: '0 0 22px' }}>Book a fitting</h2>
              <p style={{ fontSize: 16, lineHeight: 1.8, color: '#b9bdc4', margin: '0 0 32px', maxWidth: '42ch' }}>Ninety minutes, no obligation. We'll take your measurements properly, put cloth against your skin in daylight, and talk through the commission.</p>
              <div style={{ display: 'grid', gap: 18, fontSize: 15, lineHeight: 1.7, color: '#b9bdc4', borderTop: '1px solid #263243', paddingTop: 26 }}>
                {[['Workroom', '14 Bishopsgate Court, London EC2'], ['Hours', 'Tue–Fri 9–6 · Sat 10–4 · Mon by appointment'], ['Telephone', '+44 20 7946 0142']].map(([k, v]) => (
                  <div key={k}><span style={{ color: '#c2a074', letterSpacing: '0.14em', textTransform: 'uppercase', fontSize: 12 }}>{k}</span><br />{v}</div>
                ))}
              </div>
            </div>
            <div style={{ background: '#1a2635', border: '1px solid #2c3746', padding: 30 }}>
              {st.bookingSent ? (
                <div style={{ display: 'grid', gap: 14, padding: '30px 0', textAlign: 'center' }}>
                  <div style={{ fontFamily: serif, fontSize: 32, color: '#c2a074' }}>Request received</div>
                  <p style={{ fontSize: 15, lineHeight: 1.7, color: '#b9bdc4', margin: 0 }}>{'Thank you, ' + (st.booking.name || 'sir') + '. We will confirm ' + (st.booking.date || 'a time') + ' by email within one working day.'}</p>
                  <button type="button" className="ghost-dark" onClick={() => this.setState({ bookingSent: false, booking: { name: '', email: '', phone: '', date: '' }, notes: '' })}>Book another</button>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 16 }}>
                  {bookingFields.map(b => (
                    <label key={b.key} style={{ display: 'grid', gap: 7 }}>
                      <span style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#8e97a3' }}>{b.label}</span>
                      <input type={b.type} value={st.booking[b.key]} placeholder={b.placeholder} className="dark-input" style={b.type === 'date' ? { colorScheme: 'dark' } : undefined}
                        onChange={(e) => this.setState({ booking: Object.assign({}, st.booking, { [b.key]: e.target.value }) })} />
                    </label>
                  ))}
                  <div style={{ display: 'grid', gap: 7 }}>
                    <span style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#8e97a3' }}>Interested in</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {['Full suit', 'Three-piece', 'Coat', 'Trousers', 'Waistcoat', 'Shirt', 'Not sure yet'].map(label => (
                        <button key={label} type="button" onClick={() => this.setState({ interest: label })} style={css(this.chip(st.interest === label))}>{label}</button>
                      ))}
                    </div>
                  </div>
                  <label style={{ display: 'grid', gap: 7 }}>
                    <span style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#8e97a3' }}>Notes</span>
                    <textarea rows={3} value={st.notes} onChange={(e) => this.setState({ notes: e.target.value })} placeholder="Occasion, deadline, anything we should know" className="dark-input" style={{ resize: 'vertical' }} />
                  </label>
                  {st.bookingError && <div style={{ fontSize: 13, color: '#e0a07f' }}>{st.bookingError}</div>}
                  <button type="button" className="gold-btn" onClick={() => {
                    const b = st.booking;
                    if (!b.name.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) { this.setState({ bookingError: 'A name and a valid email are needed to confirm.' }); return; }
                    this.setState({ bookingSent: true, bookingError: '' });
                  }}>Request appointment</button>
                </div>
              )}
            </div>
          </div>
        </section>

        <footer style={{ background: '#10161f', color: '#8e97a3', padding: '34px 20px', fontSize: 13 }}>
          <div style={{ maxWidth: 1240, margin: '0 auto', display: 'flex', flexWrap: 'wrap', gap: 14, justifyContent: 'space-between' }}>
            <span style={{ letterSpacing: '0.22em', textTransform: 'uppercase' }}>Thornebury &amp; Sons</span>
            <span>Bespoke tailoring · London · Est. 1948</span>
            <span style={{ width: '100%', fontSize: 11, color: '#5d6672' }}>3D mannequin based on <a href="https://sketchfab.com/3d-models/stichless-mannequin-7de2b540a6014077b7a2206d8c25ca12" target="_blank" rel="noreferrer" style={{ color: '#8e97a3', textDecoration: 'underline' }}>“Stichless Mannequin” by arvelmay</a> and shirt from <a href="https://sketchfab.com/eigenscene" target="_blank" rel="noreferrer" style={{ color: '#8e97a3', textDecoration: 'underline' }}>“Shirt” by eigenscene</a>, both CC BY 4.0, modified.</span>
          </div>
        </footer>
      </div>
    );
  }
}
