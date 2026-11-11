// The standard gaps between neighbouring buttons in every game, in base px between button faces,
// in rows and stacks alike. They are the layout values the kit sets, so every game spaces its
// buttons the same; ui.css carries them as --ui-button-gap and --ui-small-button-gap for the HTML
// UI.

// Between standard buttons and full-width rows. A focus ring reaching 4 base px outside each
// button leaves 8 base px clear between two rings.
export const BUTTON_GAP = 16;

// Between small buttons, whose faces are smaller than a standard button's, such as discs in
// larger press targets and compact text buttons: more room against pressing the wrong one.
export const SMALL_BUTTON_GAP = 24;
