'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type {
  KitGalaxyData,
  GalaxyKit,
} from '@/lib/warehouse-board/galaxy-data'

// Palette (matches the board): waiting blue, assembling amber, shipped
// green, critical red. Moons: done green, partial amber, not-started slate.
const STATUS_COLOR: Record<GalaxyKit['status'], number> = {
  waiting: 0x1e98d5,
  assembling: 0xe89c0c,
  shipped: 0x0fa62c,
}
const CRITICAL_COLOR = 0xd93025
const MOON_DONE = 0x2fbf4f
const MOON_PARTIAL = 0xf5a524
const MOON_TODO = 0x5c7186
const MOONS_PER_KIT_CAP = 20

type HoverInfo = { title: string; lines: string[]; x: number; y: number }

function kitColor(kit: GalaxyKit): number {
  return kit.severity === 'critical' ? CRITICAL_COLOR : STATUS_COLOR[kit.status]
}

// Deterministic per-string angle so layout is stable across refreshes.
function hashAngle(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return (Math.abs(h) % 6283) / 1000
}

function makeLabelSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 96
  const ctx = canvas.getContext('2d')!
  ctx.font = '600 40px "Segoe UI", Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(0,0,0,0.9)'
  ctx.shadowBlur = 10
  ctx.fillStyle = 'rgba(226,236,244,0.92)'
  const label = text.length > 26 ? text.slice(0, 25) + '…' : text
  ctx.fillText(label, 256, 48)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
  )
  sprite.scale.set(17, 3.2, 1)
  return sprite
}

type PlanetEntry = {
  mesh: THREE.Mesh
  sunPos: THREE.Vector3
  orbitR: number
  angle: number
  speed: number
  kit: GalaxyKit
  school: string
}
type MoonEntry = {
  planetIdx: number
  orbitR: number
  angle: number
  speed: number
  tilt: number
  item: { part: string; desc: string | null; qty: number; fulfilled: number }
  soNumber: string
}

export function KitGalaxy({
  data,
  query,
}: {
  data: KitGalaxyData
  query: string
}) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<HoverInfo | null>(null)
  const [webglOk, setWebglOk] = useState(true)
  const engineRef = useRef<{
    rebuild: (d: KitGalaxyData) => void
    focusSo: (q: string) => void
    dispose: () => void
  } | null>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      setWebglOk(false)
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(
      55,
      mount.clientWidth / mount.clientHeight,
      0.1,
      4000
    )
    camera.position.set(0, 95, 170)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.06
    controls.minDistance = 8
    controls.maxDistance = 900

    // starfield backdrop
    {
      const starGeo = new THREE.BufferGeometry()
      const n = 1800
      const pos = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        const r = 500 + Math.random() * 900
        const theta = Math.random() * Math.PI * 2
        const phi = Math.acos(2 * Math.random() - 1)
        pos[i * 3] = r * Math.sin(phi) * Math.cos(theta)
        pos[i * 3 + 1] = r * Math.cos(phi)
        pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta)
      }
      starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      scene.add(
        new THREE.Points(
          starGeo,
          new THREE.PointsMaterial({ color: 0x8fb4cc, size: 1.1, sizeAttenuation: false, transparent: true, opacity: 0.7 })
        )
      )
    }

    const galaxy = new THREE.Group()
    scene.add(galaxy)

    let planets: PlanetEntry[] = []
    let moons: MoonEntry[] = []
    let moonMesh: THREE.InstancedMesh | null = null
    let suns: THREE.Mesh[] = []
    const focusTarget = new THREE.Vector3(0, 0, 0)
    let highlightSo: string | null = null

    const moonGeo = new THREE.SphereGeometry(0.24, 10, 10)
    const planetGeo = new THREE.SphereGeometry(1, 24, 24)
    const sunGeo = new THREE.SphereGeometry(1, 28, 28)

    function clearGalaxy() {
      galaxy.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (mesh.isMesh || (obj as THREE.Sprite).isSprite) {
          const mat = mesh.material as THREE.Material | THREE.Material[]
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
          else mat?.dispose()
          if (mesh.geometry && ![moonGeo, planetGeo, sunGeo].includes(mesh.geometry as THREE.SphereGeometry)) {
            mesh.geometry.dispose()
          }
        }
      })
      galaxy.clear()
      planets = []
      moons = []
      suns = []
      moonMesh = null
    }

    function rebuild(d: KitGalaxyData) {
      clearGalaxy()

      let totalMoons = 0
      for (const school of d.schools) {
        for (const kit of school.kits) {
          totalMoons += Math.min(kit.items.length, MOONS_PER_KIT_CAP)
        }
      }
      moonMesh = new THREE.InstancedMesh(
        moonGeo,
        new THREE.MeshBasicMaterial(),
        Math.max(totalMoons, 1)
      )
      moonMesh.userData.type = 'moons'
      galaxy.add(moonMesh)

      let moonIdx = 0
      d.schools.forEach((school, i) => {
        const spiralR = i === 0 ? 0 : 30 * Math.sqrt(i)
        const spiralA = i * 2.39996
        const sunPos = new THREE.Vector3(
          Math.cos(spiralA) * spiralR,
          0,
          Math.sin(spiralA) * spiralR
        )

        const urgent = school.kits.some((k) => k.severity === 'critical')
        const sunR = 2.1 + Math.min(school.kits.length * 0.3, 2.4)
        const sun = new THREE.Mesh(
          sunGeo,
          new THREE.MeshBasicMaterial({ color: urgent ? 0xe86a50 : 0xf5c860 })
        )
        sun.scale.setScalar(sunR)
        sun.position.copy(sunPos)
        sun.userData = { type: 'school', school, urgent }
        galaxy.add(sun)
        suns.push(sun)

        // soft glow halo
        const halo = new THREE.Mesh(
          sunGeo,
          new THREE.MeshBasicMaterial({
            color: urgent ? 0xd93025 : 0xf5c860,
            transparent: true,
            opacity: 0.16,
          })
        )
        halo.scale.setScalar(sunR * 1.7)
        halo.position.copy(sunPos)
        galaxy.add(halo)

        const label = makeLabelSprite(school.name)
        label.position.set(sunPos.x, sunR + 4.2, sunPos.z)
        galaxy.add(label)

        school.kits.forEach((kit, j) => {
          const color = kitColor(kit)
          const orbitR = sunR + 4.5 + j * 3.4

          const ring = new THREE.Mesh(
            new THREE.RingGeometry(orbitR - 0.05, orbitR + 0.05, 96),
            new THREE.MeshBasicMaterial({
              color,
              transparent: true,
              opacity: 0.22,
              side: THREE.DoubleSide,
            })
          )
          ring.rotation.x = -Math.PI / 2
          ring.position.copy(sunPos)
          galaxy.add(ring)

          const planetR = 0.85 + Math.min(1.1, Math.log10(1 + kit.units) * 0.5)
          const planet = new THREE.Mesh(
            planetGeo,
            new THREE.MeshBasicMaterial({ color })
          )
          planet.scale.setScalar(planetR)
          planet.userData = { type: 'kit', kit, school: school.name, baseScale: planetR }
          galaxy.add(planet)

          const entry: PlanetEntry = {
            mesh: planet,
            sunPos,
            orbitR,
            angle: hashAngle(kit.soNumber),
            speed:
              (0.14 / (1 + j * 0.3)) * (kit.status === 'assembling' ? 1.6 : 1),
            kit,
            school: school.name,
          }
          planets.push(entry)
          const planetIdx = planets.length - 1

          kit.items.slice(0, MOONS_PER_KIT_CAP).forEach((item, m) => {
            const done = item.fulfilled >= item.qty && item.qty > 0
            const partial = !done && item.fulfilled > 0
            moonMesh!.setColorAt(
              moonIdx,
              new THREE.Color(done ? MOON_DONE : partial ? MOON_PARTIAL : MOON_TODO)
            )
            moons.push({
              planetIdx,
              orbitR: planetR + 0.9 + (m % 6) * 0.42,
              angle: hashAngle(item.part + m),
              speed: 0.9 + (m % 5) * 0.35,
              tilt: ((m % 7) - 3) * 0.12,
              item,
              soNumber: kit.soNumber,
            })
            moonIdx++
          })
        })
      })
      if (moonMesh.instanceColor) moonMesh.instanceColor.needsUpdate = true
      moonMesh.count = moonIdx
    }

    function focusSo(q: string) {
      const needle = q.trim().toLowerCase()
      if (!needle) {
        highlightSo = null
        return
      }
      const hit = planets.find((p) =>
        p.kit.soNumber.toLowerCase().includes(needle)
      )
      if (hit) {
        highlightSo = hit.kit.soNumber
        const pos = hit.mesh.position
        focusTarget.set(pos.x, pos.y, pos.z)
        // pull the camera in if it is far out
        const dist = camera.position.distanceTo(pos)
        if (dist > 90) {
          const dir = camera.position.clone().sub(pos).normalize()
          camera.position.copy(pos.clone().add(dir.multiplyScalar(60)))
        }
      } else {
        highlightSo = null
      }
    }

    // hover + click
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    let pointerClientX = 0
    let pointerClientY = 0
    let pointerDirty = false

    function onPointerMove(e: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      pointerClientX = e.clientX - rect.left
      pointerClientY = e.clientY - rect.top
      pointerDirty = true
    }
    function pick(): THREE.Intersection | null {
      raycaster.setFromCamera(pointer, camera)
      const targets: THREE.Object3D[] = [...suns, ...planets.map((p) => p.mesh)]
      if (moonMesh) targets.push(moonMesh)
      const hits = raycaster.intersectObjects(targets, false)
      return hits[0] ?? null
    }
    function onClick() {
      const hit = pick()
      if (!hit) return
      const obj = hit.object
      if (obj.userData.type === 'school' || obj.userData.type === 'kit') {
        focusTarget.copy(
          obj.userData.type === 'school'
            ? obj.position
            : (obj as THREE.Mesh).position
        )
      }
    }
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('click', onClick)

    function updateHover() {
      if (!pointerDirty) return
      pointerDirty = false
      const hit = pick()
      if (!hit) {
        setHover(null)
        renderer.domElement.style.cursor = 'grab'
        return
      }
      renderer.domElement.style.cursor = 'pointer'
      const obj = hit.object
      if (obj.userData.type === 'school') {
        const school = obj.userData.school as { name: string; kits: GalaxyKit[] }
        const shipped = school.kits.filter((k) => k.status === 'shipped').length
        setHover({
          title: school.name,
          lines: [
            `${school.kits.length} kit order${school.kits.length > 1 ? 's' : ''} · ${shipped} shipped`,
            ...school.kits
              .slice(0, 5)
              .map((k) => `${k.soNumber} — ${k.status} · ${k.pct}%`),
            ...(school.kits.length > 5 ? [`+${school.kits.length - 5} more…`] : []),
          ],
          x: pointerClientX,
          y: pointerClientY,
        })
      } else if (obj.userData.type === 'kit') {
        const kit = obj.userData.kit as GalaxyKit
        setHover({
          title: kit.soNumber,
          lines: [
            String(obj.userData.school ?? ''),
            `${kit.status.toUpperCase()} · ${kit.pct}% assembled · ${kit.ageDays}d old`,
            `${kit.items.length} components · ${kit.unitsDone}/${kit.units} units`,
            ...(kit.severity === 'critical' ? ['⚠ OVERDUE'] : []),
            ...(kit.shippedAt
              ? [`shipped ${new Date(kit.shippedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`]
              : []),
          ],
          x: pointerClientX,
          y: pointerClientY,
        })
      } else if (obj.userData.type === 'moons' && hit.instanceId !== undefined) {
        const moon = moons[hit.instanceId]
        if (moon) {
          const it = moon.item
          setHover({
            title: it.part,
            lines: [
              it.desc ?? '',
              `${moon.soNumber} · ${Math.min(it.fulfilled, it.qty)}/${it.qty} picked`,
            ].filter(Boolean),
            x: pointerClientX,
            y: pointerClientY,
          })
        }
      }
    }

    // animation loop
    const clock = new THREE.Clock()
    const tmpMatrix = new THREE.Matrix4()
    const tmpPos = new THREE.Vector3()
    const tmpQuat = new THREE.Quaternion()
    const tmpScale = new THREE.Vector3(1, 1, 1)
    let raf = 0

    function animate() {
      raf = requestAnimationFrame(animate)
      const dt = Math.min(clock.getDelta(), 0.1)
      const t = clock.elapsedTime

      for (const p of planets) {
        p.angle += p.speed * dt
        p.mesh.position.set(
          p.sunPos.x + Math.cos(p.angle) * p.orbitR,
          p.sunPos.y,
          p.sunPos.z + Math.sin(p.angle) * p.orbitR
        )
        const base = p.mesh.userData.baseScale as number
        if (p.kit.soNumber === highlightSo) {
          p.mesh.scale.setScalar(base * (1.5 + Math.sin(t * 4) * 0.25))
        } else if (p.kit.severity === 'critical') {
          p.mesh.scale.setScalar(base * (1 + Math.sin(t * 3) * 0.14))
        } else {
          p.mesh.scale.setScalar(base)
        }
      }

      if (moonMesh) {
        for (let i = 0; i < moons.length; i++) {
          const m = moons[i]
          const p = planets[m.planetIdx]
          if (!p) continue
          const a = m.angle + t * m.speed
          tmpPos.set(
            p.mesh.position.x + Math.cos(a) * m.orbitR,
            p.mesh.position.y + Math.sin(a * 1.3) * m.tilt,
            p.mesh.position.z + Math.sin(a) * m.orbitR
          )
          tmpMatrix.compose(tmpPos, tmpQuat, tmpScale)
          moonMesh.setMatrixAt(i, tmpMatrix)
        }
        moonMesh.instanceMatrix.needsUpdate = true
      }

      for (const sun of suns) {
        if (sun.userData.urgent) {
          const s = sun.scale.x
          void s
          const base = 2.1 + Math.min((sun.userData.school.kits.length as number) * 0.3, 2.4)
          sun.scale.setScalar(base * (1 + Math.sin(t * 2.4) * 0.06))
        }
      }

      controls.target.lerp(focusTarget, 0.06)
      controls.update()
      updateHover()
      renderer.render(scene, camera)
    }

    function onResize() {
      if (!mount) return
      camera.aspect = mount.clientWidth / mount.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(mount.clientWidth, mount.clientHeight)
    }
    window.addEventListener('resize', onResize)

    rebuild(data)
    animate()

    engineRef.current = {
      rebuild,
      focusSo,
      dispose: () => {
        cancelAnimationFrame(raf)
        window.removeEventListener('resize', onResize)
        renderer.domElement.removeEventListener('pointermove', onPointerMove)
        renderer.domElement.removeEventListener('click', onClick)
        clearGalaxy()
        controls.dispose()
        renderer.dispose()
        mount.removeChild(renderer.domElement)
      },
    }
    return () => engineRef.current?.dispose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    engineRef.current?.rebuild(data)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.generatedAt])

  useEffect(() => {
    engineRef.current?.focusSo(query)
  }, [query])

  if (!webglOk) {
    return (
      <div className="flex h-full items-center justify-center font-mono text-[13px] text-slate-400">
        WebGL is not available on this display — Kit Galaxy needs it.
      </div>
    )
  }

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-white/10 bg-[#070D1B]">
      <div ref={mountRef} className="absolute inset-0" data-testid="kit-galaxy" />

      {/* stats overlay */}
      <div className="pointer-events-none absolute left-3 top-3 flex gap-2 font-mono text-[11px] font-bold uppercase tracking-wider">
        <span className="rounded bg-[#1E98D5]/20 px-2 py-1 text-[#3AACE3]">
          {data.totals.waiting} waiting
        </span>
        <span className="rounded bg-[#E89C0C]/20 px-2 py-1 text-[#F5B94E]">
          {data.totals.assembling} assembling
        </span>
        <span className="rounded bg-[#0FA62C]/20 px-2 py-1 text-[#3ECC5F]">
          {data.totals.shipped} shipped · 30d
        </span>
        <span className="rounded bg-white/10 px-2 py-1 text-slate-300">
          {data.totals.items} components
        </span>
      </div>

      {/* legend + controls hint */}
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-black/40 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-slate-300 backdrop-blur">
        <p className="mb-1 font-bold text-slate-200">
          suns = schools · planets = kits · moons = components
        </p>
        <p>
          <span className="text-[#3AACE3]">● waiting</span>
          {'  '}
          <span className="text-[#F5B94E]">● assembling</span>
          {'  '}
          <span className="text-[#3ECC5F]">● shipped</span>
          {'  '}
          <span className="text-[#FF7B6E]">● overdue (pulsing)</span>
        </p>
        <p className="mt-1 text-slate-500">
          drag to orbit · wheel to zoom · right-drag to pan · click a body to focus · hover for detail
        </p>
      </div>

      {/* hover tooltip */}
      {hover && (
        <div
          className="pointer-events-none absolute z-10 max-w-xs rounded-lg border border-white/20 bg-[#0F1A2E]/95 px-3 py-2 shadow-xl backdrop-blur"
          style={{
            left: Math.min(hover.x + 14, 9999),
            top: hover.y + 12,
          }}
          data-testid="galaxy-tooltip"
        >
          <p className="font-mono text-[13px] font-bold text-white">{hover.title}</p>
          {hover.lines.map((l, i) => (
            <p key={i} className="mt-0.5 text-[11px] leading-snug text-slate-300">
              {l}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
