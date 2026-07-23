/**
 * Fixed-height placeholder rendered while a dynamically imported chart
 * (recharts) bundle loads. Matches the card chrome used by the chart
 * components so the layout doesn't shift when the real chart mounts.
 */
export function ChartSkeleton({ height }: { height: number }) {
  return (
    <div
      style={{ height }}
      className="w-full animate-pulse rounded-[0.625rem] border border-[#D6DEE3] bg-card shadow-[0_0_2.5rem_0_rgba(82,63,105,0.1)] dark:border-[rgba(255,255,255,0.1)] dark:shadow-none"
    />
  )
}
