/**
 * Segment-level loading skeleton for /dashboard/*. Paints instantly on
 * navigation while the server component fetches its data. Deliberately
 * generic (header bar + card grid) since it covers every dashboard page,
 * not just the overview. Card chrome matches ChartSkeleton.
 */

const CARD_CHROME =
  'animate-pulse rounded-[0.625rem] border border-[#D6DEE3] bg-card dark:border-[rgba(255,255,255,0.1)]'

export default function DashboardLoading() {
  return (
    <div className="flex flex-col">
      {/* Header bar placeholder (matches Header height) */}
      <div className="flex h-[4.375rem] items-center justify-between px-4 md:px-[2.1rem]">
        <div className="h-6 w-44 animate-pulse rounded-md bg-muted" />
        <div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
      </div>

      <div className="space-y-6 p-4 md:p-6">
        {/* KPI-style card row */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className={`h-[104px] ${CARD_CHROME}`} />
          ))}
        </div>

        {/* Wide content blocks */}
        <div className={`h-[320px] ${CARD_CHROME}`} />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className={`h-[280px] lg:col-span-7 ${CARD_CHROME}`} />
          <div className={`h-[280px] lg:col-span-5 ${CARD_CHROME}`} />
        </div>
      </div>
    </div>
  )
}
