'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { fetchJson } from '@/lib/client-api'
import type { TamByStateDollarsRow, TamGeoRow, TamScenario } from '@/lib/tam/supabase'

const KeplerMap = dynamic(() => import('./KeplerMap'), { ssr: false })

type GeoPayload = {
  scenario: TamScenario
  institutions: TamGeoRow[]
  states: TamByStateDollarsRow[]
}

type StateFeature = {
  type: 'Feature'
  properties: {
    name: string
    state?: string
    n_programs?: number
    effective_students?: number
    total_tam?: number
  }
  geometry: unknown
}

type StateFeatureCollection = {
  type: 'FeatureCollection'
  features: StateFeature[]
}

const TIERS = ['cna', 'lpn', 'adn', 'diploma', 'bsn', 'graduate']
const CONTACT_ROLES = ['dean', 'lab_sim', 'program_director', 'other']
const STATE_ABBREVIATIONS: Record<string, string> = {
  Alabama: 'AL',
  Alaska: 'AK',
  Arizona: 'AZ',
  Arkansas: 'AR',
  California: 'CA',
  Colorado: 'CO',
  Connecticut: 'CT',
  Delaware: 'DE',
  'District of Columbia': 'DC',
  Florida: 'FL',
  Georgia: 'GA',
  Hawaii: 'HI',
  Idaho: 'ID',
  Illinois: 'IL',
  Indiana: 'IN',
  Iowa: 'IA',
  Kansas: 'KS',
  Kentucky: 'KY',
  Louisiana: 'LA',
  Maine: 'ME',
  Maryland: 'MD',
  Massachusetts: 'MA',
  Michigan: 'MI',
  Minnesota: 'MN',
  Mississippi: 'MS',
  Missouri: 'MO',
  Montana: 'MT',
  Nebraska: 'NE',
  Nevada: 'NV',
  'New Hampshire': 'NH',
  'New Jersey': 'NJ',
  'New Mexico': 'NM',
  'New York': 'NY',
  'North Carolina': 'NC',
  'North Dakota': 'ND',
  Ohio: 'OH',
  Oklahoma: 'OK',
  Oregon: 'OR',
  Pennsylvania: 'PA',
  'Rhode Island': 'RI',
  'South Carolina': 'SC',
  'South Dakota': 'SD',
  Tennessee: 'TN',
  Texas: 'TX',
  Utah: 'UT',
  Vermont: 'VT',
  Virginia: 'VA',
  Washington: 'WA',
  'West Virginia': 'WV',
  Wisconsin: 'WI',
  Wyoming: 'WY',
}

function label(value: string) {
  return value.replaceAll('_', ' ').toUpperCase()
}

function buildQuery(filters: {
  scenario: TamScenario
  state: string
  tier: string
  contactRole: string
  contactHasEmail: boolean
}) {
  const params = new URLSearchParams({ scenario: filters.scenario })
  if (filters.state.trim()) params.set('state', filters.state.trim().toUpperCase())
  if (filters.tier) params.set('tier', filters.tier)
  if (filters.contactRole) params.set('contactRole', filters.contactRole)
  if (filters.contactHasEmail) params.set('contactHasEmail', 'true')
  return params
}

function toNumber(value: string | number | null | undefined) {
  if (typeof value === 'number') return value
  if (!value) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function mergeStateMetrics(
  geojson: StateFeatureCollection,
  states: TamByStateDollarsRow[]
): StateFeatureCollection {
  const stateMetrics = new Map(states.map((row) => [row.state, row]))

  return {
    type: 'FeatureCollection',
    features: geojson.features.map((feature) => {
      const state = STATE_ABBREVIATIONS[feature.properties.name]
      const metrics = state ? stateMetrics.get(state) : undefined

      return {
        ...feature,
        properties: {
          ...feature.properties,
          state,
          n_programs: toNumber(metrics?.n_programs),
          effective_students: toNumber(metrics?.effective_students),
          total_tam: toNumber(metrics?.total_tam),
        },
      }
    }),
  }
}

export function TamMapClient() {
  const [scenario, setScenario] = useState<TamScenario>('base')
  const [state, setState] = useState('')
  const [tier, setTier] = useState('')
  const [contactRole, setContactRole] = useState('')
  const [contactHasEmail, setContactHasEmail] = useState(false)
  const [payload, setPayload] = useState<GeoPayload | null>(null)
  const [stateGeojson, setStateGeojson] = useState<StateFeatureCollection | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mapMode, setMapMode] = useState<'point' | 'heatmap' | 'hexbin'>('point')
  const [stateMetric, setStateMetric] = useState<'none' | 'total_tam' | 'n_programs'>('none')

  const query = useMemo(
    () => buildQuery({ scenario, state, tier, contactRole, contactHasEmail }),
    [contactHasEmail, contactRole, scenario, state, tier]
  )

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setPayload(await fetchJson<GeoPayload>(`/api/tam/geo?${query}`))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load map data')
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    fetchJson<StateFeatureCollection>('/tam/us-states.geojson')
      .then(setStateGeojson)
      .catch(() => setStateGeojson(null))
  }, [])

  const choroplethGeojson = useMemo(() => {
    if (!payload || !stateGeojson) return null
    return mergeStateMetrics(stateGeojson, payload.states)
  }, [payload, stateGeojson])

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-8">
          <select
            value={scenario}
            onChange={(event) => setScenario(event.target.value as TamScenario)}
            className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="base">Base TAM</option>
            <option value="low">Low TAM</option>
            <option value="high">High TAM</option>
          </select>
          <Input
            value={state}
            onChange={(event) => setState(event.target.value)}
            placeholder="State"
            maxLength={2}
          />
          <select
            value={tier}
            onChange={(event) => setTier(event.target.value)}
            className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="">All tiers</option>
            {TIERS.map((item) => (
              <option key={item} value={item}>
                {label(item)}
              </option>
            ))}
          </select>
          <select
            value={contactRole}
            onChange={(event) => setContactRole(event.target.value)}
            className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="">All contacts</option>
            {CONTACT_ROLES.map((item) => (
              <option key={item} value={item}>
                {label(item)}
              </option>
            ))}
          </select>
          <label className="flex h-8 items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={contactHasEmail}
              onChange={(event) => setContactHasEmail(event.target.checked)}
              className="h-4 w-4 accent-medship-primary"
            />
            Email
          </label>
          <select
            value={mapMode}
            onChange={(event) => setMapMode(event.target.value as 'point' | 'heatmap' | 'hexbin')}
            className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="point">Point</option>
            <option value="heatmap">Heatmap</option>
            <option value="hexbin">Hexbin</option>
          </select>
          <select
            value={stateMetric}
            onChange={(event) =>
              setStateMetric(event.target.value as 'none' | 'total_tam' | 'n_programs')
            }
            className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
          >
            <option value="none">No state overlay</option>
            <option value="total_tam">State TAM $</option>
            <option value="n_programs">State programs</option>
          </select>
          <Button onClick={loadData}>
            <Search className="h-4 w-4" />
            Apply
          </Button>
        </CardContent>
      </Card>

      {error ? (
        <Card>
          <CardContent className="p-6 text-sm text-medship-danger">{error}</CardContent>
        </Card>
      ) : loading || !payload ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Loading map data...</CardContent>
        </Card>
      ) : (
        <KeplerMap
          institutions={payload.institutions}
          stateGeojson={choroplethGeojson}
          stateMetric={stateMetric}
          mapMode={mapMode}
          mapboxToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''}
        />
      )}
    </div>
  )
}
