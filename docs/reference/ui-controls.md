# Input and UI controls

Wire foreground input and compose controls with game-owned actions, layout tokens and art.

[Reference](README.md)

## Foreground input

Use `bindForegroundInput(options, document)` from `runtime/web/input/dom/foregroundInput` to
give the active page, modal, recovery panel or crash screen one input owner. Bind it before
game-level capture handlers. Register each page with its current action resolver and remove
its registration on exit. Pass the router to `createModalLayer(root, foregroundInput)` and to
loading failure and crash options. Replace overlapping legacy key and secondary-button handlers
when adopting the router.

Arrows, WASD and HJKL move focus. Enter, Space, E and F invoke the focused eligible action.
Editors, composition, native controls and keys explicitly reserved by the surface keep their own
handling. Supply `preserveKey` where a control owns directional movement. Escape uses the top
surface's eligible Skip or dismissal. The game supplies the fallback and eligibility rules.

Secondary pointer activation resolves the current action on guarded release. Drag, cancellation,
surface changes and loss of availability prevent activation. Context-menu suppression is scoped
to the gesture. With the router omitted, existing modal and recovery bindings retain their defaults.

## Dialog-subtree isolation

`runtime/web/ui/dom/modalLayer` accepts `ModalOptions.isolation: "dialog"` to keep only the top dialog subtree interactive. Omission or `"layer"` retains the existing containing-layer behaviour. Strict mode rejects nonempty `live` exceptions. Optional `backdrop` names the exact element allowed to receive pointer actions outside the dialog. Its other descendants are not allowed. The caller retains the original outside-dismissal callback and mandatory-choice policy.

Strict mode keeps the dialog's ancestor paths live and makes their other branches inert. It does not move, hide, style or dim the underlying UI. Only manager-owned inert marks are restored. Nested close and focus restoration retain the existing stack. Owned-root capture guards block outside pointer and activation events, while a child-list observer updates inert branches for inserted controls. Keyboard focus and mapped actions stay within the top dialog, including close keys when no close callback exists. The focus order skips controls in a `data-ui-pending` subtree until the marker is cleared.

Handled action keys stop before later listeners on the same root. After focus falls to a neutral document target, Tab and the mapped arrow keys recover focus inside the valid top strict dialog. Forward and reverse navigation start at the first and last eligible controls, respectively. Neutral activation and close keys remain contained. Unmapped editing keys and legacy-mode handling remain unchanged.

Configure and create the manager before delegated action listeners on its root. It cannot suppress an earlier listener on that root or an ancestor capture listener. Keep caller world/Phaser input scopes and cross-modal gesture guards. Dimming, visible layout, allowed navigation and actual backdrop selection remain caller-owned. Invalid strict configurations fail before stack, focus or inert changes.

## Standard game buttons

Import `createButton(document, options)` from `@andornaut/game-kit/runtime/web/ui/dom/button` and load the existing `controls.css`. The returned view owns one stable native button, an optional skin face and a content slot. Text supplies its name. Icon-only content requires a name and accepts a decorative noninteractive element. Update content with `setContent` and presentation with `refresh`. Use `dispose` before releasing the view.

Place the native button in the caller's existing root action registry. Resolve the view through `holdAction()` and use the existing `bindHoldActions` on that root. In pointer-release mode return the same action from the physical resolver and use `setPressed` in the existing press feedback callback. Route click capture through the existing readiness and modal guards. Return `null` from `getAction` while a caller guard blocks activation. Keep only the renderer's native click handler on the button. Supply the current callback and change action identity when reusing a button for another logical action. A hold uses the normal callback unless the caller supplies a hold override.

Keep the game's skin, size tokens, placement, labels and navigation callbacks in the caller. `appearance.layout: "caller"` keeps existing geometry. Native disabled controls, focusable unavailable controls with a reason, selected styling, toggle semantics and momentary press feedback remain distinct. Use separate native form and continuous input paths for submit, steering, drag, sliders and editing.

**Refused.** Return `{ kind: "refused" }` as the availability from `getState` for an option the player can reach but not take, such as a choice card they cannot afford. The button stays enabled, focusable and in the Tab order, with no description or reason, and is `aria-disabled="true"`, which the kit sets on every refresh while the state holds. Style it on `[aria-disabled="true"]`. Pointer refusal and unavailable set the same attribute, and the kit's theme, frame and HUD disc stylesheets already draw it as disabled. Enter, Space and pointer presses and holds under a current action play `refusal`, a `ButtonRefusal`. With `{ cue, reducedMotion }`, the button calls `refuse` from `refusalCue` and leaves a cue already playing there to finish. With `{ refuse, reducedMotion }`, it calls the game's `refuse(reducedMotion, control)` in its place, with `reducedMotion()` read at that refusal and the refused button, as the pager's `refusal` does (`PagerRefusal` is `ButtonRefusal`). `refuseButton(refusal, control)` plays a refusal the same way on any control. `ButtonRefusal<Control>` takes the refused element's type, `HTMLButtonElement` by default. Without `refusal` a refused press does nothing. Focus and press stay fills. Form rows and HUD discs take the same state and option. Pointer refusal, unavailable and every other state are unchanged.

```ts
const card = createButton(document, {
  appearance: { className: "choice-option", layout: "caller" },
  content: { kind: "icon", name: cardName },
  getAction: () => ({ activate: () => choose(index) }),
  getState: () => ({ availability: { kind: entry.enabled ? "available" : "refused" } }),
  // playRefusal(reducedMotion, control)
  refusal: { reducedMotion: () => settings.reducedMotion, refuse: playRefusal },
  rule: HOLD_RULE,
});
```

The loading-failure presenter keeps its asset-independent inline fallback and adds a themed keyboard-focus cue when the browser exposes the necessary focus and forced-colors features. Native focus remains visible on the fallback path. Retry still uses its existing single-flight and input guards.

## Action groups and UI theme

`runtime/ui/actionGroup` lays out a group of action faces and owns the spacing between them. `arrangeActions(context, items)` takes each face's outer ink bounds in whole game units with the lip included, from data (`BUTTON_SIZE`) or measured labels plus padding. Fitting uses full font sizes. A row that does not fit `width` stacks, and a stack wider than `width` throws `RangeError`. Hidden items keep their identity, take no space and do not count. Secondary actions keep the caller's order and at most one visible primary goes last, rightmost in a row and at the bottom of a stack. A sole visible action is centred. Results stay in the caller's order with each visible action's `face`, `press`, `outset` and visual `order`.

- **Gaps.** `gap` is `"standard"` (`BUTTON_GAP` across, `STACK_BUTTON_GAP` stacked), `"small"` (`SMALL_BUTTON_GAP` both ways) or a named override `{ name, row, stack }` for an exempt layout. Action gaps are separate from layout tree `gap` and `padding`.
- **Press areas.** `press` is the hit rule (default `HIT_RULE`, its margin rounded up and grown to `minTarget`) or `{ margin }`. Toward a neighbour an outset is clamped to its share of the space between the faces, so press areas meet without overlap and never change layout. A clamped press area can be smaller than `minTarget`. With `pressOverlap: "nearest"` each `press` keeps its full size and may overlap a neighbour's. `pressedAction(arrangement, point)` routes a press to the action whose face centre is nearest, the earlier in the caller's order on a tie (`hitAreas` `pressedArea`). Each `outset` is then the part of the press area where its face is nearest along the axis, cut at a whole unit, so the DOM group's hit testing routes the same way. Toward a footer's middle slot outsets clamp in both modes.
- **Whole units.** Every input and output is a whole unit. Where a length splits unevenly, the odd unit goes right or below. Centring puts it after the content and the later of two neighbours takes it of the space between them. `project: { x(edge), y(edge) }` maps edges to the caller's space, such as integer device pixels, and must be nondecreasing with whole results. Neighbours share projected edges. `origin` offsets the group.
- **Stacks.** Faces stretch to the widest face (`stackWidth: "content"`, the default) or the whole room (`"fill"`). `locked: true` keeps an art-locked face at its size, centred in the column.
- **Footer.** `variant: "footer"` pins secondary actions from the left edge and the primary at the right edge, with an optional `middle` slot (such as a pager) centred in the room, each at least the row gap apart. A sole action without a middle slot is centred. A footer that does not fit stacks with the middle slot first.
- **Text.** `placeText(face, item)` receives each projected face and its result is returned as `text`. Without it text placement stays with the game.

`runtime/web/ui/dom/actionGroup` applies an arrangement in base px at `--ui-unit` with `actionGroup.css`. The game appends its action elements, such as `createButton` views, to `element` in its focus order. `arrange(context, actions)` takes `{ element, role, size, locked? }`, reads `element.hidden`, and places each direct child absolutely by its face. The DOM order, focus order and classes stay the game's. Each action's `::before` is its press area, outset by the arranged amounts, so the browser's hit test takes it as the action. A clipping ancestor clips outsets that reach past it. `measure(elements)` returns natural face sizes in whole base px, rounded up, at max-content.

```ts
import { createActionGroup } from "@andornaut/game-kit/runtime/web/ui/dom/actionGroup";

const group = createActionGroup(document);
group.element.append(back.element, resume.element);
const [backSize, resumeSize] = group.measure([back.element, resume.element]);
group.arrange({ width: CARD_CONTENT_WIDTH }, [
  { element: back.element, role: "secondary", size: backSize! },
  { element: resume.element, role: "primary", size: resumeSize! },
]);
```

**Projection in the DOM.** `arrange` and `arrangeGrid` also take the pure context's `project`, with `origin` the group's corner in the game's units (`origin` takes `project`), for a game that places its kit on its own pixel grid. The group then takes `data-ui-action-projected` and writes its box, each face, the middle slot and each press outset in whole CSS px between projected edges (`--ui-action-length: 1px`) instead of base px at `--ui-unit`, from the group's projected corner, `arrangement.group.x` and `.y`, where the game places the element. Neighbours share projected edges, so press areas still meet without overlap. Arranged without `project`, the group is in base px again.

**Grids.** `arrangeActionGrid(context, items)` lays actions out in rows of at most `columns`, such as two-column cards, with the same items, gaps, `press`, `pressOverlap`, `origin`, `project` and `placeText`. Cells share one width, either the widest face (`cellWidth: "content"`, the default) or the room split evenly (`"fill"`). A `locked` face keeps its size, centred in its cell. Visible actions fill the rows in visual order with the primary last, rows the stacked gap apart and columns the row gap apart. A short last row is a centred row of its faces, so a sole action is centred. There is no start-aligned option. A grid that does not fit `width` at full size takes fewer columns, down to one, and a column wider than `width` throws `RangeError`. Press areas clamp toward every neighbour along and between rows, so they meet without overlap. The result has `axis: "grid"` and the `columns` and `rows` placed. `pressedAction` takes it as it takes a group's. The DOM group's `arrangeGrid(context, actions)` places it as `arrange` does.

**Press clamping between groups.** `separatePressAreas(members)` clamps the press areas of neighbouring members toward each other by the rule a group uses inside. Each takes its share of the space between two faces, the earlier (left or top) the lower half and the later the odd unit, so press areas from different groups, or from a group and a box that is its own press target (a form row), meet without overlap and need no stacking order or inset. Members are arrangements and boxes in one space (arrange each at its `origin`, with the same projection). A box keeps its area, and inside a member nothing changes, so `pressOverlap: "nearest"` keeps routing its own actions. Faces of two members that overlap, such as content scrolled under a footer, stay as they are. In the DOM, `createPressContext(root)` holds the members. Use `add(group)` (a view that wraps a group, such as a modal frame's `footer`, is that group) and `add(element)` for an element whose box is its press target, such as a form row. `apply()` measures each shown member's layout position under `root` in whole base px at its `--ui-unit`, its box as drawn less the CSS `translate` of the member and of each ancestor below `root`, so a refusal shake or press shift that is playing moves no clamp, and writes each group's clamped outsets. A member group's `arrange` and `arrangeGrid` apply it again. Apply after anything else moves a member, such as a frame's `layout`. `remove(member)` restores a group's own outsets. With projected groups, `apply()` measures nothing. The members are in the projection's space, each group as arranged and each element at its placed form row box (a placed list's row), and every group must be projected with the same projection (`RangeError` otherwise).

```ts
import {
  createActionGroup,
  createPressContext,
} from "@andornaut/game-kit/runtime/web/ui/dom/actionGroup";

const menu = createActionGroup(document);
menu.element.append(achievements, settings, cheats, home, resume);
menu.arrangeGrid({ cellWidth: "fill", columns: 2, width: CARD_CONTENT_WIDTH }, [
  ...[achievements, settings, cheats, home].map((element) => ({
    element,
    role: "secondary" as const,
    size: TEXT_BUTTON_SIZE,
  })),
  { element: resume, locked: true, role: "primary", size: resumeSize },
]);

const presses = createPressContext(frame.card);
presses.add(unlocks);
presses.add(invincibility.element);
presses.add(frame.footer);
frame.layout(context, parts);
presses.apply();
```

`runtime/ui/uiTheme` and `runtime/web/ui/dom/uiTheme` with `uiTheme.css` supply the theme. `setUiColours(colours, root)` writes role-named colour slots (`cardFace`, `frame`, `textPrimary`, `textSecondary`, `accent` and the button face and text states) from `0xRRGGBB` numbers or `#rrggbb`/`#rrggbbaa` strings as `--ui-colour-<role>` and marks `root` with `data-ui-theme`. Inside it, standard button faces take the idle, primary, selected, pressed and disabled slots, and the focus slots feed the focus fill in `controls.css`, which stays the one focus treatment. State changes only fill and text colour. `--ui-button-press-dip` (base px, default 0) moves a pressed face and a disabled face never dips. Forced colours use `ButtonFace`, `Highlight` and `GrayText` fills. `setTextRoles(roles, root)` writes `{ size, lineHeight, weight }` in base px for the `ui-text-body`, `ui-text-heading`, `ui-text-label` and `ui-text-supporting` classes. `setGameTextRoles(roles, root)` writes a game's own roles beyond those four, by lower camelCase name (`dialogueName` writes `--ui-text-dialogue-name-size` and so on), and refuses a kit role's name. `setTextRole(role, element)` gives an element one role, a kit role's class or, for a game role, the `ui-text-role` class with references to its lengths, so a change on the root reaches every element of it. A game role inherits its colour. `ui-button-reset` removes user-agent button styling. Every rule in `uiTheme.css` has zero specificity, so a game's component classes always win, and the stylesheet holds no colour literals.

The kit screens outside the UI layer follow the same roles and slots where a game sets them on an ancestor, such as `setTextRoles(roles, document.documentElement)` and `setUiColours(colours, document.documentElement)`, with role lengths at the `--ui-unit` the screen inherits (1 where none is set). The crash screen (`crash.css`, CSS only, so it needs no game code to have run) takes `heading` for its title, `body` for its text, `label` for Reload and Copy and `supporting` for the dev stack. It uses `textPrimary`, `frame` and `cardFace` for its text, panel border and face. Its buttons use the button, primary, focus and pressed slots. The dev stack takes `textPrimary` on `cardFace`, the panel body's pair, so a text slot in the ink colour still reads. Each falls back on its own to the screen's text on `CrashColours.ink`, so a game that sets `textPrimary` sets `cardFace` with it. Its focused details summary fills from `buttonFocusFace` and `buttonFocusText`, else its own text and backdrop swapped, and from `Highlight` and `HighlightText` in forced colours, with no outline. The loading failure and capability error card (`mountLoadingFailure`, and `prepareBrowserLaunch`'s unsupported card) takes `heading`, `body` and `label` for its title, text and Retry. It uses `cardFace`, `textPrimary` and `frame` for its panel, text and borders, and the primary, focus and pressed button slots for Retry. Each value falls back to the screen's own `CrashColours` and its 22, 16 and 12 px monospace type, or the card's `presentation` sizes and palette, else its native system fallback. A page that sets none renders as before, apart from the summary's focus fill. Lip, shadow, highlight and shade colours, the panel geometry and forced-colours fills take no slot.

**Button frames.** The opt-in `buttonFrame.css` gives a nine-slice frame of any size the button state rules. The face itself, or a layer inside the button, with the `ui-button-frame` class (`BUTTON_FRAME_CLASS`). It follows the button's `data-ui-button-role="primary"`, `data-ui-selected`, `data-ui-pressed` and disabled state, the last matching state winning in that order. The game points `--ui-button-frame-image`, `--ui-button-frame-slice` and `--ui-button-frame-width` (a whole-pixel length, as `--ui-frame-width`) at its idle frame's properties, and the same three for `primary`, `selected`, `pressed`, `primary-pressed` and `disabled` (such as `--ui-button-frame-primary-pressed-image`). One left unset takes the idle frame's, a primary pressed one the primary's. Inside the theme root, press and focus keep the frame's edges and fill its inside from the pressed slot and the one focus fill, focus winning. A disabled frame keeps its own centre. Content marked `ui-button-frame-content` moves down `--ui-button-frame-pressed-shift` base px while pressed and `--ui-button-frame-disabled-shift` while disabled, both 0 by default. Forced colours draw a `ButtonText` or `GrayText` edge with `ButtonFace` or `Highlight` inside. Every rule has zero specificity and the stylesheet holds no colour literals.

## Modal frame

`runtime/ui/modalFrame` places a modal frame in whole game units, every length measured from the card's outer edge, so a skin never moves content. `modalFrameRooms(context)` gives the widths the game lays its parts out in (`card`, `title`, `body`, `footer`). `placeModalFrame(context, sizes)` places the `card`, `header`, `title`, scroll `body` with its `bodyInset`, optional `footer` room and `close` face, press target and outsets, and reports whether the body `scrolls`. Invalid input throws `RangeError`.

- **Card.** `families` (the game's width families as data, such as `{ large: 688, medium: 500, small: 400 }`) and `family` set the width, clamped inside `margin` (16) of the game's `content` rect. Height follows content up to the content rect less the margin above and below, past which the body scrolls. The card is centred both ways. The odd unit goes right and below.
- **Full screen.** `variant: "fullScreen"` makes the frame the content rect, its close control anchored to the view's corner and its body the height the header and footer leave.
- **Close.** `close.face` and `close.press` are corner rects, `x` in from the right edge and `y` down from the top. The press target must contain the face and defaults to `HIT_RULE` centred on it. It is never clamped or shifted and may reach past the card.
- **Header.** The title box is the card width less a reserve on each side. The reserve is the whole close target from the right edge plus the gap, mirrored left, or the padding without a close. The header is the title's height plus its `inset` (default the padding) above and below, and at least the close target's bottom plus the gap and `bodyOutset`. The title is centred in it, then moved by the game's whole-unit `inkOffset`.
- **Body and footer.** The body runs from the header to the gap above the footer, with the padding at its sides. Without a footer the bottom padding is inside the body. The footer is the padding in from the card's sides and bottom, its height the footer action group's.
- **Projection.** `project` maps every edge as in `arrangeActions`.

`runtime/web/ui/dom/modalFrame` with the opt-in `modalFrame.css` builds the frame as a full-area `element` holding the `backdrop` and the `card` (`role="dialog"` or `"alertdialog"`, `id`, `aria-labelledby` its `<id>-title` and, with `description`, `aria-describedby` its `<id>-text`). The card holds a `skin` layer for the game's CSS face or nine-slice `.ui-frame` (`skinClassName`), the header and `title` (`ui-text-heading`), the scroll `body` with its `content` box the game appends to, the footer `createActionGroup` (`footer`) and the game's close control, kept last in focus order. `layout(context, parts)` measures the title at its room, the content and the footer actions (sizes from `footer.measure`), arranges the footer with `variant: "footer"`, and places every part at `--ui-unit`. Lay out again after content, fonts or the content rect change. The close control's box is its face and its `::before` the press target. Every rule has zero specificity. The only colour is `--ui-modal-backdrop`, the dim over covered chrome, unset by default.

`open({ layer, close, focus, input, outsideTap, restore })` opens the card on the game's `modalLayer` in dialog isolation with the backdrop as its only outside target. Covered chrome is inert under the backdrop, and the focus returns to the opener on close. `close` is the game's one-layer dismissal, the same action as the close control. Escape, P and back call it, and with `outsideTap: { tapMaxDistance, tapGuard? }` a backdrop tap does too. `input` takes a `modalInput` scope for the session. The returned session's `close()` ends it.

```ts
import { createModalFrame } from "@andornaut/game-kit/runtime/web/ui/dom/modalFrame";

const frame = createModalFrame(document, { id: "restart", skinClassName: "ui-frame", title });
frame.content.append(message);
frame.footer.element.append(cancel.element, restart.element);
modalRoot.append(frame.element);
const [cancelSize, restartSize] = frame.footer.measure([cancel.element, restart.element]);
frame.layout(
  { close: CLOSE, content: SAFE_AREA, families: MODAL_WIDTHS, family: "small" },
  {
    close: closeButton.element,
    footer: {
      actions: [
        { element: cancel.element, role: "secondary", size: cancelSize! },
        { element: restart.element, role: "primary", size: restartSize! },
      ],
    },
  },
);
const session = frame.open({ close: dismiss, focus: restart.element, input: gate, layer });
```

### Pages, untitled frames and projection

Each addition is opt-in. A frame that uses none of them is placed and opened as before.

- **Page.** `variant: "page"` is placed as a full-screen frame and is not modal. After a `page` layout the DOM frame hides its backdrop and `open({ focus, input, restore })` takes no `layer`, `close` or `outsideTap`. It focuses `focus` or the card, sets no `aria-modal` and no `inert`, so covered chrome such as a top bar stays live, and closing returns the focus to the opener unless the player moved it to live chrome. A card or full-screen frame still needs `layer`.
- **Insets.** `insets: { side, bottom }` (each default the padding) set the body content's and footer's side inset and the footer's (or, without a footer, the body content's) bottom inset. The title keeps the padding.
- **Untitled.** Omit `sizes.title` for a frame without a title. Its header is the padding, or the close clearance when that is taller, and `title` is an empty box. In the DOM, omit `title` and pass `label`. The dialog takes `aria-label`, the title element is hidden and `setTitle` throws.
- **Backdrop.** `context.backdrop`, a whole-unit rect in the content rect's space, places the backdrop independently of the frame, such as over letterbox bars. Round a fractional cover outward. Omitted, the backdrop fills the frame root as before.
- **Projection in the DOM.** With `project`, the frame root takes `data-ui-modal-projected` and every placed length is whole CSS px on the game's grid (`--ui-modal-length: 1px`) instead of base px at `--ui-unit`, and the body's side and bottom insets are each projected. The game then supplies `parts.title.height` and `parts.body`. The frame does not measure across the projection. A kit footer (`parts.footer.actions`, sizes from data or `footer.measure`) is arranged on the frame's grid with the frame's own projection from the footer room's corner, so a projected page can use the footer action group.
- **Game-owned parts.** `parts.title.height` sets the title box's height for a title whose content the game places, such as ink-placed glyph runs inside `frame.title`. `parts.footer: { height }` reserves the footer room for the game's own footer, appended to `frame.footerSlot`. `layout()` also returns `units`, the layout before projection, so the game places its ink and controls from the same rects.
- **Game scroll.** `parts.scroll: "game"` stops the body's native scroll, clip and pan. The game moves and clips its content, such as by a scene-driven transform in its own clip.
- **Footer measure.** `frame.footer.measure()` shows the footer slot while it measures, so actions measure before the first layout.

```ts
// Archie's Pet shop page under its live top bar, on its device art-pixel grid.
const page = createModalFrame(document, { id: "shop", title: "Pet shop" });
const spans = titleLines.map((line) => createTextLine(document, line));
page.title.replaceChildren(...spans);
page.footerSlot.append(back);
layer.append(page.element);
const { units } = page.layout(
  {
    content: { height: 520, width: 360, x: 0, y: 40 },
    insets: { bottom: 12, side: 8 },
    project: { x: (edge) => gridX(scale, edge), y: (edge) => gridY(scale, edge) },
    variant: "page",
  },
  { body: listHeight, footer: { height: 48 }, scroll: "game", title: { height: 15, inset: 24 } },
);
titleLines.forEach((line, i) => placeText(bitmap, scale, units.title, spans[i], line));
placeBox(scale, units.footer, back, backRect);
const session = page.open({ focus: back });

// Chibi's untitled card, its backdrop over the letterbox bars.
const card = createModalFrame(document, { id: "stages", label: "Stage select" });
card.layout(
  { backdrop: SCREEN_COVER, content: VIEW, families: CARD_WIDTH, family: "large" },
  { footer: { actions } },
);
```

## Switch, form rows, pager and HUD disc

Each component keeps pure state and geometry in `runtime/ui/<component>` and its DOM part in `runtime/web/ui/dom/<component>` with an opt-in `<component>.css`. Every rule has zero specificity, lengths are unitless base px at `--ui-unit` from the game's tokens, colours are the `uiTheme` slots with system colours in forced-colours mode, `controls.css` owns the one focus fill, and every label is player text. Invalid input throws `RangeError`.

**Form rows.** `createFormRows(document, layout)` makes the list. `createFormRow(document, options)` makes a row, one standard button (`createButton`), so the whole row is the press target with the kit's hold, availability and refusal paths. A row holds an optional `icon` (one state-free frame of the game's art), its `label` and optional `note` (its description), and a trailing value stack. With `switch: true` the row is `role="switch"` with `aria-checked` from `getState().checked`, and the stack shows the game's `ui-switch` art (`--ui-switch-on-image`, `--ui-switch-off-image`, such as a button skin's cut frames) over the state word `getState().value` (On, Off, Shown or Hidden). Without it `value` is a described value. The list is a grid whose icon, label and value columns every row shares as a subgrid, so the value column is the widest value stack (or `value.track`, a fixed width) with no script measurement. `runtime/ui/formRow` `formRowPresentation(layout)` turns the game's `FormRowLayout` into the list's properties for `height`, `columnGap`, `padding`, `align` (`"center"` or `"start"` with icon and value `offset`s), the `icon` slot and size, the art-locked `switch` size, and the state word's `value.state` (`"center"` under the switch, or `"end"` with its ink's right edge on the switch's by `value.bearing`) and `value.gap`. Rows are `gap` apart, `ACTION_GAPS.standard.stack` by default. In the theme rows have a clear idle face and no press dip. State changes only the fill. A row with `pressDip` (whole units) moves its art, every child but a one-action row's face, down that far while pressed, never while disabled. The row and its press target stay put. A centred switch keeps whole-unit placement with the odd unit right when its column's right edge is whole. A `track` keeps it independent of the words' widths. A row refuses as its button does. A refused row (`{ kind: "refused" }`), value or switch, plays `refusal` on Enter, Space, pointer presses and holds, and with `{ refuse, reducedMotion }` calls the game's `refuse(reducedMotion, control)` with the row's button and never the kit cue. Pointer refusal calls only `onPointerRefusal`, never `refusal` or the kit cue, so a game plays its own cue there, such as `onPointerRefusal: () => playRefusal(reducedMotion(), row.element)`.

```ts
import { createFormRow, createFormRows } from "@andornaut/game-kit/runtime/web/ui/dom/formRow";

const rows = createFormRows(document, {
  columnGap: 8,
  height: 48,
  icon: { size: 16, slot: 24 },
  switch: { height: 16, width: 32 },
  value: { gap: 4 },
});
const fps = createFormRow(document, {
  getAction: () => ({ activate: toggleFps }),
  getState: () => ({ checked: settings.fps, value: settings.fps ? words.on : words.off }),
  icon: fpsIcon,
  label: words.fpsCounter,
  rule: HOLD_RULE,
  switch: true,
});
rows.element.append(fps.element);
```

**One-action rows.** `createFormRow(document, { action: { size, className, role }, label, icon, ... })` makes a row whose only content is one standard button face of `size` (whole units), in the game's `className` and `role`, centred in the whole row, the list's padding included, with the odd unit right and below. The face holds the optional `icon` and the `label`. `view.face` is the face. The row stays the button, so its press target is the whole row with no outsets, and it takes the list's gap and the press context like any row. The face takes the standard button face's theme fills and focus fill and dips by the theme's `--ui-button-press-dip`, which the list sets to 0 and the game may set on the row. A one-action row takes no `switch`, note or value. This is the smaller shape than per-edge press margins on rows because a form row is already one press target, so a face inside it covers the row without margins, clamps or a second hit area.

```ts
// Archie's Install row: the sole action's 145x33 face, the whole row its press.
const install = createFormRow(document, {
  action: { className: "adw-face", role: "secondary", size: { height: 33, width: 145 } },
  getAction: () => (accepts() ? { activate: startInstall } : null),
  icon: installIcon,
  label: words.install,
  rule: HOLD_RULE,
});
```

**Placed lists.** For a game that places its kit on its own pixel grid, `rows.place({ project, width, origin }, rows)` places the list through the game's projection (`ActionProjection`, as for `arrangeActions`) instead of CSS sizing. `rows` are the list's own kit rows (`createFormRow`, `createSlider`) in its order. The shown ones are each exactly their own height, each its gap below the one before from `origin`, `width` units wide. A row's height is an entry's own, `{ element, height }` in whole units, or a slider's `layout.height`, or the layout's `height`, so rows of different heights share one list. Its track, padding, icon, switch, lane, art and press dip follow that height. A row's gap is the layout's `gap`, or an entry's own. The entry `{ element, gap }` sets the whole units above that row, ignored on the first shown row. The list takes `data-ui-form-projected` and writes its grid as explicit CSS px tracks between projected edges (`--ui-form-columns` and `--ui-form-rows`). The padding, the icon slot's sides and the column gaps are tracks of their own and each row track is its pitch to the next, so the rows' subgrids share whole-pixel columns. Each row's padding, icon, switch, state word gap and bearing, and a slider's line, gap, insets, lane, track, caps, fill and thumb are written in whole CSS px between their projected edges (`--ui-form-length: 1px`). Text keeps its CSS alignment. With `artPixel`, the whole CSS px of one art pixel, art-locked parts keep their art size. Icons, switches, slider thumbs, track and fill heights, and caps use their size in units multiplied by `artPixel` from their projected corner, never stretched by snapping each edge, while rows, columns, the lane and the track's and fill's widths stay on projected edges. An icon starts at its column's left edge, and an end-placed state word's ink ends on the switch as drawn. A one-action row's face is centred in the whole row and placed by its projected edges, and a press dip is `pressDip` art pixels, or without `artPixel` the projected length from the row's top. The layout needs `value.track`. `value.height` gives a centred switch row's stack height (the switch's by default), and a slider's `layout.line` its first line's height, since a placed list measures nothing. The game puts the list element's corner at the projected `origin`. `place` returns `placed`, the projected layout, and `units`, the same layout in units (`runtime/ui/formRow` `formRowsGeometry`), for the game's own ink. `setLayout` places a placed list again. Place it again after rows show, hide or change their layout, or the projection changes. A placed row is a press context member at its placed box.

```ts
// Archie's Settings on its device art-pixel grid, its ink and art drawn from units: one list of
// 82 and 48 unit rows.
const grid = { x: (edge: number) => gridX(scale, edge), y: (edge: number) => gridY(scale, edge) };
const rows = createFormRows(document, {
  align: "start",
  columnGap: 4,
  // A separator and its clearance between rows.
  gap: 17,
  height: 82,
  icon: { offset: 9, size: 16, slot: 16 },
  padding: { bottom: 0, left: 6, right: 8, top: 0 },
  switch: { height: 16, width: 32 },
  value: { gap: SWITCH_STATE_GAP, offset: 9, state: "center", track: 46 },
});
const music = createSlider(document, {
  ...musicOptions,
  layout: { art: SLIDER_ART, height: 56, inset: { left: 20, right: 0 }, line: 27 },
});
// Switch rows dip their art 1 unit while pressed.
const sound = createFormRow(document, { ...soundOptions, pressDip: 1, switch: true });
// Install's face is centred in its whole row, padding included.
const install = createFormRow(document, {
  ...installOptions,
  action: { role: "secondary", size: { height: 33, width: 145 } },
});
rows.element.append(sound.element, music.element, effects.element, motion.element);
rows.element.append(install.element, fps.element);
const { units } = rows.place(
  { artPixel: artPixel(scale), origin: { x: 8, y: 103 }, project: grid, width: 330 },
  [
    sound,
    music,
    effects,
    motion,
    { element: install.element, height: 48 },
    { element: fps.element, height: 48 },
  ],
);
// Cheats: adjacent switches touch, other rows the list's gap apart.
cheats.place({ artPixel: artPixel(scale), origin, project: grid, width: 344 }, [
  invincible,
  { element: ghost.element, gap: 0 },
  resetSave,
]);
placeBox(scale, ORIGIN, rows.element, units.list);
```

**Pager.** `runtime/ui/pager` `arrangePager(context, sizes)` is the action group arrangement of Previous, the count and Next in one row, `PAGER_GAP` (8, a button and its copy) or another gap token on both sides of the count. The buttons' press areas clamp to half the gap toward the count, which takes no presses. `pagerState(page, pages)` says which steps are available, and `pagerSize(sizes)` sizes the pager as a footer's `middle` slot. `createPager(document, options)` builds it on `createActionGroup` with two standard buttons in the game's `appearance` with the count between them in focus order, announced politely, as `countText(state)` or with `dots: true` as decorative dots (`--ui-pager-dot-size`, `--ui-pager-dot-gap`. Accent for the current page, frame for the others) that take no focus. An unavailable step is disabled, or with `refusal` a pointer refusal that leaves the Tab order and is refused on a press. `pager.refuse(direction)` refuses a step for the game's key in the same way. With `refusal: { cue, reducedMotion }` a refusal plays `refusalCue` `refuse` on the step, leaving a cue already playing there to finish. `stopRefusal()` stops a playing cue, such as when the page or scene changes, and `dispose()` stops it too. With `refusal: { refuse, reducedMotion }` every pointer and key refusal calls the game's `refuse(reducedMotion, control)` with the refused Previous or Next button in place of the kit cue, its arguments in the kit `refuse`'s order, and the game owns its cue's replay and stopping. The pager never calls the kit cue, and `stopRefusal()` and `dispose()` leave the game's cue alone. `active()` is the caller's guard, for presses and `refuse` alike. `arrange({ width })` measures and places the parts. Pass `pager.element` and `pagerSize` as a footer group's `middle`.

```ts
import { createPager } from "@andornaut/game-kit/runtime/web/ui/dom/pager";

const pager = createPager(document, {
  appearance: TEXT_BUTTON,
  countText: ({ page, pages }) => words.page(page + 1, pages),
  labels: { next: words.next, previous: words.previous },
  rule: HOLD_RULE,
  state: () => pagerState(page, pages),
  step: (direction) => showPage(page + direction),
});
card.append(pager.element);
pager.arrange({ width: CARD_CONTENT_WIDTH });
```

A game with its own refusal cue passes it as `refusal.refuse` and refuses its key steps through the pager as follows.

```ts
const pager = createPager(document, {
  // ...
  // playRefusal(reducedMotion, control)
  refusal: { reducedMotion: () => settings.reducedMotion, refuse: playRefusal },
});
onKey("ArrowLeft", () => (page === 0 ? pager.refuse(-1) : showPage(page - 1)));
```

**HUD disc.** `createHudDisc(document, options)` is one round standard button whose box is the face, at the size token `size` names in `sizes` (`{ face, icon }`, such as two sizes per game). Lay it out and give it its press area as an action group's action, alone or with neighbours (`gap: "small"`, and `pressOverlap: "nearest"` where presses must keep the full minimum target). The face takes the theme's button slots and the focus fill, `--ui-hud-disc-edge` for an edge drawn in every state, the game's face `art`, and `--ui-hud-disc-image` with its focus, pressed and disabled variants for art faces. A pressed face takes the game's `--ui-button-press-dip`. The game's own face fill draws over those, inside the edge and under the art and icon with `--ui-hud-disc-fill`, a ring `--ui-hud-disc-ring` base px wide in `--ui-hud-disc-ring-colour`, sitting `--ui-hud-disc-ring-inset` whole base px inside the edge (0 by default) with the state's fill between, an outer rim `--ui-hud-disc-rim` base px wide in `--ui-hud-disc-rim-colour` at the disc's edge, `--ui-hud-disc-rim-inset` whole base px inside the edge (0 by default) with nothing painted beyond it, all the same in every state, and the icon's `--ui-hud-disc-ink`, each colour with `selected`, `focus`, `pressed` and `disabled` variants (such as `--ui-hud-disc-focus-fill` and `--ui-hud-disc-focus-rim-colour`), the last matching state winning in that order. The rim takes the outer part of the band between the disc's edge and the ring, so the ring inset is at least the rim inset plus the rim. A disc drawn 1 unit inside its face with a 1 unit rim and a 2 unit ring sets `--ui-hud-disc-rim-inset: 1`, `--ui-hud-disc-rim: 1`, `--ui-hud-disc-ring-inset: 2` and `--ui-hud-disc-ring: 2`, and needs no ring art. A state's fill or ink left unset shows the theme's for that state, and its ring or rim colour keeps the idle one. In forced colours the game's fill layer (fill, ring and rim) and ink step aside. State changes only the face fill or image and the icon colour, never the disc or press geometry. In forced colours the art steps aside for system fills. The `icon` (the game's SVG in `currentColor`, or art) fills its icon box, and `runtime/ui/hudDisc` `hudDiscIconOffset(size, bearings)` centres its ink, the box less its side `bearings`, on the face with the odd unit right and below. `hudDiscGeometry` projects both for a canvas.

```ts
import { createHudDisc } from "@andornaut/game-kit/runtime/web/ui/dom/hudDisc";

const pause = createHudDisc(document, {
  bearings: PAUSE_ICON_BEARINGS,
  getAction: () => ({ activate: openPause }),
  icon: pauseGlyph,
  name: words.pause,
  rule: HOLD_RULE,
  size: "large",
  sizes: HUD_DISC_SIZES,
});
hud.element.append(pause.element);
const { face } = pause.size();
hud.arrange({ gap: "small", width: face }, [
  { element: pause.element, role: "navigation", size: { height: face, width: face } },
]);
```

## Slider

`runtime/web/ui/dom/slider` `createSlider(document, options)` with `slider.css` (load it after `formRow.css`) makes a slider row for the `createFormRows` list. The first line uses the list's columns and holds the optional state-free `icon`, the `label` and optional `note`, and the value word `getState().value` (player text, such as 50% or Muted) in the value column, placed as the list places a state word (`value.state` and `value.bearing`, so `"end"` puts its ink's right edge on the column's). Under that line the lane spans the row's content, `layout.gap` below it and `layout.inset` in from its sides. The row is `role="slider"` with `aria-valuemin` 0, `aria-valuemax` `steps`, `aria-valuenow` the step and `aria-valuetext` the value word. ArrowLeft and ArrowRight move one step, Home and End to the ends. A mouse or pen press anywhere on the row drags the thumb's centre along the track. A touch drags once it travels `slop` base px sideways, a tap sets the step where it lifts, and a vertical travel is left to the browser's scrolling (`touch-action: pan-y`). `change(step)` sets the value and `commit(step)` follows a key change or an uncancelled drag or tap. With `getState().refused` the row is `aria-disabled`, keeps its focus and value, shows the disabled art and plays `refusal` on a press, a drag or a step key. `refusal` is a `SliderRefusal` (`ButtonRefusal<HTMLElement>`). The form `{ cue, reducedMotion }` plays the `refusalCue` `refuse` on the row, restarting a cue already playing there, and `{ refuse, reducedMotion }` calls the game's `refuse(reducedMotion, control)` in its place on every refusal, with `reducedMotion()` read at that refusal and the slider row, as the pager and standard buttons do. The slider then never calls the kit cue's `refuse`, `refusing` or `stopRefusal`, and the game owns its cue's replay and stopping. `active()` is the caller's guard.

The game's art keeps its locked size. The `layout.art` option gives the thumb's size and the track's height and three-slice caps (one art pixel per unit), and the game sets `--ui-slider-track-image`, `--ui-slider-fill-image` and `--ui-slider-thumb-image`, their `-disabled-image` variants and `--ui-slider-thumb-pressed-image`. The track is the lane's width rounded down to a whole unit and the thumb's offset a whole unit, a half rounding right. The fill runs to the thumb's right edge. `layout.height` sets the row's least height where it differs from the list's. In a placed list (`createFormRows` `place`), `layout.line` is the first line's height, which places the lane. The lane, track, caps, fill and thumb are whole CSS px between projected edges, the thumb and fill again at each refresh, and a press maps to units through the track as drawn, so it holds through a scaled root. Inside a theme root the row has a clear idle face and takes the pressed and disabled slots and the focus fill slots `controls.css` uses, filling the row only, with system fills in forced colours. `runtime/ui/slider` holds the pure steps and geometry in `sliderStepForKey`, `sliderThumbOffset`, `sliderStepAt`, `sliderLane`, `sliderGeometry` (projected through an `ActionProjection` for a canvas) and `sliderPresentation`.

```ts
import { createSlider } from "@andornaut/game-kit/runtime/web/ui/dom/slider";

const music = createSlider(document, {
  change: (step) => setMusicVolume(step / VOLUME_STEPS),
  commit: () => saveSettings(),
  getState: () => ({
    refused: settings.muted,
    step: volumeSteps(settings.musicVolume),
    value: settings.muted ? words.muted : words.volume(volumePercent(settings.musicVolume)),
  }),
  icon: musicIcon,
  label: words.music,
  layout: { art: SLIDER_ART, gap: SLIDER_GAP, height: SLIDER_ROW_HEIGHT, inset: { left: 2 } },
  // playRefusal(reducedMotion, control), the game's cue; or { cue: REFUSAL_CUE, reducedMotion }
  refusal: { reducedMotion: () => settings.reducedMotion, refuse: playRefusal },
  slop: TAP_MAX_DISTANCE,
  steps: VOLUME_STEPS,
});
rows.element.append(music.element);
```

## Caller action order

Layout primitives retain the caller's keyed order and action roles. Callers place the existing primary action last in vertical groups and rightmost in horizontal groups, retaining secondary order and hidden-control identities. The crash screen keeps Reload after its optional developer details and centres the sole Copy action in its own row. Its action callbacks and focus remain unchanged.

## Explicit pointer-release actions

`runtime/web/input/dom/holdActions.bindHoldActions` accepts optional `activation: "pointer-release"` with `resolvePointer(event)`, `pointerTarget` and `onPressChange(actionOrNull)`. This mode owns both short-release activation and hold dispatch. Replace any parallel custom pointerup action listener. The default mode continues to add holds to caller-owned native clicks. Both use the caller's explicit `HoldRule`. There is no numeric duration default.

`allowNonPrimaryTouch: true` additionally admits nonprimary touch contacts with button zero, so a UI action can work while other fingers hold continuous controls. Omission or false retains primary-only eligibility. Nonprimary mouse or pen contacts and nonzero buttons remain excluded. Both modes retain one owned UI gesture, captured/current guards, cancellation and matching release-click suppression. The policy is validated and captured when binding.

`resolvePointer` supplies physical hit acceptance at down, move, release and hold dispatch using the latest pointer event. It must agree with `resolve(originalElement)` on the element and logical identity. `HoldAction.identity` uses `Object.is`. Omission uses the element. Change identity when a retained element represents a different logical control. The control remains inside the owned root, but an explicit document `pointerTarget` can observe coordinate-based regions whose DOM lets presses reach a canvas. Pointer observation does not prevent defaults, stop propagation or change pointer capture. Keep those policies in the caller. When a pointer-release touch tap moves focus and exposes a different target under that contact, the binding protects the restored focus from the matching touch-derived compatibility mousedown default in browsers that expose its provenance. Other inputs keep their normal defaults.

`HoldAction.ownAriaDisabled: "refusal-feedback"` explicitly permits the original callback or hold override through that control's own ARIA refusal state. Use it only when the callback explains refusal without accepting the blocked action. Omission retains own-ARIA blocking. Both the current logical descriptor and, in pointer-release mode, the physical descriptor must permit it at dispatch. Native disabled state, inert, any disabled ancestor and a disabled binding root remain hard blocks. Availability, identity, modal/readiness guards, cancellation and release-click suppression still apply. The attribute is never removed or rewritten.

The returned callable `HoldActionsBinding` disposes listeners. Its `cancel()` instead clears the current logical gesture, timer and pressed visual immediately while retaining only matching release suppression. Wire caller modal and readiness invalidation to `cancel`, rather than disposing and rebinding a persistent root. Captured/current guards and availability remain required. A notification source must actually report each invalidation. An `accepts` callback alone is not a subscription. Disposal ends interception, including suppression of subsequent clicks.

Short releases and holds consume their corresponding native compatibility click inside the owned root. A pointer-specific witness follows that owned gesture across native event tasks and ends on a new pointer down, the matching pointer click, blur or disposal. Pointer-release mode also clears it on page hiding. The pointerless MouseEvent fallback remains confined to the release task. Tie disposal to the owned root lifetime. Disposal ends interception. Detail-zero keyboard/accessibility clicks and unrelated controls or pointers retain their existing handlers. No click is synthesized. Coordinate routing preserves underlying continuous input. It does not claim that the underlying game must accept the action.

`LoadingFailureContext` and `CrashScreenOptions` optionally accept `bindHoldAction(action)`, where `action` supplies the original `element`, `available` and `activate` closure. The caller binds its guard and rule and returns a disposer. Retry retains its busy, state and generation checks and disposes the binding with its view. Crash Reload and developer Copy use their existing semantic callbacks and page lifetime. Native disclosure and text selection remain native. Omission preserves existing factory behaviour.

## High-density game UI

Callers supply font faces, source metrics, image sources, surfaces and lifecycle policy, and keep game-owned input, hierarchy and clocks.

| Module                     | Contract                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `view/phaser/uiProjection` | Maps the canvas CSS size and an explicit device pixel ratio to an integer backing size.                                                                                                                                                                                                                                                                                                  |
| `view/phaser/uiSubmitter`  | `createUiRecorder` atomically registers sibling roots through public Phaser render roles, after the caller's font readiness promise, and rejects unsupported groups without partial routing. Refresh and disposal restore only still-owned roles. Glyph pens and baselines come from public glyph data and submitted quads, keeping signed bearings without measuring or reflowing text. |
| `view/phaser/uiCommands`   | `presentUi` replays ordered text runs, raster quads and uniform triangles with camera viewport clips. Tinted `ImageBitmap` and `HTMLImageElement` quads are cached (256 entries, 4 Mi pixels) and evicted through `releaseSurface`, canvas sources are tinted on every draw. `releaseUiTintCache(ports)` releases the rest at teardown.                                                  |
| `view/phaser/uiComposite`  | Checks same-frame default-framebuffer readback, including GL errors, flips rows and normalizes declared alpha. Excludes requested owners before UI replay and applies the supplied remap once. Masks, effects, gradients and non-normal blends are unsupported.                                                                                                                          |

Parents own the inert sibling canvas, render-event wiring, modal plane placement and combined visual verification.
