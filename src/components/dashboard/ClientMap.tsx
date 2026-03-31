'use client'

import { useEffect, useRef, useCallback } from 'react'
import type { Customer } from '@/lib/seed-data'

interface ClientMapProps {
  customers: Customer[]
  height?: string
  colorBy?: 'status' | 'rep'
  interactive?: boolean
  showClusters?: boolean
  onCustomerClick?: (customer: Customer) => void
  selectedCustomerId?: string
  fitBounds?: boolean
}

const STATUS_COLORS: Record<string, string> = {
  active: '#22c55e',
  inactive: '#9ca3af',
  prospect: '#3b82f6',
}

const REP_COLORS: Record<string, string> = {
  'Sarah Mitchell': '#452B90',
  'James Thornton': '#3A9B94',
  'Maria Gonzalez': '#F8B940',
  'David Kim': '#58BAD7',
  'Lisa Chen': '#FF9F00',
}

function buildGeoJSON(customers: Customer[]) {
  return {
    type: 'FeatureCollection' as const,
    features: customers.map((c) => ({
      type: 'Feature' as const,
      properties: {
        id: c.id,
        name: c.name,
        city: c.city,
        state: c.state,
        revenue: c.totalRevenue,
        orders: c.totalOrders,
        lastOrder: c.lastOrderDate,
        status: c.customerStatus,
        rep: c.assignedRep,
        type: c.type,
        statusColor: STATUS_COLORS[c.customerStatus] || '#9ca3af',
        repColor: REP_COLORS[c.assignedRep] || '#888888',
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [c.longitude, c.latitude],
      },
    })),
  }
}

export function ClientMap({
  customers,
  height = '500px',
  colorBy = 'status',
  interactive = true,
  showClusters = true,
  onCustomerClick,
  selectedCustomerId,
  fitBounds = true,
}: ClientMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const popupRef = useRef<mapboxgl.Popup | null>(null)

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN

  const flyToCustomer = useCallback((customer: Customer) => {
    if (!mapRef.current) return
    mapRef.current.flyTo({
      center: [customer.longitude, customer.latitude],
      zoom: 12,
      duration: 1500,
    })
  }, [])

  // Fly to selected customer when prop changes
  useEffect(() => {
    if (!selectedCustomerId || !mapRef.current) return
    const customer = customers.find((c) => c.id === selectedCustomerId)
    if (customer) flyToCustomer(customer)
  }, [selectedCustomerId, customers, flyToCustomer])

  useEffect(() => {
    if (!token || !mapContainer.current) return

    let map: mapboxgl.Map
    let cancelled = false

    async function initMap() {
      const mapboxgl = (await import('mapbox-gl')).default
      if (cancelled || !mapContainer.current) return

      map = new mapboxgl.Map({
        container: mapContainer.current,
        style: document.documentElement.classList.contains('dark')
          ? 'mapbox://styles/mapbox/dark-v11'
          : 'mapbox://styles/mapbox/light-v11',
        center: [-89.5, 39.8],
        zoom: 3.8,
        accessToken: token,
        attributionControl: false,
      })

      map.addControl(new mapboxgl.NavigationControl(), 'top-right')
      mapRef.current = map

      map.on('load', () => {
        if (cancelled) return

        const geojson = buildGeoJSON(customers)
        const colorProp = colorBy === 'status' ? 'statusColor' : 'repColor'

        if (showClusters) {
          map.addSource('customers', {
            type: 'geojson',
            data: geojson,
            cluster: true,
            clusterMaxZoom: 14,
            clusterRadius: 50,
          })

          // Cluster circles
          map.addLayer({
            id: 'clusters',
            type: 'circle',
            source: 'customers',
            filter: ['has', 'point_count'],
            paint: {
              'circle-color': '#452B90',
              'circle-opacity': 0.85,
              'circle-radius': ['step', ['get', 'point_count'], 18, 5, 24, 15, 32],
              'circle-stroke-width': 2,
              'circle-stroke-color': 'rgba(255,255,255,0.4)',
            },
          })

          // Cluster count labels
          map.addLayer({
            id: 'cluster-count',
            type: 'symbol',
            source: 'customers',
            filter: ['has', 'point_count'],
            layout: {
              'text-field': '{point_count_abbreviated}',
              'text-font': ['DIN Pro Medium', 'Arial Unicode MS Bold'],
              'text-size': 13,
            },
            paint: { 'text-color': '#ffffff' },
          })

          // Unclustered points
          map.addLayer({
            id: 'unclustered-point',
            type: 'circle',
            source: 'customers',
            filter: ['!', ['has', 'point_count']],
            paint: {
              'circle-color': ['get', colorProp],
              'circle-radius': [
                'interpolate', ['linear'], ['get', 'revenue'],
                0, 6, 100000, 10, 300000, 16, 500000, 22,
              ],
              'circle-stroke-width': 2,
              'circle-stroke-color': 'rgba(255,255,255,0.7)',
              'circle-opacity': 0.9,
            },
          })

          // Cluster click → zoom in
          map.on('click', 'clusters', (e) => {
            const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })
            if (!features.length) return
            const clusterId = features[0].properties?.cluster_id
            const source = map.getSource('customers') as mapboxgl.GeoJSONSource
            source.getClusterExpansionZoom(clusterId, (err, zoom) => {
              if (err || zoom === undefined || zoom === null) return
              const geometry = features[0].geometry
              if (geometry.type !== 'Point') return
              map.easeTo({ center: geometry.coordinates as [number, number], zoom })
            })
          })
        } else {
          map.addSource('customers', {
            type: 'geojson',
            data: geojson,
          })

          map.addLayer({
            id: 'unclustered-point',
            type: 'circle',
            source: 'customers',
            paint: {
              'circle-color': ['get', colorProp],
              'circle-radius': [
                'interpolate', ['linear'], ['get', 'revenue'],
                0, 6, 100000, 10, 300000, 16, 500000, 22,
              ],
              'circle-stroke-width': 2,
              'circle-stroke-color': 'rgba(255,255,255,0.7)',
              'circle-opacity': 0.9,
            },
          })
        }

        // Popups on hover/click for unclustered points
        if (interactive) {
          const popup = new mapboxgl.Popup({
            closeButton: false,
            closeOnClick: false,
            offset: 12,
            className: 'medship-map-popup',
          })
          popupRef.current = popup

          map.on('mouseenter', 'unclustered-point', (e) => {
            map.getCanvas().style.cursor = 'pointer'
            if (!e.features?.[0]) return
            const props = e.features[0].properties!
            const geometry = e.features[0].geometry
            if (geometry.type !== 'Point') return
            const coords = geometry.coordinates.slice() as [number, number]

            const revenue = props.revenue ? `$${Number(props.revenue).toLocaleString()}` : '$0'
            const lastOrder = props.lastOrder ? new Date(props.lastOrder + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'No orders'

            popup.setLngLat(coords).setHTML(`
              <div style="font-family:Poppins,sans-serif;padding:2px 0;">
                <div style="font-weight:600;font-size:0.8rem;color:#374557;margin-bottom:4px;">${props.name}</div>
                <div style="font-size:0.7rem;color:#888;margin-bottom:2px;">${props.city}, ${props.state}</div>
                <div style="font-size:0.7rem;color:#888;">Rep: <span style="font-weight:500;color:#374557;">${props.rep}</span></div>
                <div style="display:flex;gap:12px;margin-top:6px;padding-top:6px;border-top:1px solid #e6e6e6;">
                  <div><div style="font-size:0.65rem;color:#888;text-transform:uppercase;">Revenue</div><div style="font-size:0.8rem;font-weight:600;color:#452B90;">${revenue}</div></div>
                  <div><div style="font-size:0.65rem;color:#888;text-transform:uppercase;">Last Order</div><div style="font-size:0.75rem;font-weight:500;color:#374557;">${lastOrder}</div></div>
                </div>
              </div>
            `).addTo(map)
          })

          map.on('mouseleave', 'unclustered-point', () => {
            map.getCanvas().style.cursor = ''
            popup.remove()
          })

          map.on('click', 'unclustered-point', (e) => {
            if (!e.features?.[0] || !onCustomerClick) return
            const id = e.features[0].properties?.id
            const customer = customers.find((c) => c.id === id)
            if (customer) onCustomerClick(customer)
          })
        }

        // Cursor changes for clusters
        if (showClusters) {
          map.on('mouseenter', 'clusters', () => { map.getCanvas().style.cursor = 'pointer' })
          map.on('mouseleave', 'clusters', () => { map.getCanvas().style.cursor = '' })
        }

        // Fit bounds to markers
        if (fitBounds && customers.length > 0) {
          const bounds = new mapboxgl.LngLatBounds()
          customers.forEach((c) => bounds.extend([c.longitude, c.latitude]))
          map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 0 })
        }
      })
    }

    initMap()

    return () => {
      cancelled = true
      popupRef.current?.remove()
      map?.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, colorBy])

  if (!token) {
    return (
      <div
        className="flex items-center justify-center rounded-[0.625rem] border border-dashed border-medship-border bg-muted/30"
        style={{ height }}
      >
        <div className="max-w-sm text-center">
          <p className="mb-1 text-sm font-medium text-card-foreground">Map visualization requires a Mapbox token</p>
          <p className="text-xs text-muted-foreground">
            Add <code className="rounded bg-muted px-1 py-0.5 text-[0.7rem]">NEXT_PUBLIC_MAPBOX_TOKEN</code> to your environment variables.
          </p>
          <a
            href="https://account.mapbox.com/access-tokens/"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-xs text-medship-primary hover:underline"
          >
            Get a free Mapbox token &rarr;
          </a>
        </div>
      </div>
    )
  }

  return <div ref={mapContainer} className="rounded-[0.625rem]" style={{ height, width: '100%' }} />
}
