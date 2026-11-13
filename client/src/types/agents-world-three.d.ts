/**
 * Narrow client-only contract for the Three 0.180.0 API used by this renderer.
 * The installed runtime has no declarations in this checkout. No packages are
 * installed and no untyped module shim is used. This is not a full Three SDK.
 */
declare module 'three' {
  export const SRGBColorSpace: 'srgb';
  export class Vector2 {
    constructor(x?: number, y?: number);
    set(x: number, y: number): this;
  }
  export class Vector3 {
    constructor(x?: number, y?: number, z?: number);
    x: number; y: number; z: number;
    set(x: number, y: number, z: number): this;
    setScalar(value: number): this;
    clone(): Vector3;
    copy(value: Vector3): this;
    add(value: Vector3): this;
    sub(value: Vector3): this;
    distanceTo(value: Vector3): number;
    length(): number;
    setLength(value: number): this;
    normalize(): this;
    multiplyScalar(value: number): this;
    setFromSpherical(value: Spherical): this;
    project(camera: Camera): this;
    toArray(): number[];
  }
  export class Spherical {
    theta: number; phi: number;
    setFromVector3(value: Vector3): this;
  }
  export class Object3D {
    position: Vector3;
    scale: Vector3;
    rotation: { x: number; y: number; z: number };
    visible: boolean;
    parent: Object3D | null;
    userData: Record<string, unknown>;
    add(...objects: Object3D[]): this;
  }
  export class Group extends Object3D {}
  export class Scene extends Object3D { fog: Fog | null; }
  export class Camera extends Object3D {}
  export class PerspectiveCamera extends Camera {
    constructor(fov?: number, aspect?: number, near?: number, far?: number);
    aspect: number;
    updateProjectionMatrix(): void;
  }
  export class Fog { constructor(color: string | number, near?: number, far?: number); }
  export class HemisphereLight extends Object3D {
    constructor(skyColor?: string | number, groundColor?: string | number, intensity?: number);
  }
  export class DirectionalLight extends Object3D {
    constructor(color?: string | number, intensity?: number);
  }
  export class BufferGeometry { dispose(): void; }
  export class BoxGeometry extends BufferGeometry { constructor(width?: number, height?: number, depth?: number); }
  export class SphereGeometry extends BufferGeometry { constructor(radius?: number, widthSegments?: number, heightSegments?: number); }
  export class CylinderGeometry extends BufferGeometry { constructor(radiusTop?: number, radiusBottom?: number, height?: number, radialSegments?: number); }
  export class TorusGeometry extends BufferGeometry { constructor(radius?: number, tube?: number, radialSegments?: number, tubularSegments?: number); }
  export class Material { dispose(): void; }
  export class MeshStandardMaterial extends Material { constructor(parameters?: { color?: string | number; roughness?: number }); }
  export class SpriteMaterial extends Material { constructor(parameters?: { map?: Texture; depthTest?: boolean }); }
  export class Mesh extends Object3D { constructor(geometry?: BufferGeometry, material?: Material); }
  export class Sprite extends Object3D { constructor(material?: SpriteMaterial); }
  export class Texture { colorSpace: string; dispose(): void; }
  export class CanvasTexture extends Texture { constructor(canvas: HTMLCanvasElement); }
  export class Raycaster {
    setFromCamera(coords: Vector2, camera: Camera): void;
    intersectObjects(objects: Object3D[], recursive?: boolean): { object: Object3D }[];
  }
  export class WebGLRenderer {
    constructor(parameters?: { canvas?: HTMLCanvasElement; antialias?: boolean; alpha?: boolean; powerPreference?: WebGLPowerPreference });
    outputColorSpace: string;
    info: { render: { calls: number } };
    setPixelRatio(value: number): void;
    setClearColor(color: string | number): void;
    setSize(width: number, height: number, updateStyle?: boolean): void;
    render(scene: Object3D, camera: Camera): void;
    dispose(): void;
    forceContextLoss(): void;
  }
}
declare module 'three/addons/controls/OrbitControls.js' {
  import { Camera, Vector3 } from 'three';
  export class OrbitControls {
    constructor(camera: Camera, domElement?: HTMLElement);
    enableDamping: boolean;
    minDistance: number; maxDistance: number;
    minPolarAngle: number; maxPolarAngle: number;
    target: Vector3;
    update(): boolean;
    addEventListener(type: 'change', listener: () => void): void;
    removeEventListener(type: 'change', listener: () => void): void;
    dispose(): void;
  }
}
