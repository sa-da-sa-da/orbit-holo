// TopoJSON (world-atlas land-110m) → 等距圆柱投影陆地填充遮罩 + 海岸线描边遮罩
// 两张贴图给 globe.js 的全息地球着色器使用：fill 的 alpha=陆地，edge 的 alpha=海岸线发光

function decodeArcs(topo) {
  const tr = topo.transform;
  const sx = tr && tr.scale ? tr.scale[0] : 1;
  const sy = tr && tr.scale ? tr.scale[1] : 1;
  const tx = tr && tr.translate ? tr.translate[0] : 0;
  const ty = tr && tr.translate ? tr.translate[1] : 0;
  return topo.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    const out = new Array(arc.length);
    for (let i = 0; i < arc.length; i++) {
      x += arc[i][0];
      y += arc[i][1];
      out[i] = [x * sx + tx, y * sy + ty];
    }
    return out;
  });
}

function ringFrom(indices, arcs) {
  const pts = [];
  for (let k = 0; k < indices.length; k++) {
    const idx = indices[k];
    const arc = idx < 0 ? arcs[~idx].slice().reverse() : arcs[idx];
    for (let i = pts.length ? 1 : 0; i < arc.length; i++) pts.push(arc[i]);
  }
  return pts;
}

function collectGeometry(geom, arcs, out) {
  if (!geom) return;
  if (geom.type === 'GeometryCollection') {
    for (const g of geom.geometries || []) collectGeometry(g, arcs, out);
    return;
  }
  if (geom.type === 'Polygon') {
    out.push((geom.arcs || []).map((ring) => ringFrom(ring, arcs)));
  } else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.arcs || []) out.push(poly.map((ring) => ringFrom(ring, arcs)));
  }
}

/** @returns {Array<Array<Array<[number,number]>>>} 大陆/岛屿多边形（含洞） */
export function topoToPolygons(topo) {
  const arcs = decodeArcs(topo);
  const out = [];
  const objs = topo.objects || {};
  for (const key of Object.keys(objs)) collectGeometry(objs[key], arcs, out);
  return out;
}

function makeCanvas(W, H) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  return canvas;
}

/**
 * 同时生成填充与描边两张画布。
 * 经度平移 3 份以消除 180° 接缝。
 */
export function buildLandCanvases(polygons, W = 2048, H = 1024) {
  const fillCanvas = makeCanvas(W, H);
  const edgeCanvas = makeCanvas(W, H);
  const fill = fillCanvas.getContext('2d');
  const edge = edgeCanvas.getContext('2d');
  fill.clearRect(0, 0, W, H);
  edge.clearRect(0, 0, W, H);
  fill.fillStyle = '#ffffff';
  edge.strokeStyle = 'rgba(255,255,255,0.95)';
  edge.lineJoin = 'round';
  edge.lineCap = 'round';
  edge.lineWidth = 2.4;

  const project = (lon, lat) => [((lon + 180) / 360) * W, ((90 - lat) / 180) * H];

  for (const shift of [-360, 0, 360]) {
    for (const poly of polygons) {
      fill.beginPath();
      edge.beginPath();
      for (const ring of poly) {
        if (!ring || ring.length < 3) continue;
        for (let i = 0; i < ring.length; i++) {
          const [x, y] = project(ring[i][0] + shift, ring[i][1]);
          if (i === 0) {
            fill.moveTo(x, y);
            edge.moveTo(x, y);
          } else {
            fill.lineTo(x, y);
            edge.lineTo(x, y);
          }
        }
        fill.closePath();
        edge.closePath();
      }
      fill.fill('evenodd');
      edge.stroke();
    }
  }
  return { fillCanvas, edgeCanvas };
}

function makeTexture(THREE, canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** 加载陆地贴图；失败时返回 null（地球仍显示经纬网） */
export async function loadLandTextures(THREE, url, W = 2048, H = 1024) {
  try {
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const topo = await res.json();
    const polys = topoToPolygons(topo);
    const { fillCanvas, edgeCanvas } = buildLandCanvases(polys, W, H);
    return { fill: makeTexture(THREE, fillCanvas), edge: makeTexture(THREE, edgeCanvas) };
  } catch (err) {
    console.warn('[land] 陆地贴图加载失败：', err && err.message);
    return null;
  }
}
