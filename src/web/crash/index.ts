// What other areas import from web/crash/; consumers import the package exports.
export {
  crashGate,
  type CrashReport,
  crashView,
  type CrashWords,
  reportFromErrorEvent,
  reportFromRejection,
} from "./crashModel.ts";
