const closeWatcherStack: CloseWatcher[] = [];
class CloseWatcher extends EventTarget {
  #isActive = true;
  #firingCancelEvent = false;
  #oncancelHandler = null;
  #oncloseHandler = null;

  constructor({ signal }: { signal?: AbortSignal } = {}) {
    super();
    // No user-activation check. Real CloseWatcher would sometimes group
    // with previous watchers; this polyfill never does.

    if (signal) {
      if (signal.aborted) {
        this.#isActive = false;
        return;
      }
      signal.addEventListener("abort", () => this.#deactivate());
    }

    closeWatcherStack.push(this);
  }

  destroy() {
    this.#deactivate();
  }

  close() {
    if (!this.#isActive || !document.defaultView) {
      return;
    }

    this.dispatchEvent(new Event("close"));

    this.#deactivate();
  }

  requestClose() {
    if (!this.#isActive) {
      return;
    }
    if (this.#firingCancelEvent) {
      return;
    }

    // No user-activation check. Real CloseWatcher would sometimes skip
    // `cancel`; this polyfill always fires it.

    this.#firingCancelEvent = true;
    const shouldContinue = this.dispatchEvent(
      new Event("cancel", { cancelable: true })
    );
    this.#firingCancelEvent = false;
    if (!shouldContinue) {
      return;
    }

    if (this.#isActive && document.defaultView) {
      this.dispatchEvent(new Event("close"));
    }
    this.#deactivate();
  }

  #deactivate() {
    this.#isActive = false;

    // May not be top of stack if `destroy()` ran.
    const index = closeWatcherStack.indexOf(this);
    if (index !== -1) {
      closeWatcherStack.splice(index, 1);
    }
  }

  get oncancel() {
    return this.#oncancelHandler;
  }
  set oncancel(handler) {
    if (handler !== this.#oncancelHandler || handler === null) {
      this.removeEventListener("cancel", this.#oncancelHandler);
      this.#oncancelHandler = null;
      return;
    }

    this.#oncancelHandler = handler;
    this.addEventListener("cancel", this.#oncancelHandler);
  }

  get onclose() {
    return this.#oncancelHandler;
  }
  set onclose(handler) {
    if (handler !== this.#oncloseHandler || handler === null) {
      this.removeEventListener("close", this.#oncloseHandler);
      this.#oncloseHandler = null;
      return;
    }

    this.#oncloseHandler = handler;
    this.addEventListener("close", this.#oncloseHandler);
  }
}

// Escape keydowns only. No Android back button (or other close signals).
document.addEventListener("keydown", (e) => {
  if (!e.isTrusted) {
    // Not a user-triggered keydown.
    return;
  }

  if (e.key !== "Escape") {
    return;
  }

  const closeWatcher = closeWatcherStack.at(-1);
  if (!closeWatcher) {
    return;
  }

  /* Let other listeners run first. Queue a task; `queueMicrotask()`
     empties between each listener for browser-triggered events. */
  setTimeout(() => {
    if (e.defaultPrevented) {
      // Another listener canceled; don't deliver to CloseWatcher.
      return;
    }

    closeWatcher.requestClose();
  }, 0);
});

export { CloseWatcher };
