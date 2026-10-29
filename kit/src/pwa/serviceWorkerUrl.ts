// The query parameter on the service worker's URL that names the sound format the page loads, so
// the worker precaches that format alone (a worker has no canPlayType to choose with).
export const SOUND_FORMAT_PARAM = "sound";
// serviceWorker.ts imports only this type, so the built worker holds nothing else.
export type SoundFormatParam = typeof SOUND_FORMAT_PARAM;

export function serviceWorkerUrl(scriptUrl: string, soundFormat: string | undefined): string {
  return soundFormat === undefined
    ? scriptUrl
    : `${scriptUrl}?${SOUND_FORMAT_PARAM}=${soundFormat}`;
}
