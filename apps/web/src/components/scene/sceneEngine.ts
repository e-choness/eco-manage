import type * as Three from "three"
import { buildingPlan, type FlowKey, type Point2, type SceneFlow, type SceneFlows, type SceneView, type SiteModel, type Vec3 } from "@ecomanage/shared"
import { FLOW_COLOURS } from "./flowColours"

// Port of the App v2 prototype's site-scene.js (P4-03). The static site (ground, building, roof
// array and one device per anchor) is built once per theme and model; flows and labels follow the
// live data through setFlows(). three.js is loaded on demand, so pages without the scene don't
// pay for it.

const PAL = {
  dark: { ground: 0x0b1120, pad: 0x101a2e, grid: 0x19243c, body: 0x1a2439, edge: 0x3b4f78, panel: 0x234684, win: 0x0d1424, winE: 0x1a1a10, device: 0x212c45, car: 0x2a3653, dim: 0x27324b, sky: 0x9db8ff, gl: 0x080c16, fog: 0x0a0f1c, hemi: 0.85, sun: 1.1, pathOp: 0.22, text: "#e8ecf4", sub: "#8d9bb5", lbg: "rgba(11,17,31,.74)", lbd: "rgba(140,165,215,.18)" },
  light: { ground: 0xe4e7ec, pad: 0xeff1f4, grid: 0xd3d8e0, body: 0xfbfbfc, edge: 0xb4bcc9, panel: 0x2d5093, win: 0xc3cedf, winE: 0x000000, device: 0xe6e9ef, car: 0xcbd2dc, dim: 0xcfd5de, sky: 0xffffff, gl: 0xc9cfd8, fog: 0xeef1f5, hemi: 1.05, sun: 1.5, pathOp: 0.4, text: "#172031", sub: "#566174", lbg: "rgba(255,255,255,.88)", lbd: "rgba(20,30,50,.12)" },
} as const


const DEMO_PAD: Point2 = [19, 10.5] // the paved area under an uploaded model
const MAX_PANEL_BOXES = 300 // more panels than this are drawn as one instanced mesh

const VIEWS: Record<SceneView, { r: number; el: number; th: number; ty: number; fit?: number }> = {
  iso: { r: 31, el: 32, th: 38, ty: 0.4 },
  wide: { r: 33, el: 29, th: 36, ty: -0.6 },
  far: { r: 38, el: 32, th: 38, ty: 0.2 },
  farther: { r: 44, el: 32, th: 38, ty: 0.2 },
  fit: { r: 34, el: 32, th: 38, ty: 0.2, fit: 1.0 },
  side: { r: 30, el: 26, th: 30, ty: 0.6 },
}

export interface SceneOptions {
  theme: "dark" | "light"
  model: SiteModel
  view?: SceneView
  labels?: boolean
  safeLeft?: number // px kept clear for panels on the left / right; the site centres in between
  safeRight?: number
  shiftX?: number // fraction of the width / height
  shiftY?: number
  /** Called with the point clicked on the site (a click, not a drag). */
  onPick?: (p: Vec3) => void
}

export interface SceneHandle {
  setFlows(flows: SceneFlows): void
  dispose(): void
}

/** Whether this browser can draw WebGL (the 2D fallback is used otherwise). */
export const hasWebGL = (): boolean => {
  try {
    const canvas = document.createElement("canvas")
    return !!(window.WebGLRenderingContext && (canvas.getContext("webgl2") || canvas.getContext("webgl")))
  } catch {
    return false
  }
}

/**
 * An uploaded site model (P5-02): a GLB with Draco meshes and KTX2 textures, decoded by the files
 * the app serves under /decoders. Its URL changes with every upload, so the browser can cache it.
 */
// One loader for the page: the decoders are workers, and three.js wants a single KTX2 loader.
let gltfLoader: Promise<import("three/examples/jsm/loaders/GLTFLoader.js").GLTFLoader> | null = null
const loadUploadedModel = async (renderer: Three.WebGLRenderer, url: string) => {
  gltfLoader ??= (async () => {
    const [{ GLTFLoader }, { DRACOLoader }, { KTX2Loader }] = await Promise.all([
      import("three/examples/jsm/loaders/GLTFLoader.js"),
      import("three/examples/jsm/loaders/DRACOLoader.js"),
      import("three/examples/jsm/loaders/KTX2Loader.js"),
    ])
    const draco = new DRACOLoader().setDecoderPath("/decoders/draco/")
    // The texture formats this GPU can take are the same for every renderer on the page.
    const ktx2 = new KTX2Loader().setTranscoderPath("/decoders/basis/").detectSupport(renderer)
    return new GLTFLoader().setDRACOLoader(draco).setKTX2Loader(ktx2)
  })()
  return (await gltfLoader).loadAsync(url)
}

type Label = { el: HTMLDivElement; at: Three.Vector3; key: FlowKey | "building" }
type Flow = { curve: Three.QuadraticBezierCurve3; core: Three.InstancedMesh; halo: Three.InstancedMesh; n: number; speed: number; out: boolean }

export async function createScene(host: HTMLElement, opts: SceneOptions, initial: SceneFlows): Promise<SceneHandle> {
  const T = await import("three")
  const P = PAL[opts.theme]
  const V = VIEWS[opts.view ?? opts.model.camera.view] ?? VIEWS.fit
  const safeL = opts.safeLeft ?? 0
  const safeR = opts.safeRight ?? 0
  const ox = opts.shiftX ?? 0
  const oy = opts.shiftY ?? 0
  const anchors = opts.model.anchors
  const anchorOf = (key: FlowKey) => anchors.find((a) => a.key === key)

  let w = host.clientWidth || 800
  let h = host.clientHeight || 600
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
  renderer.setSize(w, h, false)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = T.PCFSoftShadowMap
  const canvas = renderer.domElement
  Object.assign(canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", display: "block", cursor: opts.onPick ? "crosshair" : "grab" })
  canvas.setAttribute("aria-hidden", "true")
  host.appendChild(canvas)

  const scene = new T.Scene()
  scene.fog = new T.Fog(P.fog, 45, 110)
  const camera = new T.PerspectiveCamera(30, w / h, 0.1, 200)
  const setOffset = () => {
    camera.aspect = w / h
    camera.setViewOffset(w, h, -(ox * w + (safeL - safeR) / 2), -oy * h, w, h)
    camera.updateProjectionMatrix()
  }
  setOffset()

  scene.add(new T.HemisphereLight(P.sky, P.gl, P.hemi))
  const sun = new T.DirectionalLight(0xffffff, P.sun)
  sun.position.set(9, 15, 7)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14 })
  sun.shadow.radius = 4
  scene.add(sun)

  const ground = new T.Mesh(new T.PlaneGeometry(400, 400), new T.MeshStandardMaterial({ color: P.ground, roughness: 1 }))
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)
  const grid = new T.GridHelper(120, 120, P.grid, P.grid)
  grid.position.y = 0.004
  const gridMat = grid.material as Three.Material
  gridMat.transparent = true
  gridMat.opacity = 0.6
  scene.add(grid)

  type BoxOpts = { r?: number; e?: number | string; ei?: number; edge?: boolean; cast?: boolean }
  const box = (sx: number, sy: number, sz: number, color: number | string, x: number, y: number, z: number, o: BoxOpts = {}, parent: Three.Object3D = scene) => {
    const m = new T.Mesh(
      new T.BoxGeometry(sx, sy, sz),
      new T.MeshStandardMaterial({ color, roughness: o.r ?? 0.75, metalness: 0.05, emissive: o.e ?? 0x000000, emissiveIntensity: o.ei ?? 1 })
    )
    m.position.set(x, y, z)
    m.castShadow = o.cast !== false
    m.receiveShadow = true
    if (o.edge !== false) m.add(new T.LineSegments(new T.EdgesGeometry(m.geometry), new T.LineBasicMaterial({ color: P.edge, transparent: true, opacity: 0.55 })))
    parent.add(m)
    return m
  }

  // The building: an uploaded model when the site has one (P5-02), else the generated one (P5-03)
  // with its roof array. Everything else (devices, flows, labels) comes from the anchors either way.
  const plan = buildingPlan(opts.model.generated)
  const upload = opts.model.source === "upload" ? opts.model.upload : null
  let uploaded = false
  if (upload) {
    try {
      const gltf = await loadUploadedModel(renderer, upload.glbUrl)
      gltf.scene.traverse((o) => {
        if ((o as Three.Mesh).isMesh) o.castShadow = o.receiveShadow = true
      })
      scene.add(gltf.scene)
      uploaded = true
    } catch (err) {
      console.warn("The uploaded site model couldn't be loaded; showing the generated building.", err)
    }
  }
  if (!uploaded) {
    // Its outline raised to its height (the shape is drawn in x, −z, then stood up), a band of
    // windows per storey on the walls facing south, and the roof array when the site has solar.
    const outline = new T.Shape(plan.footprint.map(([x, z]) => new T.Vector2(x, -z)))
    const body = new T.Mesh(new T.ExtrudeGeometry(outline, { depth: plan.height, bevelEnabled: false }), new T.MeshStandardMaterial({ color: P.body, roughness: 0.75, metalness: 0.05 }))
    body.rotation.x = -Math.PI / 2
    body.castShadow = body.receiveShadow = true
    body.add(new T.LineSegments(new T.EdgesGeometry(body.geometry), new T.LineBasicMaterial({ color: P.edge, transparent: true, opacity: 0.55 })))
    scene.add(body)
    for (const win of plan.windows) box(win.length, 0.5, 0.02, P.win, ...win.at, { e: P.winE, edge: false, cast: false }).rotation.y = win.heading
    if (anchorOf("pv")) {
      const panelOpts = { r: 0.35, e: opts.theme === "dark" ? 0x0c1a38 : 0 }
      if (plan.panels.length <= MAX_PANEL_BOXES) for (const [x, y, z] of plan.panels) box(0.98, 0.06, 1.02, P.panel, x, y, z, panelOpts).rotation.x = -plan.tiltRad
      else {
        // A big roof: one instanced mesh, without the outlines.
        const mesh = new T.InstancedMesh(new T.BoxGeometry(0.98, 0.06, 1.02), new T.MeshStandardMaterial({ color: P.panel, roughness: 0.35, metalness: 0.05, emissive: panelOpts.e }), plan.panels.length)
        const tilt = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), -plan.tiltRad)
        plan.panels.forEach(([x, y, z], i) => mesh.setMatrixAt(i, new T.Matrix4().compose(new T.Vector3(x, y, z), tilt, new T.Vector3(1, 1, 1))))
        mesh.castShadow = mesh.receiveShadow = true
        scene.add(mesh)
      }
    }
  }
  const [padW, padD] = uploaded ? DEMO_PAD : plan.pad.size
  const pad = new T.Mesh(new T.PlaneGeometry(padW, padD), new T.MeshStandardMaterial({ color: P.pad, roughness: 1 }))
  pad.rotation.x = -Math.PI / 2
  if (!uploaded) pad.position.set(plan.pad.center[0], 0.002, plan.pad.center[1])
  else pad.position.y = 0.002
  pad.receiveShadow = true
  scene.add(pad)
  // Camera, shadows and fog are set for the ~20 m demo site; a bigger building scales them.
  const bb = uploaded && upload ? upload.bbox : null
  const k = bb ? Math.max(1, Math.max(bb.max[0] - bb.min[0], bb.max[2] - bb.min[2], (bb.max[1] - bb.min[1]) * 2) / 20) : uploaded ? 1 : plan.scale
  if (k > 1) {
    Object.assign(sun.shadow.camera, { left: -14 * k, right: 14 * k, top: 14 * k, bottom: -14 * k, far: 500 * k })
    sun.position.multiplyScalar(k)
    scene.fog = new T.Fog(P.fog, 45 * k, 110 * k)
    camera.far = 200 * k
    ground.scale.setScalar(Math.max(1, k / 2))
    if (uploaded) pad.visible = false
  }
  const [hx0, , hz0] = opts.model.hub
  box(0.7, 1.1, 0.35, P.device, hx0, 0.55, hz0 - 0.28)

  // One device per anchor, standing where its flow starts.
  const socBars = new T.Group()
  scene.add(socBars)
  let fanBlades: Three.Group | null = null
  const bat = anchorOf("battery")
  if (bat) box(1.7, 1.3, 0.9, P.device, bat.at[0], 0.65, bat.at[2])
  const gridA = anchorOf("grid")
  if (gridA) {
    const [gx, , gz] = gridA.at
    box(1.1, 1.0, 1.0, P.device, gx, 0.5, gz)
    const pole = new T.Mesh(new T.CylinderGeometry(0.07, 0.1, 4.2, 12), new T.MeshStandardMaterial({ color: P.device, roughness: 0.8 }))
    pole.position.set(gx - 1.1, 2.1, gz)
    pole.castShadow = true
    scene.add(pole)
    box(1.5, 0.08, 0.08, P.device, gx - 1.1, 3.9, gz)
  }
  const ev = anchorOf("ev")
  if (ev) {
    const ex = ev.at[0] + 0.8
    const ez = ev.at[2]
    for (const dx of [-0.8, 0.8]) box(0.32, 1.3, 0.24, P.device, ex + dx, 0.65, ez)
    box(0.95, 0.5, 1.9, P.car, ex - 0.8, 0.3, ez + 1.35)
    box(0.82, 0.38, 0.95, P.car, ex - 0.8, 0.74, ez + 1.25)
  }
  const hp = anchorOf("heatpump")
  if (hp) {
    const [px, , pz] = hp.at
    box(1.4, 1.0, 0.7, P.device, px, 0.5, pz)
    const fan = new T.Group()
    fan.position.set(px, 0.5, pz + 0.37)
    scene.add(fan)
    const ring = new T.Mesh(new T.CylinderGeometry(0.36, 0.36, 0.03, 32), new T.MeshStandardMaterial({ color: P.dim }))
    ring.rotation.x = Math.PI / 2
    fan.add(ring)
    fanBlades = new T.Group()
    fanBlades.position.z = 0.03
    fan.add(fanBlades)
    for (const r of [0, Math.PI / 2]) {
      const b = new T.Mesh(new T.BoxGeometry(0.6, 0.08, 0.02), new T.MeshStandardMaterial({ color: FLOW_COLOURS.heatpump, emissive: FLOW_COLOURS.heatpump, emissiveIntensity: 0.3 }))
      b.rotation.z = r
      fanBlades.add(b)
    }
  }

  // Labels float over the canvas as plain elements (they stay crisp and selectable).
  const overlay = document.createElement("div")
  Object.assign(overlay.style, { position: "absolute", inset: "0", pointerEvents: "none", fontFamily: "'Geist', system-ui, sans-serif" })
  host.appendChild(overlay)
  const labels: Label[] = []
  const v3 = (a: Vec3) => new T.Vector3(a[0], a[1], a[2])
  if (opts.labels !== false) {
    const spots: [FlowKey | "building", Vec3][] = [...anchors.map((a) => [a.key, a.label] as [FlowKey, Vec3]), ["building", opts.model.buildingLabel]]
    for (const [key, at] of spots) {
      const el = document.createElement("div")
      el.dataset.testid = `scene-label-${key}`
      Object.assign(el.style, { position: "absolute", left: "0", top: "0", padding: "7px 10px", borderRadius: "8px", background: P.lbg, border: `1px solid ${P.lbd}`, backdropFilter: "blur(8px)", whiteSpace: "nowrap", willChange: "transform", display: "none" })
      overlay.appendChild(el)
      labels.push({ el, at: v3(at), key })
    }
  }
  const fillLabel = (l: Label, d: SceneFlow | null) => {
    l.el.style.display = d ? "" : "none"
    if (!d) return
    l.el.replaceChildren()
    const head = document.createElement("div")
    Object.assign(head.style, { display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", letterSpacing: ".02em", color: P.sub })
    const dot = document.createElement("span")
    Object.assign(dot.style, { width: "7px", height: "7px", borderRadius: "50%", background: FLOW_COLOURS[l.key] })
    head.append(dot, d.label)
    const value = document.createElement("div")
    Object.assign(value.style, { fontSize: "17px", fontWeight: "600", color: P.text, fontVariantNumeric: "tabular-nums", marginTop: "2px" })
    const unit = document.createElement("span")
    Object.assign(unit.style, { fontSize: "11px", fontWeight: "500", color: P.sub })
    unit.textContent = "kW"
    value.append(`${d.kw.toFixed(1)} `, unit)
    l.el.append(head, value)
    if (d.sub && w - safeL - safeR >= 820) {
      const sub = document.createElement("div")
      Object.assign(sub.style, { fontSize: "11px", color: P.sub, marginTop: "1px" })
      sub.textContent = d.sub
      l.el.append(sub)
    }
  }

  // Flows: a faint path from each anchor to the hub, and particles moving along it.
  let flowGroup = new T.Group()
  scene.add(flowGroup)
  let flows: Flow[] = []
  let current = initial
  const disposeGroup = (g: Three.Object3D) =>
    g.traverse((o) => {
      const m = o as Three.Mesh
      m.geometry?.dispose()
      const mat = m.material as Three.Material | Three.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
      else mat?.dispose()
    })

  const setFlows = (data: SceneFlows) => {
    current = data
    scene.remove(flowGroup)
    disposeGroup(flowGroup)
    flowGroup = new T.Group()
    scene.add(flowGroup)
    flows = []
    const hub = v3(opts.model.hub)
    for (const a of anchors) {
      const d = data[a.key]
      if (!d) continue
      const from = v3(a.at)
      const mid = from.clone().lerp(hub, 0.5)
      mid.y = Math.max(from.y, hub.y) + (a.key === "pv" ? 0.8 : 1.5)
      const curve = new T.QuadraticBezierCurve3(from, mid, hub)
      const col = new T.Color(FLOW_COLOURS[a.key])
      const active = d.kw > 0.05 && d.dir !== null
      flowGroup.add(new T.Mesh(new T.TubeGeometry(curve, 64, 0.022, 6, false), new T.MeshBasicMaterial({ color: col, transparent: true, opacity: active ? P.pathOp : P.pathOp * 0.4 })))
      if (!active) continue
      const n = Math.max(4, Math.min(26, Math.round(d.kw / 2.4)))
      const blending = opts.theme === "dark" ? T.AdditiveBlending : T.NormalBlending
      const core = new T.InstancedMesh(new T.SphereGeometry(0.075, 12, 12), new T.MeshBasicMaterial({ color: col, transparent: true, blending }), n)
      const halo = new T.InstancedMesh(new T.SphereGeometry(0.17, 12, 12), new T.MeshBasicMaterial({ color: col, transparent: true, opacity: opts.theme === "dark" ? 0.16 : 0.12, blending, depthWrite: false }), n)
      flowGroup.add(core, halo)
      flows.push({ curve, core, halo, n, speed: 0.1 + Math.min(d.kw, 80) / 420, out: d.dir === "out" })
    }
    // Battery charge as five bars on its front.
    disposeGroup(socBars)
    socBars.clear()
    if (bat && data.battery) {
      const lit = Math.round((data.battery.soc ?? 0) / 20)
      for (let k = 0; k < 5; k++)
        box(0.9, 0.14, 0.02, k < lit ? FLOW_COLOURS.battery : P.dim, bat.at[0], 0.3 + k * 0.2, bat.at[2] + 0.46, { e: k < lit ? FLOW_COLOURS.battery : 0, ei: opts.theme === "dark" ? 0.7 : 0.25, edge: false, cast: false }, socBars)
    }
    for (const l of labels) fillLabel(l, data[l.key])
  }
  setFlows(initial)

  // Drag to turn the site; it also sways slowly on its own. A click without a drag picks a point
  // on the site (Settings → Site model places anchors this way).
  let drag = 0
  let down: number | null = null
  let pressedAt: { x: number; y: number } | null = null
  const raycaster = new T.Raycaster()
  const onDown = (e: PointerEvent) => {
    down = e.clientX
    pressedAt = { x: e.clientX, y: e.clientY }
    canvas.style.cursor = "grabbing"
    canvas.setPointerCapture?.(e.pointerId)
  }
  const onMove = (e: PointerEvent) => {
    if (down == null) return
    drag -= (e.clientX - down) * 0.005
    down = e.clientX
  }
  const onUp = (e: PointerEvent) => {
    down = null
    canvas.style.cursor = opts.onPick ? "crosshair" : "grab"
    const start = pressedAt
    pressedAt = null
    if (!opts.onPick || !start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) return
    const rect = canvas.getBoundingClientRect()
    raycaster.setFromCamera(new T.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera)
    const hit = raycaster.intersectObjects(scene.children, true).find((h) => !(h.object instanceof T.InstancedMesh) && !(h.object instanceof T.LineSegments) && h.object !== grid)
    if (hit) opts.onPick([Math.round(hit.point.x * 10) / 10, Math.round(hit.point.y * 10) / 10, Math.round(hit.point.z * 10) / 10])
  }
  canvas.addEventListener("pointerdown", onDown)
  canvas.addEventListener("pointermove", onMove)
  window.addEventListener("pointerup", onUp)

  const ro = new ResizeObserver(() => {
    w = host.clientWidth || w
    h = host.clientHeight || h
    renderer.setSize(w, h, false)
    setOffset()
    for (const l of labels) fillLabel(l, current[l.key])
  })
  ro.observe(host)
  let visible = true
  const io = new IntersectionObserver((es) => (visible = es[0].isIntersecting))
  io.observe(host)

  const m4 = new T.Matrix4()
  const tmp = new T.Vector3()
  const q = new T.Quaternion()
  const s = new T.Vector3()
  const clock = new T.Clock()
  const el0 = (V.el * Math.PI) / 180
  const th0 = (V.th * Math.PI) / 180
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  let raf = 0
  const tick = () => {
    raf = requestAnimationFrame(tick)
    if (!visible) return
    const t = still ? 0 : clock.getElapsedTime()
    const th = th0 + Math.sin(t * 0.07) * 0.1 + drag
    const R = k * V.r * Math.max(1, (V.fit ?? 0) / (Math.max(200, w - safeL - safeR) / h))
    camera.position.set(R * Math.cos(el0) * Math.sin(th), R * Math.sin(el0) + V.ty * k, R * Math.cos(el0) * Math.cos(th))
    camera.lookAt(0, V.ty * k, 0)
    if (fanBlades) fanBlades.rotation.z = t * ((current.heatpump?.kw ?? 0) > 0.05 ? 6 : 0)
    for (const f of flows) {
      for (let i = 0; i < f.n; i++) {
        let u = (i / f.n + t * f.speed) % 1
        if (f.out) u = 1 - u
        f.curve.getPoint(u, tmp)
        const sc = 0.75 + 0.35 * Math.sin((u + i) * 6.28)
        s.set(sc, sc, sc)
        m4.compose(tmp, q, s)
        f.core.setMatrixAt(i, m4)
        f.halo.setMatrixAt(i, m4)
      }
      f.core.instanceMatrix.needsUpdate = true
      f.halo.instanceMatrix.needsUpdate = true
    }
    renderer.render(scene, camera)
    for (const l of labels) {
      tmp.copy(l.at).project(camera)
      const x = (tmp.x * 0.5 + 0.5) * w
      const y = (-tmp.y * 0.5 + 0.5) * h
      l.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-100%)`
    }
  }
  tick()

  return {
    setFlows,
    dispose() {
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      window.removeEventListener("pointerup", onUp)
      disposeGroup(scene)
      renderer.dispose()
      canvas.remove()
      overlay.remove()
    },
  }
}
