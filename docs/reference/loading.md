# Required loading

Keep required-file recovery and progress in the caller’s existing launch and loading flow.

[Reference](README.md)

See the [progress and loader contracts](integration-contracts.md#loading-and-progress) for renderer and Phaser loader configuration.

## Required loading failures

`load/loadingAttempts` exports `createLoadingAttempts({ load, onState, onReady? })`. It starts one required-file attempt, coalesces concurrent calls, and retries only after an explicit `retry()` from failed state. `load(attempt)` owns required-file classification and the existing single foreground progress handle. `attempt.isCurrent()` guards stale asynchronous bar updates. Optional placeholders remain caller-owned. Dispose the controller with its loading flow. Register caller-owned abort/partial-instance/listener cleanup with `attempt.onCancel(cleanup)`. Failed or disposed attempts cancel before another retry. Success commits ownership to the caller rather than destroying the live game. The pure controller owns no browser AbortController.

For page-lifetime required sets, `createRequiredLoading(initialResources)` observes structural providers with `status()` and failed-only `retry()`. Register a late provider with `observe(resource)` and call `invalidate()` after provider status changes. `subscribe(listener)` reports immediately and returns an unsubscribe function. `wait(ready)` registers a one-shot continuation and returns its unregister function. Readiness is rechecked between callbacks, so one callback can add another required set before the next continuation. Ready state is not terminal for this page-lifetime registry. Explicit retry is singleflight, preserves successful providers and waits for the active attempt to settle. A throwing `status()` counts as failed. One that throws while `retry()` starts rejects that retry with its error and ends the attempt. Dispose subscriptions, registry and view with the page lifecycle. Provider I/O and successful resources remain caller-owned.

Continue entry through `onReady`, or check `state.kind === "ready"` only after the attempt promise settles. Failed attempt promises also settle normally. Keep the existing launch/activation/newer-save guards around the caller's entry path. The mechanism never reads/writes saves, activates workers, reloads or creates a progress bar.

`web/progress/dom/loadingFailure.mountLoadingFailure({ onRetry }, parent)` returns `{ element, update, dispose }`. Wire `update` to the controller's `onState` and `onRetry` to its `retry`. Mount in a visible, non-inert parent outside font/art reveal gates. Native sans-serif and CSS system colours keep the shared alert readable if the game font or UI art fails. The same `LOADING_FAILURE_TEXT` gives every consumer the title `Loading failed`, the body `Some game files could not load. Try again.`, and the button `Retry`. Raw errors are not rendered. Success continues once. Another required failure returns the same alert. Dispose the view and controller together. Caller I/O already in flight is not cancelled by disposal.
