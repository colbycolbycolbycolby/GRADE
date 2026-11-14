/** Re-syncs the runner when the page comes back to the foreground. Returns a cleanup function. */
export function attachLifecycle(
  runner: { resync(): Promise<void> },
  doc: Document = document,
): () => void {
  const onVisible = () => {
    if (doc.visibilityState === 'visible') void runner.resync();
  };
  doc.addEventListener('visibilitychange', onVisible);
  return () => doc.removeEventListener('visibilitychange', onVisible);
}
