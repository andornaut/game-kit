import {
  type FittedText,
  fittingText,
  type TextFitStyle,
  type TextMeasure,
  widestLine,
} from "./textFit";

// How text set on lines lines, its widest line widest screen pixels, misses most lines no
// wider than room, such as "4 lines of 3, 530px wide in 488px"; "" where it fits.
export function overflowOf(most: number, room: number, lines: number, widest: number): string {
  return [
    lines > most ? `${lines} lines of ${most}` : "",
    widest > room ? `${widest}px wide in ${room}px` : "",
  ]
    .filter((part) => part !== "")
    .join(", ");
}

// How fitted misses its style's lines within room as measure measures it (overflowOf); "" where
// it fits.
export function fitOverflow(measure: TextMeasure, room: number, fitted: FittedText): string {
  const most = fitted.style.lines ?? 1;
  return overflowOf(most, room, fitted.lines.length, widestLine(measure, fitted));
}

// A text role: every text a game puts in one box, set in style within room screen pixels.
export interface TextRole {
  readonly name: string;
  readonly room: number;
  readonly style: TextFitStyle;
  readonly texts: readonly string[];
}

// A text that misses its role's room, and how (overflowOf).
export interface TextOverflow {
  readonly overflow: string;
  readonly role: string;
  readonly text: string;
}

// Every text in roles that fittingText cannot set within its role's lines and room, as measure
// measures it, so a test of a game's text expects [] and a failure names each text that
// overflows.
export function overflowingTexts(measure: TextMeasure, roles: readonly TextRole[]): TextOverflow[] {
  return roles.flatMap(({ name, room, style, texts }) =>
    [...new Set(texts)].flatMap((text) => {
      const overflow = fitOverflow(measure, room, fittingText(style, measure, room, text));
      return overflow === "" ? [] : [{ overflow, role: name, text }];
    }),
  );
}
