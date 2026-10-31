export interface ModalInputScope {
  // Only the top open modal accepts input.
  accepts(): boolean;
  // Capture on press/key down and check before completing that same gesture.
  capture(): () => boolean;
  close(): void;
}

export interface ModalInputGate {
  // Input with no modal owner is accepted only when no modal is open.
  accepts(): boolean;
  capture(): () => boolean;
  open(): ModalInputScope;
  // Called immediately and after every stack change, so adapters can clear held controls.
  subscribe(listener: () => void): () => void;
}

// Games apply these guards to scene, page, window and keyboard routes. The gate owns no
// dismissal rules, event listeners or rendering. A gesture never crosses a modal-stack change,
// even if the modal that interrupted it has already closed before its release arrives.
export function createModalInputGate(): ModalInputGate {
  const stack: object[] = [];
  const listeners = new Set<() => void>();
  let revision = 0;
  const notify = () => {
    revision += 1;
    for (const listener of [...listeners]) {
      listener();
    }
  };
  const capture = (accepts: () => boolean) => {
    const started = revision;
    const accepted = accepts();
    return () => accepted && started === revision && accepts();
  };
  const accepts = () => stack.length === 0;
  return {
    accepts,
    capture: () => capture(accepts),
    open() {
      const token = {};
      stack.push(token);
      notify();
      const accepts = () => stack.at(-1) === token;
      return {
        accepts,
        capture: () => capture(accepts),
        close() {
          const index = stack.indexOf(token);
          if (index >= 0) {
            stack.splice(index, 1);
            notify();
          }
        },
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      listener();
      return () => listeners.delete(listener);
    },
  };
}
