'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useCallback } from 'react'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { createClient } from '@/lib/supabase/client'
import type { FieldMapping, Automation } from '@/types'
import { AUTOMATION_INFO } from '@/types'

export default function MappingsPage() {
  const [loading, setLoading] = useState(true)
  const [mappings, setMappings] = useState<FieldMapping[]>([])
  const [selectedAutomation, setSelectedAutomation] = useState<string>('all')

  const supabase = createClient()

  const fetchMappings = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('field_mappings')
        .select('*')
        .order('automation')
        .order('source_field')

      if (error) throw error

      // Convert snake_case to camelCase
      const formatted: FieldMapping[] = (data || []).map((m) => ({
        id: m.id,
        automation: m.automation,
        sourceField: m.source_field,
        targetField: m.target_field,
        transform: m.transform,
        isRequired: m.is_required,
        defaultValue: m.default_value,
        notes: m.notes,
      }))

      setMappings(formatted)
    } catch (error) {
      console.error('Failed to fetch mappings:', error)
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    fetchMappings()
  }, [fetchMappings])

  const automations = Object.keys(AUTOMATION_INFO) as Automation[]

  const filteredMappings =
    selectedAutomation === 'all'
      ? mappings
      : mappings.filter((m) => m.automation === selectedAutomation)

  const groupedMappings = filteredMappings.reduce(
    (acc, mapping) => {
      if (!acc[mapping.automation]) {
        acc[mapping.automation] = []
      }
      acc[mapping.automation].push(mapping)
      return acc
    },
    {} as Record<string, FieldMapping[]>
  )

  return (
    <div className="flex flex-col">
      <Header title="Field Mappings" showRefresh onRefresh={fetchMappings} />

      <div className="p-6">
        <Card>
          <CardHeader>
            <CardTitle>Field Mapping Configuration</CardTitle>
            <p className="text-sm text-gray-500">
              Configure how fields are mapped between Salesforce, Fishbowl, and
              QuickBooks.
            </p>
          </CardHeader>
          <CardContent>
            <Tabs
              value={selectedAutomation}
              onValueChange={setSelectedAutomation}
              className="space-y-4"
            >
              <TabsList className="flex-wrap">
                <TabsTrigger value="all">All</TabsTrigger>
                {automations.map((automation) => (
                  <TabsTrigger key={automation} value={automation}>
                    {AUTOMATION_INFO[automation].name}
                  </TabsTrigger>
                ))}
              </TabsList>

              {loading ? (
                <div className="flex h-64 items-center justify-center">
                  <div className="text-gray-500">Loading...</div>
                </div>
              ) : mappings.length === 0 ? (
                <div className="flex h-64 flex-col items-center justify-center text-gray-500">
                  <p>No field mappings configured yet.</p>
                  <p className="text-sm">
                    Add mappings via the Supabase dashboard or API.
                  </p>
                </div>
              ) : (
                <TabsContent value={selectedAutomation}>
                  {Object.entries(groupedMappings).map(
                    ([automation, mappingList]) => (
                      <div key={automation} className="mb-8">
                        <h3 className="mb-3 text-lg font-medium">
                          {AUTOMATION_INFO[automation as Automation]?.name ||
                            automation}
                        </h3>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Source Field</TableHead>
                              <TableHead>Target Field</TableHead>
                              <TableHead>Transform</TableHead>
                              <TableHead>Required</TableHead>
                              <TableHead>Default</TableHead>
                              <TableHead>Notes</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {mappingList.map((mapping) => (
                              <TableRow key={mapping.id}>
                                <TableCell className="font-mono text-sm">
                                  {mapping.sourceField}
                                </TableCell>
                                <TableCell className="font-mono text-sm">
                                  {mapping.targetField}
                                </TableCell>
                                <TableCell>
                                  {mapping.transform ? (
                                    <code className="rounded bg-gray-100 px-1 text-xs">
                                      {mapping.transform}
                                    </code>
                                  ) : (
                                    <span className="text-gray-400">-</span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant={
                                      mapping.isRequired
                                        ? 'destructive'
                                        : 'secondary'
                                    }
                                  >
                                    {mapping.isRequired ? 'Yes' : 'No'}
                                  </Badge>
                                </TableCell>
                                <TableCell className="max-w-[150px] truncate text-sm">
                                  {mapping.defaultValue || '-'}
                                </TableCell>
                                <TableCell className="max-w-[200px] truncate text-sm text-gray-500">
                                  {mapping.notes || '-'}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )
                  )}
                </TabsContent>
              )}
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
