import { type InstallStepsKind, offersInstall } from "../installState.ts";
import type { InstallFlow } from "./installFlow.ts";

// Shows only the kind's section of the steps, or the other section where the dialog has none for
// the kind, and names the dialog by its title.
function showSteps(kind: InstallStepsKind, dialog: HTMLDialogElement): void {
  const shown = dialog.querySelector(`[data-steps="${kind}"]`) === null ? "other" : kind;
  dialog.querySelectorAll<HTMLElement>("[data-steps]").forEach((section) => {
    section.hidden = section.dataset.steps !== shown;
  });
  const title = dialog.querySelector(`[data-steps="${shown}"] h2`);
  if (title !== null) {
    dialog.setAttribute("aria-labelledby", title.id);
  }
  dialog.showModal();
}

// A page's Install button on the install flow: the browser's install prompt where it gives one,
// otherwise the steps dialog for the browser's own install steps, and hidden once installed. The
// steps dialog holds one section per InstallStepsKind, each marked data-steps with its kind and
// titled by its h2, and a button that closes it; a kind with no section shows the other section.
// The dialog also closes on Escape (the dialog's own) or a tap on the dimmed page around it.
export function wireInstallButton(
  flow: InstallFlow,
  button: HTMLElement,
  steps: HTMLDialogElement,
): void {
  const show = () => {
    button.hidden = !offersInstall(flow.state());
  };
  show();
  flow.onChange(show);
  button.addEventListener("click", () => {
    void flow.install().then((outcome) => {
      if (outcome === "steps") {
        showSteps(flow.stepsKind, steps);
      }
    });
  });
  steps.querySelector("button")?.addEventListener("click", () => steps.close());
  steps.addEventListener("click", (event) => {
    if (event.target === steps) {
      steps.close();
    }
  });
}
