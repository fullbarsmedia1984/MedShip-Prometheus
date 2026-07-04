'use client'

import { Fragment, useState } from 'react'
import { cn } from '@/lib/utils'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CallOutcomeBadge } from '@/components/dashboard/CallOutcomeBadge'
import { ComingSoonBadge, ComingSoonPanel } from '@/components/dashboard/ComingSoon'
import {
  Calendar,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Phone,
  Search,
  Star,
  Voicemail,
} from 'lucide-react'
import type { SeedProfileCall, SeedSalesRep } from '@/lib/seed-data'

interface ProfileCallTableProps {
  calls: SeedProfileCall[]
  reps: SeedSalesRep[]
  keywordFilter?: string
  onClearKeywordFilter?: () => void
}

function formatDate(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00`)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn(
            'h-3 w-3',
            i <= rating ? 'fill-amber-400 text-amber-400' : 'text-gray-200'
          )}
        />
      ))}
    </div>
  )
}

export function ProfileCallTable({ calls, reps, keywordFilter, onClearKeywordFilter }: ProfileCallTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [repFilter, setRepFilter] = useState('all')
  const [outcomeFilter, setOutcomeFilter] = useState('all')
  const [convertedFilter, setConvertedFilter] = useState('all')
  const [activityTypeFilter, setActivityTypeFilter] = useState('all')
  const [search, setSearch] = useState('')

  const outcomes = [...new Set(calls.map((call) => call.profileCallOutcome).filter(Boolean))].sort()

  let filtered = [...calls]
  if (repFilter !== 'all') filtered = filtered.filter((c) => c.repId === repFilter)
  if (outcomeFilter !== 'all') filtered = filtered.filter((c) => c.profileCallOutcome === outcomeFilter)
  if (convertedFilter === 'yes') filtered = filtered.filter((c) => c.convertedToOpp)
  else if (convertedFilter === 'no') filtered = filtered.filter((c) => !c.convertedToOpp)
  if (activityTypeFilter !== 'all') filtered = filtered.filter((c) => c.activityType === activityTypeFilter)

  if (keywordFilter) {
    const kw = keywordFilter.toLowerCase()
    filtered = filtered.filter((c) =>
      c.ringdnaKeywords?.toLowerCase().includes(kw) ||
      c.profileCallType.toLowerCase().includes(kw) ||
      c.profileCallOutcome.toLowerCase().includes(kw)
    )
  }

  if (search) {
    const q = search.toLowerCase()
    filtered = filtered.filter((c) =>
      c.repName.toLowerCase().includes(q) ||
      c.profileCallType.toLowerCase().includes(q) ||
      c.profileCallOutcome.toLowerCase().includes(q) ||
      c.ringdnaDirection?.toLowerCase().includes(q) ||
      c.ringdnaKeywords?.toLowerCase().includes(q)
    )
  }

  const repColorMap = new Map(reps.map((r) => [r.id, r.color]))

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-medship-primary/10">
              <Phone className="h-4 w-4 text-medship-primary" />
            </span>
            RingDNA Call Log
            {calls.length === 0 && <ComingSoonBadge />}
          </CardTitle>
          <div className="flex items-center gap-2">
            {keywordFilter && (
              <button
                onClick={onClearKeywordFilter}
                className="inline-flex items-center gap-1.5 rounded-full border border-medship-danger/20 bg-medship-danger/5 px-3 py-1 text-xs font-medium text-medship-danger transition-colors hover:bg-medship-danger/10"
              >
                Keyword: {keywordFilter}
                <span className="text-medship-danger/50">&times;</span>
              </button>
            )}
            <span className="text-sm text-muted-foreground">{filtered.length} calls</span>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-3">
          <div className="relative w-full sm:w-auto">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search rep, disposition, keywords..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full pl-8 text-sm sm:w-[260px]"
            />
          </div>
          <Select value={repFilter} onValueChange={(v) => setRepFilter(v ?? 'all')}>
            <SelectTrigger className="h-9 w-full text-sm sm:w-[160px]">
              <SelectValue placeholder="All Reps" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Reps</SelectItem>
              {reps.map((r) => (
                <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={outcomeFilter} onValueChange={(v) => setOutcomeFilter(v ?? 'all')}>
            <SelectTrigger className="h-9 w-full text-sm sm:w-[180px]">
              <SelectValue placeholder="All Dispositions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Dispositions</SelectItem>
              {outcomes.map((o) => (
                <SelectItem key={o} value={o}>{o}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={convertedFilter} onValueChange={(v) => setConvertedFilter(v ?? 'all')}>
            <SelectTrigger className="h-9 w-full text-sm sm:w-[140px]">
              <SelectValue placeholder="Converted" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="yes">Converted</SelectItem>
              <SelectItem value="no">Not Converted</SelectItem>
            </SelectContent>
          </Select>
          <Select value={activityTypeFilter} onValueChange={(v) => setActivityTypeFilter(v ?? 'all')}>
            <SelectTrigger className="h-9 w-full text-sm sm:w-[140px]">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="Task">Task</SelectItem>
              <SelectItem value="Event">Event</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {calls.length === 0 ? (
          <ComingSoonPanel
            title="RingDNA call log"
            description="Live Salesforce RingDNA call activity has not synced yet."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-8" />
                <TableHead>Date</TableHead>
                <TableHead className="w-10 text-center">Type</TableHead>
                <TableHead>Rep</TableHead>
                <TableHead className="hidden md:table-cell">Direction</TableHead>
                <TableHead className="hidden lg:table-cell">Disposition</TableHead>
                <TableHead>Enrichment</TableHead>
                <TableHead className="hidden md:table-cell text-center">Duration</TableHead>
                <TableHead className="hidden lg:table-cell text-center">Connect</TableHead>
                <TableHead className="hidden lg:table-cell text-center">VM</TableHead>
                <TableHead className="hidden xl:table-cell text-center">Rating</TableHead>
                <TableHead className="hidden xl:table-cell">Products</TableHead>
                <TableHead className="text-center">Conv.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, 50).map((call) => {
                const isExpanded = expandedId === call.id
                const repColor = repColorMap.get(call.repId) || '#888'

                return (
                  <Fragment key={call.id}>
                    <TableRow
                      className={cn('cursor-pointer transition-colors', isExpanded && 'bg-muted/30')}
                      onClick={() => setExpandedId(isExpanded ? null : call.id)}
                    >
                      <TableCell className="w-8 px-2">
                        {isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(call.activityDate)}
                      </TableCell>
                      <TableCell className="text-center">
                        {call.activityType === 'Task' ? (
                          <span title="Task call">
                            <ClipboardList className="mx-auto h-3.5 w-3.5 text-muted-foreground" />
                          </span>
                        ) : (
                          <span title="Event call">
                            <Calendar className="mx-auto h-3.5 w-3.5 text-medship-info" />
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[0.55rem] font-bold text-white"
                            style={{ backgroundColor: repColor }}
                          >
                            {call.repName.split(' ').map((n) => n[0]).join('')}
                          </div>
                          <span className="text-sm font-medium">{call.repName.split(' ')[0]}</span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">
                        {call.ringdnaDirection ?? 'Unknown'}
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                        {call.profileCallType}
                      </TableCell>
                      <TableCell>
                        <CallOutcomeBadge outcome={call.profileCallOutcome} />
                      </TableCell>
                      <TableCell className="hidden text-center tabular-nums text-muted-foreground md:table-cell">
                        {call.ringdnaDurationMin > 0 ? `${call.ringdnaDurationMin}m` : '-'}
                      </TableCell>
                      <TableCell className="hidden text-center lg:table-cell">
                        {call.ringdnaConnected ? (
                          <CheckCircle className="mx-auto h-4 w-4 text-emerald-500" />
                        ) : (
                          <span className="text-muted-foreground/30">-</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-center lg:table-cell">
                        {call.ringdnaVoicemail ? (
                          <Voicemail className="mx-auto h-4 w-4 text-amber-500" />
                        ) : (
                          <span className="text-muted-foreground/30">-</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">
                        {call.ringdnaRating !== null ? (
                          <StarRating rating={call.ringdnaRating} />
                        ) : (
                          <span className="text-center text-muted-foreground/30">-</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {call.productsDiscussed.slice(0, 2).map((p) => (
                            <span
                              key={p}
                              className="inline-block max-w-[100px] truncate rounded bg-muted px-1.5 py-0.5 text-[0.6rem] text-muted-foreground"
                            >
                              {p}
                            </span>
                          ))}
                          {call.productsDiscussed.length > 2 && (
                            <span className="inline-block rounded bg-muted px-1.5 py-0.5 text-[0.6rem] text-muted-foreground">
                              +{call.productsDiscussed.length - 2}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        {call.convertedToOpp ? (
                          <CheckCircle className="mx-auto h-4 w-4 text-emerald-500" />
                        ) : (
                          <span className="text-muted-foreground/30">-</span>
                        )}
                      </TableCell>
                    </TableRow>

                    {isExpanded && (
                      <TableRow className="bg-muted/20 hover:bg-muted/20">
                        <TableCell colSpan={13} className="px-6 py-4">
                          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                            <div>
                              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                RingDNA Summary
                              </h4>
                              <div className="grid grid-cols-2 gap-3 text-sm">
                                <div>
                                  <span className="text-xs text-muted-foreground">Direction:</span>
                                  <span className="ml-1 font-medium">{call.ringdnaDirection ?? 'Unknown'}</span>
                                </div>
                                <div>
                                  <span className="text-xs text-muted-foreground">Disposition:</span>
                                  <span className="ml-1 font-medium">{call.profileCallType}</span>
                                </div>
                                <div>
                                  <span className="text-xs text-muted-foreground">Connected:</span>
                                  <span className="ml-1 font-medium">{call.ringdnaConnected ? 'Yes' : 'No'}</span>
                                </div>
                                <div>
                                  <span className="text-xs text-muted-foreground">Voicemail:</span>
                                  <span className="ml-1 font-medium">{call.ringdnaVoicemail ? 'Yes' : 'No'}</span>
                                </div>
                              </div>
                            </div>

                            <div className="space-y-3">
                              {call.ringdnaKeywords && (
                                <div>
                                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                    RingDNA Keywords
                                  </h4>
                                  <div className="flex flex-wrap gap-1.5">
                                    {call.ringdnaKeywords.split(',').map((kw) => kw.trim()).filter(Boolean).map((kw) => (
                                      <span
                                        key={kw}
                                        className="rounded-full bg-medship-info/10 px-2.5 py-0.5 text-[0.7rem] font-medium text-medship-info"
                                      >
                                        {kw}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                                <div>
                                  <span className="text-xs text-muted-foreground">Program Size:</span>
                                  <span className="ml-1 font-medium">{call.programSize || 'Not captured'}</span>
                                </div>
                                {call.budgetTimeframe && (
                                  <div>
                                    <span className="text-xs text-muted-foreground">Budget Timeframe:</span>
                                    <span className="ml-1 font-medium">{call.budgetTimeframe}</span>
                                  </div>
                                )}
                                {call.followUpDate && (
                                  <div>
                                    <span className="text-xs text-muted-foreground">Follow-Up:</span>
                                    <span className="ml-1 font-medium">{formatDate(call.followUpDate)}</span>
                                  </div>
                                )}
                              </div>

                              {call.productsDiscussed.length > 0 && (
                                <div>
                                  <span className="text-xs text-muted-foreground">Products Discussed:</span>
                                  <div className="mt-1 flex flex-wrap gap-1.5">
                                    {call.productsDiscussed.map((p) => (
                                      <span
                                        key={p}
                                        className="rounded-full bg-medship-primary/10 px-2.5 py-0.5 text-[0.7rem] font-medium text-medship-primary"
                                      >
                                        {p}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
