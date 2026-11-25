# UI

Caller tokens size and place buttons; the kit computes layout, focus steps and press areas. The
HTML UI layer supplies units, frames, button skins, modal isolation, focus rings and refusal
cues, and the crash screen uses the game's words and colours.

Reference: [High-density game UI](../../README.md#high-density-game-ui), [Dialog-subtree isolation](../../README.md#dialog-subtree-isolation).

## Layout base

Components keep pure geometry and state in `src/ui/<component>.ts` and their DOM part in
`src/web/ui/dom/<component>.ts` with an opt-in `<component>.css`. `controls.css` holds button
geometry only.

- Action groups own spacing. Layout boxes equal the drawn faces; the group applies the gap tokens
  or a named override, and each press area is an outset clamped to half the space toward a
  neighbour, so no consumer adds per-button padding or negative margins.
- Fitting decides row or stack from face sizes the game supplies, at full font size. The primary
  is last; a sole visible action is centred; a footer pins secondary left and primary right
  around an optional middle slot.
- Geometry is whole game units with a game projection of edges. An odd unit always falls right or
  below.
- Colours are role-named slots under a theme root, with system colours in forced-colours mode.
  Focus, press and selection are fills; `controls.css` owns the one focus fill. Disabled is
  distinct and never dips. Theme rules have zero specificity.
- `.ui-control-row` and `.ui-control-copy` remain for one control beside its copy in flow, with no
  press outsets.

## Modal frame

The modal frame builds on the layout base: pure geometry in `src/ui/modalFrame.ts`, the DOM part
in `src/web/ui/dom/modalFrame.ts` with `modalFrame.css`, and isolation through the existing modal
layer and modal input gate.

- Every length is a whole unit measured from the card's outer edge. The skin is a separate layer
  under the parts, so a CSS face or nine-slice frame never moves content and no part adds padding
  a game cancels.
- Width families are the game's data, clamped inside a 16 unit margin of the game's content rect.
  The card's height follows its content up to the room, past which the body scrolls. A
  full-screen frame is the content rect itself.
- The close face and press target are game data placed from the corner exactly as given, never
  clamped or shifted. The title reserves the whole target plus the gap on both sides, and the
  header reaches the gap below the target. The game sets the title's ink offset.
- The footer is an action group footer variant, pinned the padding in from the card's sides and
  bottom. The close control is the last focus stop.
- The open frame takes the modal layer's dialog isolation, with the backdrop as the only outside
  target and its dim the one colour property; the focus returns to the opener. The game keeps its
  one dismissal action, which the close control, Escape, back and backdrop taps share.

## Work items

| ID      | Title                                                     | Link                             |
| ------- | --------------------------------------------------------- | -------------------------------- |
| gk-0010 | Publish the shared button and control presentation        | [gk-0010.md](../work/gk-0010.md) |
| gk-0011 | Publish the typed layout tree and its exports             | [gk-0011.md](../work/gk-0011.md) |
| gk-0023 | Recover focus in strict dialogs after a backdrop press    | [gk-0023.md](../work/gk-0023.md) |
| gk-0025 | Style keyboard focus in shared game controls              | [gk-0025.md](../work/gk-0025.md) |
| gk-0026 | Render standard game buttons through one shared primitive | [gk-0026.md](../work/gk-0026.md) |
| gk-0029 | Preserve pointer refusal on unavailable standard buttons  | [gk-0029.md](../work/gk-0029.md) |
| gk-0031 | Use ring-free button state cues                           | [gk-0031.md](../work/gk-0031.md) |
| gk-0037 | Respect pointer action admission and paint Retry presses  | [gk-0037.md](../work/gk-0037.md) |
| gk-0054 | Provide the shared layout base for game UI                | [gk-0054.md](../work/gk-0054.md) |
| gk-0055 | Provide the shared modal frame                            | [gk-0055.md](../work/gk-0055.md) |
| gk-0056 | Provide the shared switch, form row, pager and HUD disc   | [gk-0056.md](../work/gk-0056.md) |
