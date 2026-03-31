'use client'

import { useState, useEffect, useCallback } from 'react'
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
import { StatusBadge } from '@/components/dashboard/StatusBadge'
import { EmptyState } from '@/components/dashboard/EmptyState'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Map, Plus, Save, Trash2, Edit3 } from 'lucide-react'
import { getFieldMappings } from '@/lib/data'
import { AUTOMATION_INFO } from '@/types'
import type { FieldMapping, AutomationType } from '@/types'
import { toast } from 'sonner'

const MAPPING_AUTOMATIONS: AutomationType[] = [
  'P1_OPP_TO_SO',
  'P2_INVENTORY_SYNC',
  'P4_SHIPMENT_TRACKING',
]

export default function MappingsPage() {
  const [loading, setLoading] = useState(true)
  const [mappings, setMappings] = useState<FieldMapping[]>([])
  const [selectedTab, setSelectedTab] = useState<string>('P1_OPP_TO_SO')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<Partial<FieldMapping>>({})

  const fetchMappings = useCallback(async () => {
    try {
      const data = await getFieldMappings()
      setMappings(data)
    } catch (error) {
      console.error('Failed to fetch mappings:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchMappings()
  }, [fetchMappings])

  const filteredMappings = mappings.filter((m) => m.automation === selectedTab)

  const handleEdit = (mapping: FieldMapping) => {
    setEditingId(mapping.id)
    setEditValues({
      source_field: mapping.source_field,
      target_field: mapping.target_field,
      transform: mapping.transform,
      default_value: mapping.default_value,
      notes: mapping.notes,
    })
  }

  const handleSave = () => {
    if (!editingId) return
    setMappings((prev) =>
      prev.map((m) =>
        m.id === editingId
          ? { ...m, ...editValues, updated_at: new Date().toISOString() }
          : m
      )
    )
    setEditingId(null)
    setEditValues({})
    toast.success('Mapping updated')
  }

  const handleCancel = () => {
    setEditingId(null)
    setEditValues({})
  }

  const handleDelete = (id: string) => {
    setMappings((prev) => prev.filter((m) => m.id !== id))
    toast.success('Mapping deleted')
  }

  const handleAdd = () => {
    const newId = `FM-NEW-${Date.now()}`
    const newMapping: FieldMapping = {
      id: newId,
      automation: selectedTab as AutomationType,
      source_field: '',
      target_field: '',
      transform: null,
      is_required: false,
      default_value: null,
      notes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    setMappings((prev) => [...prev, newMapping])
    setEditingId(newId)
    setEditValues({
      source_field: '',
      target_field: '',
      transform: null,
      default_value: null,
      notes: null,
    })
  }

  return (
    <div className="flex flex-col">
      <Header title="Field Mappings" />

      <div className="p-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Map className="h-5 w-5 text-medship-primary" />
                  Field Mapping Configuration
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Configure how fields are mapped between Salesforce, Fishbowl, and QuickBooks.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex h-64 items-center justify-center">
                <div className="text-muted-foreground">Loading...</div>
              </div>
            ) : (
              <Tabs value={selectedTab} onValueChange={setSelectedTab}>
                <TabsList>
                  {MAPPING_AUTOMATIONS.map((automation) => (
                    <TabsTrigger key={automation} value={automation}>
                      {AUTOMATION_INFO[automation].name}
                    </TabsTrigger>
                  ))}
                </TabsList>

                {MAPPING_AUTOMATIONS.map((automation) => (
                  <TabsContent key={automation} value={automation} className="mt-4">
                    {filteredMappings.length === 0 ? (
                      <EmptyState
                        icon={Map}
                        title="No mappings configured"
                        description="Add field mappings for this automation."
                        action={
                          <Button onClick={handleAdd} size="sm">
                            <Plus className="mr-2 h-4 w-4" />
                            Add Mapping
                          </Button>
                        }
                      />
                    ) : (
                      <>
                        <div className="mb-4 flex justify-end">
                          <Button onClick={handleAdd} size="sm" variant="outline">
                            <Plus className="mr-2 h-4 w-4" />
                            Add Mapping
                          </Button>
                        </div>
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Source Field</TableHead>
                                <TableHead>Target Field</TableHead>
                                <TableHead>Transform</TableHead>
                                <TableHead>Required</TableHead>
                                <TableHead>Default Value</TableHead>
                                <TableHead>Notes</TableHead>
                                <TableHead className="w-24">Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {filteredMappings.map((mapping) => (
                                <TableRow key={mapping.id}>
                                  {editingId === mapping.id ? (
                                    <>
                                      <TableCell>
                                        <Input
                                          value={editValues.source_field ?? ''}
                                          onChange={(e) =>
                                            setEditValues((prev) => ({ ...prev, source_field: e.target.value }))
                                          }
                                          className="h-8 text-sm"
                                        />
                                      </TableCell>
                                      <TableCell>
                                        <Input
                                          value={editValues.target_field ?? ''}
                                          onChange={(e) =>
                                            setEditValues((prev) => ({ ...prev, target_field: e.target.value }))
                                          }
                                          className="h-8 text-sm"
                                        />
                                      </TableCell>
                                      <TableCell>
                                        <Input
                                          value={editValues.transform ?? ''}
                                          onChange={(e) =>
                                            setEditValues((prev) => ({ ...prev, transform: e.target.value || null }))
                                          }
                                          className="h-8 text-sm"
                                          placeholder="-"
                                        />
                                      </TableCell>
                                      <TableCell>
                                        <StatusBadge status={mapping.is_required ? 'Yes' : 'No'} />
                                      </TableCell>
                                      <TableCell>
                                        <Input
                                          value={editValues.default_value ?? ''}
                                          onChange={(e) =>
                                            setEditValues((prev) => ({ ...prev, default_value: e.target.value || null }))
                                          }
                                          className="h-8 text-sm"
                                          placeholder="-"
                                        />
                                      </TableCell>
                                      <TableCell>
                                        <Input
                                          value={editValues.notes ?? ''}
                                          onChange={(e) =>
                                            setEditValues((prev) => ({ ...prev, notes: e.target.value || null }))
                                          }
                                          className="h-8 text-sm"
                                          placeholder="-"
                                        />
                                      </TableCell>
                                      <TableCell>
                                        <div className="flex gap-1">
                                          <Button size="xs" onClick={handleSave}>
                                            <Save className="h-3 w-3" />
                                          </Button>
                                          <Button size="xs" variant="ghost" onClick={handleCancel}>
                                            Cancel
                                          </Button>
                                        </div>
                                      </TableCell>
                                    </>
                                  ) : (
                                    <>
                                      <TableCell className="font-mono text-sm">
                                        {mapping.source_field}
                                      </TableCell>
                                      <TableCell className="font-mono text-sm">
                                        {mapping.target_field}
                                      </TableCell>
                                      <TableCell>
                                        {mapping.transform ? (
                                          <code className="rounded bg-muted px-1 text-xs">
                                            {mapping.transform}
                                          </code>
                                        ) : (
                                          <span className="text-muted-foreground">-</span>
                                        )}
                                      </TableCell>
                                      <TableCell>
                                        <StatusBadge
                                          status={mapping.is_required ? 'required' : 'optional'}
                                        />
                                      </TableCell>
                                      <TableCell className="max-w-[150px] truncate text-sm">
                                        {mapping.default_value || '-'}
                                      </TableCell>
                                      <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                                        {mapping.notes || '-'}
                                      </TableCell>
                                      <TableCell>
                                        <div className="flex gap-1">
                                          <Button
                                            size="xs"
                                            variant="ghost"
                                            onClick={() => handleEdit(mapping)}
                                          >
                                            <Edit3 className="h-3 w-3" />
                                          </Button>
                                          <Button
                                            size="xs"
                                            variant="ghost"
                                            className="text-medship-danger hover:text-medship-danger"
                                            onClick={() => handleDelete(mapping.id)}
                                          >
                                            <Trash2 className="h-3 w-3" />
                                          </Button>
                                        </div>
                                      </TableCell>
                                    </>
                                  )}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </>
                    )}
                  </TabsContent>
                ))}
              </Tabs>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
