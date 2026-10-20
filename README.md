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

Mannequin body: "Stichless Mannequin" by arvelmay (https://sketchfab.com/3d-models/stichless-mannequin-7de2b540a6014077b7a2206d8c25ca12), licensed CC BY 4.0. Modified: re-posed to a relaxed stance, groin smoothed to a shop-mannequin finish, abdomen softened, rescaled; reshaped at runtime from customer measurements (incl. belly).
Shirt: "Shirt" by eigenscene (https://sketchfab.com/eigenscene), licensed CC BY 4.0. Modified: refitted and re-posed onto the mannequin, recoloured with our cloths, reshaped at runtime.
Display stand styled after "Store Mannequin" by A-in Architecture (CC BY 4.0).
