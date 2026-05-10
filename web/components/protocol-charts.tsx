'use client';

import { useMemo, useState } from 'react';

interface DailyPoint {
  day: string;
  volume_usd: number;
  n_trades: number;
  liquidity_available_usd?: number;
}

const PALETTE = {
  liquidity: '#6ee7b7',
  volume: '#60a5fa',
  trades: '#c084fc',
};

function fmtUsdShort(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
}

function fmtDayShort(iso: string): string {
  // YYYY-MM-DD → MMM D
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function aggregateWeekly(points: DailyPoint[]): Array<{ week_start: string; volume_usd: number }> {
  const buckets = new Map<string, number>();
  for (const p of points) {
    const d = new Date(`${p.day}T00:00:00Z`);
    const dow = d.getUTCDay(); // 0=Sun..6=Sat
    const offset = (dow + 6) % 7; // days since Monday
    d.setUTCDate(d.getUTCDate() - offset);
    const weekStart = d.toISOString().slice(0, 10);
    buckets.set(weekStart, (buckets.get(weekStart) ?? 0) + p.volume_usd);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week_start, volume_usd]) => ({ week_start, volume_usd }));
}

const RANGES = [
  { key: '30d', label: '30d', days: 30 },
  { key: '90d', label: '90d', days: 90 },
  { key: '365d', label: '1Y', days: 365 },
  { key: 'all', label: 'All', days: 99999 },
] as const;

type RangeKey = (typeof RANGES)[number]['key'];

export default function ProtocolCharts({ points }: { points: DailyPoint[] }) {
  const [range, setRange] = useState<RangeKey>('90d');
  const days = RANGES.find((r) => r.key === range)?.days ?? 90;

  const filtered = useMemo(() => {
    const since = Date.now() - days * 86_400_000;
    return points.filter((p) => new Date(`${p.day}T00:00:00Z`).getTime() >= since);
  }, [points, days]);

  const liquidityAvailablePoints = useMemo(
    () =>
      filtered
        .filter((p) => typeof p.liquidity_available_usd === 'number')
        .map((p) => ({ x: p.day, y: p.liquidity_available_usd! })),
    [filtered],
  );

  const weeklyVolume = useMemo(() => {
    const w = aggregateWeekly(filtered);
    return w.map((b) => ({ x: b.week_start, y: b.volume_usd }));
  }, [filtered]);

  const tradesPerDay = useMemo(
    () => filtered.map((p) => ({ x: p.day, y: p.n_trades })),
    [filtered],
  );

  const latestAvailable =
    liquidityAvailablePoints.length > 0
      ? liquidityAvailablePoints[liquidityAvailablePoints.length - 1].y
      : null;

  return (
    <div>
      <div className="chart-range-row">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            className={`chip${range === r.key ? ' chip-active' : ''}`}
            onClick={() => setRange(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>
      <div className="charts-grid">
        <ChartCard
          title="Liquidity available"
          subtitle={
            liquidityAvailablePoints.length >= 2
              ? `${liquidityAvailablePoints.length} days`
              : liquidityAvailablePoints.length === 1
                ? 'starting'
                : '—'
          }
        >
          {liquidityAvailablePoints.length >= 2 ? (
            <BarChart points={liquidityAvailablePoints} color={PALETTE.liquidity} />
          ) : liquidityAvailablePoints.length === 1 ? (
            <ChartAccumulating value={latestAvailable!} />
          ) : (
            <ChartEmpty message="No liquidity data yet" />
          )}
        </ChartCard>
        <ChartCard
          title="Weekly on-ramp volume"
          subtitle={weeklyVolume.length ? `${weeklyVolume.length} weeks` : '—'}
        >
          {weeklyVolume.length ? (
            <BarChart points={weeklyVolume} color={PALETTE.volume} valueFormatter={fmtUsdShort} />
          ) : (
            <ChartEmpty message="No volume data" />
          )}
        </ChartCard>
        <ChartCard
          title="Trades per day"
          subtitle={tradesPerDay.length ? `${tradesPerDay.length} days` : '—'}
        >
          {tradesPerDay.length ? (
            <BarChart points={tradesPerDay} color={PALETTE.trades} valueFormatter={fmtCount} />
          ) : (
            <ChartEmpty message="No trade data" />
          )}
        </ChartCard>
      </div>
    </div>
  );
}

function fmtCount(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return n.toFixed(0);
}

function ChartAccumulating({ value }: { value: number }) {
  return (
    <div className="chart-accumulating">
      <div className="chart-accumulating-value mono">{fmtUsdShort(value)}</div>
      <div className="chart-accumulating-label">today · history accumulates daily</div>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="chart-card">
      <div className="chart-header">
        <span className="chart-title">{title}</span>
        {subtitle ? <span className="chart-subtitle">{subtitle}</span> : null}
      </div>
      <div className="chart-body">{children}</div>
    </div>
  );
}

function ChartEmpty({ message }: { message: string }) {
  return <div className="chart-empty">{message}</div>;
}

interface ChartPoint {
  x: string;
  y: number;
}

const CHART_W = 800;
const CHART_H = 220;
const PAD_T = 12;
const PAD_R = 16;
const PAD_B = 28;
const PAD_L = 60;

function niceDomainMax(rawMax: number): number {
  if (rawMax <= 0) return 1;
  const exp = Math.floor(Math.log10(rawMax));
  const base = Math.pow(10, exp);
  const ratio = rawMax / base;
  let nice;
  if (ratio <= 1) nice = 1;
  else if (ratio <= 2) nice = 2;
  else if (ratio <= 5) nice = 5;
  else nice = 10;
  return nice * base;
}

type ValueFormatter = (n: number) => string;

function AreaChart({ points, color, valueFormatter = fmtUsdShort }: { points: ChartPoint[]; color: string; valueFormatter?: ValueFormatter }) {
  const ymax = niceDomainMax(Math.max(...points.map((p) => p.y), 0));
  const plotW = CHART_W - PAD_L - PAD_R;
  const plotH = CHART_H - PAD_T - PAD_B;

  const xPx = (i: number) =>
    points.length > 1 ? PAD_L + (i / (points.length - 1)) * plotW : PAD_L + plotW / 2;
  const yPx = (y: number) => PAD_T + plotH - (ymax > 0 ? (y / ymax) * plotH : 0);

  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xPx(i).toFixed(1)} ${yPx(p.y).toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L ${xPx(points.length - 1).toFixed(1)} ${yPx(0).toFixed(1)} L ${xPx(0).toFixed(1)} ${yPx(0).toFixed(1)} Z`;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * ymax);
  const xLabelIdx = points.length === 1 ? [0] : [0, Math.floor((points.length - 1) / 2), points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      style={{ width: '100%', height: 'auto', display: 'block' }}
    >
      {yTicks.map((y, i) => (
        <g key={i}>
          <line
            x1={PAD_L}
            y1={yPx(y).toFixed(1)}
            x2={PAD_L + plotW}
            y2={yPx(y).toFixed(1)}
            stroke="var(--border)"
            strokeDasharray={i === 0 ? undefined : '2,4'}
            strokeWidth="1"
          />
          <text
            x={PAD_L - 8}
            y={yPx(y).toFixed(1)}
            dy="0.32em"
            textAnchor="end"
            fontSize="10"
            fill="var(--fg-mute)"
          >
            {valueFormatter(y)}
          </text>
        </g>
      ))}
      {xLabelIdx.map((i) => (
        <text
          key={i}
          x={xPx(i).toFixed(1)}
          y={CHART_H - 8}
          fontSize="10"
          fill="var(--fg-mute)"
          textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
        >
          {fmtDayShort(points[i].x)}
        </text>
      ))}
      <path d={areaPath} fill={color} fillOpacity="0.18" />
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function BarChart({ points, color, valueFormatter = fmtUsdShort }: { points: ChartPoint[]; color: string; valueFormatter?: ValueFormatter }) {
  const ymax = niceDomainMax(Math.max(...points.map((p) => p.y), 0));
  const plotW = CHART_W - PAD_L - PAD_R;
  const plotH = CHART_H - PAD_T - PAD_B;

  const n = points.length;
  const slot = n > 0 ? plotW / n : plotW;
  const barW = Math.max(1, slot * 0.7);

  const xPx = (i: number) => PAD_L + i * slot + (slot - barW) / 2;
  const yPx = (y: number) => PAD_T + plotH - (ymax > 0 ? (y / ymax) * plotH : 0);

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * ymax);
  const xLabelIdx = n <= 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];

  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      style={{ width: '100%', height: 'auto', display: 'block' }}
    >
      {yTicks.map((y, i) => (
        <g key={i}>
          <line
            x1={PAD_L}
            y1={yPx(y).toFixed(1)}
            x2={PAD_L + plotW}
            y2={yPx(y).toFixed(1)}
            stroke="var(--border)"
            strokeDasharray={i === 0 ? undefined : '2,4'}
            strokeWidth="1"
          />
          <text
            x={PAD_L - 8}
            y={yPx(y).toFixed(1)}
            dy="0.32em"
            textAnchor="end"
            fontSize="10"
            fill="var(--fg-mute)"
          >
            {valueFormatter(y)}
          </text>
        </g>
      ))}
      {points.map((p, i) => {
        const top = yPx(p.y);
        const h = Math.max(0, PAD_T + plotH - top);
        return (
          <rect
            key={i}
            x={xPx(i).toFixed(1)}
            y={top.toFixed(1)}
            width={barW.toFixed(1)}
            height={h.toFixed(1)}
            fill={color}
            fillOpacity="0.85"
          >
            <title>{`${fmtDayShort(p.x)} · ${valueFormatter(p.y)}`}</title>
          </rect>
        );
      })}
      {xLabelIdx.map((i) => (
        <text
          key={i}
          x={(xPx(i) + barW / 2).toFixed(1)}
          y={CHART_H - 8}
          fontSize="10"
          fill="var(--fg-mute)"
          textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
        >
          {fmtDayShort(points[i].x)}
        </text>
      ))}
    </svg>
  );
}
