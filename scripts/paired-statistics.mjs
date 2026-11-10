/** Descriptive paired ratios; a three-observation range is not a 95% CI. */
export function logSd(values) {
  if (values.length < 2) return undefined;
  const logs = values.map(Math.log);
  const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
  return Math.sqrt(
    logs.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (logs.length - 1)
  );
}

export function pairedComparison(left, right) {
  if (
    !left ||
    !right ||
    left.failed ||
    right.failed ||
    left.capped ||
    right.capped
  )
    return undefined;
  const a = left.machineEstimates;
  const b = right.machineEstimates;
  const machineRatios =
    a?.length && a.length === b?.length
      ? a.map((value, i) => value / b[i])
      : [];
  const processRatios = [];
  let squares = 0;
  let df = 0;
  const ap = left.processEstimates ?? [];
  const bp = right.processEstimates ?? [];
  for (let i = 0; i < ap.length; i++) {
    if (!bp[i] || ap[i].length !== bp[i].length) continue;
    const ratios = ap[i].map((value, j) => value / bp[i][j]);
    processRatios.push(ratios);
    const sd = logSd(ratios);
    if (sd !== undefined) {
      squares += sd ** 2 * (ratios.length - 1);
      df += ratios.length - 1;
    }
  }
  const observations =
    machineRatios.length > 1
      ? machineRatios
      : ap.length === 1 &&
          bp.length === 1 &&
          processRatios.length === 1 &&
          processRatios[0].length > 1
        ? processRatios[0]
        : [];
  return {
    machineRatios,
    processRatios,
    sdRatioMachine: logSd(machineRatios),
    sdRatioProcess: df ? Math.sqrt(squares / df) : undefined,
    range: observations.length
      ? [Math.min(...observations), Math.max(...observations)]
      : undefined,
    level: machineRatios.length > 1 ? "machine" : "process",
  };
}
