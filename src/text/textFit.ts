import { wrapWords } from "../lines";
import { type BitmapFont, inkWidth } from "./bitmapFont";

// Text is set at one fixed size per style and never shrinks to fit its room: text that would
// not fit wraps onto more lines, or overflows, which fitsRoom and text/overflow tell.

// A style's scale and how many lines its box holds (1 when unset).
export interface TextFitStyle {
  lines?: number;
  scale: number;
}

// The width of a line in screen pixels at a style, as the game measures it: bitmapMeasure for a
// bitmap font, or a measure read off a drawn label.
export type TextMeasure = (style: TextFitStyle, line: string) => number;

// Text set in a style, broken into its lines.
export interface FittedText {
  lines: string[];
  style: TextFitStyle;
}

// A line's ink width in font at a style (inkWidth).
export function bitmapMeasure(font: BitmapFont): TextMeasure {
  return (style, line) => inkWidth(font, style.scale, line);
}

// Text in style, each paragraph (split at "\n") starting a line. A style of more than one line
// breaks each paragraph at spaces into lines no wider than room as measure measures them, as
// many as it takes. Text too long for its style keeps its size and overflows, which fitsRoom
// tells.
export function fittingText(
  style: TextFitStyle,
  measure: TextMeasure,
  room: number,
  text: string,
): FittedText {
  const paragraphs = text.split("\n");
  const lines =
    (style.lines ?? 1) === 1
      ? paragraphs
      : paragraphs.flatMap((paragraph) =>
          wrapWords((line) => measure(style, line), room, paragraph),
        );
  return { lines, style };
}

// The widest of fitted's lines as measure measures them, or 0 for no lines.
export function widestLine(measure: TextMeasure, fitted: FittedText): number {
  return Math.max(0, ...fitted.lines.map((line) => measure(fitted.style, line)));
}

// Whether fitted keeps to its style's lines, each line no wider than room as measure measures
// it.
export function fitsRoom(measure: TextMeasure, room: number, fitted: FittedText): boolean {
  const { lines, style } = fitted;
  return lines.length <= (style.lines ?? 1) && lines.every((line) => measure(style, line) <= room);
}
