export interface DeliveryPlan {
  width: number;
  stride: number;
  columns?: readonly number[];
  steps: number;
  values: Float64Array;
  required: number;
}

export interface DeliveryResult {
  deliveries: number;
  coverage: number;
  mismatches: number;
  latest: Float64Array;
}

/** A numerical schedule, prepared without invoking a reactive library. */
export function deliveryPlan(
  rows: readonly (readonly number[])[],
  columns?: readonly number[]
): DeliveryPlan {
  const stride = rows[0].length;
  const width = columns?.length ?? stride;
  const values = new Float64Array(rows.length * stride);
  const counts = new Array<number>(stride).fill(0);
  for (let i = 0; i < width; i++) counts[columns?.[i] ?? i]++;
  let required = 0;
  for (let step = 0; step < rows.length; step++) {
    if (rows[step].length !== stride)
      throw new Error("Inconsistent observer width");
    for (let i = 0; i < stride; i++) {
      values[step * stride + i] = rows[step][i];
      if (step > 0 && rows[step][i] !== rows[step - 1][i])
        required += counts[i];
    }
  }
  return { width, stride, columns, steps: rows.length - 1, values, required };
}

/**
 * The same consumer accounting runs for every engine. It records wrong or
 * intermediate values and unique deliveries of changed outputs. Engines may
 * additionally deliver unchanged values; that is visible work, not an error.
 * Assertions and reference simulation are outside measurement.
 */
export class DeliveryProbe {
  step = 0;
  private deliveries = 0;
  private coverage = 0;
  private mismatches = 0;
  private seen: Int32Array;
  private latest: Float64Array;

  constructor(public plan: DeliveryPlan) {
    this.seen = new Int32Array(plan.width).fill(-1);
    this.latest = new Float64Array(plan.width).fill(NaN);
  }

  record(index: number, value: number): void {
    const { stride, values, columns } = this.plan;
    const offset = this.step * stride + (columns?.[index] ?? index);
    const expected = values[offset];
    this.deliveries++;
    if (value !== expected) this.mismatches++;
    if (this.seen[index] !== this.step && value === expected) {
      if (this.step === 0 || expected !== values[offset - stride])
        this.coverage++;
      this.seen[index] = this.step;
    }
    this.latest[index] = value;
  }

  reset(plan = this.plan): void {
    this.plan = plan;
    this.step = 0;
    this.deliveries = this.coverage = this.mismatches = 0;
    this.seen.fill(-1);
  }

  snapshot(): DeliveryResult {
    return {
      deliveries: this.deliveries,
      coverage: this.coverage,
      mismatches: this.mismatches,
      latest: this.latest,
    };
  }

  verifyInitial(name: string): void {
    if (this.mismatches || this.coverage !== this.plan.width) {
      throw new Error(
        `${name}: initial effects did not deliver correct values`
      );
    }
  }
}

export function verifyDelivery(
  name: string,
  plan: DeliveryPlan,
  result: DeliveryResult
): void {
  if (result.mismatches || result.coverage !== plan.required) {
    throw new Error(
      `${name}: delivery mismatches=${result.mismatches}, changed outputs delivered=${result.coverage}, expected=${plan.required}`
    );
  }
  const offset = plan.steps * plan.stride;
  for (let i = 0; i < plan.width; i++) {
    if (result.latest[i] !== plan.values[offset + (plan.columns?.[i] ?? i)]) {
      throw new Error(`${name}: observer ${i} has a stale final value`);
    }
  }
}
