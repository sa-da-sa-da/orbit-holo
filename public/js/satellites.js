// 卫星点云层：加法混合光点、屏幕空间拾取、轨道线、选中标记
import * as THREE from 'three';

const SAT_VERT = /* glsl */`
attribute vec3 color;
attribute float aSize;
attribute float aHidden;
uniform float uPixelRatio;
uniform float uScale;
uniform float uMinSize;
uniform float uEarthR;
varying vec3 vColor;
varying float vBoost;
void main() {
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = max(-mv.z, 1.0);
  // 距离衰减放缓（指数 0.72）：远处的 GEO/高轨目标不再缩成一个暗点
  float atten = pow(260.0 / d, 0.72);
  float s = aSize * uScale * uPixelRatio * atten * 1.50;
  float ps = clamp(s, uMinSize * uPixelRatio, 30.0);
  // 地球遮挡：视线与地球球体相交时整点丢弃（避免"穿模"看到球背面的卫星）
  vec3 rd = normalize(position - cameraPosition);
  float b = dot(cameraPosition, rd);
  float c = dot(cameraPosition, cameraPosition) - uEarthR * uEarthR;
  float h = b * b - c;
  float occluded = 0.0;
  if (h > 0.0) {
    float t = -b - sqrt(h);
    if (t > 0.0 && t < distance(position, cameraPosition)) occluded = 1.0;
  }
  gl_PointSize = mix(ps, 0.0, max(step(0.5, aHidden), occluded));
  // 越远越提亮，避免与背景星空混淆
  vBoost = mix(1.0, 1.5, smoothstep(260.0, 900.0, d));
}
`;

const SAT_FRAG = /* glsl */`
uniform float uOpacity;
varying vec3 vColor;
varying float vBoost;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float core = smoothstep(0.5, 0.0, d);
  float a = pow(core, 1.7);
  // 远处目标：核心更实、亮度更高，保证与星空可分辨
  vec3 col = vColor * (0.58 + 1.30 * a) * vBoost;
  gl_FragColor = vec4(col, min(1.0, a * uOpacity * vBoost));
}
`;

export function createSatLayer({ count, pixelRatio = 1 }) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const hidden = new Float32Array(count);
  sizes.fill(1.8);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aHidden', new THREE.BufferAttribute(hidden, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2000);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uPixelRatio: { value: pixelRatio },
      uOpacity: { value: 1 },
      uScale: { value: 1 },
    uMinSize: { value: 4.0 },
    uEarthR: { value: 100.0 },
    },
    vertexShader: SAT_VERT,
    fragmentShader: SAT_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 5;

  const attrs = {
    position: geometry.getAttribute('position'),
    color: geometry.getAttribute('color'),
    size: geometry.getAttribute('aSize'),
    hidden: geometry.getAttribute('aHidden'),
  };

  const scratch = new THREE.Vector3();

  return {
    points,
    geometry,
    material,
    positions,
    colors,
    sizes,
    hidden,
    /** 直接写入 worker 传来的位置缓冲（世界坐标，单位 = 地球半径 100） */
    setPositionBuffer(buf) {
      positions.set(buf);
      attrs.position.needsUpdate = true;
    },
    commitColors() {
      attrs.color.needsUpdate = true;
    },
    commitSizes() {
      attrs.size.needsUpdate = true;
    },
    commitHidden() {
      attrs.hidden.needsUpdate = true;
    },
    setOpacity(v) {
      material.uniforms.uOpacity.value = v;
    },
    setMinSize(v) {
      material.uniforms.uMinSize.value = v;
    },
    setScale(v) {
      material.uniforms.uScale.value = v;
    },
    setPixelRatio(r) {
      material.uniforms.uPixelRatio.value = r;
    },
    hideAll() {
      hidden.fill(1);
      attrs.hidden.needsUpdate = true;
    },
    /**
     * 屏幕空间拾取：返回距离鼠标最近的卫星索引（<= 阈值像素），否则 -1
     */
    /** 调试用：解释某颗卫星为什么没被拾取 */
    debugPick(i, camera, ndcX, ndcY) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const px = (ndcX * 0.5 + 0.5) * w;
      const py = (0.5 - ndcY * 0.5) * h;
      const v = new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      const out = { i, raw: [v.x, v.y, v.z], hidden: hidden[i] };
      out.occluded = occludedByEarth(camera, v.x, v.y, v.z);
      out.radial = v.length();
      v.project(camera);
      out.projected = [v.x, v.y, v.z];
      out.screen = [(v.x * 0.5 + 0.5) * w, (-v.y * 0.5 + 0.5) * h];
      out.dist = Math.hypot(out.screen[0] - px, out.screen[1] - py);
      return out;
    },
    /** 返回鼠标附近若干候选（按像素距离升序），用于"多目标选择"弹层 */
    pickAll(ndcX, ndcY, camera, maxPixels = 18, maxResults = 8, maxCount = count, hiddenMask = hidden) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const px = (ndcX * 0.5 + 0.5) * w;
      const py = (0.5 - ndcY * 0.5) * h; // NDC y 向上，屏幕 y 向下
      const found = [];
      const limit2 = maxPixels * maxPixels;
      for (let i = 0; i < maxCount; i++) {
        if (hiddenMask[i] > 0.5) continue;
        scratch.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
        if (scratch.lengthSq() < 1e-6) continue;
        if (occludedByEarth(camera, scratch.x, scratch.y, scratch.z)) continue;
        scratch.project(camera);
        if (scratch.z > 1) continue;
        const sx = (scratch.x * 0.5 + 0.5) * w;
        const sy = (-scratch.y * 0.5 + 0.5) * h;
        const d2 = (sx - px) * (sx - px) + (sy - py) * (sy - py);
        if (d2 <= limit2) found.push({ index: i, dist: Math.sqrt(d2) });
      }
      found.sort((a, b) => a.dist - b.dist);
      return found.slice(0, maxResults);
    },
    /**
     * 屏幕空间拾取：返回距离鼠标最近的卫星索引（<= 阈值像素），否则 -1
     */
    pick(ndcX, ndcY, camera, maxPixels = 12, maxCount = count, hiddenMask = hidden) {
      let best = -1;
      let bestDist = maxPixels * maxPixels;
      const w = window.innerWidth;
      const h = window.innerHeight;
      for (let i = 0; i < maxCount; i++) {
        if (hiddenMask[i] > 0.5) continue;
        scratch.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
        if (scratch.lengthSq() < 1e-6) continue;
        if (occludedByEarth(camera, scratch.x, scratch.y, scratch.z)) continue;
        scratch.project(camera);
        if (scratch.z > 1) continue;
        const sx = (scratch.x * 0.5 + 0.5) * w;
        const sy = (-scratch.y * 0.5 + 0.5) * h;
        const dx = sx - (ndcX * 0.5 + 0.5) * w;
        const dy = sy - (0.5 - ndcY * 0.5) * h;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDist) {
          bestDist = d2;
          best = i;
        }
      }
      return best;
    },
  };
}

const EARTH_OCCLUDE_R = 99.0;
/** 地球是否挡住了相机与该点的连线（相机、球心在原点） */
export function occludedByEarth(camera, x, y, z) {
  const ox = camera.position.x;
  const oy = camera.position.y;
  const oz = camera.position.z;
  const dx = x - ox;
  const dy = y - oy;
  const dz = z - oz;
  const a = dx * dx + dy * dy + dz * dz;
  if (a < 1e-6) return false;
  const t = -(ox * dx + oy * dy + oz * dz) / a;
  if (t <= 0.001 || t >= 1) return false;
  const cx = ox + dx * t;
  const cy = oy + dy * t;
  const cz = oz + dz * t;
  return cx * cx + cy * cy + cz * cz < EARTH_OCCLUDE_R * EARTH_OCCLUDE_R;
}

export function createOrbitLine({ color = 0x5ef0ff, opacity = 0.5, linewidth = 1, maxPoints = 512, closed = true } = {}) {
  const positions = new Float32Array(maxPoints * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setDrawRange(0, 0);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4000);
  // 自定义材质：与卫星点一致做「地球遮挡剔除」，避免轨道线穿过地球（穿模）
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uEarthR: { value: 100.0 },
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uEarthR;
      varying vec3 vWorld;
      void main() {
        vec3 rd = normalize(vWorld - cameraPosition);
        float b = dot(cameraPosition, rd);
        float c = dot(cameraPosition, cameraPosition) - uEarthR * uEarthR;
        float h = b * b - c;
        if (h > 0.0) {
          float t = -b - sqrt(h);
          if (t > 0.0 && t < distance(vWorld, cameraPosition)) discard;
        }
        gl_FragColor = vec4(uColor, uOpacity);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const line = closed ? new THREE.LineLoop(geometry, material) : new THREE.Line(geometry, material);
  line.frustumCulled = false;
  line.renderOrder = 4;
  return {
    line,
    material,
    setPoints(flat) {
      const n = Math.min(flat.length / 3, maxPoints);
      positions.set(flat.subarray(0, n * 3));
      geometry.setDrawRange(0, n);
      geometry.getAttribute('position').needsUpdate = true;
      geometry.computeBoundingSphere();
    },
    clear() {
      geometry.setDrawRange(0, 0);
    },
    setColor(c) {
      if (material.uniforms && material.uniforms.uColor) material.uniforms.uColor.value.set(c);
      else if (material.color) material.color.set(c);
    },
    setOpacity(o) {
      if (material.uniforms && material.uniforms.uOpacity) material.uniforms.uOpacity.value = o;
      else material.opacity = o;
    },
    setVisible(v) {
      line.visible = v;
    },
  };
}

/** 选中标记：脉冲准星环 */
export function createSelectionMarker({ color = 0x9ffcff, scale = 11 } = {}) {
  const baseScale = scale;
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  const cx = S / 2;
  const cy = S / 2;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  // 环
  ctx.beginPath();
  ctx.arc(cx, cy, S * 0.3, 0, Math.PI * 2);
  ctx.stroke();
  // 四角刻线
  ctx.lineWidth = 2.5;
  const r0 = S * 0.36;
  const r1 = S * 0.47;
  for (let k = 0; k < 4; k++) {
    const a = (Math.PI / 2) * k + Math.PI / 4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.stroke();
  }
  // 中心点
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    color: new THREE.Color(color),
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.95,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.setScalar(baseScale);
  sprite.renderOrder = 10;
  sprite.visible = false;
  return {
    sprite,
    setColor(c) {
      mat.color.set(c);
    },
    place(x, y, z) {
      sprite.position.set(x, y, z);
      sprite.visible = true;
    },
    hide() {
      sprite.visible = false;
    },
    update(t) {
      const s = baseScale * (1 + Math.sin(t * 4.0) * 0.10);
      sprite.scale.setScalar(s);
    },
  };
}
