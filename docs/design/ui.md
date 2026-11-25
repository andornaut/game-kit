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
  is last; a sole visible action is centred, with no start-aligned option; a footer pins
  secondary left and primary right around an optional middle slot.
- A grid is rows of columns with the same gap rule: cells share the widest face's width or the
  room split evenly, a short last row is centred, and a grid that does not fit takes fewer
  columns. Its press areas clamp toward every neighbour along and between rows.
- Press areas of neighbouring groups, and of a group and a control that is its own press target
  such as a form row, clamp toward each other by the same share rule through a shared press
  context, so no game adds a stacking order or an inset. Inside a group nothing changes. The
  context measures layout positions: each box as drawn less the CSS translate of the member and
  its ancestors below the root, so a playing shake or press shift moves no clamp.
- Geometry is whole game units with a game projection of edges. An odd unit always falls right or
  below.
- Under a game projection the DOM action group, form rows and slider write whole CSS px between
  projected edges through one length variable set to 1px, so each stylesheet keeps one rule set and
  a caller without a projection gets the same styles and layout. Projected press context members
  share the projection's space and are not measured.
- Colours are role-named slots under a theme root, with system colours in forced-colours mode.
  Focus, press and selection are fills; `controls.css` owns the one focus fill. Disabled is
  distinct and never dips. Theme rules have zero specificity.
- Text roles are the kit's four plus any a game names, each the same size, line height and weight
  on the theme root; an element of a game role refers to them, so it needs no game rule.
- Button frame states are size-independent: a nine-slice frame on any face or layer follows its
  button's role, selection, press and disabled state from game tokens, and press and focus fill
  its inside.
- A standard button's refused state is for an option the player can reach but not take: it stays
  focusable and in the Tab order with no description, and Enter, Space and pointer presses play
  the shared refusal cue or the game's refuse callback, as the pager's do. Its styling hook is
  `aria-disabled="true"`, which conveys the refusal to assistive technology with no description
  and which pointer refusal and unavailable already set, so the kit's disabled art applies and
  the game adds no attribute. Pointer refusal keeps leaving the Tab order and unavailable keeps
  its spoken reason.
- Kit screens outside the UI layer, the crash screen and the loading failure card, take the text
  roles and colour slots from an ancestor such as the document root, each with its own type and
  colours as the fallback. The crash screen does this in CSS alone, so it needs no game code.
  Its details summary shows focus as a fill, from the focus slots, else its text and backdrop
  swapped, with no outline. Its details text and face are one slot pair, the panel body's, so a
  theme never draws them in one colour.
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
- A page is a full-screen frame that is not modal: it opens off the modal layer with no backdrop,
  `aria-modal` or inert marks, so covered chrome stays live, and its leave is the game's own.
- Every addition is opt-in and leaves a frame that does not use it unchanged: insets from the
  game, an untitled frame named by its label, a backdrop rect apart from the content rect, a
  footer that measures before its first layout, and a body the game scrolls.
- Under a projection the DOM writes whole CSS px on the game's grid, and the game supplies every
  height the frame would otherwise measure. A game that places its own title ink or footer gives
  their heights and places them from the unprojected layout `layout()` returns.
- A projected frame arranges the kit footer action group with its own projection from the footer
  room's corner.

## Switch, form rows, pager and HUD disc

These build on the layout base: standard buttons, action group tokens and placement, and the
theme slots.

- A form row is one button and the whole press target. Its icon is one state-free frame; its
  label names it and its note describes it. The list's grid columns are shared by every row, so
  the value column is sized by CSS, never by script. The game sets the row height, padding,
  icon slot, switch size and state word placement; rows are the stacked action gap apart.
- A placed list writes its grid as explicit CSS px tracks between projected edges, with the
  padding, the icon slot's sides and the column gaps as tracks of their own and each row track its
  pitch to the next, so rows keep sharing columns through the subgrid. Rows are exactly their
  heights and the game supplies what text would otherwise size: the value track, a centred switch
  stack's height and a slider's first line.
- A switch row is a switch with its state word below the switch, centred or with its ink's right
  edge on the switch's. Focus and press are fills only and a row never dips.
- A pager is an action group of Previous, the count and Next, with one gap token on both sides
  of the count. Its buttons are standard buttons; an unavailable step is disabled or a pointer
  refusal, and the game's keys refuse a step through the pager the same way. A refusal plays the
  shared refusal cue, which a further refusal does not restart and the game can stop, or the
  game's own refuse callback in its place, whose replay and stopping the game owns. The kit cue
  shakes by the inherited unit, 1 where none is set. Dots are decorative. The pager fits a
  footer's middle slot.
- A HUD disc is a round standard button whose box is its face, placed and given its press area by
  an action group. State changes only fill, face image or icon colour, never geometry; an edge
  stays the same in every state. The game's own face fill, a ring drawn as part of it and the
  icon's ink take state tokens, so no per-state art is needed; a ring is never a focus outline.
  The ring may sit a whole-unit inset inside the edge, the same in every state, with the fill
  between, and only the fill layer moves. An outer rim, also part of the fill layer, takes the
  band's outer units at the disc's edge, which may sit a whole-unit inset inside the edge; nothing
  is painted beyond it, so the disc stays round with clear corners. The icon's ink, less its side
  bearings, centres on the face with the odd unit right and below.
- An action group may keep each full press area and route overlaps to the nearest face centre,
  the earlier action on a tie; the DOM draws each area cut where its face stops being nearest.

## Slider

A slider row builds on the form row: pure steps and geometry in `src/ui/slider.ts`, the DOM part
in `src/web/ui/dom/slider.ts` with `slider.css`, in the form row list's grid.

- The value is a whole step from 0 to the game's step count. Left and right arrows move one step,
  Home and End to the ends, and a press anywhere on the row drags the thumb's centre along the
  track; a touch drags only once it travels sideways and leaves vertical travel to scrolling.
- The first line shares the list's columns: one state-free icon, the label and the value word in
  the value column, placed as the list places a state word. The lane spans the row under it.
- The track and thumb are the game's art at their locked sizes, the track a three-slice. The
  track is a whole number of units and the thumb's offset a whole unit, a half rounding right; a
  canvas takes the same geometry through the projection hook.
- Focus and press fill the row only, focus with the one focus fill, with system fills in forced
  colours. A refused slider keeps its focus and value and plays the shared refusal cue.

## Work items

| ID      | Title                                                                        | Link                             |
| ------- | ---------------------------------------------------------------------------- | -------------------------------- |
| gk-0010 | Publish the shared button and control presentation                           | [gk-0010.md](../work/gk-0010.md) |
| gk-0011 | Publish the typed layout tree and its exports                                | [gk-0011.md](../work/gk-0011.md) |
| gk-0023 | Recover focus in strict dialogs after a backdrop press                       | [gk-0023.md](../work/gk-0023.md) |
| gk-0025 | Style keyboard focus in shared game controls                                 | [gk-0025.md](../work/gk-0025.md) |
| gk-0026 | Render standard game buttons through one shared primitive                    | [gk-0026.md](../work/gk-0026.md) |
| gk-0029 | Preserve pointer refusal on unavailable standard buttons                     | [gk-0029.md](../work/gk-0029.md) |
| gk-0031 | Use ring-free button state cues                                              | [gk-0031.md](../work/gk-0031.md) |
| gk-0037 | Respect pointer action admission and paint Retry presses                     | [gk-0037.md](../work/gk-0037.md) |
| gk-0054 | Provide the shared layout base for game UI                                   | [gk-0054.md](../work/gk-0054.md) |
| gk-0055 | Provide the shared modal frame                                               | [gk-0055.md](../work/gk-0055.md) |
| gk-0056 | Provide the shared switch, form row, pager and HUD disc                      | [gk-0056.md](../work/gk-0056.md) |
| gk-0058 | Provide the shared slider                                                    | [gk-0058.md](../work/gk-0058.md) |
| gk-0059 | Use shared text roles and colour slots on kit crash and startup screens      | [gk-0059.md](../work/gk-0059.md) |
| gk-0061 | Add a non-modal page variant to the modal frame                              | [gk-0061.md](../work/gk-0061.md) |
| gk-0062 | Close Chibi's shared component gaps                                          | [gk-0062.md](../work/gk-0062.md) |
| gk-0063 | Add a panel highlight token and fill crash details focus                     | [gk-0063.md](../work/gk-0063.md) |
| gk-0064 | Place DOM action groups, form rows and sliders on the game grid              | [gk-0064.md](../work/gk-0064.md) |
| gk-0065 | Fix themed crash details contrast and inset the HUD disc ring                | [gk-0065.md](../work/gk-0065.md) |
| gk-0066 | Let the pager play the game's refusal cue                                    | [gk-0066.md](../work/gk-0066.md) |
| gk-0067 | Recover grouped installs on a format change and measure press areas unshaken | [gk-0067.md](../work/gk-0067.md) |
| gk-0068 | Add a silent refused state to standard buttons                               | [gk-0068.md](../work/gk-0068.md) |
| gk-0069 | Draw an outer rim on HUD discs                                               | [gk-0069.md](../work/gk-0069.md) |
| gk-0070 | Let form rows and sliders play the game's refusal cue                        | [gk-0070.md](../work/gk-0070.md) |
