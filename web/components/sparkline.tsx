interface SparklineProps {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
  ariaLabel?: string;
}

/**
 * Tiny SVG sparkline. Renders a thin polyline of `values`. Used inline in
 * dense tables to show a 14-day trend without heavy chart machinery.
 */
export default function Sparkline({
  values,
  color = 'var(--accent)',
  width = 88,
  height = 22,
  ariaLabel,
}: SparklineProps) {
  if (values.length < 2) {
    return (
      <span className="muted" style={{ fontSize: 11 }}>
        —
      </span>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = width / (values.length - 1);
  const pts = values
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  // Build a closed path for the area fill below the line
  const areaPts = `0,${height} ${pts} ${width},${height}`;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel ?? `sparkline of ${values.length} days`}
      style={{ display: 'block' }}
    >
      <polygon points={areaPts} fill={color} fillOpacity="0.14" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.2" />
    </svg>
  );
}
