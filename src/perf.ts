const _enabled = (() => {
  try {
    if (
      typeof process !== "undefined" &&
      process.env &&
      process.env.PDFDIFF_PROFILE === "1"
    ) {
      return true;
    }
  } catch {
    // process not available (e.g. in some browser worker environments)
  }
  const g = globalThis as { __PDFDIFF_PROFILE__?: boolean };
  return g.__PDFDIFF_PROFILE__ === true;
})();

export type Counters = Readonly<Record<string, number>>;

export type Span = { stop(): void };

type Perf = {
  readonly enabled: boolean;
  span(key: string): Span;
  incr(key: string, delta?: number): void;
  setMax(key: string, value: number): void;
  merge(other: Counters): void;
  dump(): Counters;
  reset(): void;
};

const _counters: Record<string, number> = Object.create(null);

const _NOOP_SPAN: Span = Object.freeze({ stop() {} });
const _noop = () => {};
const _emptyDump = (): Counters => Object.freeze({});

const _realPerf: Perf = {
  enabled: true,
  span(key) {
    const t0 = performance.now();
    return {
      stop() {
        _counters[key] = (_counters[key] ?? 0) + (performance.now() - t0);
      },
    };
  },
  incr(key, delta = 1) {
    _counters[key] = (_counters[key] ?? 0) + delta;
  },
  setMax(key, value) {
    const cur = _counters[key];
    if (cur === undefined || value > cur) _counters[key] = value;
  },
  merge(other) {
    for (const k of Object.keys(other)) {
      _counters[k] = (_counters[k] ?? 0) + other[k]!;
    }
  },
  dump() {
    return { ..._counters };
  },
  reset() {
    for (const k of Object.keys(_counters)) delete _counters[k];
  },
};

const _noopPerf: Perf = {
  enabled: false,
  span: () => _NOOP_SPAN,
  incr: _noop,
  setMax: _noop,
  merge: _noop,
  dump: _emptyDump,
  reset: _noop,
};

export const perf: Perf = _enabled ? _realPerf : _noopPerf;
