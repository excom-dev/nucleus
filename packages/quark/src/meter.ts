/**
 * Engine work counters behind `Quark.meter` (complexity snapshots, see
 * `@excom/nucleus-test`). Always on and engine-wide: hot paths do
 * `counts.<metric>++`, nothing else.
 */
export const counts = {
  /** `Quark.run` calls (sheet passes). */
  quarkRuns: 0,
  /** Rule applications in sheet passes (`@on` / `@delay` blocks excluded). */
  ruleRuns: 0,
  variableRuns: 0,
  attributeRuns: 0,
  listenerRuns: 0,
  /** Binding writes / reads on element state. */
  setVar: 0,
  getVar: 0,
  schedulePaint: 0,
};

/** A kind of engine work `Quark.meter` counts. */
export type QuarkMetric = keyof typeof counts;

export interface QuarkMeter {
  /** Work since the last `reset()`, across every sheet. */
  readonly counts: Readonly<Record<QuarkMetric, number>>;
  /** Zero every count. */
  reset(): void;
  /**
   * Selectors of registered sheets' per-rule subtree queries
   * (`queryScopeCost`).
   */
  scopeSelectors(): Iterable<string>;
}

export const resetCounts = () => {
  (Object.keys(counts) as QuarkMetric[]).forEach((metric) => {
    counts[metric] = 0;
  });
};
