// Odyssey: a hairpin (crescendo or diminuendo) as an element that spans measures and systems.
//
// The wedge opens (or closes) evenly over its whole length, so where a system break cuts it the next system
// carries on with the opening the previous one ended with (`hairpinPieces`). Its y is below the staff, clear of the
// lowest note under it. On a scanned page the pieces can instead be given as the OMR found them (`setScanPieces`).

import { Note } from '../note';
import { StaveNote } from '../stavenote';
import { HAIRPIN_OPEN, HairpinKind, hairpinLines, HairpinPiece, hairpinPieces, SPACE } from './geometry';
import { Spanner, SpanSegment } from './spanner';

/** How far below the bottom staff line the middle of a hairpin sits, in VexFlow units. */
export const HAIRPIN_DROP = 28;

export class SpanHairpin extends Spanner {
  static override get CATEGORY(): string {
    return 'SpanHairpin';
  }

  private kind: HairpinKind = 'crescendo';
  private open = HAIRPIN_OPEN;
  private scan?: HairpinPiece[];

  setKind(kind: HairpinKind): this {
    this.kind = kind;
    return this;
  }

  setOpening(open: number): this {
    this.open = open;
    return this;
  }

  /** Draw exactly these pieces (the hairpin as found on the scan) instead of working them out from the notes. */
  setScanPieces(pieces: HairpinPiece[]): this {
    this.scan = pieces;
    return this;
  }

  protected groupClass(): string {
    return 'hairpin';
  }

  /** The pieces to draw, one per segment. */
  getPieces(): HairpinPiece[] {
    if (this.scan) return this.scan;
    const spans = this.segments.map((s) => {
      const a = s.first as StaveNote | undefined;
      const b = s.last as StaveNote | undefined;
      // starts at the first note's head and ends after the last one; an open end runs to the staff's edge
      const x0 = a ? a.getNoteHeadBeginX() : s.x0;
      const x1 = b ? b.getNoteHeadEndX() : s.x1 - SPACE * 0.4;
      return { x0, x1, y: this.yFor(s, a, b) };
    });
    return hairpinPieces(this.kind, spans, this.open);
  }

  /** Below the staff, and below the lowest notehead or stem the hairpin passes. */
  private yFor(segment: SpanSegment, a?: Note, b?: Note): number {
    const base = segment.stave.getYForLine(4) + HAIRPIN_DROP;
    const notes = [a, b].filter((n): n is Note => n !== undefined);
    let low = -Infinity;
    for (const n of notes) low = Math.max(low, ...n.getYs());
    return Math.max(base, low + SPACE * 2 + this.open / 2);
  }

  /** Pieces given from the scan are drawn as they are; otherwise one piece per segment. */
  override draw(): void {
    if (!this.scan) return super.draw();
    const ctx = this.checkContext();
    this.setRendered();
    this.scan.forEach((piece, i) => {
      ctx.openGroup(this.groupClass(), this.spanId ? `${this.spanId}-${i}` : undefined, {
        ...this.spanData,
        role: 'scan',
      });
      ctx.save();
      this.drawPiece(piece);
      ctx.restore();
      ctx.closeGroup();
    });
  }

  protected drawSegment(_segment: SpanSegment, index: number): void {
    const piece = this.getPieces()[index];
    if (piece) this.drawPiece(piece);
  }

  /** The two sides of the wedge. */
  private drawPiece(piece: HairpinPiece): void {
    const ctx = this.checkContext();
    ctx.beginPath();
    for (const [from, to] of hairpinLines(piece)) {
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
    }
    ctx.setLineWidth(1.2);
    ctx.stroke();
  }
}
