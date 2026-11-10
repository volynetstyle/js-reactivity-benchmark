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
  // Partial rows retain their real machine IDs. Never pair compacted arrays
  // by position: [machine 1, machine 3] is not [machine 1, machine 2].
  if (
    (left.partial && !left.machineIds) ||
    (right.partial && !right.machineIds)
  )
    return undefined;
  const leftIds = left.machineIds ?? a?.map((_, i) => i + 1);
  const rightIds = right.machineIds ?? b?.map((_, i) => i + 1);
  const matches =
    leftIds?.flatMap((id, i) => {
      const j = rightIds?.indexOf(id) ?? -1;
      return j >= 0 ? [[i, j]] : [];
    }) ?? [];
  if (a?.length && b?.length && !matches.length) return undefined;
  const machineRatios =
    a?.length && b?.length ? matches.map(([i, j]) => a[i] / b[j]) : [];
  const processRatios = [];
  let squares = 0;
  let df = 0;
  const ap = left.processEstimates ?? [];
  const bp = right.processEstimates ?? [];
  const processMatches = matches.length
    ? matches
    : ap.length === 1 && bp.length === 1
      ? [[0, 0]]
      : [];
  for (const [i, j] of processMatches) {
    if (!ap[i] || !bp[j] || ap[i].length !== bp[j].length) continue;
    const ratios = ap[i].map((value, k) => value / bp[j][k]);
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
      : processMatches.length === 1 &&
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
