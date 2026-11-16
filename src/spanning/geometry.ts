// Odyssey: spanning geometry (slurs, ties, hairpins) for the engraver.
//
// This file is pure arithmetic: it knows nothing about VexFlow's classes, the DOM or a render context, so it can be
// tested on its own (node --test). `slur.ts`, `tie.ts` and `hairpin.ts` wrap it as VexFlow elements.
//
// Clean-room: written from the published engraving rules (Elaine Gould, "Behind Bars": slur and tie placement,
// shape and height; hairpins), not from any other engraver's source, so it stays MIT like the rest of the fork.
//
// Conventions: y grows downwards (screen), units are VexFlow units (SPACE = one staff space). Stem direction follows
// VexFlow (1 up, -1 down, 0 none). A curve lies on a `Side`: "above" the notes (smaller y) or "below".

export const SPACE = 10;

export type Side = 'above' | 'below';
export type StemDir = 1 | -1 | 0;

export interface Point {
  x: number;
  y: number;
}

/** An axis-aligned box, x0 < x1, y0 < y1 (y downwards). */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A cubic bezier. */
export interface Bezier {
  p0: Point;
  c1: Point;
  c2: Point;
  p3: Point;
}

/** What the geometry needs to know of one note, independent of VexFlow. */
export interface NoteInfo {
  /** Horizontal extent of the noteheads (a chord's displaced heads included). */
  headX0: number;
  headX1: number;
  /** y of the highest and the lowest notehead centre (equal for a single note). */
  yTop: number;
  yBottom: number;
  stem: StemDir;
  /** x of the stem and y of its far end; only meaningful when `stem` is not 0 and `hasStem` is true. */
  stemX: number;
  stemTipY: number;
  hasStem: boolean;
  /** The note is under a beam; notes with the same id share one beam. */
  beam?: number;
  /** An unbeamed note with a flag (the flag hangs to the right of the stem tip). */
  flagged: boolean;
  /** Width taken to the left of the heads by accidentals, 0 if none. */
  leftExtra: number;
  /** Width taken to the right of the heads by dots, 0 if none. */
  rightExtra: number;
}

// ---- bezier helpers ---------------------------------------------------------------------------------------------------

export function bezierPoint(b: Bezier, t: number): Point {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return {
    x: w0 * b.p0.x + w1 * b.c1.x + w2 * b.c2.x + w3 * b.p3.x,
    y: w0 * b.p0.y + w1 * b.c1.y + w2 * b.c2.y + w3 * b.p3.y,
  };
}

export function bezierSamples(b: Bezier, n = 48): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) out.push(bezierPoint(b, i / n));
  return out;
}

/** The extreme values of a cubic bezier along one axis: its end points and where the derivative is zero. */
function extrema(p0: number, p1: number, p2: number, p3: number): [number, number] {
  const values = [p0, p3];
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const ts: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) ts.push(-c / b);
  } else {
    const d = b * b - 4 * a * c;
    if (d >= 0) {
      const r = Math.sqrt(d);
      ts.push((-b + r) / (2 * a), (-b - r) / (2 * a));
    }
  }
  for (const t of ts) {
    if (t > 0 && t < 1) {
      const u = 1 - t;
      values.push(u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3);
    }
  }
  return [Math.min(...values), Math.max(...values)];
}

export function bezierBounds(b: Bezier): Rect {
  const [x0, x1] = extrema(b.p0.x, b.c1.x, b.c2.x, b.p3.x);
  const [y0, y1] = extrema(b.p0.y, b.c1.y, b.c2.y, b.p3.y);
  return { x0, y0, x1, y1 };
}

const sign = (side: Side): number => (side === 'above' ? -1 : 1);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * A bezier from `a` to `b` bulging towards `side` (relative to the chord), the control points `f` of the chord length in
 * from the ends and `k1`/`k2` away from the chord. The middle of a symmetric one stands 0.75 * k off the chord.
 */
function arch(a: Point, b: Point, side: Side, f1: number, f2: number, k1: number, k2: number): Bezier {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // the normal that points to the requested side, whichever way the chord runs
  let nx = uy;
  let ny = -ux;
  if (ny === 0) {
    nx = 0;
    ny = sign(side);
  } else if (Math.sign(ny) !== sign(side)) {
    nx = -nx;
    ny = -ny;
  }
  return {
    p0: a,
    c1: { x: a.x + ux * len * f1 + nx * k1, y: a.y + uy * len * f1 + ny * k1 },
    c2: { x: b.x - ux * len * f2 + nx * k2, y: b.y - uy * len * f2 + ny * k2 },
    p3: b,
  };
}

// ---- which side -------------------------------------------------------------------------------------------------------

/**
 * The side of a slur over `notes`. Gould: a slur goes on the notehead side, away from the stems: stems up put it below,
 * stems down above, and a mixture puts it above. A note of voice 1 of several (`voice === 1`) always takes the slur
 * above and voice 2 below, whatever its stems do.
 */
export function slurSide(notes: NoteInfo[], voice?: 1 | 2): Side {
  if (voice === 1) return 'above';
  if (voice === 2) return 'below';
  const stems = notes.filter((n) => n.hasStem && n.stem !== 0);
  if (!stems.length) return 'above';
  const up = stems.filter((n) => n.stem === 1).length;
  if (up === stems.length) return 'below';
  return 'above';
}

/**
 * The side of the tie of one notehead of a note or chord.
 * - voices side by side: the voice with stems up ties above, the one with stems down below;
 * - a chord alone: heads in the upper half tie above, the lower half below, and the middle head of an odd chord goes
 *   against the stem;
 * - a single note ties against its stem; a note with no stem (whole note) follows where its stem would go.
 */
export function tieSide(opts: {
  stem: StemDir;
  /** 0 = lowest head of the chord, `count - 1` = highest. */
  index: number;
  count: number;
  multiVoice: boolean;
}): Side {
  const { stem, index, count, multiVoice } = opts;
  if (multiVoice) return stem === -1 ? 'below' : 'above';
  if (count > 1) {
    const mid = (count - 1) / 2;
    if (index > mid) return 'above';
    if (index < mid) return 'below';
  }
  return stem === 1 ? 'below' : 'above';
}

// ---- obstacles --------------------------------------------------------------------------------------------------------

/**
 * Boxes a slur on `side` must clear: noteheads (with accidentals and dots), stems, flags, and the beam bands between
 * stem tips. Only the side the slur is on matters, so a stem on the far side of the heads is left out. Notes in `skip`
 * (the ones the slur is attached to) add no head or stem, but still count as the ends of a beam.
 */
export function obstaclesOf(notes: NoteInfo[], side: Side, skip: Set<NoteInfo> = new Set()): Rect[] {
  const rects: Rect[] = [];
  const half = SPACE * 0.5;
  for (const n of notes) {
    // the notes a slur is attached to are not in its way, but their beams are
    if (skip.has(n)) continue;
    rects.push({ x0: n.headX0 - n.leftExtra, x1: n.headX1 + n.rightExtra, y0: n.yTop - half, y1: n.yBottom + half });
    if (n.hasStem && n.stem !== 0) {
      const towards = n.stem === 1 ? 'above' : 'below';
      // a stem reaches over the heads on its own side; on the other side it is at most a head's width away
      const head = side === 'above' ? n.yTop : n.yBottom;
      if (towards === side) {
        const y0 = Math.min(n.stemTipY, head);
        const y1 = Math.max(n.stemTipY, head);
        // a flag hangs to the right of the stem
        rects.push({ x0: n.stemX - 1, x1: n.stemX + (n.flagged ? SPACE * 0.9 : 1), y0, y1 });
      }
    }
  }
  // beams: a band joining the stem tips of consecutive notes of one beam
  const beams = new Map<number, NoteInfo[]>();
  for (const n of notes) {
    if (n.beam !== undefined && n.hasStem) beams.set(n.beam, [...(beams.get(n.beam) ?? []), n]);
  }
  for (const group of beams.values()) {
    group.sort((a, b) => a.stemX - b.stemX);
    for (let i = 0; i + 1 < group.length; i++) {
      const a = group[i];
      const b = group[i + 1];
      if (a.stem === 0 || (a.stem === 1 ? 'above' : 'below') !== side) continue;
      // slice the band so a sloped beam does not become one big box
      const pieces = Math.max(1, Math.ceil((b.stemX - a.stemX) / (SPACE * 1.5)));
      for (let p = 0; p < pieces; p++) {
        const t0 = p / pieces;
        const t1 = (p + 1) / pieces;
        const ya = a.stemTipY + (b.stemTipY - a.stemTipY) * t0;
        const yb = a.stemTipY + (b.stemTipY - a.stemTipY) * t1;
        const head = side === 'above' ? Math.min(a.yTop, b.yTop) : Math.max(a.yBottom, b.yBottom);
        const outer = side === 'above' ? Math.min(ya, yb) : Math.max(ya, yb);
        rects.push({
          x0: a.stemX + (b.stemX - a.stemX) * t0,
          x1: a.stemX + (b.stemX - a.stemX) * t1,
          y0: Math.min(outer, head),
          y1: Math.max(outer, head),
        });
      }
    }
  }
  return rects;
}

/** How far (in y, positive = collides) the curve intrudes into the boxes on `side`, keeping `margin` clear. */
export function intrusion(curve: Bezier, side: Side, rects: Rect[], margin: number): number {
  const pts = bezierSamples(curve, 64);
  let worst = -Infinity;
  for (const r of rects) {
    for (const p of pts) {
      if (p.x < r.x0 - margin * 0.5 || p.x > r.x1 + margin * 0.5) continue;
      const v = side === 'above' ? p.y - (r.y0 - margin) : r.y1 + margin - p.y;
      if (v > worst) worst = v;
    }
  }
  return worst;
}

// ---- slurs ------------------------------------------------------------------------------------------------------------

export interface SlurEnd {
  /** Where the slur starts or ends. */
  point: Point;
}

/** Height of a slur's middle above its chord for a span of `length`: shallow when short, deeper when long, never extreme. */
export function slurHeight(length: number): number {
  return SPACE * (0.5 + 1.5 * (1 - Math.exp(-length / (11 * SPACE))));
}

/**
 * Where a slur starts or ends on a note. On the notehead side it leaves the head's centre, 0.3 of a space off the head.
 * On the stem side it sits at the stem, just beyond its end (Gould), so it does not cut through the stem.
 */
export function slurAnchor(n: NoteInfo, side: Side, end: 'start' | 'end'): Point {
  const dir = sign(side);
  const onStemSide = n.hasStem && n.stem !== 0 && (n.stem === 1 ? 'above' : 'below') === side;
  if (onStemSide) {
    // keep the end of the slur a little inside the span, away from the stem's flag
    const inset = end === 'start' ? 0.5 : -0.5;
    return { x: n.stemX + inset, y: n.stemTipY + dir * SPACE * 0.4 };
  }
  const edge = side === 'above' ? n.yTop : n.yBottom;
  return { x: (n.headX0 + n.headX1) / 2, y: edge + dir * (SPACE * 0.5 + SPACE * 0.3) };
}

export interface SlurShape {
  curve: Bezier;
  side: Side;
  /** The thickness of the slur in its middle, away from the notes. */
  thickness: number;
  /** y distance the curve could not be lifted clear of (0 when it clears everything). */
  clipped: number;
}

/**
 * The curve of a slur from `a` to `b`. Its height comes from the span; then it is lifted, and shaped (the middle moved
 * towards the end that needs more room), until it clears every box in `obstacles` by `margin`, up to `maxHeight`.
 */
export function slurShape(
  a: Point,
  b: Point,
  side: Side,
  obstacles: Rect[] = [],
  opts: { margin?: number; maxHeight?: number; minHeight?: number; thickness?: number } = {}
): SlurShape {
  const margin = opts.margin ?? SPACE * 0.3;
  const maxHeight = opts.maxHeight ?? SPACE * 7;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const base = Math.max(slurHeight(length), opts.minHeight ?? 0);
  const make = (h: number, skew: number): Bezier => {
    const k = h / 0.75;
    return arch(a, b, side, 0.32, 0.32, k * (1 + skew), k * (1 - skew));
  };
  const thickness = opts.thickness ?? SPACE * 0.3;
  if (!obstacles.length) return { curve: make(base, 0), side, thickness, clipped: 0 };

  let best: { h: number; skew: number } | null = null;
  const skews = [0, -0.15, 0.15, -0.3, 0.3, -0.45, 0.45];
  for (const skew of skews) {
    let h = base;
    while (h <= maxHeight && intrusion(make(h, skew), side, obstacles, margin) > 0) h += SPACE * 0.2;
    if (h > maxHeight) continue;
    // prefer the lowest slur; a skew has to win by a good margin over the symmetric shape
    if (!best || h < best.h - SPACE * 0.25) best = { h, skew };
  }
  if (best) return { curve: make(best.h, best.skew), side, thickness, clipped: 0 };
  const curve = make(maxHeight, 0);
  return { curve, side, thickness, clipped: Math.max(0, intrusion(curve, side, obstacles, margin)) };
}

/**
 * The outline of a slur as two beziers: the edge towards the notes, then back along the far edge `thickness` away
 * (control points moved, so the ends taper to a point and the middle is thickest).
 */
export function slurOutline(shape: Pick<SlurShape, 'curve' | 'side' | 'thickness'>): { forward: Bezier; back: Bezier } {
  const { curve, side, thickness } = shape;
  const d = sign(side) * thickness;
  return {
    forward: curve,
    back: {
      p0: curve.p3,
      c1: { x: curve.c2.x, y: curve.c2.y + d },
      c2: { x: curve.c1.x, y: curve.c1.y + d },
      p3: curve.p0,
    },
  };
}

// ---- ties -------------------------------------------------------------------------------------------------------------

export function tieHeight(length: number): number {
  return clamp(SPACE * 0.3 + length * 0.07, SPACE * 0.45, SPACE * 1.1);
}

/** Move `y` off a staff line (a tie that ends on a line looks like a stroke through the head). */
export function offStaffLine(y: number, lineYs: number[], side: Side): number {
  const clearance = SPACE * 0.14;
  for (const line of lineYs) {
    if (Math.abs(y - line) < clearance) return line + sign(side) * clearance;
  }
  return y;
}

export interface TieShape {
  curve: Bezier;
  side: Side;
  thickness: number;
}

/**
 * A tie from one head to the next. It starts just beyond the first head and ends just before the second, 0.42 of a
 * space off the head's centre on `side`, and arches by a height that grows gently with the length.
 */
export function tieShape(a: Point, b: Point, side: Side): TieShape {
  const length = Math.abs(b.x - a.x);
  const h = tieHeight(length);
  const k = h / 0.75;
  return { curve: arch(a, b, side, 0.3, 0.3, k, k), side, thickness: SPACE * 0.26 };
}

/** The end points of the tie of one notehead: just outside the head, past the stem when the stem is on the tie's side. */
export function tieAnchors(
  head: { x0: number; x1: number; y: number; stem: StemDir; stemX: number; hasStem: boolean },
  side: Side,
  end: 'start' | 'end',
  lineYs: number[] = []
): Point {
  const stemOnSide = head.hasStem && head.stem !== 0 && (head.stem === 1 ? 'above' : 'below') === side;
  const y = offStaffLine(head.y + sign(side) * SPACE * 0.42, lineYs, side);
  if (end === 'start') {
    const x = stemOnSide && head.stem === 1 ? Math.max(head.x1, head.stemX + 2) : head.x1 + 2;
    return { x, y };
  }
  const x = stemOnSide && head.stem === -1 ? Math.min(head.x0, head.stemX - 2) : head.x0 - 2;
  return { x, y };
}

// ---- spans across systems ---------------------------------------------------------------------------------------------

export type SegmentRole = 'whole' | 'start' | 'middle' | 'end';

/**
 * How a span from `startSystem` to `endSystem` is cut: one segment in a system, or a segment per system it touches.
 * The first runs from its note to the right end of its system, the last from the left of its system to its note, and
 * a middle one fills its system. The same cutting is used for a page break.
 */
export function splitSpan(startSystem: number, endSystem: number): { system: number; role: SegmentRole }[] {
  if (endSystem <= startSystem) return [{ system: startSystem, role: 'whole' }];
  const out: { system: number; role: SegmentRole }[] = [{ system: startSystem, role: 'start' }];
  for (let s = startSystem + 1; s < endSystem; s++) out.push({ system: s, role: 'middle' });
  out.push({ system: endSystem, role: 'end' });
  return out;
}

/**
 * The open end of a slur or tie cut at a system edge: it stays on the level of the note it is attached to (`anchor`)
 * and reaches just inside the edge. `which` is the end of the segment that is open: the start of a continuation (at the
 * left edge of its system) or the end of the first piece (at the right edge). A note right next to the edge would leave
 * a stub, so the piece is at least `minLength` long (it then reaches over the clef and key signature, as engraved).
 */
export function openEnd(
  anchor: Point,
  edgeX: number,
  which: 'start' | 'end',
  minLength = SPACE * 2,
  gap = SPACE * 0.4
): Point {
  const x =
    which === 'start' ? Math.min(edgeX + gap, anchor.x - minLength) : Math.max(edgeX - gap, anchor.x + minLength);
  return { x, y: anchor.y };
}

// ---- hairpins ---------------------------------------------------------------------------------------------------------

export type HairpinKind = 'crescendo' | 'diminuendo';

/** One straight-sided piece of a hairpin: opening (full height) at both ends, centred on y. */
export interface HairpinPiece {
  x0: number;
  x1: number;
  y: number;
  open0: number;
  open1: number;
}

export const HAIRPIN_OPEN = SPACE * 1.3;

/**
 * A hairpin over `spans` (one [x0, x1] per system, in order). The opening changes evenly over the whole length, so
 * a hairpin cut by a system break continues with the opening it ended with.
 */
export function hairpinPieces(
  kind: HairpinKind,
  spans: { x0: number; x1: number; y: number }[],
  open = HAIRPIN_OPEN
): HairpinPiece[] {
  const total = spans.reduce((t, s) => t + Math.max(0, s.x1 - s.x0), 0) || 1;
  const at = (t: number): number => (kind === 'crescendo' ? open * t : open * (1 - t));
  let done = 0;
  return spans.map((s) => {
    const t0 = done / total;
    done += Math.max(0, s.x1 - s.x0);
    const t1 = done / total;
    return { x0: s.x0, x1: s.x1, y: s.y, open0: at(t0), open1: at(t1) };
  });
}

/**
 * A piece of hairpin as the OMR found it on the scan. An end cut by a system break (`open_*`) is drawn half open; the
 * closed end of a crescendo (start) or diminuendo (end) comes to a point.
 */
export function scanHairpinPiece(
  kind: HairpinKind,
  seg: { x0: number; x1: number; y: number; open_start: boolean; open_end: boolean },
  open = HAIRPIN_OPEN
): HairpinPiece {
  const closedStart = kind === 'crescendo' && !seg.open_start;
  const closedEnd = kind === 'diminuendo' && !seg.open_end;
  const open0 = kind === 'crescendo' ? (closedStart ? 0 : open / 2) : open;
  const open1 = kind === 'diminuendo' ? (closedEnd ? 0 : open / 2) : open;
  return { x0: seg.x0, x1: seg.x1, y: seg.y, open0, open1 };
}

/** The four corner points of a hairpin piece, as two lines (upper, lower). */
export function hairpinLines(p: HairpinPiece): [Point, Point][] {
  return [
    [
      { x: p.x0, y: p.y - p.open0 / 2 },
      { x: p.x1, y: p.y - p.open1 / 2 },
    ],
    [
      { x: p.x0, y: p.y + p.open0 / 2 },
      { x: p.x1, y: p.y + p.open1 / 2 },
    ],
  ];
}
