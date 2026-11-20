// Renderer, camera, post-processing, sky/HDRI lighting and quality presets.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { settings } from './ctx.js';

export const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
document.getElementById('game').appendChild(renderer.domElement);
export const maxAniso = renderer.capabilities.getMaxAnisotropy();

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.05, 5000);
camera.rotation.order = 'YXZ';
scene.add(camera);

// ---------- lights ----------
export const SUN = new THREE.Vector3(-0.5, 0.45, -0.74).normalize();
export const sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -190, right: 190, top: 190, bottom: -190, near: 50, far: 1600 });
sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.35;
scene.add(sun, sun.target);
export const hemi = new THREE.HemisphereLight(0xbcd3f2, 0x5e5446, 0.25);
scene.add(hemi);
scene.fog = new THREE.FogExp2(0xbfc8d2, 0.0016);

// ---------- post processing ----------
const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
export const composer = new EffectComposer(renderer, rt);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
export const gtao = new GTAOPass(scene, camera, 4, 4);
gtao.enabled = false;
gtao.blendIntensity = 0.85;
gtao.updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.4, thickness: 1.5, scale: 1.0, samples: 12 });
composer.addPass(gtao);
export const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.5, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());
export const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, vig: { value: 0.7 }, dmg: { value: 0 }, sat: { value: 1.06 } },
  vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: `uniform sampler2D tDiffuse;uniform float time,vig,dmg,sat;varying vec2 vUv;
    void main(){
      vec2 d=vUv-.5;
      float ca=(.0012+dmg*.006)*length(d)*2.;
      vec3 c=vec3(texture2D(tDiffuse,vUv+d*ca).r,texture2D(tDiffuse,vUv).g,texture2D(tDiffuse,vUv-d*ca).b);
      float l=dot(c,vec3(.299,.587,.114));
      c=mix(vec3(l),c,sat*(1.-dmg*.6));
      c=(c-.5)*1.04+.5;
      c*=mix(vec3(.96,.99,1.04),vec3(1.04,1.,.95),smoothstep(.15,.85,l));
      c*=1.-dot(d,d)*vig;
      float n=fract(sin(dot(vUv*vec2(12.9898,78.233)+time,vec2(1.)))*43758.5453);
      c+=(n-.5)*.018;
      gl_FragColor=vec4(c,1.);
    }`,
});
composer.addPass(grade);

let DPR = 1;
export function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(DPR); renderer.setSize(w, h);
  composer.setPixelRatio(DPR); composer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

export function applyQuality(q = settings.quality) {
  const presets = {
    low: { dpr: 1, shadow: 1024, bloom: false, ao: false, msaa: 0 },
    medium: { dpr: 1, shadow: 2048, bloom: true, ao: false, msaa: 4 },
    high: { dpr: Math.min(devicePixelRatio || 1, 1.5), shadow: 4096, bloom: true, ao: false, msaa: 4 },
    ultra: { dpr: Math.min(devicePixelRatio || 1, 2), shadow: 4096, bloom: true, ao: true, msaa: 4 },
  };
  const p = presets[q] || presets.high;
  DPR = p.dpr;
  bloom.enabled = p.bloom;
  gtao.enabled = p.ao;
  if (sun.shadow.mapSize.x !== p.shadow) {
    sun.shadow.mapSize.set(p.shadow, p.shadow);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  for (const t of [composer.renderTarget1, composer.renderTarget2]) {
    if (t.samples !== p.msaa) { t.samples = p.msaa; t.dispose(); }
  }
  resize();
}

// ---------- sky ----------
export async function loadSky(url) {
  const loader = new RGBELoader().setDataType(THREE.FloatType);
  const tex = await loader.loadAsync(url);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  const { width: w, height: h, data } = tex.image;
  // find the sun (brightest pixel) and the horizon colour for fog
  let best = -1, bx = 0, by = 0;
  const hor = [0, 0, 0]; let hn = 0;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      const L = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
      if (L > best) { best = L; bx = x; by = y; }
      const v = 1 - (y + 0.5) / h;
      if (v > 0.5 && v < 0.535) { hor[0] += data[i]; hor[1] += data[i + 1]; hor[2] += data[i + 2]; hn++; }
    }
  }
  const u = (bx + 0.5) / w, v = 1 - (by + 0.5) / h;
  const az = (u - 0.5) * Math.PI * 2, el = (v - 0.5) * Math.PI;
  SUN.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).normalize();
  if (SUN.y < 0.15) { SUN.y = 0.15; SUN.normalize(); }

  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromEquirectangular(tex).texture;
  pm.dispose();
  scene.background = tex;
  scene.backgroundIntensity = 1.0;
  scene.environment = env;
  scene.environmentIntensity = 0.9;
  if (hn) {
    const k = 1 / hn;
    scene.fog.color.setRGB(hor[0] * k, hor[1] * k, hor[2] * k, THREE.LinearSRGBColorSpace);
  }
  return { sun: SUN.clone() };
}

export function useFallbackSky() {
  scene.background = new THREE.Color(0x9fb8d6);
  hemi.intensity = 1.2;
}

const _c = new THREE.Vector3();
export function updateShadow(center) {
  // keep the shadow frustum around the player, snapped to texels to avoid shimmering
  const texel = (sun.shadow.camera.right - sun.shadow.camera.left) / sun.shadow.mapSize.x;
  _c.copy(center);
  _c.x = Math.round(_c.x / texel) * texel; _c.z = Math.round(_c.z / texel) * texel; _c.y = 0;
  sun.target.position.copy(_c);
  sun.position.copy(_c).addScaledVector(SUN, 700);
}

export function render(dt) {
  grade.uniforms.time.value = (grade.uniforms.time.value + dt) % 100;
  composer.render(dt);
}
