// Deterministic terrain shared by the WebGL scene (geometry displacement)
// and the HUD (elevation / grade readouts sampled along the route).

function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}

/** Terrain height in world units at world-space (x, z). Range ≈ [0, 15]. */
export function heightAt(x: number, z: number): number {
  let h = 0;
  let amp = 1;
  let freq = 0.012;
  for (let o = 0; o < 4; o++) {
    h += valueNoise(x * freq + 31.7, z * freq + 17.3) * amp;
    amp *= 0.48;
    freq *= 2.15;
  }
  // Normalize (sum of amps ≈ 1.86), shape with a gentle curve, scale.
  const n = h / 1.86;
  return Math.pow(n, 1.25) * 23;
}

export const TERRAIN_SIZE = 240;
export const ROUTE_SAMPLES = 400;

/** Winding route across the terrain in XZ, lifted to sit on the surface. */
export function routePoints(): Array<[number, number, number]> {
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i <= ROUTE_SAMPLES; i++) {
    const t = i / ROUTE_SAMPLES;
    const x = -95 + t * 185 + Math.sin(t * Math.PI * 3.1) * 22;
    const z = 82 - t * 168 + Math.cos(t * Math.PI * 2.3) * 26;
    const y = heightAt(x, z) + 0.45;
    pts.push([x, y, z]);
  }
  return pts;
}

export const TOTAL_KM = 42.2;
const ELEV_SCALE = 118; // world Y unit → meters
const ELEV_BASE = 412;

export function elevationMeters(worldY: number): number {
  return ELEV_BASE + (worldY - 0.45) * ELEV_SCALE;
}

/** HUD readouts for a route progress p ∈ [0, 1]. */
export function routeReadout(pts: Array<[number, number, number]>, p: number) {
  const idx = Math.min(pts.length - 1, Math.max(0, p * (pts.length - 1)));
  const i = Math.floor(idx);
  const frac = idx - i;
  const y =
    pts[i][1] + (pts[Math.min(i + 1, pts.length - 1)][1] - pts[i][1]) * frac;

  const iAhead = Math.min(pts.length - 1, i + 4);
  const iBack = Math.max(0, i - 4);
  const dElev = (pts[iAhead][1] - pts[iBack][1]) * ELEV_SCALE;
  const dDist = ((iAhead - iBack) / (pts.length - 1)) * TOTAL_KM * 1000;
  const grade = dDist > 0 ? (dElev / dDist) * 100 : 0;

  return {
    km: p * TOTAL_KM,
    elev: elevationMeters(y),
    grade: Math.max(-18, Math.min(18, grade)),
  };
}
