export function createNativeButton(document: Document, text = ""): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  return button;
}
