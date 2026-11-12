// HTML UI art decoded before it shows. A browser requests a CSS url() or background-image only
// when it first paints the rule, so art in a layer shown at once arrives after the layer. The
// image cache requests and decodes the art ahead, during boot, and keeps each image referenced so
// the decoded image stays in memory for that paint. revealWhenDecoded holds a layer hidden until
// its art has decoded, so what lies beneath keeps showing. Both set attributes only; ui.css hides
// a layer that carries data-ui-pending.

export const PENDING_ATTRIBUTE = "data-ui-pending";

export interface ImageCache {
  // Settles once every url has decoded or failed, retaining each one not yet retained. It never
  // rejects.
  decoded(urls: readonly string[]): Promise<void>;
  // Requests and decodes each url not yet retained, and keeps its image for the cache's life.
  retain(urls: readonly string[]): void;
}

export interface Reveal {
  // Shows the layer at once by removing data-ui-pending and settles revealed false. It does
  // nothing once revealed has settled.
  cancel(): void;
  // True once the layer is shown after its images settle; false when cancelled first, or
  // superseded by a later reveal on the same layer.
  readonly revealed: Promise<boolean>;
}

interface Retained {
  // Referenced for the cache's life, so the decoded image stays in memory.
  readonly image: HTMLImageElement;
  readonly settled: Promise<void>;
}

const ignore = () => undefined;

// The image cache for document's art. URLs are deduplicated as given, so each must be the one the
// CSS resolves to.
export function createImageCache(document: Document): ImageCache {
  const retained = new Map<string, Retained>();
  const settle = (url: string): Promise<void> => {
    let entry = retained.get(url);
    if (entry === undefined) {
      const image = document.createElement("img");
      image.src = url;
      entry = { image, settled: image.decode().then(ignore, ignore) };
      retained.set(url, entry);
    }
    return entry.settled;
  };
  return {
    decoded: (urls) => Promise.all(urls.map(settle)).then(ignore),
    retain(urls) {
      urls.forEach(settle);
    },
  };
}

const pending = new WeakMap<Element, () => void>();

// Sets data-ui-pending on layer at once, until urls (or the list a promise of them resolves to)
// have all settled in cache, then removes it. A rejected promise counts as settled, so the layer
// shows. A reveal already pending on layer is cancelled first. There is no timeout: a promise or
// request that never settles keeps layer hidden, so the caller keeps a fallback view drawing until
// the reveal.
export function revealWhenDecoded(
  cache: ImageCache,
  urls: readonly string[] | Promise<readonly string[]>,
  layer: Element,
): Reveal {
  pending.get(layer)?.();
  let resolve: (shown: boolean) => void = ignore;
  const revealed = new Promise<boolean>((settle) => {
    resolve = settle;
  });
  let open = true;
  const finish = (shown: boolean) => {
    if (!open) {
      return;
    }
    open = false;
    if (pending.get(layer) === cancel) {
      pending.delete(layer);
    }
    layer.removeAttribute(PENDING_ATTRIBUTE);
    resolve(shown);
  };
  const cancel = () => finish(false);
  pending.set(layer, cancel);
  layer.setAttribute(PENDING_ATTRIBUTE, "");
  // A list starts its requests at once; a promised list starts them when it resolves.
  const decoded =
    urls instanceof Promise
      ? urls.then((list) => cache.decoded(list), ignore)
      : cache.decoded(urls);
  void decoded.then(() => finish(true));
  return { cancel, revealed };
}
