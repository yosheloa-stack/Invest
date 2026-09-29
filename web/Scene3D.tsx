import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
// A slowly drifting field of 3D candlesticks: several price paths receding into fog.
// Purely decorative; pauses when hidden and stays still for reduced-motion users.
export default function Scene3D({ intensity = 1 }: { intensity?: number }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0a0f1a, 16, 60);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
    camera.position.set(0, 7.5, 16);
    camera.lookAt(0, 1, -12);
    scene.add(new THREE.AmbientLight(0xaab8ff, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(6, 12, 8);
    scene.add(key);
    const rim = new THREE.PointLight(0xd9a441, 40, 40);
    rim.position.set(-8, 6, -10);
    scene.add(rim);
    const rows = 7,
      cols = 64,
      count = rows * cols;
    const body = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.42, 1, 0.42),
      new THREE.MeshStandardMaterial({
        roughness: 0.45,
        metalness: 0.1,
      }),
      count,
    );
    const wick = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.06, 1, 0.06),
      new THREE.MeshBasicMaterial({ color: 0x5c6b8a }),
      count,
    );
    const up = new THREE.Color(0x1fd1a0),
      down = new THREE.Color(0xf2546b),
      m = new THREE.Matrix4(),
      q = new THREE.Quaternion(),
      v = new THREE.Vector3(),
      sc = new THREE.Vector3();
    // Deterministic random walk per row so the scene looks like real price action.
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
    const candles: { o: number; c: number; h: number; l: number }[] = [];
    for (let r = 0; r < rows; r++) {
      let p = 0;
      for (let i = 0; i < cols; i++) {
        const o = p,
          c = p + rnd() * 0.9 + Math.sin(i / 7 + r) * 0.12;
        candles.push({
          o,
          c,
          h: Math.max(o, c) + Math.abs(rnd()) * 0.5,
          l: Math.min(o, c) - Math.abs(rnd()) * 0.5,
        });
        p = c * 0.96;
      }
    }
    candles.forEach((k, n) => {
      const bodyH = Math.max(0.08, Math.abs(k.c - k.o));
      body.setColorAt(n, k.c >= k.o ? up : down);
      m.compose(v.set(0, (k.o + k.c) / 2, 0), q, sc.set(1, bodyH, 1));
      body.setMatrixAt(n, m);
      m.compose(v.set(0, (k.h + k.l) / 2, 0), q, sc.set(1, k.h - k.l, 1));
      wick.setMatrixAt(n, m);
    });
    const group = new THREE.Group();
    group.add(body, wick);
    scene.add(group);
    const grid = new THREE.GridHelper(120, 60, 0x1e2a40, 0x131b2b);
    grid.position.y = -3.2;
    scene.add(grid);
    const place = (offset: number) => {
      for (let r = 0; r < rows; r++)
        for (let i = 0; i < cols; i++) {
          const n = r * cols + i,
            k = candles[n];
          const x = ((i * 0.9 + offset) % (cols * 0.9)) - cols * 0.45,
            z = -r * 5 - 2,
            y = r * 0.9 - 1;
          const bodyH = Math.max(0.08, Math.abs(k.c - k.o));
          m.compose(v.set(x, y + (k.o + k.c) / 2, z), q, sc.set(1, bodyH, 1));
          body.setMatrixAt(n, m);
          m.compose(
            v.set(x, y + (k.h + k.l) / 2, z),
            q,
            sc.set(1, k.h - k.l, 1),
          );
          wick.setMatrixAt(n, m);
        }
      body.instanceMatrix.needsUpdate = true;
      wick.instanceMatrix.needsUpdate = true;
    };
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(
      new UnrealBloomPass(
        new THREE.Vector2(256, 256),
        0.9 * intensity,
        0.5,
        0.3,
      ),
    );
    composer.addPass(new OutputPass());
    const resize = () => {
      const w = el.clientWidth || 1,
        h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0,
      visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(el);
    const start = performance.now();
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (!visible || document.hidden) return;
      const t = (now - start) / 1000;
      place(t * 0.9 * intensity);
      camera.position.x = Math.sin(t * 0.08) * 2.2;
      camera.lookAt(0, 1, -12);
      composer.render();
    };
    if (still) {
      place(0);
      composer.render();
    } else frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      io.disconnect();
      composer.dispose();
      renderer.dispose();
      body.geometry.dispose();
      wick.geometry.dispose();
      el.removeChild(renderer.domElement);
    };
  }, [intensity]);
  return <div className="scene3d" ref={host} aria-hidden="true" />;
}
