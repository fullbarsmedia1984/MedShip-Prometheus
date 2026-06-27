'use client'

import { useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Provider, useDispatch } from 'react-redux'
import { applyMiddleware, combineReducers, createStore } from 'redux'
import KeplerGl from '@kepler.gl/components'
import keplerGlReducer from '@kepler.gl/reducers'
import { addDataToMap } from '@kepler.gl/actions'
import { processGeojson, processRowObject } from '@kepler.gl/processors'
import { taskMiddleware } from 'react-palm/tasks'
import type { ProtoDataset } from '@kepler.gl/types/actions'
import type { TamGeoRow } from '@/lib/tam/supabase'

type MapMode = 'point' | 'heatmap' | 'hexbin'
type StateMetric = 'none' | 'total_tam' | 'n_programs'
type StateFeatureCollection = {
  type: 'FeatureCollection'
  features: unknown[]
}

type DeckClickInfo = {
  object?: {
    index?: number
  } | null
}

type KeplerMapProps = {
  institutions: TamGeoRow[]
  stateGeojson: StateFeatureCollection | null
  stateMetric: StateMetric
  mapMode: MapMode
  mapboxToken: string
}

const reducers = combineReducers({
  keplerGl: keplerGlReducer.initialState({
    uiState: {
      readOnly: true,
      currentModal: null,
    },
  }),
})

const store = createStore(reducers, {}, applyMiddleware(taskMiddleware))

function modeLayerVisibility(mode: MapMode) {
  return {
    point: mode === 'point',
    heatmap: mode === 'heatmap',
    hexbin: mode === 'hexbin',
  }
}

function toKeplerDataset(
  info: ProtoDataset['info'],
  data: ReturnType<typeof processRowObject>
): ProtoDataset {
  if (!data) {
    throw new Error(`Unable to process Kepler dataset ${info.id ?? info.label}`)
  }

  return {
    info,
    data: data as ProtoDataset['data'],
  }
}

function KeplerMapInner({
  institutions,
  stateGeojson,
  stateMetric,
  mapMode,
  mapboxToken,
}: KeplerMapProps) {
  const dispatch = useDispatch()
  const router = useRouter()
  const rows = useMemo(
    () =>
      institutions.map((institution) => {
        const primaryProgram = institution.programs[0]
        const primaryContact = institution.contacts[0]
        const enrollment = institution.programs.reduce(
          (sum, program) => sum + (program.est_annual_enrollment ?? 0),
          0
        )
        const accreditedProgramCount =
          institution.accredited_program_count ??
          institution.programs.filter(
            (program) => program.accreditor !== 'none' || program.state_board_approved
          ).length
        const programCount = institution.program_count ?? institution.programs.length
        const accreditationRate =
          institution.accreditation_rate ??
          (programCount > 0 ? (accreditedProgramCount / programCount) * 100 : 0)

        return {
          id: institution.id,
          name: institution.name,
          city: institution.city,
          state: institution.state,
          lat: institution.lat,
          lng: institution.lng,
          tier: primaryProgram?.tier ?? 'unknown',
          est_annual_enrollment: enrollment,
          program_count: programCount,
          accredited_program_count: accreditedProgramCount,
          accreditation_rate: Math.round(accreditationRate * 10) / 10,
          accreditation: `${Math.round(accreditationRate)}% accredited/approved (${accreditedProgramCount}/${programCount})`,
          primary_contact: primaryContact?.name ?? '',
          primary_contact_role: primaryContact?.role_category ?? '',
          primary_contact_email: primaryContact?.email ?? '',
          primary_contact_phone: primaryContact?.phone ?? '',
        }
      }),
    [institutions]
  )

  useEffect(() => {
    const visible = modeLayerVisibility(mapMode)
    const datasets: ProtoDataset[] = [
      toKeplerDataset(
        { label: 'Nursing TAM Institutions', id: 'tam_institutions' },
        processRowObject(rows)
      ),
    ]

    if (stateGeojson && stateMetric !== 'none') {
      datasets.push(
        toKeplerDataset(
          { label: 'State TAM Choropleth', id: 'tam_state_choropleth' },
          processGeojson(stateGeojson)
        )
      )
    }

    dispatch(
      addDataToMap({
        datasets,
        options: {
          centerMap: true,
          readOnly: true,
        },
        config: {
          version: 'v1',
          config: {
            visState: {
              layers: [
                {
                  id: 'tam_state_choropleth',
                  type: 'geojson',
                  config: {
                    dataId: 'tam_state_choropleth',
                    label: stateMetric === 'total_tam' ? 'State TAM Dollars' : 'State Program Count',
                    columns: { geojson: '_geojson' },
                    isVisible: Boolean(stateGeojson && stateMetric !== 'none'),
                    visConfig: {
                      opacity: 0.14,
                      strokeOpacity: 0.28,
                      thickness: 0.6,
                      stroked: true,
                      filled: true,
                      enable3d: false,
                      colorRange: {
                        name: 'TAM sequential',
                        type: 'sequential',
                        category: 'Custom',
                        colors: ['#E7F0FA', '#B7D4EA', '#7DB6D8', '#3F8FC2', '#1764A4', '#0B3B75'],
                      },
                    },
                  },
                  visualChannels: {
                    colorField: { name: stateMetric, type: 'real' },
                    colorScale: 'quantile',
                  },
                },
                {
                  id: 'tam_points',
                  type: 'point',
                  config: {
                    dataId: 'tam_institutions',
                    label: 'Institutions',
                    columns: { lat: 'lat', lng: 'lng' },
                    isVisible: visible.point,
                    visConfig: {
                      radius: 12,
                      radiusRange: [5, 34],
                      opacity: 0.92,
                      outline: true,
                      thickness: 1.4,
                      strokeColor: [255, 255, 255],
                      colorRange: {
                        name: 'MedShip tiers',
                        type: 'qualitative',
                        category: 'Custom',
                        colors: ['#1E98D5', '#0FA62C', '#F59E0B', '#7C3AED', '#EF4444', '#64748B'],
                      },
                    },
                  },
                  visualChannels: {
                    colorField: { name: 'tier', type: 'string' },
                    colorScale: 'ordinal',
                    sizeField: { name: 'accreditation_rate', type: 'real' },
                    sizeScale: 'linear',
                  },
                },
                {
                  id: 'tam_heatmap',
                  type: 'heatmap',
                  config: {
                    dataId: 'tam_institutions',
                    label: 'Enrollment Heatmap',
                    columns: { lat: 'lat', lng: 'lng' },
                    isVisible: visible.heatmap,
                  },
                  visualChannels: {
                    weightField: { name: 'est_annual_enrollment', type: 'integer' },
                    weightScale: 'linear',
                  },
                },
                {
                  id: 'tam_hexbin',
                  type: 'hexagon',
                  config: {
                    dataId: 'tam_institutions',
                    label: 'Enrollment Hexbin',
                    columns: { lat: 'lat', lng: 'lng' },
                    isVisible: visible.hexbin,
                  },
                  visualChannels: {
                    colorField: { name: 'est_annual_enrollment', type: 'integer' },
                    colorScale: 'quantile',
                  },
                },
              ],
              interactionConfig: {
                tooltip: {
                  fieldsToShow: {
                    tam_institutions: [
                      { name: 'name', format: null },
                      { name: 'city', format: null },
                      { name: 'state', format: null },
                      { name: 'tier', format: null },
                      { name: 'program_count', format: null },
                      { name: 'accreditation', format: null },
                      { name: 'est_annual_enrollment', format: null },
                      { name: 'primary_contact', format: null },
                      { name: 'primary_contact_role', format: null },
                      { name: 'primary_contact_email', format: null },
                      { name: 'primary_contact_phone', format: null },
                    ],
                  },
                  enabled: true,
                  compareMode: false,
                  compareType: null,
                },
              },
            },
            mapState: {
              latitude: 39.5,
              longitude: -98.35,
              zoom: 3,
            },
            mapStyle: {
              styleType: 'light',
            },
          },
        },
      })
    )
  }, [dispatch, mapMode, rows, stateGeojson, stateMetric])

  function handlePointClick(info: DeckClickInfo) {
    const index = info.object?.index
    if (typeof index !== 'number') return

    const institution = rows[index]
    if (!institution?.id) return

    router.push(`/dashboard/tam/browser?institutionId=${encodeURIComponent(institution.id)}`)
  }

  return (
    <div className="h-[72vh] min-h-[520px] overflow-hidden rounded-lg border border-border">
      <KeplerGl
        id="tam"
        mapboxApiAccessToken={mapboxToken}
        width={1200}
        height={760}
        readOnly
        deckGlProps={{ onClick: handlePointClick }}
      />
    </div>
  )
}

export default function KeplerMap(props: KeplerMapProps) {
  return (
    <Provider store={store}>
      <KeplerMapInner {...props} />
    </Provider>
  )
}
