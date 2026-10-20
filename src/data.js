export const IMG = (id) => 'https://images.unsplash.com/photo-' + id + '?w=700&q=70&auto=format&fit=crop';

export const GARMENTS = [
  { id: 'suit', name: 'Full Suit', base: 1240, meters: 4.6, weeks: 6, desc: 'Coat and trousers cut from one length, matched and balanced.', meta: '6 weeks · 3 fittings', swatch: '#1d2a3c', img: IMG('1593030103066-0093718efeb9'), pos: 'center 20%' },
  { id: 'three', name: 'Three-Piece', base: 1540, meters: 5.9, weeks: 7, desc: 'Coat, waistcoat and trousers — the full commission in one cloth.', meta: '7 weeks · 3 fittings', swatch: '#22303f', img: IMG('1593030103066-0093718efeb9'), pos: 'center 55%' },
  { id: 'coat', name: 'Coat', base: 890, meters: 3.4, weeks: 5, desc: 'Single-breasted jacket, floating canvas, hand-set collar.', meta: '5 weeks · 2 fittings', swatch: '#243247', img: IMG('1594938298603-c8148c4dae35'), pos: 'center 25%' },
  { id: 'waistcoat', name: 'Waistcoat', base: 340, meters: 1.3, weeks: 3, desc: 'Five button, welted pockets, adjustable cinch back.', meta: '3 weeks · 1 fitting', swatch: '#4a3a2c', img: IMG('1603394151492-5e9b974b090b'), pos: 'center 30%' },
  { id: 'pants', name: 'Trousers', base: 380, meters: 1.6, weeks: 3, desc: 'Flat-front, side adjusters, hand-finished waistband curtain.', meta: '3 weeks · 1 fitting', swatch: '#3c3f46', img: IMG('1622497170185-5d668f816a56'), pos: 'center 75%' },
  { id: 'shirt', name: 'Shirt', base: 220, meters: 2.2, weeks: 3, desc: 'Cut from your own pattern: split yoke, single-needle seams, hand-sewn buttons.', meta: '3 weeks · 1 fitting', swatch: '#dfe6ef', img: null, pos: 'center' }
];

export const SUIT_FABRICS = [
  { id: 'wool', name: 'Worsted Wool', rate: 96, cloth: 'Super 130s · 280g', desc: 'The house standard. Crisp drape, holds a press through a long day.',
    colors: [{ name: 'Midnight Navy', hex: '#1c2a44', code: 'W-104' }, { name: 'Charcoal', hex: '#3a3d42', code: 'W-118' }, { name: 'Slate Grey', hex: '#6b7078', code: 'W-126' }, { name: 'Oxblood', hex: '#5a2a2c', code: 'W-141' }, { name: 'Ink Black', hex: '#1a1a1c', code: 'W-100' }] },
  { id: 'cotton', name: 'Combed Cotton', rate: 54, cloth: 'Twill · 320g', desc: 'Matte and soft-shouldered. Mellows with each wear, made for warm months.',
    colors: [{ name: 'Stone', hex: '#b9a98f', code: 'C-210' }, { name: 'Tobacco', hex: '#7d5c38', code: 'C-222' }, { name: 'Olive Drab', hex: '#565c43', code: 'C-233' }, { name: 'Chalk', hex: '#ded6c6', code: 'C-201' }] },
  { id: 'linen', name: 'Irish Linen', rate: 72, cloth: 'Dry-spun · 260g', desc: 'Cool, dry hand and an honest rumple. Cut a touch fuller by design.',
    colors: [{ name: 'Sand', hex: '#c9b391', code: 'L-302' }, { name: 'Fog Blue', hex: '#8296a3', code: 'L-315' }, { name: 'Clay', hex: '#a5715a', code: 'L-327' }, { name: 'Ivory', hex: '#e6ddcb', code: 'L-300' }] },
  { id: 'blend', name: 'Wool–Silk Blend', rate: 128, cloth: '82/18 · 250g', desc: 'A quiet lustre for evening. Peak and shawl lapels get a satin facing.',
    colors: [{ name: 'Black Tie', hex: '#141518', code: 'B-400' }, { name: 'Deep Bottle', hex: '#22382f', code: 'B-412' }, { name: 'Aubergine', hex: '#3b2739', code: 'B-421' }, { name: 'Storm', hex: '#4c525c', code: 'B-430' }] }
];

export const SHIRT_FABRICS = [
  { id: 'poplin', name: 'Two-Fold Poplin', rate: 38, cloth: '100s/2 · 110g', desc: 'Smooth, crisp and quietly bright. The everyday business shirt.',
    colors: [{ name: 'White', hex: '#f4f3ef', code: 'P-500' }, { name: 'Sky', hex: '#cfdcea', code: 'P-512' }, { name: 'Pale Pink', hex: '#ecd6d4', code: 'P-521' }, { name: 'Lilac', hex: '#d9d3e6', code: 'P-530' }] },
  { id: 'oxford', name: 'Royal Oxford', rate: 34, cloth: 'Basketweave · 135g', desc: 'A soft basket texture with more body. Best with a button-down collar.',
    colors: [{ name: 'White', hex: '#f1f0ea', code: 'O-600' }, { name: 'Oxford Blue', hex: '#b9cbe0', code: 'O-614' }, { name: 'Ecru', hex: '#e9e1cf', code: 'O-622' }] },
  { id: 'twill', name: 'Cotton Twill', rate: 44, cloth: '120s/2 · 125g', desc: 'A diagonal weave with a gentle sheen. Resists creasing through the day.',
    colors: [{ name: 'White', hex: '#f3f2ee', code: 'T-700' }, { name: 'French Blue', hex: '#9fb6d4', code: 'T-718' }, { name: 'Charcoal', hex: '#4a4d52', code: 'T-733' }] },
  { id: 'shirtlinen', name: 'Shirting Linen', rate: 52, cloth: 'Lightweight · 140g', desc: 'Airy and textured for hot days. Softens beautifully with washing.',
    colors: [{ name: 'Natural', hex: '#e2d8c4', code: 'SL-800' }, { name: 'Sea Blue', hex: '#a8bfcf', code: 'SL-812' }, { name: 'Sage', hex: '#b7bfa5', code: 'SL-820' }] }
];

const ALL = ['coat', 'suit', 'three', 'pants', 'waistcoat', 'shirt'];
export const GROUPS = [
  { key: 'lapel', label: 'Lapel', note: 'Watch the collar change', applies: ['coat', 'suit', 'three'],
    options: [{ id: 'notch', name: 'Notch', add: 0 }, { id: 'peak', name: 'Peak', add: 60 }, { id: 'shawl', name: 'Shawl', add: 85 }] },
  { key: 'collar', label: 'Collar', note: 'Shaped by hand', applies: ['shirt'],
    options: [{ id: 'spread', name: 'Spread', add: 0 }, { id: 'button', name: 'Button-down', add: 0 }, { id: 'cutaway', name: 'Cutaway', add: 15 }] },
  { key: 'cuff', label: 'Cuffs', note: 'Single or double', applies: ['shirt'],
    options: [{ id: 'barrel', name: 'Barrel', add: 0 }, { id: 'french', name: 'French + links', add: 20 }] },
  { key: 'button', label: 'Buttons', note: 'Front and cuffs', applies: ALL,
    options: [{ id: 'horn', name: 'Buffalo horn', add: 0 }, { id: 'corozo', name: 'Corozo nut', add: 24 }, { id: 'pearl', name: 'Mother-of-pearl', add: 48 }] },
  { key: 'fit', label: 'Fit', note: 'Ease drafted into the pattern', applies: ALL,
    options: [{ id: 'slim', name: 'Slim', add: 0 }, { id: 'regular', name: 'Regular', add: 0 }, { id: 'relaxed', name: 'Relaxed', add: 0 }] },
  { key: 'wcStyle', label: 'Waistcoat style', note: 'How the fronts close', applies: ['waistcoat', 'three'],
    options: [{ id: 'classic', name: 'Four-button', add: 0 }, { id: 'two', name: 'Two-button, deep V', add: 0 }, { id: 'double', name: 'Double-breasted', add: 45 }, { id: 'wrap', name: 'Asymmetric wrap', add: 60 }] },
  { key: 'pockets', label: 'Pockets', note: 'Hand-set', applies: ['coat', 'suit', 'three', 'pants', 'waistcoat'],
    options: [{ id: 'flap', name: 'Flap', add: 0 }, { id: 'jetted', name: 'Jetted', add: 32 }, { id: 'patch', name: 'Patch', add: 18 }, { id: 'ticket', name: 'Flap + ticket', add: 46 }] },
  { key: 'lining', label: 'Lining', note: 'Use “Show lining” on the dummy', applies: ['coat', 'suit', 'three', 'waistcoat'],
    options: [{ id: 'bemberg', name: 'Bemberg cupro', add: 0 }, { id: 'silk', name: 'Printed silk', add: 120 }, { id: 'half', name: 'Half-lined', add: -30 }, { id: 'none', name: 'Unlined', add: -55 }] }
];

// ranges are imperial (in / lb)
export const FIELDS = [
  { key: 'height', label: 'Height', type: 'len', ph: 70, min: 55, max: 84, hint: 'Barefoot, standing tall', for: ALL },
  { key: 'weight', label: 'Weight', type: 'wt', ph: 172, min: 90, max: 400, hint: 'Approximate is fine', for: ALL },
  { key: 'neck', label: 'Neck', type: 'len', ph: 15.5, min: 12, max: 22, hint: 'Base of the neck, one finger under the tape', for: ['shirt'] },
  { key: 'chest', label: 'Chest', type: 'len', ph: 40, min: 26, max: 64, hint: 'Fullest point, under the arms', for: ['coat', 'suit', 'three', 'waistcoat', 'shirt'] },
  { key: 'waist', label: 'Waist', type: 'len', ph: 34, min: 22, max: 60, hint: 'Where you wear your trousers', for: ALL },
  { key: 'hip', label: 'Hip', type: 'len', ph: 39, min: 26, max: 64, hint: 'Fullest part of the seat', for: ['coat', 'suit', 'three', 'pants'] },
  { key: 'shoulder', label: 'Shoulder', type: 'len', ph: 18, min: 13, max: 26, hint: 'Point to point, across the back', for: ['coat', 'suit', 'three', 'waistcoat', 'shirt'] },
  { key: 'sleeve', label: 'Sleeve length', type: 'len', ph: 25, min: 18, max: 40, hint: 'Shoulder point to wrist bone', for: ['coat', 'suit', 'three', 'shirt'] },
  { key: 'inseam', label: 'Inseam', type: 'len', ph: 32, min: 22, max: 42, hint: 'Crotch to floor, no shoes', for: ['suit', 'three', 'pants'] }
];

export const STEP_TITLES = ['Garment', 'Measurements', 'Fabric', 'Colour', 'Details', 'Summary'];
