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
uniform vec3 uSunDir;
uniform float uTerm;
uniform float uPrime;
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
  // 本初子午线（0°）与 180° 经线
  float merW = max(fwidth(lonDeg) * 1.6, 1e-4);
  float primeMeridian = 1.0 - smoothstep(0.0, merW, abs(lonDeg));
  float antiMeridian = 1.0 - smoothstep(0.0, merW, abs(abs(lonDeg) - 180.0));
  // 昼夜：以太阳方向与球面法线夹角判定，smoothstep 让晨昏线有过渡带
  float sunDot = dot(normalize(vN), normalize(uSunDir));
  // 昼夜分界：过渡带收窄（约 ±3.5°），夜面压得更暗，白天/黑夜一眼可分
  float night = smoothstep(0.062, -0.062, sunDot) * uTerm;
  float dayFac = smoothstep(-0.02, 0.30, sunDot);
  // 晨昏线：一条细亮线 + 一层很薄的暖色暮光
  float terminator = exp(-pow(sunDot * 52.0, 2.0)) * uTerm;
  float twilight = exp(-pow(sunDot * 7.0, 2.0)) * uTerm;
  float sweepY = fract(uTime * 0.045);
  float band = exp(-pow((vUv.y - sweepY) * 26.0, 2.0));

  // ---- 地球本色：海洋深蓝、陆地绿棕、极地雪白 ----
  float absLat = abs(latDeg);
  vec3 oceanDeep = vec3(0.018, 0.095, 0.190);
  vec3 oceanShallow = vec3(0.050, 0.270, 0.430);
  vec3 landGreen = vec3(0.115, 0.330, 0.150);
  vec3 landDry = vec3(0.520, 0.410, 0.215);
  vec3 landPolar = vec3(0.720, 0.780, 0.820);
  float dryBand = exp(-pow((absLat - 26.0) / 12.0, 2.0));
  vec3 land = mix(landGreen, landDry, clamp(dryBand, 0.0, 1.0) * 0.9);
  land = mix(land, landPolar, smoothstep(58.0, 76.0, absLat));
  vec3 ocean = mix(oceanShallow, oceanDeep, smoothstep(0.0, 52.0, absLat) * 0.75);
  vec3 col = mix(ocean, land, clamp(m * (0.35 + 0.65 * uLandAmt), 0.0, 1.0));
  // 白天略提亮，让受光面更实
  col *= mix(0.88, 1.16, dayFac);
  // 夜面：先压暗到接近黑，再叠加冷色环境光（"夜半球"一眼可辨）
  vec3 nightTint = vec3(0.030, 0.075, 0.150);
  col = mix(col, col * 0.13 + nightTint * 0.22, night);
  // 全息线框在夜里要收敛，否则黑夜看起来还是亮的
  float lineVis = 1.0 - night * 0.82;
  col += vec3(0.180, 0.620, 0.760) * grid * (0.30 + 0.40 * m) * lineVis;
  col += vec3(0.520, 0.980, 1.000) * coast * (1.05 + 0.10 * sin(uTime * 2.2)) * lineVis;
  col += vec3(0.250, 0.780, 1.000) * fres * 0.85 * lineVis;
  col += vec3(0.120, 0.600, 0.800) * band * 0.22 * lineVis;
  col += vec3(0.350, 0.920, 1.000) * equator * 0.18 * lineVis;
  col += vec3(0.980, 0.760, 0.320) * primeMeridian * uPrime * 0.85 * lineVis;
  col += vec3(0.540, 0.760, 0.980) * antiMeridian * uPrime * 0.45 * lineVis;
  // 暮光暖带（很薄）+ 细亮晨昏线
  col += vec3(1.000, 0.560, 0.230) * twilight * 0.30;
  col += vec3(1.000, 0.880, 0.560) * terminator * 0.95;

  float a = 0.92 + fres * 0.08 + coast * 0.10 + grid * 0.08 + band * 0.05;
  a += primeMeridian * uPrime * 0.20 + terminator * 0.30 + twilight * 0.08;
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
    size: 1.15,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0.6,
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
  uSunDir: { value: new THREE.Vector3(1, 0, 0) },
  uTerm: { value: 1 },
  uPrime: { value: 1 },
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

  const layers = { grid: true, atmosphere: true, stars: true, land: true, terminator: true, meridian: true };
  const target = { grid: 1, atmosphere: 1, stars: 1, land: 1, terminator: 1, meridian: 1 };

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
      if (key === 'terminator') target.terminator = on ? 1 : 0;
      if (key === 'meridian') target.meridian = on ? 1 : 0;
    },
    getLayer(key) {
      return layers[key];
    },
    /** 太阳方向（ECEF 单位向量，世界坐标）→ 驱动晨昏线 */
    setSunDir(v) {
      if (!v) return;
      uniforms.uSunDir.value.set(v.x, v.y, v.z).normalize();
    },
    update(dt, elapsed) {
      uniforms.uTerm.value += (target.terminator - uniforms.uTerm.value) * Math.min(1, dt * 8);
      uniforms.uPrime.value += (target.meridian - uniforms.uPrime.value) * Math.min(1, dt * 8);
      uniforms.uTime.value = elapsed;
      uniforms.uGrid.value += (target.grid - uniforms.uGrid.value) * Math.min(1, dt * 8);
      uniforms.uLandAmt.value += (target.land * (landTexture ? 1 : 0) - uniforms.uLandAmt.value) * Math.min(1, dt * 8);
      atmoUniforms.uOpacity.value = 0.85 + Math.sin(elapsed * 0.6) * 0.06;
    },
  };
}
