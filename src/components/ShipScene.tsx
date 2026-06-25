import { Canvas, useFrame } from "@react-three/fiber";
import { Grid, Html, Line, OrbitControls } from "@react-three/drei";
import { useMemo, useRef } from "react";
import { Color, Group, Vector3 } from "three";
import { ports, routes } from "@/data/chmarlData";

type PortMarkerProps = {
  name: string;
  position: [number, number, number];
};

function PortMarker({ name, position }: PortMarkerProps) {
  return (
    <group position={position}>
      <mesh position-y={0.08}>
        <cylinderGeometry args={[0.16, 0.16, 0.16, 32]} />
        <meshStandardMaterial color="#65e4cb" emissive="#1a8f81" emissiveIntensity={0.7} />
      </mesh>
      <mesh position={[0, 0.22, 0]}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshStandardMaterial color="#ffffff" emissive="#8ddcff" emissiveIntensity={0.6} />
      </mesh>
      <PortLabel label={name} />
    </group>
  );
}

function PortLabel({ label }: { label: string }) {
  return (
    <Html center distanceFactor={8} position={[0, 0.46, 0]} style={{ pointerEvents: "none" }}>
      <div className="port-label">{label}</div>
    </Html>
  );
}

function routeColor(risk: string) {
  if (risk === "high") return "#ff7474";
  if (risk === "medium") return "#ffd780";
  return "#65e4cb";
}

function RouteLines() {
  const portMap = useMemo(
    () => new Map(ports.map((port) => [port.name, new Vector3(...port.position)])),
    []
  );

  return (
    <group position-y={0.08}>
      {routes.map((route) => {
        const from = portMap.get(route.from);
        const to = portMap.get(route.to);
        if (!from || !to) return null;
        const mid = new Vector3().addVectors(from, to).multiplyScalar(0.5);
        mid.y = 0.4;
        const points = [from, mid, to];
        return (
          <Line
            key={`${route.from}-${route.to}`}
            points={points}
            color={routeColor(route.risk)}
            lineWidth={2}
            transparent
            opacity={0.78}
          />
        );
      })}
    </group>
  );
}

function Vessel({ offset, color }: { offset: number; color: string }) {
  const ref = useRef<Group>(null!);
  const path = useMemo(
    () => [
      new Vector3(-5.2, 0.18, -0.6),
      new Vector3(-4.6, 0.18, 1.2),
      new Vector3(-3.9, 0.18, 3.2),
      new Vector3(-3.4, 0.18, 5.2),
    ],
    []
  );

  useFrame((state) => {
    const t = (state.clock.elapsedTime * 0.08 + offset) % 1;
    const segment = Math.min(path.length - 2, Math.floor(t * (path.length - 1)));
    const localT = t * (path.length - 1) - segment;
    const current = new Vector3().lerpVectors(path[segment], path[segment + 1], localT);
    ref.current.position.copy(current);
    const next = path[Math.min(segment + 1, path.length - 1)];
    ref.current.lookAt(next.x, current.y, next.z);
  });

  return (
    <group ref={ref}>
      <mesh rotation-x={Math.PI / 2}>
        <coneGeometry args={[0.16, 0.52, 4]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.35} />
      </mesh>
      <mesh position-y={-0.03}>
        <boxGeometry args={[0.32, 0.08, 0.12]} />
        <meshStandardMaterial color="#dffcff" />
      </mesh>
    </group>
  );
}

function OceanPlane() {
  return (
    <mesh rotation-x={-Math.PI / 2} receiveShadow>
      <planeGeometry args={[16, 12, 64, 64]} />
      <meshStandardMaterial
        color={new Color("#06243a")}
        metalness={0.2}
        roughness={0.45}
        emissive="#031d31"
        emissiveIntensity={0.5}
      />
    </mesh>
  );
}

export default function ShipScene() {
  return (
    <div className="scene-container">
      <Canvas shadows camera={{ position: [0, 6.8, 8.8], fov: 48 }} dpr={[1, 2]}>
        <color attach="background" args={["#020912"]} />
        <fog attach="fog" args={["#020912", 8, 22]} />
        <ambientLight intensity={1.2} />
        <directionalLight position={[4, 8, 4]} intensity={2.4} castShadow />
        <OceanPlane />
        <Grid
          args={[16, 12]}
          cellSize={0.5}
          cellThickness={0.4}
          sectionSize={2}
          sectionThickness={1.2}
          fadeDistance={18}
          fadeStrength={1.4}
          position-y={0.02}
          infiniteGrid={false}
        />
        <RouteLines />
        {ports.map((port) => (
          <PortMarker key={port.name} name={port.name} position={port.position} />
        ))}
        <Vessel offset={0} color="#65e4cb" />
        <Vessel offset={0.22} color="#ffd780" />
        <Vessel offset={0.48} color="#8ddcff" />
        <Vessel offset={0.72} color="#ff7474" />
        <OrbitControls enablePan enableZoom enableRotate minDistance={5} maxDistance={14} maxPolarAngle={1.35} />
      </Canvas>
      <div className="scene-overlay">
        <div className="overlay-box">
          <strong>Operational layer</strong>
          Routes are colored by constraint pressure and risk class.
        </div>
        <div className="overlay-box">
          <strong>CH-MARL hierarchy</strong>
          Fleet policy, port agents, vessel agents, and constraint shield are ready for data integration.
        </div>
      </div>
    </div>
  );
}
