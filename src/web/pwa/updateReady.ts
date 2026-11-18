// The message a page posts to a waiting service worker to make it take over now.
// dom/serviceWorker imports only its type, so the built worker holds nothing else.
export const SKIP_WAITING_MESSAGE = "skip-waiting";
export type SkipWaitingMessage = typeof SKIP_WAITING_MESSAGE;
