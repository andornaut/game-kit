import { clamp01 } from "../numbers.ts";

// A load run's measured share of settled files (loaded or failed) out of the run's total, which
// never moves backward. While the total stays put the share is done / total. When the total grows
// it keeps the share shown so far as a base and fills the rest by the files settled since:
// base + (1 - base) * (done - doneAtGrowth) / (total - doneAtGrowth), so it neither drops nor
// parks, and it reaches exactly 1 once every file has settled. Each call takes the run's counts
// so far and returns the share, in [0, 1]. A zero total, or a negative or nonfinite count, keeps
// the share shown so far, starting from 0; the first nonzero total sets no base. Create one per
// run.
export function createFileShare(): (done: number, total: number) => number {
  let base = 0;
  let doneAtGrowth = 0;
  let lastTotal = 0;
  let shown = 0;
  return (done, total) => {
    if (!(Number.isFinite(done) && Number.isFinite(total) && done >= 0 && total >= 0)) {
      return shown;
    }
    if (lastTotal > 0 && total > lastTotal) {
      base = shown;
      doneAtGrowth = done;
    }
    lastTotal = total;
    const remaining = total - doneAtGrowth;
    if (remaining > 0) {
      shown = Math.max(shown, base + (1 - base) * clamp01((done - doneAtGrowth) / remaining));
    }
    return shown;
  };
}
