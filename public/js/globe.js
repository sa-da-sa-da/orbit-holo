// 全息地球：不透明内核 + 全息着色外壳 + 大气辉光 + 星空
import * as THREE from 'three';

const VERT = /* glsl */`
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */`
precision highp float;
uniform sampler2D uLand;
uniform sampler2D uEdge;
uniform float uTime;
uniform float uGrid;
uniform float uLandAmt;
uniform float uOpacity;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;

float gridLine(float v) {
  float f = abs(fract(v + 0.5) - 0.5);
  float w = max(fwidth(v) * 1.35, 1e-5);
  return 1.0 - smoothstep(0.0, w, f);
}

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(vV);
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.4);

  float m = texture2D(uLand, vUv).a;
  float coast = texture2D(uEdge, vUv).a;

  float latDeg = (vUv.y - 0.5) * 180.0;
  float lonDeg = (vUv.x - 0.5) * 360.0;
  // 极区经线收敛保护，避免极点处糊成一片高亮
  float polar = smoothstep(0.55, 0.96, abs(vUv.y - 0.5) * 2.0);
  float grid = max(gridLine(latDeg / 15.0), gridLine(lonDeg / 15.0) * (1.0 - polar * 0.88));
  grid = max(grid, gridLine(latDeg / 90.0) * 1.25);
  grid *= uGrid;

  float equator = 1.0 - smoothstep(0.0, 0.03, abs(latDeg) / 180.0);
  float sweepY = fract(uTime * 0.045);
  float band = exp(-pow((vUv.y - sweepY) * 26.0, 2.0));

  vec3 col = vec3(0.030, 0.100, 0.140);
  col = mix(col, vec3(0.100, 0.420, 0.500) * uLandAmt, m * 0.78);
  col += vec3(0.180, 0.620, 0.760) * grid * (0.50 + 0.50 * m);
  col += vec3(0.450, 0.950, 1.000) * coast * (0.90 + 0.10 * sin(uTime * 2.2));
  col += vec3(0.250, 0.850, 1.000) * fres * 1.00;
  col += vec3(0.120, 0.600, 0.800) * band * 0.30;
  col += vec3(0.350, 0.920, 1.000) * equator * 0.18;

  float a = 0.55 + fres * 0.45 + coast * 0.50 + grid * 0.22 + band * 0.12 + m * 0.15;
  a = clamp(a, 0.0, 1.0) * uOpacity;

  // 极轻微噪点，强化全息质感
  float dither = fract(sin(dot(vUv * 1024.0, vec2(12.9898, 78.233))) * 43758.5453);
  a += (dither - 0.5) * 0.006;

  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}
`;

const ATMO_VERT = /* glsl */`
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const ATMO_FRAG = /* glsl */`
precision highp float;
uniform float uOpacity;
uniform vec3 uColor;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.6);
  gl_FragColor = vec4(uColor * f * 0.95, f * 0.7 * uOpacity);
}
`;

function makeStars(count = 3200) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1;
    const phi = Math.random() * Math.PI * 2;
    const r = 2400 + Math.random() * 1400;
    const s = Math.sqrt(1 - u * u);
    pos[i * 3] = r * s * Math.cos(phi);
    pos[i * 3 + 1] = r * u;
    pos[i * 3 + 2] = r * s * Math.sin(phi);
    const t = 0.35 + Math.random() * 0.5;
    const warm = Math.random() < 0.12;
    col[i * 3] = warm ? t : t * 0.72;
    col[i * 3 + 1] = t * 0.92;
    col[i * 3 + 2] = warm ? t * 0.85 : t;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 1.5,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geo, mat);
}

export function createGlobe({ radius = 100, landTexture = null, edgeTexture = null } = {}) {
  const group = new THREE.Group();
  group.name = 'globe';

  // 不透明内核：遮挡背面卫星，提供体积感
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 0.994, 64, 48),
    new THREE.MeshBasicMaterial({ color: 0x03080e })
  );
  core.renderOrder = 0;
  group.add(core);

  const uniforms = {
    uLand: { value: landTexture },
    uEdge: { value: edgeTexture },
    uTime: { value: 0 },
    uGrid: { value: 1 },
    uLandAmt: { value: landTexture ? 1 : 0 },
    uOpacity: { value: 1 },
  };

  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 128, 80),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.FrontSide,
      extensions: { derivatives: true },
    })
  );
  shell.renderOrder = 2;
  group.add(shell);

  const atmoUniforms = { uOpacity: { value: 1 }, uColor: { value: new THREE.Color(0x3fd8ff) } };
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.055, 64, 48),
    new THREE.ShaderMaterial({
      uniforms: atmoUniforms,
      vertexShader: ATMO_VERT,
      fragmentShader: ATMO_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
    })
  );
  atmosphere.renderOrder = 3;
  group.add(atmosphere);

  const stars = makeStars();
  stars.renderOrder = -1;
  group.add(stars);

  const layers = { grid: true, atmosphere: true, stars: true, land: true };
  const target = { grid: 1, atmosphere: 1, stars: 1, land: 1 };

  return {
    group,
    radius,
    uniforms,
    setLayer(key, on) {
      if (!(key in layers)) return;
      layers[key] = !!on;
      if (key === 'grid') target.grid = on ? 1 : 0;
      if (key === 'land') target.land = on ? 1 : 0;
      if (key === 'atmosphere') atmosphere.visible = !!on;
      if (key === 'stars') stars.visible = !!on;
    },
    getLayer(key) {
      return layers[key];
    },
    update(dt, elapsed) {
      uniforms.uTime.value = elapsed;
      uniforms.uGrid.value += (target.grid - uniforms.uGrid.value) * Math.min(1, dt * 8);
      uniforms.uLandAmt.value += (target.land * (landTexture ? 1 : 0) - uniforms.uLandAmt.value) * Math.min(1, dt * 8);
      atmoUniforms.uOpacity.value = 0.85 + Math.sin(elapsed * 0.6) * 0.06;
    },
  };
}
