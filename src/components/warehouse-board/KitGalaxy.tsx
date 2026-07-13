'use client'

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { motion, AnimatePresence } from 'motion/react'
import type {
  KitGalaxyData,
  GalaxyKit,
  GalaxySchool,
} from '@/lib/warehouse-board/galaxy-data'

// Palette (matches the board): waiting blue, assembling amber, shipped
// green, critical red. Solid moons: done green, partial amber, not-started slate.
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
type Selected =
  | { type: 'school'; school: GalaxySchool }
  | { type: 'kit'; kit: GalaxyKit; school: string }

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
  const label = text.length > 40 ? text.slice(0, 39) + '…' : text
  // shrink the font until the name actually fits the canvas
  let fontSize = 40
  ctx.font = `600 ${fontSize}px "Segoe UI", Arial, sans-serif`
  const width = ctx.measureText(label).width
  if (width > 480) {
    fontSize = Math.max(20, Math.floor((fontSize * 480) / width))
    ctx.font = `600 ${fontSize}px "Segoe UI", Arial, sans-serif`
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(0,0,0,0.9)'
  ctx.shadowBlur = 8
  // deliberately dim: keeps the text under the bloom threshold (no glow)
  ctx.fillStyle = 'rgba(168,184,196,0.92)'
  ctx.fillText(label, 256, 48)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
  )
  sprite.material.color.setScalar(0.8)
  sprite.scale.set(17, 3.2, 1)
  return sprite
}

// soft round particle sprite (Points render hard squares without a map)
function makeParticleTexture(): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,0.9)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// "New order" acknowledgements live per-display in localStorage: the beam
// burns for 24h after issue unless someone clicks the planet.
const ACK_KEY = 'wb-kit-galaxy-ack'
function readAcks(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(ACK_KEY) ?? '{}')
  } catch {
    return {}
  }
}
function writeAck(soNumber: string) {
  try {
    const map = readAcks()
    map[soNumber] = Date.now()
    for (const k of Object.keys(map)) {
      if (Date.now() - map[k] > 7 * 86400000) delete map[k]
    }
    localStorage.setItem(ACK_KEY, JSON.stringify(map))
  } catch {
    // storage unavailable (private mode) — beam just persists
  }
}
function isNewKit(kit: GalaxyKit): boolean {
  if (!kit.issuedAt) return false
  if (Date.now() - new Date(kit.issuedAt).getTime() > 86400000) return false
  return !readAcks()[kit.soNumber]
}

/** Assembly shockwave tier for a kit still on the floor:
 *  1 = ≥50% (subtle) · 2 = ≥75% (intense) · 3 = fully assembled (big + beam). */
function waveTier(kit: GalaxyKit): 0 | 1 | 2 | 3 {
  if (kit.status === 'shipped' || kit.units <= 0) return 0
  if (kit.pct >= 100) return 3
  if (kit.pct >= 75) return 2
  if (kit.pct >= 50) return 1
  return 0
}

const WAVE_CONFIG: Record<1 | 2 | 3, { period: number; max: number; peak: number; rings: number }> = {
  1: { period: 4.2, max: 3.2, peak: 0.2, rings: 1 },
  2: { period: 2.4, max: 5.0, peak: 0.36, rings: 2 },
  3: { period: 1.6, max: 7.5, peak: 0.5, rings: 3 },
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
  linkIdx: number | null
  orbitR: number
  angle: number
  speed: number
  tilt: number
  phase: number
  color: THREE.Color
  item: { part: string; desc: string | null; qty: number; fulfilled: number }
  soNumber: string
}
type StarshipEntry = {
  group: THREE.Group
  planetIdx: number
  orbitR: number
  angle: number
  speed: number
}

function makePoStarship(): THREE.Group {
  const ship = new THREE.Group()
  const hull = new THREE.Mesh(
    new THREE.ConeGeometry(0.24, 1.05, 8),
    new THREE.MeshStandardMaterial({
      color: 0xd9f4ff,
      emissive: 0x2a8fb8,
      emissiveIntensity: 0.45,
      metalness: 0.65,
      roughness: 0.28,
    })
  )
  hull.rotation.z = -Math.PI / 2
  hull.position.x = 0.12

  const wings = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.08, 0.48),
    new THREE.MeshStandardMaterial({
      color: 0x67c9eb,
      emissive: 0x164b68,
      emissiveIntensity: 0.35,
      metalness: 0.5,
      roughness: 0.32,
    })
  )
  wings.position.x = -0.12
  wings.rotation.y = Math.PI / 4

  const engine = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0x8ee9ff })
  )
  engine.position.x = -0.48

  for (const part of [hull, wings, engine]) part.raycast = () => {}
  ship.add(hull, wings, engine)
  return ship
}

function pctBar(pct: number): string {
  const filled = Math.round(pct / 10)
  return '█'.repeat(filled) + '░'.repeat(10 - filled)
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
  const [selected, setSelected] = useState<Selected | null>(null)
  const [webglOk, setWebglOk] = useState(true)
  const selectedRef = useRef<Selected | null>(null)
  selectedRef.current = selected
  const engineRef = useRef<{
    rebuild: (d: KitGalaxyData) => void
    focusSo: (q: string) => void
    dispose: () => void
  } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true })
    } catch {
      setWebglOk(false)
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x070d1b)
    scene.add(new THREE.HemisphereLight(0xdff6ff, 0x18243b, 1.65))
    const moonKeyLight = new THREE.DirectionalLight(0xffffff, 2.1)
    moonKeyLight.position.set(80, 140, 90)
    scene.add(moonKeyLight)
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
    // Left = orbit, wheel = zoom, right = pan ONLY (screen-space).
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    }
    controls.screenSpacePanning = true

    // bloom: the "everything glows" pass
    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    // Dialed way back: ambient glow is subtle; hovered/selected/new bodies
    // get their material color over-driven past the threshold, which is
    // what makes them bloom hard.
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(mount.clientWidth, mount.clientHeight),
      0.35, // strength
      0.35, // radius
      0.3 // threshold — dim things (labels, links) never bloom
    )
    composer.addPass(bloom)

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
          new THREE.PointsMaterial({
            color: 0x8fb4cc,
            size: 1.0,
            sizeAttenuation: false,
            transparent: true,
            opacity: 0.55,
          })
        )
      )
    }

    const galaxy = new THREE.Group()
    scene.add(galaxy)

    let planets: PlanetEntry[] = []
    // Every component is a solid sphere; picked/partial components also carry
    // link lines + particles into their kit.
    let moons: MoonEntry[] = []
    let moonMesh: THREE.InstancedMesh | null = null
    let suns: THREE.Mesh[] = []
    let labels: THREE.Sprite[] = []
    let linkLines: THREE.LineSegments | null = null
    let linkPositions: Float32Array | null = null
    let particles: THREE.Points | null = null
    let particlePositions: Float32Array | null = null
    let starships: StarshipEntry[] = []
    let beams: { mesh: THREE.Mesh; planetIdx: number }[] = []
    let waves: {
      mesh: THREE.Mesh
      planetIdx: number
      period: number
      offset: number
      maxScale: number
      peak: number
      baseR: number
    }[] = []
    const focusTarget = new THREE.Vector3(0, 0, 0)
    let highlightSo: string | null = null
    let hoverPaused = false
    let hoverObj: THREE.Object3D | null = null
    let hoverMoonId: number | null = null
    let boostedMoonId: number | null = null
    const particleTexture = makeParticleTexture()
    const beamGeo = new THREE.CylinderGeometry(0.35, 1.1, 70, 12, 1, true)
    const waveGeo = new THREE.RingGeometry(0.92, 1, 64)

    const moonGeo = new THREE.SphereGeometry(0.32, 16, 12)
    const planetGeo = new THREE.SphereGeometry(1, 24, 24)
    const sunGeo = new THREE.SphereGeometry(1, 28, 28)

    function clearGalaxy() {
      galaxy.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (mesh.isMesh || (obj as THREE.Sprite).isSprite || (obj as THREE.Points).isPoints) {
          const mat = mesh.material as THREE.Material | THREE.Material[]
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
          else mat?.dispose()
          if (
            mesh.geometry &&
            ![moonGeo, planetGeo, sunGeo, beamGeo, waveGeo].includes(
              mesh.geometry as THREE.SphereGeometry
            )
          ) {
            mesh.geometry.dispose()
          }
        }
      })
      galaxy.clear()
      planets = []
      moons = []
      suns = []
      labels = []
      beams = []
      waves = []
      moonMesh = null
      linkLines = null
      linkPositions = null
      particles = null
      particlePositions = null
      starships = []
      hoverObj = null
      hoverMoonId = null
      boostedMoonId = null
    }

    function rebuild(d: KitGalaxyData) {
      clearGalaxy()

      let totalMoons = 0
      let totalLinked = 0
      for (const school of d.schools) {
        for (const kit of school.kits) {
          for (const item of kit.items.slice(0, MOONS_PER_KIT_CAP)) {
            totalMoons++
            if (item.fulfilled > 0) totalLinked++
          }
        }
      }
      moonMesh = new THREE.InstancedMesh(
        moonGeo,
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          metalness: 0.08,
          roughness: 0.52,
        }),
        Math.max(totalMoons, 1)
      )
      moonMesh.userData.type = 'moons'
      galaxy.add(moonMesh)

      // moon -> planet link lines (picked/partial only; gradient moon -> planet)
      linkPositions = new Float32Array(totalLinked * 2 * 3)
      const linkColors = new Float32Array(totalLinked * 2 * 3)
      const linkGeo = new THREE.BufferGeometry()
      linkGeo.setAttribute('position', new THREE.BufferAttribute(linkPositions, 3))
      linkGeo.setAttribute('color', new THREE.BufferAttribute(linkColors, 3))
      linkLines = new THREE.LineSegments(
        linkGeo,
        new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.22,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      )
      galaxy.add(linkLines)

      // particles flowing along the links (component -> kit)
      particlePositions = new Float32Array(Math.max(totalLinked, 1) * 3)
      const particleColors = new Float32Array(Math.max(totalLinked, 1) * 3)
      const particleGeo = new THREE.BufferGeometry()
      particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3))
      particleGeo.setAttribute('color', new THREE.BufferAttribute(particleColors, 3))
      particles = new THREE.Points(
        particleGeo,
        new THREE.PointsMaterial({
          map: particleTexture,
          size: 0.9,
          sizeAttenuation: true,
          vertexColors: true,
          transparent: true,
          opacity: 0.75,
          alphaTest: 0.02,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      )
      particleGeo.setDrawRange(0, totalLinked)
      galaxy.add(particles)

      let moonIdx = 0
      let linkIdx = 0
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
        const sunColor = new THREE.Color(urgent ? 0xe86a50 : 0xf5c860)
        const sun = new THREE.Mesh(
          sunGeo,
          new THREE.MeshBasicMaterial({ color: sunColor })
        )
        sun.scale.setScalar(sunR)
        sun.position.copy(sunPos)
        sun.userData = { type: 'school', school, urgent, baseColor: sunColor.clone() }
        galaxy.add(sun)
        suns.push(sun)

        const halo = new THREE.Mesh(
          sunGeo,
          new THREE.MeshBasicMaterial({
            color: urgent ? 0xd93025 : 0xf5c860,
            transparent: true,
            opacity: 0.14,
            depthWrite: false,
          })
        )
        halo.scale.setScalar(sunR * 1.8)
        halo.position.copy(sunPos)
        galaxy.add(halo)

        const label = makeLabelSprite(school.name)
        label.position.set(sunPos.x, sunR + 4.2, sunPos.z)
        galaxy.add(label)
        labels.push(label)

        school.kits.forEach((kit, j) => {
          const color = kitColor(kit)
          const orbitR = sunR + 4.5 + j * 3.4

          const ring = new THREE.Mesh(
            new THREE.RingGeometry(orbitR - 0.05, orbitR + 0.05, 96),
            new THREE.MeshBasicMaterial({
              color,
              transparent: true,
              opacity: 0.2,
              side: THREE.DoubleSide,
              depthWrite: false,
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
          const isNew = isNewKit(kit)
          const tier = waveTier(kit)
          const assembledUnacked =
            tier === 3 && !readAcks()['asm:' + kit.soNumber]
          planet.userData = {
            type: 'kit',
            kit,
            school: school.name,
            baseScale: planetR,
            baseColor: new THREE.Color(color),
            isNew,
            assembledUnacked,
          }
          galaxy.add(planet)

          // Beam announcements (one per planet, assembled wins):
          // green = fully assembled & ready to ship, blue = new order (24h)
          if (assembledUnacked || isNew) {
            const beam = new THREE.Mesh(
              beamGeo,
              new THREE.MeshBasicMaterial({
                color: assembledUnacked ? 0xa9f5c4 : 0xcfe9ff,
                transparent: true,
                opacity: 0.28,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
              })
            )
            beam.userData.isBeam = true
            galaxy.add(beam)
            beams.push({ mesh: beam, planetIdx: planets.length })
          }

          // assembly-progress shockwaves (50% / 75% / 100% tiers)
          if (tier !== 0) {
            const cfg = WAVE_CONFIG[tier]
            for (let w = 0; w < cfg.rings; w++) {
              const wave = new THREE.Mesh(
                waveGeo,
                new THREE.MeshBasicMaterial({
                  color,
                  transparent: true,
                  opacity: 0,
                  side: THREE.DoubleSide,
                  blending: THREE.AdditiveBlending,
                  depthWrite: false,
                })
              )
              wave.rotation.x = -Math.PI / 2
              wave.raycast = () => {} // decorative — never block hover picks
              galaxy.add(wave)
              waves.push({
                mesh: wave,
                planetIdx: planets.length,
                period: cfg.period,
                offset: (w / cfg.rings) * cfg.period,
                maxScale: cfg.max,
                peak: cfg.peak,
                baseR: planetR,
              })
            }
          }

          planets.push({
            mesh: planet,
            sunPos,
            orbitR,
            angle: hashAngle(kit.soNumber),
            speed:
              (0.14 / (1 + j * 0.3)) * (kit.status === 'assembling' ? 1.6 : 1),
            kit,
            school: school.name,
          })
          const planetIdx = planets.length - 1
          const planetColor = new THREE.Color(color)

          if (kit.hasPo) {
            const group = makePoStarship()
            galaxy.add(group)
            starships.push({
              group,
              planetIdx,
              orbitR: planetR + 4.2,
              angle: hashAngle(`po:${kit.soNumber}`),
              speed: 0.34,
            })
          }

          kit.items.slice(0, MOONS_PER_KIT_CAP).forEach((item, m) => {
            const done = item.fulfilled >= item.qty && item.qty > 0
            const partial = !done && item.fulfilled > 0
            const entry: MoonEntry = {
              planetIdx,
              linkIdx: done || partial ? linkIdx : null,
              orbitR: planetR + 0.9 + (m % 6) * 0.42,
              angle: hashAngle(item.part + m),
              // halved from v1 — moons drift, not race
              speed: 0.45 + (m % 5) * 0.175,
              tilt: ((m % 7) - 3) * 0.12,
              phase: (m * 0.37) % 1,
              color: new THREE.Color(
                done ? MOON_DONE : partial ? MOON_PARTIAL : MOON_TODO
              ),
              item,
              soNumber: kit.soNumber,
            }
            moonMesh!.setColorAt(moonIdx, entry.color)
            if (done || partial) {
              // link gradient: moon end gets moon color, planet end planet color
              entry.color.toArray(linkColors, linkIdx * 6)
              planetColor.toArray(linkColors, linkIdx * 6 + 3)
              entry.color.toArray(particleColors, linkIdx * 3)
              linkIdx++
            }
            moons.push(entry)
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
      raycaster.params.Points.threshold = 0.6
      const targets: THREE.Object3D[] = [...suns, ...planets.map((p) => p.mesh)]
      if (moonMesh) targets.push(moonMesh)
      const hits = raycaster.intersectObjects(targets, false)
      return hits[0] ?? null
    }
    function onClick() {
      const hit = pick()
      if (!hit) {
        setSelected(null)
        return
      }
      const obj = hit.object
      if (obj.userData.type === 'school') {
        focusTarget.copy(obj.position)
        setSelected({ type: 'school', school: obj.userData.school })
      } else if (obj.userData.type === 'kit') {
        focusTarget.copy((obj as THREE.Mesh).position)
        setSelected({
          type: 'kit',
          kit: obj.userData.kit,
          school: obj.userData.school,
        })
        if (obj.userData.isNew || obj.userData.assembledUnacked) {
          // acknowledge the announcement: kill the beam on this display
          const so = (obj.userData.kit as GalaxyKit).soNumber
          if (obj.userData.isNew) writeAck(so)
          if (obj.userData.assembledUnacked) writeAck('asm:' + so)
          obj.userData.isNew = false
          obj.userData.assembledUnacked = false
          const idx = planets.findIndex((p) => p.mesh === obj)
          beams = beams.filter((b) => {
            if (b.planetIdx !== idx) return true
            galaxy.remove(b.mesh)
            ;(b.mesh.material as THREE.Material).dispose()
            return false
          })
        }
      }
    }
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('click', onClick)

    function updateHover() {
      if (!pointerDirty) return
      pointerDirty = false
      const hit = pick()
      if (!hit) {
        hoverPaused = false
        hoverObj = null
        hoverMoonId = null
        setHover(null)
        renderer.domElement.style.cursor = 'grab'
        return
      }
      hoverPaused = true
      renderer.domElement.style.cursor = 'pointer'
      const obj = hit.object
      hoverObj = obj.userData.type === 'moons' ? null : obj
      hoverMoonId =
        obj.userData.type === 'moons' && hit.instanceId !== undefined
          ? hit.instanceId
          : null
      if (obj.userData.type === 'school') {
        const school = obj.userData.school as GalaxySchool
        const shipped = school.kits.filter((k) => k.status === 'shipped').length
        setHover({
          title: school.name,
          lines: [
            `${school.kits.length} kit order${school.kits.length > 1 ? 's' : ''} · ${shipped} shipped · click for detail`,
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
            `${kit.status.toUpperCase()} · ${kit.pct}% assembled · ${kit.ageDays}d old · click for detail`,
            ...(kit.shipBy
              ? [`ship by ${kit.shipBy}${kit.tableLocation ? ` · table ${kit.tableLocation}` : ''}`]
              : kit.tableLocation
                ? [`table ${kit.tableLocation}`]
                : []),
            ...(kit.hasPo ? ['PO on file · starship in orbit'] : []),
            ...(kit.severity === 'critical'
              ? [kit.dueBased ? '⚠ LATE FOR SCHOOL NEED-BY' : '⚠ OVERDUE (age)']
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

    // animation loop — simTime only advances while not suspended
    const clock = new THREE.Clock()
    let simTime = 0
    const tmpMatrix = new THREE.Matrix4()
    const tmpPos = new THREE.Vector3()
    const tmpQuat = new THREE.Quaternion()
    const tmpScale = new THREE.Vector3(1, 1, 1)
    let raf = 0

    function animate() {
      raf = requestAnimationFrame(animate)
      const dt = Math.min(clock.getDelta(), 0.1)
      const t = clock.elapsedTime
      const suspended = hoverPaused || selectedRef.current !== null
      if (!suspended) simTime += dt

      const sel = selectedRef.current
      const selSo = sel?.type === 'kit' ? sel.kit.soNumber : null
      const selSchool = sel?.type === 'school' ? sel.school.name : null

      for (const p of planets) {
        if (!suspended) p.angle += p.speed * dt
        p.mesh.position.set(
          p.sunPos.x + Math.cos(p.angle) * p.orbitR,
          p.sunPos.y,
          p.sunPos.z + Math.sin(p.angle) * p.orbitR
        )
        const base = p.mesh.userData.baseScale as number
        const isNew =
          p.mesh.userData.isNew === true ||
          p.mesh.userData.assembledUnacked === true
        if (p.kit.soNumber === highlightSo || isNew) {
          p.mesh.scale.setScalar(base * (1.35 + Math.sin(t * 3.2) * 0.2))
        } else if (p.kit.severity === 'critical') {
          p.mesh.scale.setScalar(base * (1 + Math.sin(t * 3) * 0.14))
        } else {
          p.mesh.scale.setScalar(base)
        }
        // brightness drives bloom: hovered/selected/new planets over-drive
        // their color past the bloom threshold; everything else stays calm
        const baseColor = p.mesh.userData.baseColor as THREE.Color
        const mat = p.mesh.material as THREE.MeshBasicMaterial
        const boosted =
          hoverObj === p.mesh || p.kit.soNumber === selSo || isNew
        mat.color
          .copy(baseColor)
          .multiplyScalar(boosted ? 2.4 + Math.sin(t * 2.8) * 0.5 : 1)
      }

      // moon hover highlight (instanced color over-drive)
      if (moonMesh && hoverMoonId !== boostedMoonId) {
        if (boostedMoonId !== null && moons[boostedMoonId]) {
          moonMesh.setColorAt(boostedMoonId, moons[boostedMoonId].color)
        }
        if (hoverMoonId !== null && moons[hoverMoonId]) {
          moonMesh.setColorAt(
            hoverMoonId,
            moons[hoverMoonId].color.clone().multiplyScalar(2.6)
          )
        }
        boostedMoonId = hoverMoonId
        if (moonMesh.instanceColor) moonMesh.instanceColor.needsUpdate = true
      }

      if (moonMesh && linkPositions && particlePositions) {
        for (let i = 0; i < moons.length; i++) {
          const m = moons[i]
          const p = planets[m.planetIdx]
          if (!p) continue
          const a = m.angle + simTime * m.speed
          const mx = p.mesh.position.x + Math.cos(a) * m.orbitR
          const my = p.mesh.position.y + Math.sin(a * 1.3) * m.tilt
          const mz = p.mesh.position.z + Math.sin(a) * m.orbitR
          tmpPos.set(mx, my, mz)
          // Counteract perspective shrinkage at long camera distances while
          // keeping close-up moons subordinate to their planet.
          const moonScale = THREE.MathUtils.clamp(
            camera.position.distanceTo(tmpPos) / 150,
            1,
            4
          )
          tmpScale.setScalar(moonScale)
          tmpMatrix.compose(tmpPos, tmpQuat, tmpScale)
          moonMesh.setMatrixAt(i, tmpMatrix)

          if (m.linkIdx === null) continue
          const li = m.linkIdx
          // link line: moon -> planet
          linkPositions[li * 6] = mx
          linkPositions[li * 6 + 1] = my
          linkPositions[li * 6 + 2] = mz
          linkPositions[li * 6 + 3] = p.mesh.position.x
          linkPositions[li * 6 + 4] = p.mesh.position.y
          linkPositions[li * 6 + 5] = p.mesh.position.z

          // particle flowing from component into the kit
          const f = (simTime * 0.35 + m.phase) % 1
          particlePositions[li * 3] = mx + (p.mesh.position.x - mx) * f
          particlePositions[li * 3 + 1] = my + (p.mesh.position.y - my) * f
          particlePositions[li * 3 + 2] = mz + (p.mesh.position.z - mz) * f
        }
        moonMesh.instanceMatrix.needsUpdate = true
        if (linkLines) {
          ;(linkLines.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
        }
        if (particles) {
          ;(particles.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true
        }
      }

      // A customer PO is represented by one ship circling outside the moon band.
      for (const ship of starships) {
        const p = planets[ship.planetIdx]
        if (!p) continue
        const a = ship.angle + simTime * ship.speed
        ship.group.position.set(
          p.mesh.position.x + Math.cos(a) * ship.orbitR,
          p.mesh.position.y + 0.65 + Math.sin(a * 2) * 0.25,
          p.mesh.position.z + Math.sin(a) * ship.orbitR
        )
        ship.group.rotation.y = -a - Math.PI / 2
        const shipScale = THREE.MathUtils.clamp(
          camera.position.distanceTo(ship.group.position) / 155,
          1,
          3.6
        )
        ship.group.scale.setScalar(shipScale)
      }

      for (const sun of suns) {
        const school = sun.userData.school as GalaxySchool
        if (sun.userData.urgent) {
          const base = 2.1 + Math.min(school.kits.length * 0.3, 2.4)
          sun.scale.setScalar(base * (1 + Math.sin(t * 2.4) * 0.06))
        }
        const baseColor = sun.userData.baseColor as THREE.Color
        const mat = sun.material as THREE.MeshBasicMaterial
        const boosted = hoverObj === sun || school.name === selSchool
        mat.color.copy(baseColor).multiplyScalar(boosted ? 2.2 : 1)
      }

      // announcement beams track their planet and shimmer
      for (const b of beams) {
        const p = planets[b.planetIdx]
        if (!p) continue
        b.mesh.position.set(
          p.mesh.position.x,
          p.mesh.position.y + 35,
          p.mesh.position.z
        )
        const mat = b.mesh.material as THREE.MeshBasicMaterial
        mat.opacity = 0.22 + Math.sin(t * 2.6) * 0.1
      }

      // assembly shockwaves: expanding, fading rings around the planet
      for (const w of waves) {
        const p = planets[w.planetIdx]
        if (!p) continue
        const phase = ((t + w.offset) % w.period) / w.period
        w.mesh.position.copy(p.mesh.position)
        w.mesh.scale.setScalar(w.baseR * (1.3 + phase * w.maxScale))
        ;(w.mesh.material as THREE.MeshBasicMaterial).opacity =
          w.peak * (1 - phase) * (1 - phase)
      }

      // labels keep near-constant screen size: scale with camera distance
      for (const label of labels) {
        const dist = camera.position.distanceTo(label.position)
        const s = THREE.MathUtils.clamp(dist / 130, 0.6, 4.5)
        label.scale.set(17 * s, 3.2 * s, 1)
      }

      controls.target.lerp(focusTarget, 0.06)
      controls.update()
      updateHover()
      composer.render()
    }

    function onResize() {
      if (!mount) return
      camera.aspect = mount.clientWidth / mount.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(mount.clientWidth, mount.clientHeight)
      composer.setSize(mount.clientWidth, mount.clientHeight)
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
        composer.dispose()
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
          {'  '}
          <span className="text-slate-400">● solid gray moon = not picked</span>
        </p>
        <p className="mt-0.5 text-slate-500">
          shockwaves = 50% / 75% / 100% assembled · green beam = ready to ship ·
          blue beam = new order · ▲ starship = PO on file
        </p>
        <p className="mt-1 text-slate-500">
          drag to orbit · wheel to zoom · right-drag to pan · click a body for
          details · hover pauses motion
        </p>
      </div>

      {/* hover tooltip */}
      {hover && (
        <div
          className="pointer-events-none absolute z-10 max-w-xs rounded-lg border border-white/20 bg-[#0F1A2E]/95 px-3 py-2 shadow-xl backdrop-blur"
          style={{ left: hover.x + 14, top: hover.y + 12 }}
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

      {/* detail pop-out panel (translucent) */}
      <AnimatePresence>
        {selected && (
          <motion.aside
            key={selected.type === 'kit' ? selected.kit.soNumber : selected.school.name}
            initial={{ x: 60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 60, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="absolute bottom-3 right-3 top-3 z-20 flex w-[340px] flex-col rounded-xl border border-white/15 bg-[#0F1A2E]/75 shadow-2xl backdrop-blur-md"
            data-testid="galaxy-panel"
          >
            <header className="flex items-start justify-between gap-2 border-b border-white/10 p-4">
              <div className="min-w-0">
                <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-slate-400">
                  {selected.type === 'school' ? 'School system' : 'Kit order'}
                </p>
                <h3 className="mt-0.5 break-words font-mono text-[16px] font-bold text-white">
                  {selected.type === 'school'
                    ? selected.school.name
                    : selected.kit.soNumber}
                </h3>
                {selected.type === 'kit' && (
                  <>
                    <p className="mt-0.5 truncate text-[11px] text-slate-400">
                      {selected.school}
                    </p>
                    {selected.kit.hasPo && (
                      <p className="mt-1 font-mono text-[9px] font-bold uppercase tracking-wider text-[#8EE9FF]">
                        ▲ starship · PO on file
                      </p>
                    )}
                  </>
                )}
              </div>
              <button
                onClick={() => setSelected(null)}
                className="rounded border border-white/15 px-2 py-1 font-mono text-[10px] font-bold uppercase text-slate-400 transition-colors hover:border-[#D93025] hover:text-[#FF7B6E]"
                data-testid="galaxy-panel-close"
              >
                esc ✕
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {selected.type === 'school' ? (
                <>
                  <p className="mb-3 font-mono text-[11px] uppercase tracking-wider text-slate-400">
                    {selected.school.kits.length} kit orders
                  </p>
                  <div className="flex flex-col gap-2">
                    {selected.school.kits.map((k) => (
                      <button
                        key={k.soNumber}
                        onClick={() =>
                          setSelected({
                            type: 'kit',
                            kit: k,
                            school: selected.school.name,
                          })
                        }
                        className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-left transition-colors hover:border-white/30"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[13px] font-bold text-white">
                            {k.hasPo ? '▲ ' : ''}{k.soNumber}
                          </span>
                          <span
                            className="rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase"
                            style={{
                              color: `#${kitColor(k).toString(16).padStart(6, '0')}`,
                              background: `#${kitColor(k).toString(16).padStart(6, '0')}22`,
                            }}
                          >
                            {k.severity === 'critical' ? 'overdue' : k.status}
                          </span>
                        </div>
                        <p className="mt-1 font-mono text-[10px] text-slate-400">
                          {pctBar(k.pct)} {k.pct}% · {k.ageDays}d ·{' '}
                          {k.items.length} components
                        </p>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="mb-3 grid grid-cols-2 gap-2 font-mono text-[11px]">
                    <div className="rounded-lg bg-white/[0.05] px-2.5 py-2">
                      <p className="text-[9px] uppercase tracking-wider text-slate-500">
                        Status
                      </p>
                      <p
                        className="mt-0.5 font-bold uppercase"
                        style={{
                          color: `#${kitColor(selected.kit).toString(16).padStart(6, '0')}`,
                        }}
                      >
                        {selected.kit.severity === 'critical'
                          ? 'overdue'
                          : selected.kit.status}
                      </p>
                    </div>
                    <div className="rounded-lg bg-white/[0.05] px-2.5 py-2">
                      <p className="text-[9px] uppercase tracking-wider text-slate-500">
                        Age
                      </p>
                      <p className="mt-0.5 font-bold text-white">
                        {selected.kit.ageDays}d
                      </p>
                    </div>
                    <div className="rounded-lg bg-white/[0.05] px-2.5 py-2">
                      <p className="text-[9px] uppercase tracking-wider text-slate-500">
                        Assembled
                      </p>
                      <p className="mt-0.5 font-bold text-white">
                        {selected.kit.pct}% · {fmt(selected.kit.unitsDone)}/
                        {fmt(selected.kit.units)} units
                      </p>
                    </div>
                    <div className="rounded-lg bg-white/[0.05] px-2.5 py-2">
                      <p className="text-[9px] uppercase tracking-wider text-slate-500">
                        {selected.kit.shippedAt ? 'Shipped' : 'Components'}
                      </p>
                      <p className="mt-0.5 font-bold text-white">
                        {selected.kit.shippedAt
                          ? new Date(selected.kit.shippedAt).toLocaleDateString(
                              'en-US',
                              { month: 'short', day: 'numeric' }
                            )
                          : selected.kit.items.length}
                      </p>
                    </div>
                    <div className="rounded-lg bg-white/[0.05] px-2.5 py-2">
                      <p className="text-[9px] uppercase tracking-wider text-slate-500">
                        Ship by · need-by
                      </p>
                      <p className="mt-0.5 font-bold text-white">
                        {selected.kit.shipBy
                          ? `${selected.kit.shipBy.slice(5).replace('-', '/')} · ${selected.kit.needBy?.slice(5).replace('-', '/') ?? '—'}`
                          : 'set in Kit Assembly'}
                      </p>
                    </div>
                    <div className="rounded-lg bg-white/[0.05] px-2.5 py-2">
                      <p className="text-[9px] uppercase tracking-wider text-slate-500">
                        Table · rep · kit list
                      </p>
                      <p className="mt-0.5 font-bold text-white">
                        {selected.kit.tableLocation ?? '—'} ·{' '}
                        {selected.kit.rep ?? '—'} ·{' '}
                        {selected.kit.kitListPrinted ? '✓' : '✗'}
                      </p>
                    </div>
                  </div>
                  <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-slate-400">
                    Components ({selected.kit.items.length})
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {selected.kit.items.map((it, idx) => {
                      const done = it.fulfilled >= it.qty && it.qty > 0
                      const partial = !done && it.fulfilled > 0
                      return (
                        <div
                          key={idx}
                          className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-mono text-[11px] font-bold text-white">
                              {it.part}
                            </span>
                            <span
                              className={`shrink-0 font-mono text-[10px] font-bold ${
                                done
                                  ? 'text-[#3ECC5F]'
                                  : partial
                                    ? 'text-[#F5B94E]'
                                    : 'text-slate-500'
                              }`}
                            >
                              {Math.min(it.fulfilled, it.qty)}/{it.qty}
                            </span>
                          </div>
                          {it.desc && (
                            <p className="mt-0.5 truncate text-[10px] text-slate-400">
                              {it.desc}
                            </p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
            <footer className="border-t border-white/10 px-4 py-2">
              <p className="font-mono text-[9px] uppercase tracking-wider text-slate-500">
                motion paused while open · esc or click empty space to close
              </p>
            </footer>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  )
}

function fmt(n: number): string {
  return Number.isInteger(n)
    ? String(n)
    : n.toLocaleString('en-US', { maximumFractionDigits: 1 })
}
