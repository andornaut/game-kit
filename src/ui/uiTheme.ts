// The UI theme's data: role-named colour slots and text roles a game fills from its own palette
// and type scale. The kit's stylesheets read only these slots, never a game's colour. uiTheme.css
// in web/ui/dom consumes them.

// Colour slots by role. Button slots cover each face state; focus, press and selection change
// only the fill and text colour.
export const UI_COLOUR_ROLES = [
  "accent",
  "buttonDisabledFace",
  "buttonDisabledText",
  "buttonFace",
  "buttonFocusFace",
  "buttonFocusText",
  "buttonPressedFace",
  "buttonPressedText",
  "buttonPrimaryFace",
  "buttonPrimaryText",
  "buttonSelectedFace",
  "buttonSelectedText",
  "buttonText",
  "cardFace",
  "frame",
  "textPrimary",
  "textSecondary",
] as const;

export type UiColourRole = (typeof UI_COLOUR_ROLES)[number];

// 0xRRGGBB, or "#rrggbb" or "#rrggbbaa".
export type UiColour = number | string;

export type UiColours = Readonly<Partial<Record<UiColourRole, UiColour>>>;

// Text roles: heading and body take the primary text colour, supporting the secondary, and label
// inherits its control's text colour.
export const TEXT_ROLES = ["body", "heading", "label", "supporting"] as const;

export type TextRole = (typeof TEXT_ROLES)[number];

// Lengths in base px.
export interface TextStyle {
  readonly lineHeight: number;
  readonly size: number;
  readonly weight: number;
}

export type TextRoles = Readonly<Partial<Record<TextRole, TextStyle>>>;

// The opt-in class that resets a native button's user-agent styling with zero specificity.
export const BUTTON_RESET_CLASS = "ui-button-reset";

// The opt-in classes of buttonFrame.css: a nine-slice frame of any size that follows its button's
// state, and content that moves with the frame's lip.
export const BUTTON_FRAME_CLASS = "ui-button-frame";
export const BUTTON_FRAME_CONTENT_CLASS = "ui-button-frame-content";

const HEX = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;

const kebab = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

// The custom property that holds a colour slot, such as --ui-colour-card-face.
export function colourProperty(role: UiColourRole): string {
  if (!UI_COLOUR_ROLES.includes(role)) {
    throw new RangeError(`Unknown colour role: ${role}`);
  }
  return `--ui-colour-${kebab(role)}`;
}

// The class that applies a text role, such as ui-text-heading.
export function textRoleClass(role: TextRole): string {
  if (!TEXT_ROLES.includes(role)) {
    throw new RangeError(`Unknown text role: ${role}`);
  }
  return `ui-text-${role}`;
}

function cssColour(role: UiColourRole, colour: UiColour): string {
  if (typeof colour === "number") {
    if (!Number.isInteger(colour) || colour < 0 || colour > 0xffffff) {
      throw new RangeError(`${role} must be 0xRRGGBB`);
    }
    return `#${colour.toString(16).padStart(6, "0")}`;
  }
  if (!HEX.test(colour)) {
    throw new RangeError(`${role} must be #rrggbb or #rrggbbaa`);
  }
  return colour.toLowerCase();
}

// Each given slot's custom property and CSS colour. Throws, before returning any, on an unknown
// role or a malformed colour.
export function colourProperties(colours: UiColours): Record<string, string> {
  return Object.fromEntries(
    Object.entries(colours).map(([role, colour]) => [
      colourProperty(role as UiColourRole),
      cssColour(role as UiColourRole, colour),
    ]),
  );
}

// Each given role's size, line height and weight properties, such as --ui-text-heading-size, as
// unitless numbers. Throws on an unknown role, a nonpositive length or a weight outside 1 to 1000.
export function textRoleProperties(roles: TextRoles): Record<string, number> {
  const properties: Record<string, number> = {};
  for (const [role, style] of Object.entries(roles)) {
    const name = textRoleClass(role as TextRole).replace(/^ui-/, "--ui-");
    for (const [field, value] of [
      ["size", style.size],
      ["line-height", style.lineHeight],
    ] as const) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`${role} ${field} must be finite and positive`);
      }
      properties[`${name}-${field}`] = value;
    }
    if (!Number.isInteger(style.weight) || style.weight < 1 || style.weight > 1000) {
      throw new RangeError(`${role} weight must be a whole number from 1 to 1000`);
    }
    properties[`${name}-weight`] = style.weight;
  }
  return properties;
}

// A game's own text roles beyond the kit's four, by lower camelCase name, such as dialogueName.
// Each takes the same size, line height and weight as a kit role and inherits its colour.
export type GameTextRoles = Readonly<Record<string, TextStyle>>;

// The class that applies a game text role: it reads the role's lengths through the --ui-text-size,
// --ui-text-line-height and --ui-text-weight references the element holds (gameTextRoleReferences).
export const GAME_TEXT_ROLE_CLASS = "ui-text-role";

const GAME_ROLE_NAME = /^[a-z][A-Za-z0-9]*$/;

// The custom property prefix of a game text role, such as --ui-text-dialogue-name. Throws on a
// name that is not lower camelCase or that is one of the kit's four roles.
function gameRolePrefix(role: string): string {
  if (!GAME_ROLE_NAME.test(role) || (TEXT_ROLES as readonly string[]).includes(role)) {
    throw new RangeError(`A game text role needs its own lower camelCase name: ${role}`);
  }
  return `--ui-text-${kebab(role)}`;
}

// Each game role's size, line height and weight properties, such as --ui-text-dialogue-name-size,
// as unitless numbers. Throws as textRoleProperties does, or on a name gameRolePrefix refuses.
export function gameTextRoleProperties(roles: GameTextRoles): Record<string, number> {
  const properties: Record<string, number> = {};
  for (const [role, style] of Object.entries(roles)) {
    const prefix = gameRolePrefix(role);
    const checked = textRoleProperties({ body: style });
    for (const field of ["size", "line-height", "weight"]) {
      properties[`${prefix}-${field}`] = checked[`--ui-text-body-${field}`]!;
    }
  }
  return properties;
}

// The properties an element of a game text role holds: references to the role's lengths, which
// the theme root holds, so a change to the role reaches every element of it.
export function gameTextRoleReferences(role: string): Record<string, string> {
  const prefix = gameRolePrefix(role);
  return Object.fromEntries(
    ["size", "line-height", "weight"].map((field) => [
      `--ui-text-${field}`,
      `var(${prefix}-${field})`,
    ]),
  );
}
