import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { pct, ticker } from "./format";
type Item = { symbol: string; change: number | null };
// 3D market map: one glowing column per asset, height = last-hour move, color = direction.
// Click a column to open that asset.
export default function Market3D({
  items,
  selected,
  onSelect,
}: {
  items: Item[];
  selected: string;
  onSelect: (s: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    labels = useRef<HTMLDivElement>(null),
    data = useRef({ items, selected, onSelect });
  data.current = { items, selected, onSelect };
  const key = items.map((i) => i.symbol).join();
  useEffect(() => {
    const el = host.current,
      lab = labels.current;
    if (!el || !lab) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      el.classList.add("no-webgl");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    scene.fog = new THREE.Fog(0x131722, 18, 40);
    scene.add(new THREE.AmbientLight(0x8fa3c8, 0.5));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
    keyLight.position.set(5, 12, 7);
    scene.add(keyLight);
    const n = data.current.items.length,
      radius = Math.max(4.2, n * 0.52),
      up = new THREE.Color(0x089981),
      down = new THREE.Color(0xf23645),
      flat = new THREE.Color(0x787b86),
      brass = new THREE.Color(0x2962ff);
    // Floor: a faint polar grid, like a radar dish the columns stand on.
    const floor = new THREE.PolarGridHelper(
      radius + 2.2,
      24,
      6,
      96,
      0x2a2e39,
      0x1e222d,
    );
    floor.position.y = 0;
    scene.add(floor);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.68, 48),
      new THREE.MeshBasicMaterial({ color: brass, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    scene.add(ring);
    const geo = new THREE.BoxGeometry(0.62, 1, 0.62);
    geo.translate(0, 0.5, 0);
    const cols = data.current.items.map((it, i) => {
      const a = (i / n) * Math.PI * 2,
        mat = new THREE.MeshStandardMaterial({
          color: flat,
          emissive: flat,
          emissiveIntensity: 0.35,
          roughness: 0.3,
          metalness: 0.5,
          transparent: true,
          opacity: 0.92,
        }),
        mesh = new THREE.Mesh(geo, mat),
        capMat = new THREE.MeshBasicMaterial({ color: flat }),
        cap = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.05, 0.66), capMat);
      mesh.position.set(Math.cos(a) * radius, 0, Math.sin(a) * radius);
      cap.position.copy(mesh.position);
      mesh.userData.symbol = it.symbol;
      scene.add(mesh, cap);
      const tag = document.createElement("button");
      tag.className = "m3d-tag";
      tag.type = "button";
      tag.onclick = () => data.current.onSelect(it.symbol);
      lab.appendChild(tag);
      return { mesh, cap, mat, capMat, tag, h: 0.3, symbol: it.symbol };
    });
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(256, 256),
      0.55,
      0.4,
      0.55,
    );
    composer.addPass(bloom);
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
    const ray = new THREE.Raycaster(),
      mouse = new THREE.Vector2();
    const click = (e: MouseEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      mouse.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
      ray.setFromCamera(mouse, camera);
      const hit = ray.intersectObjects(cols.map((c) => c.mesh))[0];
      if (hit) data.current.onSelect(hit.object.userData.symbol);
    };
    renderer.domElement.addEventListener("click", click);
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0,
      visible = true,
      angle = 0.6,
      last = performance.now();
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(el);
    const v = new THREE.Vector3();
    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { items: list, selected: sel } = data.current,
        max = Math.max(0.004, ...list.map((x) => Math.abs(x.change ?? 0)));
      if (!still) angle += dt * 0.12;
      const far = radius + 7.5 + Math.max(0, 1.6 - camera.aspect) * 5;
      camera.position.set(
        Math.cos(angle) * far,
        radius * 0.95 + 2.4,
        Math.sin(angle) * far,
      );
      camera.lookAt(0, 1.1, 0);
      const w = el.clientWidth,
        hh = el.clientHeight;
      cols.forEach((c) => {
        const it = list.find((x) => x.symbol === c.symbol),
          ch = it?.change ?? 0,
          target = 0.25 + (Math.abs(ch) / max) * 4.2;
        c.h += (target - c.h) * Math.min(1, dt * 4);
        c.mesh.scale.y = c.h;
        c.cap.position.y = c.h;
        const col = !it?.change ? flat : ch > 0 ? up : down;
        c.mat.color.lerp(col, 0.1);
        c.mat.emissive.lerp(col, 0.1);
        c.capMat.color.lerp(col, 0.1);
        const isSel = c.symbol === sel;
        c.mat.emissiveIntensity +=
          ((isSel ? 0.7 : 0.18) - c.mat.emissiveIntensity) * 0.1;
        if (isSel)
          ring.position.set(c.mesh.position.x, 0.02, c.mesh.position.z);
        v.set(c.mesh.position.x, c.h + 0.55, c.mesh.position.z).project(camera);
        const behind = v.z > 1;
        c.tag.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * hh}px) translate(-50%, -100%)`;
        c.tag.style.opacity = behind ? "0" : "1";
        c.tag.classList.toggle("on", isSel);
        c.tag.classList.toggle("up", ch > 0);
        c.tag.classList.toggle("down", ch < 0);
        const text = `${ticker(c.symbol)} ${it?.change == null ? "—" : `${ch >= 0 ? "+" : ""}${pct(ch, 2)}`}`;
        if (c.tag.textContent !== text) c.tag.textContent = text;
      });
      composer.render();
    };
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (!visible || document.hidden) return;
      draw(now);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      io.disconnect();
      renderer.domElement.removeEventListener("click", click);
      composer.dispose();
      renderer.dispose();
      geo.dispose();
      cols.forEach((c) => {
        c.mat.dispose();
        c.capMat.dispose();
        c.tag.remove();
      });
      el.removeChild(renderer.domElement);
    };
  }, [key]);
  return (
    <div className="m3d">
      <div className="m3d-canvas" ref={host} aria-hidden="true" />
      <div className="m3d-labels" ref={labels} />
    </div>
  );
}
