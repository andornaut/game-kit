import {
  colourProperties,
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
