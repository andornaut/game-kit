// What other areas import from ui/; consumers import the package exports.
export {
  type ActionArrangement,
  type ActionGapSelection,
  type ActionGroupContext,
  type ActionPress,
  arrangeActions,
} from "./actionGroup.ts";
export {
  type ButtonFaceInsets,
  buttonGroupSize,
  type ButtonMetrics,
  type ButtonPlacement,
  type ButtonRole,
  type ButtonSize,
} from "./buttonLayout.ts";
export {
  type ControlAvailability,
  type ControlPresentation,
  controlPresentation,
  disclosurePath,
  type DisclosureStyle,
  type PageDividerStyle,
  validatePageDivider,
} from "./controlPresentation.ts";
export { type FocusKeyAction, focusKeyAction, stepFocus } from "./focusKeys.ts";
export { type FormRowLayout, formRowPresentation } from "./formRow.ts";
export {
  checkHudDiscSize,
  hudDiscIconOffset,
  type HudDiscSize,
  type IconBearings,
  NO_BEARINGS,
} from "./hudDisc.ts";
export {
  type LayoutColumnSizing,
  type LayoutMeasurement,
  type LayoutNode,
  type LayoutPath,
  type LayoutReport,
  layoutReport,
  type LayoutSchema,
  type LayoutSlots,
  validateLayoutTree,
} from "./layoutTree.ts";
export {
  MODAL_FRAME,
  type ModalFrameContext,
  type ModalFrameLayout,
  modalFrameRooms,
  type ModalTitleSize,
  placeModalFrame,
} from "./modalFrame.ts";
export { PAGER_GAP, type PagerPart, type PagerSizes, type PagerState } from "./pager.ts";
export {
  checkSliderStep,
  checkSliderSteps,
  type SliderLayout,
  sliderPresentation,
  sliderStepAt,
  sliderStepForKey,
} from "./slider.ts";
export {
  colourProperties,
  colourProperty,
  type TextRole,
  textRoleClass,
  textRoleProperties,
  type TextRoles,
  type UiColourRole,
  type UiColours,
} from "./uiTheme.ts";
