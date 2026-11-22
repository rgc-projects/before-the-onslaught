export function isForeground(): boolean {
  return !document.hidden && document.hasFocus();
}

export function watchForeground(onChange: () => void): () => void {
  let active = isForeground();
  const update = () => {
    const next = isForeground();
    if (next === active) return;
    active = next;
    onChange();
  };

  document.addEventListener('visibilitychange', update);
  window.addEventListener('blur', update);
  window.addEventListener('focus', update);
  return () => {
    document.removeEventListener('visibilitychange', update);
    window.removeEventListener('blur', update);
    window.removeEventListener('focus', update);
  };
}
