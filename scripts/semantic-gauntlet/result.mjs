/** Turn any library outcome into data; only the diagnostic harness itself is tested. */
export function classifyCell(name, workload, version, child) {
  const stderr = child.stderr?.trim() ?? "";
  let cell;
  try {
    cell = JSON.parse(child.stdout);
    if (!Array.isArray(cell.checks)) throw new Error("invalid checks");
  } catch {
    cell = {
      checks: [],
      error:
        child.error?.message ||
        stderr ||
        `exit ${child.status}: invalid output`,
    };
  }
  const timedOut = child.error?.code === "ETIMEDOUT";
  const error =
    cell.error ||
    (child.status !== 0
      ? child.error?.message || stderr || `exit ${child.status}`
      : null);
  const outcome = timedOut
    ? "timeout"
    : error
      ? "error"
      : cell.checks.some((check) => !check.matches)
        ? "difference"
        : "match";
  return {
    ...cell,
    name,
    workload,
    version,
    error,
    outcome,
    exitCode: child.status,
    stderr,
  };
}
