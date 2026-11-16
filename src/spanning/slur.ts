// Odyssey: a slur that can cross barlines, system breaks and page breaks, and keeps clear of the notes under it.
//
// The shape comes from `slurShape` in geometry.ts: its height follows the span, and it is lifted and skewed until it
// clears the noteheads, stems and beams between its ends. Across a system break each system gets a segment: the first
// runs from its note to the end of the staff, the next picks up at the start of the staff and runs to its note.

import { Beam } from '../beam';
import { Note } from '../note';
import {
  NoteInfo,
  obstaclesOf,
  openEnd,
  Point,
  Side,
  slurAnchor,
  slurOutline,
  SlurShape,
  slurShape,
  slurSide,
  SPACE,
} from './geometry';
import { noteInfo, Spanner, SpanSegment } from './spanner';

export class SpanSlur extends Spanner {
  static override get CATEGORY(): string {
    return 'SpanSlur';
  }

  private between: Note[] = [];
  private forcedSide?: Side;
  private shapeOf = new Map<SpanSegment, SlurShape>();

  /** The notes under the slur (any voice): the curve avoids their heads, stems and beams. */
  setObstacleNotes(notes: Note[]): this {
    this.between = notes;
    return this;
  }

  /** Force the side; otherwise it follows `SpanSlur.sideFor` over the notes of the slur. */
  setSide(side: Side): this {
    this.forcedSide = side;
    return this;
  }

  /** The side a slur over `notes` takes (see `slurSide`). `voice` is 1 or 2 when the part has two voices. */
  static sideFor(notes: Note[], voice?: 1 | 2): Side {
    const beams = new Map<Beam, number>();
    return slurSide(
      notes.map((n) => noteInfo(n, beams)),
      voice
    );
  }

  protected groupClass(): string {
    return 'slur';
  }

  /** The curve of a segment, worked out from the notes' present positions (they must be formatted). */
  getShape(segment: SpanSegment): SlurShape {
    const cached = this.shapeOf.get(segment);
    if (cached) return cached;
    const beams = new Map<Beam, number>();
    const first = segment.first ? noteInfo(segment.first, beams) : undefined;
    const last = segment.last ? noteInfo(segment.last, beams) : undefined;
    const side = this.forcedSide ?? slurSide([first, last].filter((n): n is NoteInfo => n !== undefined));
    const a = first ? slurAnchor(first, side, 'start') : undefined;
    const b = last ? slurAnchor(last, side, 'end') : undefined;
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
    } else {
      // a segment filling a whole system between its two ends: along the outside of the staff
      const y =
        side === 'above' ? segment.stave.getYForLine(0) - SPACE * 1.5 : segment.stave.getYForLine(4) + SPACE * 1.5;
      start = { x: segment.x0 + SPACE * 0.4, y };
      end = { x: segment.x1 - SPACE * 0.4, y };
    }
    const skip = new Set<NoteInfo>();
    const infos = [...this.between, ...(segment.first ? [segment.first] : []), ...(segment.last ? [segment.last] : [])]
      .filter((n, i, all) => all.indexOf(n) === i)
      .map((n) => ({ n, info: noteInfo(n, beams) }));
    for (const { n, info } of infos) if (n === segment.first || n === segment.last) skip.add(info);
    const lo = Math.min(start.x, end.x);
    const hi = Math.max(start.x, end.x);
    // only the notes within the segment's reach matter
    const inReach = infos
      .filter(({ info }) => info.headX1 >= lo - SPACE && info.headX0 <= hi + SPACE)
      .map(({ info }) => info);
    const shape = slurShape(start, end, side, obstaclesOf(inReach, side, skip));
    this.shapeOf.set(segment, shape);
    return shape;
  }

  protected drawSegment(segment: SpanSegment): void {
    const ctx = this.checkContext();
    const { forward, back } = slurOutline(this.getShape(segment));
    ctx.beginPath();
    ctx.moveTo(forward.p0.x, forward.p0.y);
    ctx.bezierCurveTo(forward.c1.x, forward.c1.y, forward.c2.x, forward.c2.y, forward.p3.x, forward.p3.y);
    ctx.bezierCurveTo(back.c1.x, back.c1.y, back.c2.x, back.c2.y, back.p3.x, back.p3.y);
    ctx.closePath();
    ctx.setLineWidth(0.5);
    ctx.fill();
    ctx.stroke();
  }
}
