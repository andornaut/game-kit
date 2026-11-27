import {
  checkHudDiscSize,
  hudDiscIconOffset,
  type HudDiscSize,
  type IconBearings,
  NO_BEARINGS,
} from "../../../../ui/actions/hudDisc.ts";
import { writeLayoutProperties } from "../layoutProperties.ts";
import { REFUSAL_ATTRIBUTES } from "../refusalCue.ts";
import { type ButtonOptions, type ButtonView, createButton } from "./button.ts";

// The HTML HUD disc (hudDisc.css): one standard button (button.ts) whose box is the round face, at
// its size token in base px times --ui-unit. Place it, alone or with neighbours, as an action of
// an action group (actionGroup.ts), which owns its press area and spacing. The face takes the
// theme's button slots (uiTheme.css) and controls.css's one focus fill, and optionally the game's
// art under the icon; state changes only the face fill or image and the icon colour, never the
// disc's geometry. The icon box holds the game's SVG or art, its ink centred on the face.

export const HUD_DISC_CLASS = "ui-hud-disc";
export const HUD_DISC_FACE_CLASS = "ui-hud-disc-face";
export const HUD_DISC_ICON_CLASS = "ui-hud-disc-icon";
export const HUD_DISC_ART_CLASS = "ui-hud-disc-art";
export const HUD_DISC_SIZE_ATTRIBUTE = "data-ui-hud-disc-size";

export interface HudDiscOptions extends Omit<ButtonOptions, "appearance" | "content"> {
  // The accessible name: player text.
  readonly name: string;
  // The game's decorative SVG or art for the icon box; it fills the box. Draw an SVG in
  // currentColor so state colours tint it.
  readonly icon?: Element;
  readonly bearings?: IconBearings;
  // The game's decorative face art, drawn under the icon and filling the face.
  readonly art?: Element;
  // The size token's name in sizes.
  readonly size: string;
  readonly sizes: Readonly<Record<string, HudDiscSize>>;
  readonly className?: string;
}

export interface HudDiscView {
  // The native button, whose box is the face: an action group's action.
  readonly element: HTMLButtonElement;
  readonly face: HTMLElement;
  // The current size token, for the action group's face size.
  size(): HudDiscSize;
  setSize(size: string): void;
  setIcon(icon: Element | undefined, bearings?: IconBearings): void;
  setName(name: string): void;
  refresh(): void;
  setPressed(pressed: boolean): void;
  holdAction: ButtonView["holdAction"];
  dispose(): void;
}

function resolveSize(sizes: HudDiscOptions["sizes"], size: string): HudDiscSize {
  if (!Object.hasOwn(sizes, size)) {
    throw new RangeError(`Unknown HUD disc size: ${size}`);
  }
  const token = sizes[size]!;
  checkHudDiscSize(token);
  return token;
}

function place(
  element: HTMLElement,
  name: string,
  size: HudDiscSize,
  bearings: IconBearings,
): void {
  const offset = hudDiscIconOffset(size, bearings);
  writeLayoutProperties(
    {
      "--ui-hud-disc-face": size.face,
      "--ui-hud-disc-icon": size.icon,
      "--ui-hud-disc-icon-x": offset.x,
      "--ui-hud-disc-icon-y": offset.y,
    },
    element,
  );
  element.setAttribute(HUD_DISC_SIZE_ATTRIBUTE, name);
}

// Creates a disc at options.size. Throws RangeError on an unknown or invalid size, bearings that
// leave no ink or an empty name.
export function createHudDisc(document: Document, options: HudDiscOptions): HudDiscView {
  const { art, className, name, size, sizes, ...button } = options;
  let token = resolveSize(sizes, size);
  let bearings = options.bearings ?? NO_BEARINGS;
  hudDiscIconOffset(token, bearings);
  let icon = options.icon;
  let current = name;
  const content = () => ({
    kind: "icon" as const,
    name: current,
    ...(icon === undefined ? {} : { icon }),
  });
  const view = createButton(document, {
    ...button,
    appearance: {
      className: `${className ?? ""} ${HUD_DISC_CLASS}`.trim(),
      contentClassName: HUD_DISC_ICON_CLASS,
      face: { className: HUD_DISC_FACE_CLASS },
      layout: "caller",
    },
    content: content(),
  });
  view.face.setAttribute(REFUSAL_ATTRIBUTES.label, "");
  if (art !== undefined) {
    art.classList.add(HUD_DISC_ART_CLASS);
    art.setAttribute("aria-hidden", "true");
    view.face.prepend(art);
  }
  place(view.element, size, token, bearings);
  return {
    dispose: () => view.dispose(),
    element: view.element,
    face: view.face,
    holdAction: () => view.holdAction(),
    refresh: () => view.refresh(),
    setIcon(next, nextBearings = NO_BEARINGS) {
      hudDiscIconOffset(token, nextBearings);
      icon = next;
      bearings = nextBearings;
      view.setContent(content());
      place(view.element, view.element.getAttribute(HUD_DISC_SIZE_ATTRIBUTE)!, token, bearings);
    },
    setName(next) {
      const previous = current;
      current = next;
      try {
        view.setContent(content());
      } catch (error) {
        current = previous;
        throw error;
      }
    },
    setPressed: (pressed) => view.setPressed(pressed),
    setSize(next) {
      const nextToken = resolveSize(sizes, next);
      hudDiscIconOffset(nextToken, bearings);
      token = nextToken;
      place(view.element, next, token, bearings);
    },
    size: () => token,
  };
}
