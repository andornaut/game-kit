// The parts of an AudioContext this uses; Phaser's WebAudioSoundManager.context is one.
export interface ResumableAudioContext {
  resume(): Promise<void>;
  readonly state: string;
}

// Events that count as a user gesture for starting audio. touchend rather than touchstart,
// because iOS Safari only unlocks audio on the end of a touch.
export const AUDIO_UNLOCK_EVENTS = ["keydown", "mousedown", "pointerup", "touchend"] as const;

// Mobile browsers start an AudioContext suspended until a user gesture. This resumes it on each
// gesture until it is running, then stops listening. Returns a function that stops listening.
export function unlockAudioOnFirstGesture(
  gestureTarget: EventTarget,
  audioContext: ResumableAudioContext,
): () => void {
  const stopListening = () => {
    for (const type of AUDIO_UNLOCK_EVENTS) {
      gestureTarget.removeEventListener(type, onGesture);
    }
  };
  function onGesture(): void {
    if (audioContext.state === "running") {
      stopListening();
      return;
    }
    audioContext
      .resume()
      .then(() => {
        if (audioContext.state === "running") {
          stopListening();
        }
      })
      .catch(() => {});
  }
  if (audioContext.state === "running") {
    return stopListening;
  }
  for (const type of AUDIO_UNLOCK_EVENTS) {
    gestureTarget.addEventListener(type, onGesture);
  }
  return stopListening;
}
