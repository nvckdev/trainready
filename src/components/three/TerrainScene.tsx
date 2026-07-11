"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { heightAt, routePoints, TERRAIN_SIZE } from "@/lib/terrain";

// Palette hardcoded for GL (mirrors the OKLCH tokens in globals.css)
const FIELD = "#241f1a"; // night ground, matches --field
const BONE = "#eee7d8"; // contour lines, matches --bone
const SIGNAL = "#f0521a";

export type ProgressState = { target: number; value: number };
export type ProgressRef = React.RefObject<ProgressState>;

const vertexShader = /* glsl */ `
  varying float vH;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  void main() {
    vH = position.y;
    vNormal = normalMatrix * normal;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uPaper;
  uniform vec3 uInk;
  uniform vec3 uCamPos;
  varying float vH;
  varying vec3 vNormal;
  varying vec3 vWorldPos;

  float contour(float h, float spacing, float width) {
    float g = h / spacing;
    float f = fract(g);
    float d = min(f, 1.0 - f);
    float aa = fwidth(g);
    return 1.0 - smoothstep(0.0, aa * width, d);
  }

  void main() {
    float minor = contour(vH, 1.0, 1.4) * 0.3;
    float major = contour(vH, 5.0, 1.9) * 0.72;

    // Moonlit relief: multiplicative shading keeps the night ground dark
    vec3 light = normalize(vec3(0.45, 0.85, 0.3));
    float lit = clamp(dot(normalize(vNormal), light), 0.0, 1.0);

    vec3 col = mix(uPaper, uInk, clamp(minor + major, 0.0, 1.0));
    col *= 0.78 + 0.38 * lit;

    // Survey graticule: faint square grid over the whole sheet
    float grat = max(contour(vWorldPos.x, 24.0, 1.2), contour(vWorldPos.z, 24.0, 1.2));
    col = mix(col, uInk, grat * 0.07);

    // Dissolve into the page: camera-distance fog and radial edge fade
    float dist = distance(vWorldPos.xz, uCamPos.xz);
    float fog = smoothstep(90.0, 155.0, dist);
    float edge = smoothstep(88.0, 118.0, length(vWorldPos.xz));
    col = mix(col, uPaper, max(fog, edge));

    gl_FragColor = vec4(col, 1.0);
  }
`;

function Terrain() {
  const matRef = useRef<THREE.ShaderMaterial>(null);

  const geometry = useMemo(() => {
    const seg = 220;
    const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }, []);

  const uniforms = useMemo(
    () => ({
      uPaper: { value: new THREE.Color(FIELD) },
      uInk: { value: new THREE.Color(BONE) },
      uCamPos: { value: new THREE.Vector3() },
    }),
    []
  );

  useFrame(({ camera }) => {
    uniforms.uCamPos.value.copy(camera.position);
  });

  return (
    <mesh geometry={geometry}>
      <shaderMaterial
        ref={matRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
      />
    </mesh>
  );
}

function Route({ progressRef }: { progressRef: ProgressRef }) {
  const RADIAL = 6;
  const TUBULAR = 420;

  const { curve, tube } = useMemo(() => {
    const pts = routePoints().map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.TubeGeometry(curve, TUBULAR, 0.16, RADIAL, false);
    return { curve, tube };
  }, []);

  const tubeRef = useRef<THREE.Mesh>(null);
  const headRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const p = THREE.MathUtils.clamp(progressRef.current.value, 0.0001, 1);
    if (tubeRef.current) {
      const perRing = RADIAL * 6;
      const count = Math.floor(TUBULAR * p) * perRing;
      tubeRef.current.geometry.setDrawRange(0, count);
    }
    if (headRef.current) {
      headRef.current.position.copy(curve.getPointAt(p));
    }
  });

  return (
    <group>
      <mesh ref={tubeRef} geometry={tube}>
        <meshBasicMaterial color={SIGNAL} />
      </mesh>
      <mesh ref={headRef}>
        <sphereGeometry args={[0.5, 20, 20]} />
        <meshBasicMaterial color={SIGNAL} />
      </mesh>
    </group>
  );
}

function Rig({ progressRef }: { progressRef: ProgressRef }) {
  const curve = useMemo(() => {
    const pts = routePoints().map(([x, y, z]) => new THREE.Vector3(x, y, z));
    return new THREE.CatmullRomCurve3(pts);
  }, []);

  const lookTarget = useRef(new THREE.Vector3());

  useFrame(({ camera }, dt) => {
    // Ease the scrubbed progress so the flight feels damped, not stepped
    const k = 1 - Math.exp(-4.5 * Math.min(dt, 0.1));
    const s = progressRef.current;
    s.value += (s.target - s.value) * k;

    const p = THREE.MathUtils.clamp(s.value, 0, 1);
    const head = curve.getPointAt(p);
    const back = curve.getPointAt(Math.max(0, p - 0.045));
    // Aim just behind the head so the recorded line leads the frame
    const aim = curve.getPointAt(Math.max(0, p - 0.012));

    // High overview at the start, settling into an elevated lateral
    // tracking shot so the route reads diagonally across the frame
    const overview = 1 - THREE.MathUtils.smoothstep(p, 0, 0.16);
    const dir = new THREE.Vector3().subVectors(head, back).setY(0);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    const perp = new THREE.Vector3(-dir.z, 0, dir.x);

    // Narrow viewports get less lateral offset and more height so the
    // route stays framed
    const aspect =
      (camera as THREE.PerspectiveCamera).aspect ?? 1;
    const narrow = THREE.MathUtils.clamp(1 - aspect, 0, 0.6);

    const camPos = head
      .clone()
      .addScaledVector(dir, -20 - overview * 34)
      .addScaledVector(perp, 11 - narrow * 9)
      .add(new THREE.Vector3(0, 10 + narrow * 14 + overview * 55, 0));

    // Never clip into a hillside
    const ground = heightAt(camPos.x, camPos.z);
    camPos.y = Math.max(camPos.y, ground + 4.5);

    camera.position.lerp(camPos, k);
    lookTarget.current.lerp(aim, k);
    camera.lookAt(lookTarget.current);
  });

  return null;
}

export function TerrainScene({
  progress,
  frameloop = "always",
}: {
  progress: ProgressRef;
  frameloop?: "always" | "demand";
}) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      frameloop={frameloop}
      camera={{ fov: 55, near: 0.5, far: 500, position: [-60, 60, 130] }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
    >
      <color attach="background" args={[FIELD]} />
      <Terrain />
      <Route progressRef={progress} />
      <Rig progressRef={progress} />
    </Canvas>
  );
}
