// Odyssey: the base of the spanning elements (slurs, ties, hairpins) and the glue between VexFlow's notes and the pure
// geometry in `geometry.ts`.
//
// A spanner runs from one note to another and may cross barlines, system breaks and page breaks. It is cut into
// segments, one per system it touches; each segment knows its notes (or none, where the span is open), the stave it
// sits on and the horizontal extent of that stave's system. See `cutSpan`.

import { Accidental } from '../accidental';
import { Beam } from '../beam';
import { Element } from '../element';
import { Note } from '../note';
import { Stave } from '../stave';
import { StaveNote } from '../stavenote';
import { Category } from '../typeguard';
import { NoteInfo, SegmentRole, SPACE, splitSpan, StemDir } from './geometry';

/** The part of a spanner in one system. A missing `first` or `last` means the span is open at that end. */
export interface SpanSegment {
  role: SegmentRole;
  first?: Note;
  last?: Note;
  /** The stave the segment sits on: its notes' stave, or the system's stave for a middle segment. */
  stave: Stave;
  /** Where the system's music begins (after its clef and key) and where it ends. */
  x0: number;
  x1: number;
}

/** The staff of one row in one system: what a segment needs to know where the line breaks are. */
export interface SystemSpan {
  system: number;
  stave: Stave;
  x0: number;
  x1: number;
}

/** One end of a spanner: its note if it is drawn, and the system it is in (if known). */
export interface SpanEnd {
  note?: Note;
  system?: number;
}

/**
 * Cut a spanner from `first` to `last` into one segment per system. An end whose note is not drawn (it is on another
 * page) leaves the span open there. `systemAt` gives the extent of a system's staff, or null when it is not drawn.
 */
export function cutSpan(first: SpanEnd, last: SpanEnd, systemAt: (system: number) => SystemSpan | null): SpanSegment[] {
  const make = (role: SegmentRole, system: number, a?: Note, b?: Note): SpanSegment[] => {
    const at = systemAt(system);
    return at ? [{ role, first: a, last: b, stave: at.stave, x0: at.x0, x1: at.x1 }] : [];
  };
  if (first.note && last.note) {
    const fs = first.system ?? 0;
    const ls = last.system ?? 0;
    return splitSpan(fs, ls).flatMap(({ system, role }) =>
      make(
        role,
        system,
        role === 'whole' || role === 'start' ? first.note : undefined,
        role === 'whole' || role === 'end' ? last.note : undefined
      )
    );
  }
  if (first.note) return make('start', first.system ?? 0, first.note, undefined);
  if (last.note) return make('end', last.system ?? 0, undefined, last.note);
  return [];
}

/** What the geometry needs of a note. `beams` numbers the Beam objects so notes of one beam share an id. */
export function noteInfo(note: Note, beams: Map<Beam, number> = new Map()): NoteInfo {
  const ys = note.getYs();
  let stem: StemDir = 0;
  let stemX = 0;
  let stemTipY = 0;
  let hasStem = false;
  try {
    const dir = note.getStemDirection();
    stem = dir > 0 ? 1 : dir < 0 ? -1 : 0;
    hasStem = note.hasStem();
    if (hasStem) {
      stemX = (note as StaveNote).getStemX();
      stemTipY = note.getStemExtents().topY;
    }
  } catch {
    // rests and notes without a stem
  }
  const sn = note as StaveNote;
  const headX0 = (sn.getNoteHeadBeginX?.() ?? note.getAbsoluteX()) - (note.getLeftDisplacedHeadPx?.() ?? 0);
  const headX1 =
    (sn.getNoteHeadEndX?.() ?? note.getAbsoluteX() + note.getGlyphWidth()) + (note.getRightDisplacedHeadPx?.() ?? 0);
  const accidentals = note.getModifiersByType(Accidental.CATEGORY);
  const leftExtra = accidentals.reduce((w, a) => Math.max(w, a.getWidth() + 3), 0);
  const dots = note.getModifiersByType('Dot').length;
  const beam = note.getBeam();
  let beamId: number | undefined;
  if (beam) {
    if (!beams.has(beam)) beams.set(beam, beams.size);
    beamId = beams.get(beam);
  }
  return {
    headX0,
    headX1,
    yTop: Math.min(...ys),
    yBottom: Math.max(...ys),
    stem,
    stemX,
    stemTipY,
    hasStem,
    beam: beamId,
    flagged: hasStem && sn.hasFlag?.() === true,
    leftExtra,
    rightExtra: dots ? SPACE * 0.9 : 0,
  };
}

/** Base of the spanning elements: holds the segments and the context-drawing boilerplate. */
export abstract class Spanner extends Element {
  static override get CATEGORY(): string {
    return Category.Spanner;
  }

  protected segments: SpanSegment[] = [];
  /** `data-*` of the SVG groups, and the id they get with the segment number appended. */
  protected spanId?: string;
  protected spanData: Record<string, string> = {};

  /** The segments to draw, in order (see `cutSpan`). */
  setSegments(segments: SpanSegment[]): this {
    this.segments = segments;
    return this;
  }

  getSegments(): SpanSegment[] {
    return this.segments;
  }

  /** Name the spanner in the SVG: `<g class="slur" id="<id>-<n>" data-...>`. */
  setSpanId(id: string, data: Record<string, string> = {}): this {
    this.spanId = id;
    this.spanData = data;
    return this;
  }

  /** The group class of the element: "slur", "tie" or "hairpin". */
  protected abstract groupClass(): string;

  /** Draw one segment (inside its SVG group). */
  protected abstract drawSegment(segment: SpanSegment, index: number): void;

  override draw(): void {
    const ctx = this.checkContext();
    this.setRendered();
    this.segments.forEach((segment, i) => {
      const id = this.spanId ? `${this.spanId}-${i}` : undefined;
      ctx.openGroup(this.groupClass(), id, { ...this.spanData, role: segment.role });
      ctx.save();
      this.drawSegment(segment, i);
      ctx.restore();
      ctx.closeGroup();
    });
  }
}
