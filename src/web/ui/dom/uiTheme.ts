import {
  colourProperties,
  GAME_TEXT_ROLE_CLASS,
  gameTextRoleProperties,
  gameTextRoleReferences,
  type GameTextRoles,
  TEXT_ROLES,
  type TextRole,
  textRoleClass,
  textRoleProperties,
  type TextRoles,
  type UiColours,
} from "../../../ui/uiTheme.ts";
import { writeLayoutProperties } from "./layoutProperties.ts";

// The theme root attribute. uiTheme.css applies the button face fills only inside it, so loading
// the stylesheet changes nothing until a game fills the slots.
export const UI_THEME_ATTRIBUTE = "data-ui-theme";

// Writes the given colour slots on root and marks it as the theme root. Slots left out keep their
// current value. Set the slots on the theme root itself: it bridges the focus slots into
// controls.css's single focus fill there. Throws, before writing any, on an invalid slot.
export function setUiColours(colours: UiColours, root: HTMLElement): boolean {
  const changed = writeLayoutProperties(colourProperties(colours), root);
  const marked = !root.hasAttribute(UI_THEME_ATTRIBUTE);
  root.setAttribute(UI_THEME_ATTRIBUTE, "");
  return changed || marked;
}

// Writes the given text roles' size, line height and weight on root, in base px. Throws, before
// writing any, on an invalid role.
export function setTextRoles(roles: TextRoles, root: ElementCSSInlineStyle): boolean {
  return writeLayoutProperties(textRoleProperties(roles), root);
}

// Writes each game text role's size, line height and weight on root, in base px, beside the kit's
// roles. Throws, before writing any, on an invalid role or a name that is a kit role's.
export function setGameTextRoles(roles: GameTextRoles, root: ElementCSSInlineStyle): boolean {
  return writeLayoutProperties(gameTextRoleProperties(roles), root);
}

const REFERENCES = ["--ui-text-size", "--ui-text-line-height", "--ui-text-weight"];

// Gives element one text role, a kit role's class or a game role's class and references, and
// removes any other role given this way. Throws, before any change, on an invalid game role.
export function setTextRole(role: TextRole | string, element: HTMLElement): void {
  const kit = (TEXT_ROLES as readonly string[]).includes(role);
  const references = kit ? {} : gameTextRoleReferences(role);
  element.classList.remove(GAME_TEXT_ROLE_CLASS, ...TEXT_ROLES.map(textRoleClass));
  for (const name of REFERENCES) {
    element.style.removeProperty(name);
  }
  if (kit) {
    element.classList.add(textRoleClass(role as TextRole));
    return;
  }
  element.classList.add(GAME_TEXT_ROLE_CLASS);
  writeLayoutProperties(references, element);
}
