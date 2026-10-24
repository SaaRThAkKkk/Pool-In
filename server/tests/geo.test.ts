import { describe, expect, it } from 'vitest';
import {
  boxAround,
  distanceMetres,
  nearestVertices,
  polylineLengths,
  projectOntoPolyline,
  simplifyPolyline,
  simplifyToMaxPoints,
  type LatLngTuple,
} from '../src/utils/geo.js';

// A straight road running east along latitude 12.97, from lng 77.50 to 77.60 (about 10.8 km).
const road: LatLngTuple[] = [
  [12.97, 77.5],
  [12.97, 77.55],
  [12.97, 77.6],
];

describe('distanceMetres', () => {
  it('is zero for the same point and roughly right for a known pair', () => {
    expect(distanceMetres({ lat: 12.97, lng: 77.59 }, { lat: 12.97, lng: 77.59 })).toBe(0);
    const km = distanceMetres({ lat: 12.9716, lng: 77.5946 }, { lat: 12.2958, lng: 76.6394 }) / 1000;
    expect(km).toBeGreaterThan(120);
    expect(km).toBeLessThan(135);
  });
});

describe('polylineLengths', () => {
  it('accumulates distance along the line', () => {
    const lengths = polylineLengths(road);
    expect(lengths[0]).toBe(0);
    expect(lengths[1]).toBeCloseTo(5_420, -2); // ~5.4 km per 0.05 degrees of longitude at this latitude
    expect(lengths[2]).toBeCloseTo(lengths[1]! * 2, -1);
  });
});

describe('projectOntoPolyline', () => {
  it('finds the closest point, the distance to it, and how far along the road it is', () => {
    const p = { lat: 12.975, lng: 77.525 }; // ~555 m north of the road, a quarter of the way along
    const proj = projectOntoPolyline(road, p)!;

    expect(proj.distanceMeters).toBeGreaterThan(540);
    expect(proj.distanceMeters).toBeLessThan(570);
    expect(proj.point.lat).toBeCloseTo(12.97, 4);
    expect(proj.point.lng).toBeCloseTo(77.525, 4);
    expect(proj.progressMeters).toBeCloseTo(polylineLengths(road)[2]! / 4, -2);
    expect(proj.segment).toBe(0);
  });

  it('clamps to the end of the road for a point beyond it', () => {
    const proj = projectOntoPolyline(road, { lat: 12.97, lng: 77.7 })!;
    expect(proj.point.lng).toBeCloseTo(77.6, 5);
    expect(proj.progressMeters).toBeCloseTo(polylineLengths(road)[2]!, 0);
    expect(proj.distanceMeters).toBeGreaterThan(10_000);
  });

  it('picks the nearer segment of a bent road', () => {
    const bent: LatLngTuple[] = [
      [12.0, 77.0],
      [12.0, 77.1],
      [12.1, 77.1],
    ];
    const proj = projectOntoPolyline(bent, { lat: 12.05, lng: 77.11 })!;
    expect(proj.segment).toBe(1);
    expect(proj.distanceMeters).toBeCloseTo(1_090, -2);
  });

  it('puts a point that lies on the road at distance ~0', () => {
    expect(projectOntoPolyline(road, { lat: 12.97, lng: 77.52 })!.distanceMeters).toBeLessThan(0.5);
  });

  it('orders points by progress, which is how route order is decided', () => {
    const early = projectOntoPolyline(road, { lat: 12.971, lng: 77.51 })!;
    const late = projectOntoPolyline(road, { lat: 12.971, lng: 77.58 })!;
    expect(early.progressMeters).toBeLessThan(late.progressMeters);
  });

  it('returns null for a line with fewer than two points', () => {
    expect(projectOntoPolyline([], { lat: 1, lng: 1 })).toBeNull();
    expect(projectOntoPolyline([[1, 1]], { lat: 1, lng: 1 })).toBeNull();
  });

  it('handles a zero-length segment without dividing by zero', () => {
    const proj = projectOntoPolyline([[12, 77], [12, 77], [12, 77.1]], { lat: 12, lng: 77.05 })!;
    expect(Number.isFinite(proj.distanceMeters)).toBe(true);
    expect(proj.distanceMeters).toBeLessThan(1);
  });
});

describe('simplifyPolyline', () => {
  it('drops points that are on the straight line, keeping the ends', () => {
    const dense: LatLngTuple[] = Array.from({ length: 50 }, (_, i) => [12.97, 77.5 + i * 0.001]);
    const out = simplifyPolyline(dense, 5);
    expect(out).toEqual([dense[0], dense[49]]);
  });

  it('keeps a corner', () => {
    const l: LatLngTuple[] = [
      [12.0, 77.0],
      [12.0, 77.05],
      [12.0, 77.1],
      [12.05, 77.1],
      [12.1, 77.1],
    ];
    const out = simplifyPolyline(l, 20);
    expect(out).toContainEqual([12.0, 77.1]);
    expect(out[0]).toEqual(l[0]);
    expect(out.at(-1)).toEqual(l.at(-1));
  });

  it('never moves the route by more than the tolerance', () => {
    const wiggly: LatLngTuple[] = Array.from({ length: 200 }, (_, i) => [12.97 + Math.sin(i / 8) * 0.004, 77.5 + i * 0.0005]);
    const out = simplifyPolyline(wiggly, 30);
    expect(out.length).toBeLessThan(wiggly.length);
    for (const [lat, lng] of wiggly) {
      expect(projectOntoPolyline(out, { lat, lng })!.distanceMeters).toBeLessThanOrEqual(31);
    }
  });

  it('copes with short lines', () => {
    expect(simplifyPolyline([], 5)).toEqual([]);
    expect(simplifyPolyline([[1, 1]], 5)).toEqual([[1, 1]]);
    expect(simplifyPolyline([[1, 1], [2, 2]], 5)).toEqual([[1, 1], [2, 2]]);
  });
});

describe('simplifyToMaxPoints', () => {
  it('shrinks a long route to the limit', () => {
    const wiggly: LatLngTuple[] = Array.from({ length: 3000 }, (_, i) => [12.97 + Math.sin(i / 20) * 0.02, 77.5 + i * 0.0001]);
    const out = simplifyToMaxPoints(wiggly, 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out[0]).toEqual(wiggly[0]);
    expect(out.at(-1)).toEqual(wiggly.at(-1));
  });
});

describe('boxAround', () => {
  it('is a closed ring that contains the whole circle', () => {
    const ring = boxAround({ lat: 12.97, lng: 77.59 }, 5);
    expect(ring[0]).toEqual(ring.at(-1));
    expect(ring).toHaveLength(5);
    const [w, s] = ring[0]!;
    const [e, n] = ring[2]!;
    expect(distanceMetres({ lat: 12.97, lng: 77.59 }, { lat: n, lng: 77.59 })).toBeGreaterThanOrEqual(4_990);
    expect(distanceMetres({ lat: 12.97, lng: 77.59 }, { lat: 12.97, lng: e })).toBeGreaterThanOrEqual(4_990);
    expect(w).toBeLessThan(77.59);
    expect(s).toBeLessThan(12.97);
  });
});

describe('nearestVertices', () => {
  it('returns the closest vertices first', () => {
    const near = nearestVertices(road, { lat: 12.97, lng: 77.56 }, 2);
    expect(near.map((n) => n.index)).toEqual([1, 2]);
    expect(near[0]!.distanceMeters).toBeLessThan(near[1]!.distanceMeters);
  });
});
