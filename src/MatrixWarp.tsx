import { useEffect, useRef, useState } from 'react'
import { gsap } from 'gsap'
import * as THREE from 'three'

// One instanced mesh per light layer: no per-particle React updates or DOM nodes.
const COUNT = 1800
const vertexShader = `
  attribute vec4 flight;
  uniform float travel;
  uniform float speed;
  uniform float thickness;
  varying vec2 trailUv;
  varying float tint;
  void main() {
    float z = 8.0 + mod(flight.z - travel * flight.w, 1200.0);
    float angle = flight.x;
    float radius = flight.y;
    float length = mix(12.0, 180.0, speed) * flight.w;
    vec3 head = vec3(cos(angle) * radius, sin(angle) * radius, -z);
    vec3 tail = head - vec3(0.0, 0.0, length);
    vec3 p = mix(tail, head, uv.y);
    p.xy += vec2(-sin(angle), cos(angle)) * position.x * thickness;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    trailUv = uv;
    tint = step(0.67, fract(flight.x * 13.7));
  }
`
const fragmentShader = `
  uniform float light;
  varying vec2 trailUv;
  varying float tint;
  void main() {
    float edge = pow(max(0.0, 1.0 - abs(trailUv.x * 2.0 - 1.0)), 1.5);
    float tail = smoothstep(0.0, 0.85, trailUv.y);
    float code = mix(0.72, 1.0, step(0.22, fract(trailUv.y * 16.0)));
    vec3 color = mix(vec3(0.18, 1.0, 0.53), vec3(0.24, 0.85, 1.0), tint);
    color = mix(color, vec3(0.78, 1.0, 0.9), pow(trailUv.y, 14.0) * 0.65);
    gl_FragColor = vec4(color, edge * tail * code * light);
  }
`

export default function MatrixWarp({ durationMs }: { durationMs: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const element = canvas.current
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    if (!element || media.matches) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas: element, alpha: true, antialias: false, powerPreference: 'low-power' })
    } catch {
      // CSS tunnel underneath also works on machines without WebGL.
      return
    }
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(70, 1, 1, 1500)
    const quad = new THREE.PlaneGeometry(1, 1)
    const geometry = new THREE.InstancedBufferGeometry()
    geometry.index = quad.index!.clone()
    geometry.setAttribute('position', quad.getAttribute('position').clone())
    geometry.setAttribute('uv', quad.getAttribute('uv').clone())
    quad.dispose()
    const flights = new Float32Array(COUNT * 4)
    for (let index = 0; index < COUNT; index++) {
      flights.set([
        index * 2.399963,
        15 + Math.sqrt((index * 0.618034) % 1) * 410,
        (index * 719.3) % 1200,
        0.7 + (index * 0.414214 % 1) * 0.6,
      ], index * 4)
    }
    geometry.setAttribute('flight', new THREE.InstancedBufferAttribute(flights, 4))
    geometry.instanceCount = COUNT
    const travel = { value: 0 }, speed = { value: 0.03 }
    const materials = [1.0, 5.0].map((thickness, index) => new THREE.ShaderMaterial({
      vertexShader, fragmentShader,
      uniforms: { travel, speed, thickness: { value: thickness }, light: { value: index ? 0.1 : 0.78 } },
      // These radial ribbons face outward; the camera travels inside the tunnel.
      side: THREE.DoubleSide,
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    }))
    materials.forEach(material => {
      const mesh = new THREE.Mesh(geometry, material)
      mesh.frustumCulled = false
      scene.add(mesh)
    })
    const seconds = durationMs / 1000
    const sequence = gsap.timeline()
      .to(speed, { value: 1, duration: seconds * 0.2, ease: 'power2.in' })
      .to(speed, { value: 1, duration: seconds * 0.62 })
      .to(speed, { value: 0.18, duration: seconds * 0.18, ease: 'power2.out' })
    const resize = () => {
      const width = Math.max(1, element.clientWidth), height = Math.max(1, element.clientHeight)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    resize()
    let frame = 0, stopped = false, firstFrame = true, last = performance.now()
    const start = last
    renderer.debug.onShaderError = () => {
      stopped = true
      setReady(false)
      sequence.kill()
    }
    const render = (now: number) => {
      if (stopped || document.hidden || now - start >= durationMs) return
      if (now - last < 1000 / 60) { frame = requestAnimationFrame(render); return }
      const delta = Math.min((now - last) / 1000, 0.05)
      last = now
      travel.value += delta * (80 + speed.value * 650)
      try {
        renderer.render(scene, camera)
        if (!stopped && firstFrame) { firstFrame = false; setReady(true) }
      } catch {
        stopped = true
        setReady(false)
        sequence.kill()
        return
      }
      if (!stopped) frame = requestAnimationFrame(render)
    }
    const visibility = () => {
      cancelAnimationFrame(frame)
      if (!document.hidden && !stopped) { last = performance.now(); frame = requestAnimationFrame(render) }
    }
    const stopForMotion = () => {
      if (!media.matches) return
      stopped = true
      cancelAnimationFrame(frame)
      sequence.kill()
      setReady(false)
    }
    const contextLost = (event: Event) => {
      event.preventDefault()
      stopped = true
      cancelAnimationFrame(frame)
      sequence.kill()
      setReady(false)
    }
    document.addEventListener('visibilitychange', visibility)
    media.addEventListener('change', stopForMotion)
    element.addEventListener('webglcontextlost', contextLost)
    frame = requestAnimationFrame(render)
    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      sequence.kill()
      observer.disconnect()
      document.removeEventListener('visibilitychange', visibility)
      media.removeEventListener('change', stopForMotion)
      element.removeEventListener('webglcontextlost', contextLost)
      geometry.dispose()
      materials.forEach(material => material.dispose())
      renderer.dispose()
      renderer.forceContextLoss()
    }
  }, [durationMs])
  return <canvas className="sf-startup-warp-canvas" data-ready={ready} ref={canvas} aria-hidden="true" />
}
