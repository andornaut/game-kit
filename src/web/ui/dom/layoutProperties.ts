// Layout constants reach the UI's static CSS as custom properties: script writes them through
// CSSOM (style.setProperty), which a CSP without 'unsafe-inline' allows, and the stylesheet reads
// them, for example calc(var(--ui-unit) * var(--hud-edge) * 1px). Numbers are written unitless.

// Values by custom property name, each starting with --.
export type LayoutValues = Readonly<Record<string, number | string>>;

const CUSTOM_PROPERTY = /^--[A-Za-z0-9_-]+$/;

// Writes each value on element as its custom property, only where it differs from the value
// already there, and returns whether any changed. Throws, before writing any, on a name that is
// not a custom property or a number that is not finite.
export function writeLayoutProperties(
  values: LayoutValues,
  element: ElementCSSInlineStyle,
): boolean {
  const entries = Object.entries(values).map(([name, value]) => {
    if (!CUSTOM_PROPERTY.test(name)) {
      throw new Error(`Not a custom property name: ${name}`);
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new RangeError(`${name} must be finite, not ${value}`);
    }
    return [name, String(value)] as const;
  });
  let changed = false;
  for (const [name, value] of entries) {
    if (element.style.getPropertyValue(name) !== value) {
      element.style.setProperty(name, value);
      changed = true;
    }
  }
  return changed;
}
