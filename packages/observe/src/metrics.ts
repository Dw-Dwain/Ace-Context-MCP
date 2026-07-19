/** Minimal Prometheus-style counter registry. ponytail: swap for prom-client
 *  if histograms/summaries or a richer exposition format are needed. */
export class Metrics {
  private counters = new Map<string, number>();

  inc(name: string, by = 1, labels?: Record<string, string>): void {
    const key = seriesKey(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + by);
  }

  get(name: string, labels?: Record<string, string>): number {
    return this.counters.get(seriesKey(name, labels)) ?? 0;
  }

  /** Prometheus text exposition. One `# TYPE` per metric family. */
  render(): string {
    const families = new Map<string, string[]>();
    for (const [key, value] of this.counters) {
      const name = key.split('{')[0]!;
      if (!families.has(name)) families.set(name, []);
      families.get(name)!.push(`${key} ${value}`);
    }
    const out: string[] = [];
    for (const [name, lines] of families) {
      out.push(`# TYPE ${name} counter`);
      out.push(...lines);
    }
    return out.join('\n') + '\n';
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.counters);
  }
}

function seriesKey(name: string, labels?: Record<string, string>): string {
  if (!labels || Object.keys(labels).length === 0) return name;
  const inner = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(',');
  return `${name}{${inner}}`;
}
