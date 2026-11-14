import 'fake-indexeddb/auto';

if (typeof window !== 'undefined') {
  // jsdom has no ResizeObserver and no canvas. The components must still mount.
  class FakeResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= FakeResizeObserver;
  HTMLCanvasElement.prototype.getContext = (() =>
    null) as typeof HTMLCanvasElement.prototype.getContext;
}
