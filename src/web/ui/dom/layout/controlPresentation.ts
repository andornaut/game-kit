import {
  type ControlAvailability,
  controlPresentation,
  disclosurePath,
  type DisclosureStyle,
  type PageDividerStyle,
  validatePageDivider,
} from "../../../../ui/controlPresentation.ts";
import { writeLayoutProperties } from "../layoutProperties.ts";
import { createChromeSvg } from "./vectorChrome.ts";

// Keep relevant unmet controls focusable and render their visible explanation. The capture guard
// blocks unavailable clicks before normal action listeners. Custom action paths use invokeControl.
export function bindButtonAvailability(
  context: {
    readonly getAvailability: () => ControlAvailability;
    readonly onUnavailable?: (reason: string) => void;
    readonly reason: HTMLElement;
  },
  button: HTMLButtonElement,
): { dispose(): void; refresh(): ReturnType<typeof controlPresentation> } {
  function refresh(): ReturnType<typeof controlPresentation> {
    const presentation = controlPresentation(context.getAvailability());
    button.hidden = !presentation.visible;
    button.disabled = false;
    button.setAttribute("aria-disabled", String(!presentation.executable));
    context.reason.textContent = presentation.reason ?? "";
    context.reason.hidden = presentation.reason === undefined;
    if (presentation.reason === undefined) {
      button.removeAttribute("aria-description");
    } else {
      button.setAttribute("aria-description", presentation.reason);
    }
    return presentation;
  }

  function prevent(event: Event): void {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function guard(event: Event): void {
    let presentation: ReturnType<typeof controlPresentation>;
    try {
      presentation = refresh();
    } catch (error) {
      prevent(event);
      throw error;
    }
    if (!presentation.executable) {
      prevent(event);
      if (presentation.reason !== undefined) {
        context.onUnavailable?.(presentation.reason);
      }
    }
  }

  refresh();
  button.addEventListener("click", guard, true);
  return {
    dispose: () => button.removeEventListener("click", guard, true),
    refresh,
  };
}

// Set once on the page/modal theme root. Every page divider inherits this same token pair.
export function setPageDivider(style: PageDividerStyle, root: HTMLElement): void {
  validatePageDivider(style);
  writeLayoutProperties({ "--ui-page-divider-thickness": style.thickness }, root);
  root.style.setProperty(
    "--ui-page-divider-colour",
    `#${style.colour.toString(16).padStart(6, "0")}`,
  );
}

export function createPageDivider(document: Document): HTMLHRElement {
  const divider = document.createElement("hr");
  divider.classList.add("ui-page-divider");
  return divider;
}

// Decorative only. Its containing native button or link supplies the accessible name and
// navigation behaviour; action buttons do not receive a disclosure mark automatically.
export function createDisclosure(document: Document, style: DisclosureStyle): SVGSVGElement {
  const path = disclosurePath(style);
  const icon = createChromeSvg(document, style, [
    { colour: style.colour, kind: "stroke", path, width: style.strokeWidth },
  ]);
  icon.classList.add("ui-disclosure-icon");
  writeLayoutProperties(
    { "--ui-disclosure-height": style.height, "--ui-disclosure-width": style.width },
    icon,
  );
  return icon;
}
