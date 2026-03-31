'use client'

import { Fragment } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { EmptyState } from './EmptyState'

interface Column<T> {
  key: string
  label: string
  sortable?: boolean
  render?: (value: any, row: T) => React.ReactNode
  className?: string
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  totalItems: number
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onSort?: (key: string, direction: 'asc' | 'desc') => void
  sortKey?: string
  sortDirection?: 'asc' | 'desc'
  onRowClick?: (row: T) => void
  expandedRow?: string | null
  renderExpanded?: (row: T) => React.ReactNode
  emptyMessage?: string
}

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((acc, key) => acc?.[key], obj)
}

export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  totalItems,
  page,
  pageSize,
  onPageChange,
  onSort,
  sortKey,
  sortDirection,
  onRowClick,
  expandedRow,
  renderExpanded,
  emptyMessage = 'No data found',
}: DataTableProps<T>) {
  const totalPages = Math.ceil(totalItems / pageSize)

  const handleSort = (key: string) => {
    if (!onSort) return
    const newDirection =
      sortKey === key && sortDirection === 'asc' ? 'desc' : 'asc'
    onSort(key, newDirection)
  }

  // Generate visible page numbers
  const getPageNumbers = (): number[] => {
    const pages: number[] = []
    const maxVisible = 5
    let start = Math.max(1, page - Math.floor(maxVisible / 2))
    const end = Math.min(totalPages, start + maxVisible - 1)
    start = Math.max(1, end - maxVisible + 1)
    for (let i = start; i <= end; i++) {
      pages.push(i)
    }
    return pages
  }

  if (data.length === 0) {
    return <EmptyState title={emptyMessage} />
  }

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((col) => (
              <TableHead
                key={col.key}
                className={cn(
                  col.sortable && onSort && 'cursor-pointer select-none',
                  col.className
                )}
                onClick={() => col.sortable && handleSort(col.key)}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {col.sortable && sortKey === col.key && (
                    sortDirection === 'asc' ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )
                  )}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row, rowIndex) => {
            const rowId = row.id as string | undefined
            const isExpanded = expandedRow != null && rowId === expandedRow

            return (
              <Fragment key={rowId ?? rowIndex}>
                <TableRow
                  className={cn(
                    rowIndex % 2 === 0 && 'bg-muted/30',
                    onRowClick && 'cursor-pointer',
                  )}
                  onClick={() => onRowClick?.(row)}
                >
                  {columns.map((col) => {
                    const value = getNestedValue(row, col.key)
                    return (
                      <TableCell key={col.key} className={col.className}>
                        {col.render ? col.render(value, row) : (value ?? '-')}
                      </TableCell>
                    )
                  })}
                </TableRow>
                {isExpanded && renderExpanded && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={columns.length} className="p-0">
                      {renderExpanded(row)}
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            )
          })}
        </TableBody>
      </Table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-2">
          <p className="text-xs text-muted-foreground">
            Showing {(page - 1) * pageSize + 1}
            {' '}-{' '}
            {Math.min(page * pageSize, totalItems)} of {totalItems}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-xs"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>

            {getPageNumbers().map((pageNum) => (
              <Button
                key={pageNum}
                variant={pageNum === page ? 'default' : 'outline'}
                size="xs"
                onClick={() => onPageChange(pageNum)}
                className="min-w-6"
              >
                {pageNum}
              </Button>
            ))}

            <Button
              variant="outline"
              size="icon-xs"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
