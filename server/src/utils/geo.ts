export interface LatLng {
  lat: number;
  lng: number;
}

/** [lat, lng] pair, the shape routes are stored and returned in. */
export type LatLngTuple = [number, number];

const EARTH_RADIUS_M = 6_371_000;
const M_PER_DEG = (Math.PI / 180) * EARTH_RADIUS_M;
const rad = (deg: number) => (deg * Math.PI) / 180;

// Great-circle distance in metres (haversine).
export function distanceMetres(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

const toLatLng = ([lat, lng]: LatLngTuple): LatLng => ({ lat, lng });

/** Cumulative distance in metres from the start of the line to each vertex (first value is 0). */
export function polylineLengths(line: LatLngTuple[]): number[] {
  const out: number[] = [0];
  for (let i = 1; i < line.length; i++) out.push(out[i - 1]! + distanceMetres(toLatLng(line[i - 1]!), toLatLng(line[i]!)));
  return out;
}

export interface Projection {
  /** Straight-line distance from the point to the line, in metres. */
  distanceMeters: number;
  /** How far along the line (from its start) the closest point is, in metres. */
  progressMeters: number;
  /** The closest point on the line. */
  point: LatLng;
  /** Index of the segment the closest point lies on. */
  segment: number;
}

// Closest point on a polyline to `p`. Uses a local flat approximation per segment, which is accurate to well
// under a metre over the few kilometres that matter here.
export function projectOntoPolyline(line: LatLngTuple[], p: LatLng, cumulative = polylineLengths(line)): Projection | null {
  if (line.length < 2) return null;
  const cosLat = Math.cos(rad(p.lat));
  let best: Projection | null = null;

  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const ax = (a[1] - p.lng) * cosLat * M_PER_DEG;
    const ay = (a[0] - p.lat) * M_PER_DEG;
    const dx = (b[1] - a[1]) * cosLat * M_PER_DEG;
    const dy = (b[0] - a[0]) * M_PER_DEG;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const dist = Math.hypot(cx, cy);

    if (!best || dist < best.distanceMeters) {
      best = {
        distanceMeters: dist,
        progressMeters: cumulative[i]! + t * (cumulative[i + 1]! - cumulative[i]!),
        point: { lat: p.lat + cy / M_PER_DEG, lng: p.lng + cx / (M_PER_DEG * cosLat) },
        segment: i,
      };
    }
  }
  return best;
}

// Douglas-Peucker simplification: drops points that lie within `toleranceMeters` of a straight line between
// their neighbours. Keeps the first and last point. Used to keep stored routes small.
export function simplifyPolyline(line: LatLngTuple[], toleranceMeters: number): LatLngTuple[] {
  if (line.length <= 2) return line.slice();
  const keep = new Array<boolean>(line.length).fill(false);
  keep[0] = true;
  keep[line.length - 1] = true;

  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    const a = line[start]!;
    const b = line[end]!;
    let worst = -1;
    let worstDist = toleranceMeters;
    for (let i = start + 1; i < end; i++) {
      const proj = projectOntoPolyline([a, b], toLatLng(line[i]!));
      if (proj && proj.distanceMeters > worstDist) {
        worstDist = proj.distanceMeters;
        worst = i;
      }
    }
    if (worst > -1) {
      keep[worst] = true;
      stack.push([start, worst], [worst, end]);
    }
  }
  return line.filter((_, i) => keep[i]);
}

// Simplify with growing tolerance until the line has at most `maxPoints` points.
export function simplifyToMaxPoints(line: LatLngTuple[], maxPoints: number, startToleranceMeters = 10): LatLngTuple[] {
  let tolerance = startToleranceMeters;
  let out = simplifyPolyline(line, tolerance);
  while (out.length > maxPoints && tolerance < 5_000) {
    tolerance *= 1.6;
    out = simplifyPolyline(line, tolerance);
  }
  return out;
}

/** A closed square GeoJSON ring (lng, lat) that fully contains the circle of `radiusKm` around `center`. */
export function boxAround(center: LatLng, radiusKm: number): [number, number][] {
  const dLat = (radiusKm * 1000) / M_PER_DEG;
  const dLng = dLat / Math.max(0.01, Math.cos(rad(center.lat)));
  const [w, e, s, n] = [center.lng - dLng, center.lng + dLng, center.lat - dLat, center.lat + dLat];
  return [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
    [w, s],
  ];
}

/** The `k` polyline vertices closest to `p`, nearest first (straight-line). */
export function nearestVertices(line: LatLngTuple[], p: LatLng, k: number): { index: number; distanceMeters: number }[] {
  return line
    .map((v, index) => ({ index, distanceMeters: distanceMetres(p, toLatLng(v)) }))
    .sort((x, y) => x.distanceMeters - y.distanceMeters)
    .slice(0, k);
}
