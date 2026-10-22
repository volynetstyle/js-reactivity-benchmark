/** Adapt an explicit scheduler flush to an outermost, exception-safe commit. */
export function commitBatch(flush: () => void) {
  let depth = 0;
  return (fn: () => unknown): void => {
    depth++;
    try {
      fn();
    } finally {
      if (--depth === 0) flush();
    }
  };
}
