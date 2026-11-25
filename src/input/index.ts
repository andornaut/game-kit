// What other areas import from input/; consumers import the package exports.
export { type HoldPress, type HoldRule, moveHold, startHold, tickHold } from "./hold.ts";
export { type ModalInputGate, type ModalInputScope } from "./modalInput.ts";
export { followOnePress } from "./onePress.ts";
export {
  type OutsideArea,
  type OutsidePress,
  outsidePressDown,
  outsidePressMove,
  outsideTapped,
} from "./outsideTap.ts";
export { guardPassed } from "./tapGuard.ts";
