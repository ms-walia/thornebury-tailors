# Thornebury Tailors — Custom Order

Bespoke-order site with a live 3D fitting room. The mannequin starts bare and dresses itself in whatever is ordered — shirt, trousers, waistcoat, coat, full suit or three-piece — tailored around its body and re-drafted from the customer's measurements.

## Run locally

```bash
npm install
npm run dev
```

Build: `npm run build` (output in `dist/`). Deploys to Vercel as a standard Vite project.

## How the 3D works

- `public/assets/mannequin.glb` — smoothed, re-posed male mannequin with per-vertex arm/leg weights.
- `public/assets/anatomy.json` — body cross-sections (hull radii per height and angle) plus arm and leg centrelines.
- `src/suit3d.js` — `<suit-viewer>` web component (three.js). Reshapes the mannequin to the measurements and builds each garment around the body hull.

## Credits

Base mesh: "3D Male Base Mesh" by BoQsc (https://github.com/BoQsc/Godot-Male-Base-Mesh), CC0 1.0.
