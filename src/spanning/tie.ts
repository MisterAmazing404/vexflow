// Odyssey: a tie that can cross barlines and system breaks, on the right side of each notehead.
//
// A tie joins noteheads of the same pitch. Its side follows Gould: against the stem for a single note, up in the
// upper half and down in the lower half of a chord, and with the stems when two voices share a staff
// (`tieSide`). Across a system break it is cut like a slur: the first piece leaves its head and runs to the end of
// the staff, the second starts at the beginning of the staff and arrives at its head.

import { StaveNote } from '../stavenote';
import { openEnd, Point, Side, slurOutline, StemDir, tieAnchors, TieShape, tieShape, tieSide } from './geometry';
import { Spanner, SpanSegment } from './spanner';

export class SpanTie extends Spanner {
  static override get CATEGORY(): string {
    return 'SpanTie';
  }

  private firstIndexes: number[] = [0];
  private lastIndexes: number[] = [0];
  private multiVoice = false;
  private forcedSide?: Side;

  /** Which noteheads are tied: `first[i]` of the first note to `last[i]` of the last (indexes into the note's keys). */
  setIndexes(first: number[], last: number[]): this {
    this.firstIndexes = first;
    this.lastIndexes = last;
    return this;
  }

  /** Two voices share the staff: ties follow the stems instead of going against them. */
  setMultiVoice(multi: boolean): this {
    this.multiVoice = multi;
    return this;
  }

  setSide(side: Side): this {
    this.forcedSide = side;
    return this;
  }

  protected groupClass(): string {
    return 'tie';
  }

  /** The tie of every tied notehead in a segment. */
  getShapes(segment: SpanSegment): TieShape[] {
    const lineYs = Array.from({ length: segment.stave.getNumLines() }, (_, i) => segment.stave.getYForLine(i));
    const shapes: TieShape[] = [];
    const first = segment.first as StaveNote | undefined;
    const last = segment.last as StaveNote | undefined;
    const ref = first ?? last;
    if (!ref) return shapes;
    const count = ref.getKeys().length;
    this.firstIndexes.forEach((fi, n) => {
      const li = this.lastIndexes[n];
      const side =
        this.forcedSide ??
        tieSide({
          stem: stemOf(ref),
          // heads are numbered from the lowest; VexFlow's y grows down, so the largest y is index 0
          index: indexFromBottom(ref, first ? fi : li),
          count,
          multiVoice: this.multiVoice,
        });
      const a = first ? anchor(first, fi, side, 'start', lineYs) : undefined;
      const b = last ? anchor(last, li, side, 'end', lineYs) : undefined;
      let start: Point;
      let end: Point;
      if (a && b) {
        start = a;
        end = b;
      } else if (a) {
        start = a;
        end = openEnd(a, segment.x1, 'end');
      } else if (b) {
        start = openEnd(b, segment.x0, 'start');
        end = b;
      } else return;
      shapes.push(tieShape(start, end, side));
    });
    return shapes;
  }

  protected drawSegment(segment: SpanSegment): void {
    const ctx = this.checkContext();
    for (const shape of this.getShapes(segment)) {
      const { forward, back } = slurOutline(shape);
      ctx.beginPath();
      ctx.moveTo(forward.p0.x, forward.p0.y);
      ctx.bezierCurveTo(forward.c1.x, forward.c1.y, forward.c2.x, forward.c2.y, forward.p3.x, forward.p3.y);
      ctx.bezierCurveTo(back.c1.x, back.c1.y, back.c2.x, back.c2.y, back.p3.x, back.p3.y);
      ctx.closePath();
      ctx.setLineWidth(0.4);
      ctx.fill();
      ctx.stroke();
    }
  }
}

function stemOf(note: StaveNote): StemDir {
  const dir = note.getStemDirection();
  return dir > 0 ? 1 : dir < 0 ? -1 : 0;
}

/** Position of key `i` counted from the lowest head (VexFlow's y runs down, so a larger y is lower). */
function indexFromBottom(note: StaveNote, i: number): number {
  const ys = note.getYs();
  const order = ys.map((y, k) => ({ y, k })).sort((p, q) => q.y - p.y);
  return order.findIndex((o) => o.k === i);
}

/** The point where the tie of head `i` of `note` starts (`end` = 'start') or ends. */
function anchor(note: StaveNote, i: number, side: Side, end: 'start' | 'end', lineYs: number[]): Point {
  const head = note.noteHeads[i];
  const x0 = head ? head.getAbsoluteX() : note.getNoteHeadBeginX();
  const x1 = x0 + (head ? head.getWidth() : note.getGlyphWidth());
  const stem = stemOf(note);
  let stemX = 0;
  let hasStem = false;
  try {
    hasStem = note.hasStem();
    if (hasStem) stemX = note.getStemX();
  } catch {
    hasStem = false;
  }
  return tieAnchors({ x0, x1, y: note.getYs()[i], stem, stemX, hasStem }, side, end, lineYs);
}
