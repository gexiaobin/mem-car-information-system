import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const canvas = document.querySelector("#render");
const status = document.querySelector("#status");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(1600, 800, false);
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.shadowMap.enabled = false;
renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
const environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04);
scene.environment = environment.texture;
scene.environmentIntensity = 0.7;
const camera = new THREE.PerspectiveCamera(31, 2, 0.1, 100);
camera.zoom = 1.6;
camera.updateProjectionMatrix();
let direction = 1;
let side = 1;
function compose() {
  camera.position.set(8.0 * side, 1.65, 5.8 * direction);
  camera.lookAt(0, 0.58, 0);
  renderer.render(scene, camera);
}
scene.add(new THREE.HemisphereLight(0xd9efff, 0x1b2738, 0.35));
const key = new THREE.DirectionalLight(0xf3f8ff, 2);
key.position.set(-3, 7, 5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 0.5, far: 20 });
key.shadow.bias = -0.0003;
key.shadow.normalBias = 0.015;
key.shadow.radius = 5;
scene.add(key);
const rim = new THREE.DirectionalLight(0xa8d8ff, 1.0);
rim.position.set(4, 4, -5);
scene.add(rim);
const shadowCanvas = document.createElement("canvas");
shadowCanvas.width = shadowCanvas.height = 256;
const context = shadowCanvas.getContext("2d");
const falloff = context.createRadialGradient(128, 128, 24, 128, 128, 128);
falloff.addColorStop(0, "rgba(0,0,0,.8)");
falloff.addColorStop(.45, "rgba(0,0,0,.45)");
falloff.addColorStop(1, "rgba(0,0,0,0)");
context.fillStyle = falloff;
context.fillRect(0, 0, 256, 256);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 6.0), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false, opacity: 0.7 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.008;
floor.receiveShadow = true;
scene.add(floor);
const loader = new GLTFLoader();
const draco = new DRACOLoader().setDecoderPath("/three/examples/jsm/libs/draco/gltf/");
loader.setDRACOLoader(draco);
try {
  const { scene: car } = await loader.loadAsync("/model.glb");
  const bounds = new THREE.Box3().setFromObject(car);
  const size = bounds.getSize(new THREE.Vector3());
  car.scale.multiplyScalar(4.8 / Math.max(size.x, size.z));
  const scaled = new THREE.Box3().setFromObject(car);
  const center = scaled.getCenter(new THREE.Vector3());
  car.position.sub(new THREE.Vector3(center.x, scaled.min.y, center.z));
  const silver = new THREE.MeshPhysicalMaterial({ color: 0xcbd4dc, metalness: 0.62, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.2 });
  const graphite = new THREE.MeshPhysicalMaterial({ color: 0x1a2531, metalness: 0.75, roughness: 0.28, clearcoat: 0.7 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x070c12, metalness: 0.35, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 });
  car.traverse(object => {
    if (/License.?Plate|InteriorSteeringEmblem/i.test(object.name)) object.visible = false;
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = false;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const adjusted = materials.map(material => {
      material.emissiveMap = null;
      material.emissive?.setHex(0x000000);
      material.emissiveIntensity = 0;
      if (/Paint 1/.test(material.name)) return silver;
      if (/Paint 2/.test(material.name)) return graphite;
      if (material.name === "Glass") return glass;
      if (material.name === "Tireside") {
        material.map = null; material.normalMap = null;
        material.color.setHex(0x101317); material.roughness = 0.78;
      }
      if (/Rim/.test(material.name)) { material.color.setHex(0x8d9da9); material.metalness = 0.85; material.roughness = 0.24; }
      material.needsUpdate = true;
      return material;
    });
    object.material = Array.isArray(object.material) ? adjusted : adjusted[0];
  });
  scene.add(car);
  compose();
  status.textContent = "渲染完成 · 1600 × 800 · 透明背景";
  document.querySelector("#export").disabled = false;
} catch (error) { status.textContent = `模型加载失败：${error.message}`; }
document.querySelector("#left").onclick = () => { side = 1; compose(); };
document.querySelector("#right").onclick = () => { side = -1; compose(); };
document.querySelector("#reverse").onclick = () => { direction *= -1; compose(); };
document.querySelector("#export").onclick = () => {
  compose();
  canvas.toBlob(async blob => {
    const response = await fetch("/export", { method: "POST", body: blob });
    status.textContent = response.ok ? "已保存 .local/car-studio/studio-silver.png" : "导出失败";
  }, "image/png");
};
