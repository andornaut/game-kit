import type { InstallFlow } from "./installFlow";
import { type MenuInstallBrowser, offersInstall } from "./installState";

// Shows only the browser's section of the steps and names the dialog by its title.
function showSteps(browser: MenuInstallBrowser, dialog: HTMLDialogElement): void {
  dialog.querySelectorAll<HTMLElement>("[data-browser]").forEach((section) => {
    section.hidden = section.dataset.browser !== browser;
  });
  const title = dialog.querySelector(`[data-browser="${browser}"] h2`);
  if (title !== null) {
    dialog.setAttribute("aria-labelledby", title.id);
  }
  dialog.showModal();
}

// A page's Install button on the install flow: the browser's install prompt where it gives one,
// the steps dialog for the browser's own menu where it installs only from there (iOS, Firefox for
// Android), and hidden once installed or where neither works. The steps dialog holds one section
// per browser, each marked data-browser with its MenuInstallBrowser and titled by its h2, and a
// button that closes it; it also closes on Escape (the dialog's own) or a tap on the dimmed page
// around it.
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
      if (outcome === "menuSteps" && flow.menuBrowser !== undefined) {
        showSteps(flow.menuBrowser, steps);
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
