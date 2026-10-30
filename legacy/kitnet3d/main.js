'use strict';
/* =========================================================================
   KitNet 3D — transforma planta baixa 2D em simulação 3D de espaços pequenos
   Site estático — planta 2D com vista 3D completa (Three.js) e perspectiva
   3D aérea ao passar o mouse.
   ========================================================================= */
import * as THREE from 'three';
import { OrbitControls } from './vendor/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from './vendor/renderers/CSS2DRenderer.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rad = (d) => (d * Math.PI) / 180;
const round2 = (v) => Math.round(v * 1000) / 1000;

/* ----------------------------- constantes ------------------------------ */
const WALL_H = 2.6;   // pé-direito (m)
const WALL_T = 0.15;  // espessura da parede (m)
const SNAP = 0.1;
const MPAGO_LINKS = {
  avulso:    'https://mpago.la/25zi72B',
  essencial: 'https://mpago.la/1AF3asn',
  pro:       'https://mpago.la/2eL1BXa',
}; // Links de pagamento do Mercado Pago (ex.: https://mpago.la/XXXXXXXX)

const FURNITURE_DEFS = {
  cama:     { label: 'Cama',         emoji: '🛏️', w: 2.0,  d: 1.6,  color: '#a8c8e0' },
  sofa:     { label: 'Sofá',         emoji: '🛋️', w: 2.0,  d: 0.9,  color: '#c9a8d8' },
  mesa:     { label: 'Mesa',         emoji: '🍽️', w: 0.9,  d: 0.9,  color: '#d8c9a8' },
  cadeira:  { label: 'Cadeira',      emoji: '🪑', w: 0.45, d: 0.45, color: '#b8c9a8' },
  cozinha:  { label: 'Cozinha/Pia',  emoji: '🚰', w: 2.0,  d: 0.6,  color: '#a8d8c8' },
  fogao:    { label: 'Fogão',        emoji: '🍳', w: 0.6,  d: 0.6,  color: '#d0d0d8' },
  geladeira:{ label: 'Geladeira',    emoji: '🧊', w: 0.7,  d: 0.75, color: '#cfe0ea' },
  rouparia: { label: 'Guarda-roupa', emoji: '👕', w: 1.6,  d: 0.6,  color: '#d8b8a0' },
  vaso:     { label: 'Vaso sanit.',  emoji: '🚽', w: 0.45, d: 0.7,  color: '#e8e8ec' },
  chuveiro: { label: 'Chuveiro',     emoji: '🚿', w: 0.9,  d: 0.9,  color: '#bfe0ee' },
  piaB:     { label: 'Pia banheiro', emoji: '🧼', w: 0.6,  d: 0.5,  color: '#e0d8c8' },
  maquina:  { label: 'Máq. lavar',   emoji: '🧺', w: 0.6,  d: 0.6,  color: '#eaeaea' },
  tv:       { label: 'TV',           emoji: '📺', w: 1.2,  d: 0.1,  color: '#2c3340' },
  porta:    { label: 'Porta',        emoji: '🚪', w: 0.9,  d: 0.1,  color: '#a8895f' },
  janela:   { label: 'Janela',       emoji: '🪟', w: 1.2,  d: 0.1,  color: '#8fc7e8' },
  planta:   { label: 'Planta',       emoji: '🪴', w: 0.4,  d: 0.4,  color: '#8fca8f' },
};
const FURN_TYPES = Object.keys(FURNITURE_DEFS);

/* ------------------------------- estado -------------------------------- */
const proj = {
  walls: [],        // {x1,y1,x2,y2}
  furniture: [],    // {type,x,y,rot,id}
  bg: null,         // { src,width,height,scale,x,y,visible }
  colors: { wall: '#f4f1ea', floor: '#e9e3d5' },
};
const layers = { walls: true, furn: true, bg: true, types: {} };
FURN_TYPES.forEach((t) => { layers.types[t] = true; });
let view = { scale: 80, ox: 80, oy: 60 };
let tool = 'wall';
let selFurnType = 'cama';
let selId = null;
let selWall = -1;
let wallChain = [];
let undoStack = [];
let redoStack = [];
let lastId = 1;
const mouse = { x: 0, y: 0, wx: 0, wy: 0 };
let isDown = false;
let drag = null;
let spaceDown = false;
const bgImageCache = {};

/* --------------------------- multi-desenhos ----------------------------- */
const PROJECTS_KEY = 'kitnet3d_projects';   // [{id,name,updated,walls,furn}]
const PROJ_PREFIX = 'kitnet3d_proj_';       // kitnet3d_proj_<id>
const ACTIVE_KEY = 'kitnet3d_current';      // id ativo
let currentId = 'default';
let curName = 'Meu desenho';

/* ------------------------------- planos -------------------------------- */
const PLANS = {
  free:      { name: 'Grátis',    price: 0,    dias: 0,  maxWalls: 1,   maxFurn: 1,    maxProjects: 1,
               export: false, detect: false, shadows: false, teto: false },
  avulso:    { name: 'Avulso',    price: 9.9,  dias: 1,  maxWalls: 2,   maxFurn: 2,    maxProjects: 3,
               export: true, detect: true, shadows: true, teto: true },
  essencial: { name: 'Essencial', price: 24.9, dias: 30, maxWalls: 3,   maxFurn: 5,    maxProjects: 10,
               export: true, detect: false, shadows: true, teto: true },
pro:       { name: 'Pro',       price: 79.9, dias: 30, maxWalls: 999, maxFurn: 999, maxProjects: 999,
               export: true, detect: true, shadows: true, teto: true },
};
const PLAN_ORDER = ['free', 'avulso', 'essencial', 'pro'];
let plan = 'free';
let planExpires = null;

function getPlan() { return PLANS[plan] || PLANS.free; }

function planForKey(k) { return PLANS[k] ? k : 'free'; }

function loadPlan() {
  try {
    const s = JSON.parse(localStorage.getItem('kitnet3d_plan') || 'null');
    if (!s) return;
    plan = planForKey(s.plan);
    planExpires = s.expires ? new Date(s.expires) : null;
    if (plan !== 'free' && planExpires && planExpires < new Date()) {
      plan = 'free'; planExpires = null; savePlan();
      setTimeout(() => toast('Seu plano pago expirou. Plano Grátis reativado.'), 900);
    }
  } catch (e) {}
  updatePlanUI();
}
function savePlan() {
  try {
    localStorage.setItem('kitnet3d_plan', JSON.stringify({
      plan, expires: planExpires ? planExpires.toISOString() : null,
    }));
  } catch (e) {}
}
function applyPlan(p, expires) {
  plan = planForKey(p); planExpires = expires || null;
  savePlan(); updatePlanUI();
  toast(plan === 'free' ? 'Plano Grátis' : ('Plano ' + PLANS[plan].name + ' ativado'));
}
function openUpgrade(reason) {
  const reasons = {
    walls:   'Você atingiu o limite de paredes do seu plano.',
    furn:    'Você atingiu o limite de móveis do seu plano.',
    projects:'Você atingiu o limite de desenhos salvos do seu plano.',
    export:  'Exportar o projeto em JSON é um recurso dos planos pagos.',
    detect:  'A detecção automática de paredes é um recurso do Avulso e Pro.',
    shadows: 'Sombras na vista 3D é um recurso dos planos pagos.',
    teto:    'O teto na vista 3D é um recurso dos planos pagos.',
  };
  $('upgradeReason').textContent = (reasons[reason] || '') + ' Faça upgrade para liberar os limites.';
  $('upgradeOverlay').classList.remove('hidden');
}
function closeUpgrade() { $('upgradeOverlay').classList.add('hidden'); }
function requirePro(feature) {
  if (getPlan()[feature]) return true;
  openUpgrade(feature);
  return false;
}
function canAddWalls() { return proj.walls.length < getPlan().maxWalls; }
function canAddFurn() { return proj.furniture.length < getPlan().maxFurn; }

function updatePlanUI() {
  const p = getPlan();
  $('planName').textContent = p.name;
  $('planBadge').textContent = p.name;
  $('planBadge').classList.toggle('pro', plan !== 'free');
  $('planNote').textContent = planExpires
    ? (' · expira ' + planExpires.toLocaleDateString('pt-BR'))
    : (plan !== 'free' ? ' · ativo' : '');
  $('maxWalls').textContent = p.maxWalls >= 900 ? '∞' : p.maxWalls;
  $('maxFurn').textContent = p.maxFurn >= 900 ? '∞' : p.maxFurn;
  $('useWalls').textContent = proj.walls.length;
  $('useFurn').textContent = proj.furniture.length;
  paintMeter($('meterWalls'), proj.walls.length, p.maxWalls);
  paintMeter($('meterFurn'), proj.furniture.length, p.maxFurn);
  const nProj = listProjects().length;
  $('maxProj').textContent = p.maxProjects >= 900 ? '∞' : p.maxProjects;
  $('useProj').textContent = nProj;
  paintMeter($('meterProjects'), nProj, p.maxProjects);
  $('btnExport').innerHTML = p.export ? '⇩ <b>Exportar</b>' : '⇩ <b>Exportar</b> · <span style="color:#4cc2ff">PRO</span>';
  $('btnSolve').innerHTML = p.detect ? '🔍 <b>Detectar</b>' : '🔍 <b>Detectar</b> · <span style="color:#4cc2ff">PRO</span>';
}
function paintMeter(el, used, max) {
  const full = max >= 900 ? 0 : used / Math.max(1, max);
  el.style.width = (Math.min(1, full) * 100).toFixed(1) + '%';
  el.parentElement.classList.toggle('full', max < 900 && used >= max);
}

/* ------------------------------- DOM/2D -------------------------------- */
const c2 = { cn: $('c2d') };
c2.ctx = c2.cn.getContext('2d');

function resize2d() {
  const dpr = window.devicePixelRatio || 1;
  c2.cn.width = Math.max(1, Math.round(c2.cn.clientWidth * dpr));
  c2.cn.height = Math.max(1, Math.round(c2.cn.clientHeight * dpr));
  c2.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  resizeV3d();
  draw2d();
}
window.addEventListener('resize', () => resize2d());

function w2s(wx, wy) { return [wx * view.scale + view.ox, wy * view.scale + view.oy]; }
function s2w(sx, sy) { return [(sx - view.ox) / view.scale, (sy - view.oy) / view.scale]; }
function snap(v) { return Math.round(v / SNAP) * SNAP; }

/* ------------------------------ desenho 2D ----------------------------- */
function draw2d() {
  const W = c2.cn.clientWidth, H = c2.cn.clientHeight;
  if (!W || !H) return;
  draw2dTo(c2.ctx, W, H);
  renderAerial();
}

function draw2dTo(ctx, W, H, noCursor) {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#f4f6f8';
  ctx.fillRect(0, 0, W, H);
  drawBg(ctx, W, H);
  if ($('chkGrid').checked) drawGrid(ctx, W, H);
  if (layers.walls) drawWalls(ctx);
  if (layers.furn) drawFurniture(ctx);
  if (!noCursor) drawCursor(ctx);
}

function drawBg(ctx, W, H) {
  if (!layers.bg) return;
  const bg = proj.bg;
  if (!bg || !bg.visible) return;
  const img = bgImageCache[bg.src];
  if (!img || !img.complete) return;
  const x1 = bg.x + img.width * bg.scale, y1 = bg.y + img.height * bg.scale;
  const [sx0, sy0] = w2s(bg.x, bg.y);
  const [sx1, sy1] = w2s(x1, y1);
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.drawImage(img, sx0, sy0, sx1 - sx0, sy1 - sy0);
  ctx.restore();
  ctx.strokeStyle = 'rgba(43,155,216,.7)';
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(sx0, sy0, sx1 - sx0, sy1 - sy0);
  ctx.setLineDash([]);
}

const GRID_MINOR = 0.5;

function drawGrid(ctx, W, H) {
  const [x0, y0] = s2w(0, 0);
  const [x1, y1] = s2w(W, H);
  const g = GRID_MINOR;
  ctx.font = '10px system-ui';
  const a = Math.floor(Math.min(x0, x1) / g), b = Math.ceil(Math.max(x0, x1) / g);
  for (let i = a; i <= b; i++) {
    const vx = i * g;
    const major = Math.abs(vx - Math.round(vx)) < 0.0001;
    const [sx] = w2s(vx, 0);
    ctx.strokeStyle = major ? 'rgba(20,30,45,.18)' : 'rgba(20,30,45,.09)';
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke();
    if (major) {
      ctx.fillStyle = 'rgba(20,30,45,.5)';
      ctx.fillText(vx.toFixed(0) + 'm', sx + 3, 12);
    }
    const [syv] = w2s(0, vx);
    ctx.strokeStyle = major ? 'rgba(20,30,45,.18)' : 'rgba(20,30,45,.09)';
    ctx.beginPath(); ctx.moveTo(0, syv); ctx.lineTo(W, syv); ctx.stroke();
    if (major && vx !== 0) {
      ctx.fillStyle = 'rgba(20,30,45,.5)';
      ctx.fillText(vx.toFixed(0) + 'm', 3, syv - 3);
    }
  }
}

function drawWalls(ctx) {
  for (let i = 0; i < proj.walls.length; i++) {
    const wl = proj.walls[i];
    const [x1, y1] = w2s(wl.x1, wl.y1);
    const [x2, y2] = w2s(wl.x2, wl.y2);
    const pxw = Math.max(3, WALL_T * view.scale);
    ctx.strokeStyle = i === selWall ? '#ff8c3a' : '#2a3240';
    ctx.lineWidth = pxw;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.fillStyle = '#6b7686';
    ctx.beginPath(); ctx.arc(x1, y1, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x2, y2, 2.5, 0, Math.PI * 2); ctx.fill();
  }
  if (wallChain.length) {
    ctx.strokeStyle = '#2b9bd8';
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 2;
    for (let i = 0; i < wallChain.length - 1; i++) {
      const [x1, y1] = w2s(wallChain[i][0], wallChain[i][1]);
      const [x2, y2] = w2s(wallChain[i + 1][0], wallChain[i + 1][1]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    const lp = wallChain[wallChain.length - 1];
    const [px, py] = w2s(lp[0], lp[1]);
    const [mx, my] = w2s(mouse.wx, mouse.wy);
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(mx, my); ctx.stroke();
    ctx.setLineDash([]);
  }
}

function rectCorners(w, d, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const hs = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
  return hs.map(([a, b]) => [a * c - b * s, a * s + b * c]);
}

function drawItemSlot(ctx, w, d, rot, cx, cy, def, fillAlpha) {
  const corners = rectCorners(w, d, rot).map(([a, b]) => w2s(cx + a, cy + b));
  ctx.globalAlpha = fillAlpha == null ? 0.75 : fillAlpha;
  ctx.fillStyle = def.color;
  ctx.beginPath();
  ctx.moveTo(corners[0][0], corners[0][1]);
  for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i][0], corners[i][1]);
  ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#3a4350';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const [sx, sy] = w2s(cx, cy);
  ctx.fillStyle = 'rgba(20,30,45,.8)';
  ctx.font = '10px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(def.emoji, sx, sy + 3.5);
  ctx.textAlign = 'left';
}

function drawFurniture(ctx) {
  for (const it of proj.furniture) {
    if (!layers.types[it.type]) continue;
    const def = FURNITURE_DEFS[it.type];
    drawItemSlot(ctx, def.w, def.d, rad(it.rot), it.x, it.y, def);
    if (it.id === selId) {
      const [sx, sy] = w2s(it.x, it.y);
      ctx.strokeStyle = '#ff8c3a';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(sx - 14, sy - 14, 28, 28);
      ctx.setLineDash([]);
      ctx.fillStyle = '#ff8c3a';
      ctx.font = 'bold 10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(def.label, sx, sy - 18);
      ctx.textAlign = 'left';
    }
  }
  if (tool === 'furn' && !drag && layers.types[selFurnType]) {
    const def = FURNITURE_DEFS[selFurnType];
    const gx = $('chkSnap').checked ? snap(mouse.wx) : mouse.wx;
    const gy = $('chkSnap').checked ? snap(mouse.wy) : mouse.wy;
    drawItemSlot(ctx, def.w, def.d, 0, gx, gy, def, 0.35);
  }
}

function drawCursor(ctx) {
  const [sx, sy] = w2s(mouse.wx, mouse.wy);
  if (tool === 'wall' || tool === 'furn' || tool === 'erase') {
    const onSnap = $('chkSnap').checked;
    ctx.strokeStyle = onSnap ? '#ff8c3a' : '#2b9bd8';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx - 11, sy); ctx.lineTo(sx - 3, sy);
    ctx.moveTo(sx + 3, sy); ctx.lineTo(sx + 11, sy);
    ctx.moveTo(sx, sy - 11); ctx.lineTo(sx, sy - 3);
    ctx.moveTo(sx, sy + 3); ctx.lineTo(sx, sy + 11);
    ctx.stroke();
  }
}

/* ------------------------------ utilidades ----------------------------- */
function nextId() { return lastId++; }

function pushUndo() {
  undoStack.push(stateJSON());
  if (undoStack.length > 60) undoStack.shift();
  redoStack.length = 0;
  updateNav();
}
function stateJSON() {
  return JSON.stringify({ walls: proj.walls, furniture: proj.furniture, bg: bgMeta(), colors: proj.colors, layers, mats: proj.mats });
}
function bgMeta() {
  const b = proj.bg;
  return b ? { src: b.src, width: b.width, height: b.height, scale: b.scale, x: b.x, y: b.y, visible: b.visible } : null;
}
function undo() {
  const s = undoStack.pop();
  if (!s) { toast('Nada para voltar'); return; }
  redoStack.push(stateJSON());
  const d = JSON.parse(s);
  proj.walls = d.walls; proj.furniture = d.furniture; proj.bg = d.bg;
  proj.mats = Object.assign({ wall: 'massa' }, d.mats || {});
  if (d.colors) proj.colors = Object.assign({ wall: '#f4f1ea', floor: '#e9e3d5' }, d.colors);
  if (d.layers) applyLayerState(d.layers);
  selId = null; selWall = -1; wallChain = [];
  scheduleSave(); toast('Voltou');
  draw2d(); updateStats(); updateNav(); syncColors();
}
function redo() {
  const s = redoStack.pop();
  if (!s) { toast('Nada para avançar'); return; }
  undoStack.push(stateJSON());
  const d = JSON.parse(s);
  proj.walls = d.walls; proj.furniture = d.furniture; proj.bg = d.bg;
  proj.mats = Object.assign({ wall: 'massa' }, d.mats || {});
  if (d.colors) proj.colors = Object.assign({ wall: '#f4f1ea', floor: '#e9e3d5' }, d.colors);
  if (d.layers) applyLayerState(d.layers);
  selId = null; selWall = -1; wallChain = [];
  scheduleSave(); toast('Avançou');
  draw2d(); updateStats(); updateNav(); syncColors();
}
function updateNav() {
  const u = $('btnUndo'), r = $('btnRedo');
  if (u) u.classList.toggle('disabled', !undoStack.length);
  if (r) r.classList.toggle('disabled', !redoStack.length);
  renderProps();
}

function renderProps() {
  const p = $('propsPanel');
  if (!p) return;
  const item = selId != null ? proj.furniture.find((f) => f.id === selId) : null;
  if (item) {
    const def = FURNITURE_DEFS[item.type];
    p.innerHTML =
      `<div class="prow"><b>${def.emoji} ${esc(def.label)}</b><span>rot ${item.rot}°</span></div>` +
      `<div class="prow small">X <b>${item.x.toLocaleString('pt-BR')}</b> · Y <b>${item.y.toLocaleString('pt-BR')}</b> m</div>` +
      `<div class="prow small">Tamanho ${def.w.toLocaleString('pt-BR')} × ${def.d.toLocaleString('pt-BR')} m</div>` +
      `<div class="gacts">` +
      `<button class="btn" id="prRot" title="Girar 90° (R)">⟳ Girar</button>` +
      `<button class="btn" id="prDup" title="Duplicar">⧉ Copiar</button>` +
      `<button class="btn danger" id="prDel" title="Excluir (Delete)">✕ Apagar</button>` +
      `</div>`;
    $('prRot').onclick = rotateSelected;
    $('prDup').onclick = duplicateSelected;
    $('prDel').onclick = deleteSelected;
  } else if (selWall >= 0 && proj.walls[selWall]) {
    const wl = proj.walls[selWall];
    const len = Math.hypot(wl.x2 - wl.x1, wl.y2 - wl.y1);
    p.innerHTML =
      `<div class="prow"><b>🧱 Parede</b><span>${len.toLocaleString('pt-BR')} m</span></div>` +
      `<div class="prow small">de (${wl.x1.toFixed(2)}, ${wl.y1.toFixed(2)}) até (${wl.x2.toFixed(2)}, ${wl.y2.toFixed(2)})</div>` +
      `<div class="gacts"><button class="btn danger" id="prDelW" title="Excluir (Delete)">✕ Apagar</button></div>`;
    const b = $('prDelW'); if (b) b.onclick = deleteSelected;
  } else {
    p.innerHTML = '<div class="hint">Clique em um móvel ou parede para inspecionar e editar.</div>';
  }
}

function duplicateSelected() {
  if (selId == null) return;
  const src = proj.furniture.find((f) => f.id === selId);
  if (!src) return;
  if (!canAddFurn()) { openUpgrade('furn'); return; }
  pushUndo();
  const it = { type: src.type, x: round2(src.x + 0.3), y: round2(src.y + 0.3), rot: src.rot, id: nextId() };
  proj.furniture.push(it);
  selId = it.id;
  scheduleSave(); updateStats(); draw2d();
}
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2000);
}
function projectDataObj() {
  return { walls: proj.walls, furniture: proj.furniture, bg: bgMeta(), colors: proj.colors, layers, mats: proj.mats, lastId };
}
function saveAuto() {
  const data = projectDataObj();
  try { localStorage.setItem('kitnet3d_proj', JSON.stringify(data)); } catch (e) {}
  if (currentId) {
    try { localStorage.setItem(PROJ_PREFIX + currentId, JSON.stringify(data)); } catch (e) {}
    touchProjectMeta(currentId, {
      updated: Date.now(), name: curName,
      walls: proj.walls.length, furn: proj.furniture.length,
    });
  }
}
let saveTimer = null;
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(saveAuto, 300); }

function updateStats() {
  const t = $('projTitle'); if (t) t.textContent = curName;
  $('stWalls').textContent = proj.walls.length;
  $('stFurn').textContent = proj.furniture.length;
  const a = computeArea();
  $('stArea').textContent = a == null ? '—' : a.toFixed(1);
  updatePlanUI();
}

/* ------------------------------- ferramentas --------------------------- */
function setTool(t) {
  tool = t; wallChain = [];
  $('tWall').classList.toggle('on', t === 'wall');
  $('tFurn').classList.toggle('on', t === 'furn');
  $('tErase').classList.toggle('on', t === 'erase');
  $('tPanT').classList.toggle('on', t === 'pan');
  const hints = {
    wall: 'Clique para desenhar paredes. Duplo clique ou Esc termina a linha; clicar perto do início fecha o cômodo.',
    furn: 'Clique para colocar o móvel selecionado. Arraste para mover. R gira 90°, Delete apaga.',
    erase: 'Clique sobre uma parede ou móvel para apagá-lo.',
    pan: 'Arraste para mover a tela. (Botão do meio ou Espaço + arrastar funcionam em qualquer modo.)',
  };
  $('hintMsg').innerHTML = hints[t] || '';
  draw2d();
}

/* ------------------------------- paredes ------------------------------- */
function addWallSeg(ax, ay, bx, by) {
  const len = Math.hypot(bx - ax, by - ay);
  if (len < Math.max(SNAP * 0.5, 0.12)) return;
  pushUndo();
  proj.walls.push({ x1: round2(ax), y1: round2(ay), x2: round2(bx), y2: round2(by) });
  selWall = proj.walls.length - 1;
  scheduleSave(); updateStats(); draw2d(); renderProps();
}

function handleWallClick(w) {
  if (!canAddWalls()) { openUpgrade('walls'); return; }
  const gx = $('chkSnap').checked ? snap(w[0]) : w[0];
  const gy = $('chkSnap').checked ? snap(w[1]) : w[1];
  if (!wallChain.length) { wallChain.push([gx, gy]); selWall = -1; draw2d(); return; }
  const first = wallChain[0];
  const far = wallChain[wallChain.length - 1];
  const close = Math.hypot(gx - first[0], gy - first[1]);
  if (wallChain.length >= 2 && close <= Math.max(SNAP, 0.3) && Math.hypot(gx - far[0], gy - far[1]) > 0.2) {
    if (Math.hypot(far[0] - first[0], far[1] - first[1]) > 0.2) addWallSeg(far[0], far[1], first[0], first[1]);
    wallChain = [];
  } else {
    if (wallChain.length) addWallSeg(far[0], far[1], gx, gy);
    wallChain.push([gx, gy]);
  }
  draw2d();
}
function endWallChain() { wallChain = []; draw2d(); }

/* ------------------------------- móveis -------------------------------- */
function pickFurniture(w) {
  let best = null, bd = 0.55;
  for (const it of proj.furniture) {
    const def = FURNITURE_DEFS[it.type];
    const corners = rectCorners(def.w, def.d, rad(it.rot)).map(([a, b]) => [it.x + a, it.y + b]);
    let inside = false;
    for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
      const [xi, yi] = corners[i], [xj, yj] = corners[j];
      if (((yi > w[1]) !== (yj > w[1])) && (w[0] < (xj - xi) * (w[1] - yi) / (yj - yi) + xi)) inside = !inside;
    }
    const d = Math.hypot(w[0] - it.x, w[1] - it.y);
    if (inside || d < 0.5) { if (!best || d < bd) { best = it; bd = d; } }
  }
  return best;
}

function addFurniture(type, x, y, rot) {
  if (!canAddFurn()) { openUpgrade('furn'); return null; }
  pushUndo();
  const it = { type, x: round2(x), y: round2(y), rot: rot || 0, id: nextId() };
  proj.furniture.push(it);
  selId = it.id;
  scheduleSave(); updateStats(); draw2d(); renderProps();
  return it;
}

function handleFurnClick(w) {
  const gx = $('chkSnap').checked ? snap(w[0]) : w[0];
  const gy = $('chkSnap').checked ? snap(w[1]) : w[1];
  const found = pickFurniture(w);
  if (found) {
    selId = found.id; selWall = -1;
    drag = { mode: 'dragItem', item: found };
  } else {
    const it = addFurniture(selFurnType, gx, gy, 0);
    if (!it) { draw2d(); return; }
    drag = { mode: 'dragItem', item: it, pushed: true };
  }
  draw2d(); renderProps();
}

function eraseAt(w) {
  const fu = pickFurniture(w);
  if (fu) {
    pushUndo();
    proj.furniture = proj.furniture.filter((f) => f.id !== fu.id);
    selId = null;
    scheduleSave(); updateStats(); draw2d(); renderProps();
    return;
  }
  let best = null, bd = 0.25;
  for (let i = 0; i < proj.walls.length; i++) {
    const wl = proj.walls[i];
    const d = distSeg(w[0], w[1], wl.x1, wl.y1, wl.x2, wl.y2);
    if (d < bd) { best = i; bd = d; }
  }
  if (best != null) {
    pushUndo();
    proj.walls.splice(best, 1);
    selWall = -1;
    scheduleSave(); updateStats(); draw2d(); renderProps();
  }
}
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-9) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function rotateSelected() {
  if (selId == null) return;
  const it = proj.furniture.find((f) => f.id === selId);
  if (!it) return;
  pushUndo();
  it.rot = (it.rot + 90) % 360;
  scheduleSave(); draw2d(); renderProps();
}
function deleteSelected() {
  if (selId != null) {
    pushUndo();
    proj.furniture = proj.furniture.filter((f) => f.id !== selId);
    selId = null;
    scheduleSave(); updateStats(); draw2d(); renderProps();
  } else if (selWall >= 0 && proj.walls[selWall]) {
    pushUndo();
    proj.walls.splice(selWall, 1);
    selWall = -1;
    scheduleSave(); updateStats(); draw2d(); renderProps();
  }
}

/* ------------------------------ eventos 2D ----------------------------- */
function canvasPoint(e) {
  const r = c2.cn.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

c2.cn.addEventListener('pointerdown', (e) => {
  isDown = true;
  c2.cn.setPointerCapture(e.pointerId);
  const [sx, sy] = canvasPoint(e);
  const w = s2w(sx, sy);
  mouse.x = sx; mouse.y = sy; mouse.wx = w[0]; mouse.wy = w[1];
  if (e.button === 1 || spaceDown || tool === 'pan') { drag = { mode: 'pan', lx: sx, ly: sy }; return; }
  if (e.altKey) {
    if (proj.bg) drag = { mode: 'bg', lx: sx, ly: sy };
    return;
  }
  if (tool === 'wall') { handleWallClick(w); return; }
  if (tool === 'furn') { handleFurnClick(w); return; }
  if (tool === 'erase') { eraseAt(w); return; }
});

c2.cn.addEventListener('pointermove', (e) => {
  const [sx, sy] = canvasPoint(e);
  const w = s2w(sx, sy);
  mouse.x = sx; mouse.y = sy; mouse.wx = w[0]; mouse.wy = w[1];
  if (drag) {
    if (drag.mode === 'pan') { view.ox += sx - drag.lx; view.oy += sy - drag.ly; drag.lx = sx; drag.ly = sy; }
    else if (drag.mode === 'bg') {
      proj.bg.x -= (sx - drag.lx) / view.scale;
      proj.bg.y -= (sy - drag.ly) / view.scale;
      drag.lx = sx; drag.ly = sy;
      scheduleSave();
    } else if (drag.mode === 'dragItem' && drag.item) {
      const gx = $('chkSnap').checked ? snap(w[0]) : w[0];
      const gy = $('chkSnap').checked ? snap(w[1]) : w[1];
      if (!drag.pushed && (gx !== drag.item.x || gy !== drag.item.y)) { drag.pushed = true; pushUndo(); }
      drag.item.x = round2(gx); drag.item.y = round2(gy); selId = drag.item.id;
    }
    updateStats();
    draw2d();
    return;
  }
  updateStatus();
  draw2d();
});
function endDrag() {
  if (drag && drag.mode === 'dragItem') scheduleSave();
  if (drag && drag.mode === 'dragItem' && drag.item) renderProps();
  drag = null; isDown = false;
}
c2.cn.addEventListener('pointerup', endDrag);
c2.cn.addEventListener('pointercancel', endDrag);
c2.cn.addEventListener('dblclick', (e) => { if (tool === 'wall') endWallChain(); });
c2.cn.addEventListener('contextmenu', (e) => e.preventDefault());

c2.cn.addEventListener('wheel', (e) => {
  e.preventDefault();
  const [sx, sy] = canvasPoint(e);
  if (e.ctrlKey) {
    if (!proj.bg) return;
    const fac = e.deltaY < 0 ? 1.06 : 1 / 1.06;
    proj.bg.scale = clamp(proj.bg.scale * fac, 0.0002, 0.05);
    scheduleSave(); draw2d();
    return;
  }
  const w = s2w(sx, sy);
  const ns = clamp(view.scale * Math.exp(-e.deltaY * 0.0012), 30, 700);
  view.ox = sx - w[0] * ns;
  view.oy = sy - w[1] * ns;
  view.scale = ns;
  draw2d();
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (k === 'z' && e.shiftKey) { e.preventDefault(); redo(); return; }
    if (k === 'y') { e.preventDefault(); redo(); return; }
  }
  if (e.key === 'Escape' && !$('upgradeOverlay').classList.contains('hidden')) { closeUpgrade(); return; }
  if (e.key === 'Escape' && !$('galleryOverlay').classList.contains('hidden')) { closeGallery(); return; }
  if (e.key === 'Escape' && !$('viewModal').classList.contains('hidden')) { closeView3d(); return; }
  if (e.key === 'Escape' && v3dOn) { hide3D(); return; }
  if (e.code === 'Space') { spaceDown = true; e.preventDefault(); return; }
  if (e.key === 'Escape') { wallChain = []; selId = null; selWall = -1; draw2d(); renderProps(); return; }
  if (e.key === 'r' || e.key === 'R') { rotateSelected(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); return; }
  if (e.key.startsWith('Arrow')) {
    e.preventDefault();
    const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    const dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    const st = e.shiftKey ? 0.5 : SNAP;
    if (selId != null) {
      const it = proj.furniture.find((f) => f.id === selId);
      if (!it) return;
      pushUndo();
      it.x = round2(it.x + dx * st); it.y = round2(it.y + dy * st);
      scheduleSave(); draw2d();
    } else if (proj.bg) {
      proj.bg.x += dx * st; proj.bg.y += dy * st;
      scheduleSave(); draw2d();
    }
  }
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceDown = false; });

function updateStatus() {
  const gx = $('chkSnap').checked ? snap(mouse.wx) : mouse.wx;
  const gy = $('chkSnap').checked ? snap(mouse.wy) : mouse.wy;
  const t = tool === 'wall' ? 'Paredes' : tool === 'furn' ? 'Móveis' : tool === 'erase' ? 'Apagar' : 'Mover tela';
  statusEl.innerHTML = `<b>${t}</b> &nbsp; X: ${mouse.wx.toFixed(2)} m &nbsp; Y: ${mouse.wy.toFixed(2)} m` +
    ($('chkSnap').checked ? ` &nbsp;<span style="color:#ff8c3a">snap ${gx.toFixed(1)}, ${gy.toFixed(1)}</span>` : '') +
    ` &nbsp;·&nbsp; zoom ${Math.round(view.scale * 10) / 10}×`;
}
const statusEl = $('status');

/* ------------------------------ área (loops) --------------------------- */
function computeArea() {
  const walls = proj.walls;
  if (!walls.length) return null;
  try {
    const segs = [];
    const pts = [];
    for (const w of walls) {
      const a = { x: w.x1, y: w.y1 }, b = { x: w.x2, y: w.y2 };
      segs.push([a, b]); pts.push(a, b);
    }
    for (let i = 0; i < segs.length; i++)
      for (let j = i + 1; j < segs.length; j++) {
        const p = segIntersect(segs[i][0], segs[i][1], segs[j][0], segs[j][1]);
        if (p) pts.push(p);
      }

    const map = {}, pnt = {};
    const nodeOf = (p) => {
      const kx = Math.round(p.x * 10) / 10, ky = Math.round(p.y * 10) / 10;
      const key = kx + '|' + ky;
      if (!(key in map)) { map[key] = Object.keys(map).length; pnt[map[key]] = { x: kx, y: ky }; }
      return map[key];
    };
    const adj = [];
    const edges = {};
    const edgeKey = (a, b) => (a < b ? a + '_' + b : b + '_' + a);
    for (const [a, b] of segs) {
      const axx = b.x - a.x, ayy = b.y - a.y;
      const len = Math.hypot(axx, ayy);
      if (len < 1e-6) continue;
      const on = [];
      for (const p of pts) {
        const t = ((p.x - a.x) * axx + (p.y - a.y) * ayy) / (len * len);
        if (t > 1e-4 && t < 1 - 1e-4 && Math.abs((p.x - a.x) * ayy - (p.y - a.y) * axx) < 1e-3)
          on.push({ t, p });
      }
      on.sort((p, q) => p.t - q.t);
      const chain = [a, ...on.map((o) => o.p), b];
      for (let k = 0; k < chain.length - 1; k++) {
        const na = nodeOf(chain[k]), nb = nodeOf(chain[k + 1]);
        if (na === nb) continue;
        const ek = edgeKey(na, nb);
        if (edges[ek]) continue;
        edges[ek] = true;
        (adj[na] = adj[na] || []).push(nb);
        (adj[nb] = adj[nb] || []).push(na);
      }
    }
    const N = Object.keys(map).length;
    let best = 0;
    for (let s = 0; s < N; s++) {
      if (!adj[s] || adj[s].length < 2) continue;
      for (const fst of adj[s]) {
        const ordered = [s];
        let prev = s, cur = fst;
        const seenEdges = {}; seenEdges[edgeKey(prev, cur)] = true;
        let ok = true, guard = 0;
        while (guard++ < N * 3 + 8) {
          if (cur === s) { if (ordered.length >= 3) best = Math.max(best, areaOf(ordered, pnt)); ok = false; break; }
          const nxt = pickNextArea(prev, cur, adj[cur], pnt);
          if (nxt == null) { ok = false; break; }
          const ek = edgeKey(cur, nxt);
          if (seenEdges[ek]) { ok = false; break; }
          seenEdges[ek] = true;
          ordered.push(cur);
          prev = cur; cur = nxt;
        }
      }
    }
    if (best > 1.0) return best;
  } catch (e) { /* fallback */ }
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const w of walls) {
    for (const [px, py] of [[w.x1, w.y1], [w.x2, w.y2]]) {
      minX = Math.min(minX, px); minY = Math.min(minY, py);
      maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
    }
  }
  return (maxX - minX) * (maxY - minY);
}
function segIntersect(a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  if (t > 1e-4 && t < 1 - 1e-4 && u > 1e-4 && u < 1 - 1e-4)
    return { x: a.x + t * r.x, y: a.y + t * r.y };
  return null;
}
function pickNextArea(prev, cur, nd, pnt) {
  const a = pnt[prev], b = pnt[cur];
  let ux = b.x - a.x, uy = b.y - a.y;
  const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
  let best = null, bestAng = Infinity;
  for (const n of nd) {
    if (n === prev) continue;
    const v = pnt[n];
    let vx = v.x - b.x, vy = v.y - b.y;
    const vl = Math.hypot(vx, vy) || 1; vx /= vl; vy /= vl;
    let ang = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    if (ang < 0) ang += Math.PI * 2;
    if (ang < Math.PI - 1e-6 && ang < bestAng) { bestAng = ang; best = n; }
  }
  return best;
}
function areaOf(loop, pnt) {
  let s = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = pnt[loop[i]];
    const b = pnt[loop[(i + 1) % loop.length]];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s / 2);
}

/* ------------------------------- 3D ------------------------------------ */
function mergeWalls(segs) {
  const res = segs.map((s) => ({ ...s }));
  let changed = true;
  while (changed) {
    changed = false;
    outer:
    for (let i = 0; i < res.length; i++) {
      for (let j = i + 1; j < res.length; j++) {
        const m = tryMerge(res[i], res[j]);
        if (m) { res[i] = m; res.splice(j, 1); changed = true; break outer; }
      }
    }
  }
  return res;
}
function tryMerge(a, b) {
  const vx = a.x2 - a.x1, vy = a.y2 - a.y1;
  const lenA = Math.hypot(vx, vy);
  if (lenA < 1e-9) return null;
  const wx = b.x2 - b.x1, wy = b.y2 - b.y1;
  const lenB = Math.hypot(wx, wy);
  if (lenB < 1e-9) return null;
  const ux = vx / lenA, uy = vy / lenA;
  if (Math.abs((wx * ux + wy * uy) / lenB) < 0.9995) return null;
  const projA = (px, py) => (px - a.x1) * ux + (py - a.y1) * uy;
  const p1 = projA(b.x1, b.y1), p2 = projA(b.x2, b.y2);
  const perp = Math.abs(-(b.x1 - a.x1) * uy + (b.y1 - a.y1) * ux);
  if (perp > 0.025) return null;
  const lo = Math.min(p1, p2, 0, lenA), hi = Math.max(p1, p2, 0, lenA);
  if (hi - lo >= lenA + lenB + 1e-4) return null;
  return {
    x1: a.x1 + ux * lo, y1: a.y1 + uy * lo,
    x2: a.x1 + ux * hi, y2: a.y1 + uy * hi,
  };
}

const FURN_H = {
  cama: 0.6, sofa: 0.75, mesa: 0.8, cadeira: 0.5, cozinha: 0.9,
  fogao: 0.95, geladeira: 1.9, rouparia: 2.15, vaso: 0.78, chuveiro: 2.1,
  piaB: 0.92, maquina: 0.9, tv: 1.0, porta: 2.0, janela: 1.3, planta: 0.9,
};

function fadeColor(hex, f) {
  const v = parseInt(hex.slice(1), 16);
  const r = clamp(Math.round(((v >> 16) & 255) * f), 0, 255);
  const g = clamp(Math.round(((v >> 8) & 255) * f), 0, 255);
  const b = clamp(Math.round((v & 255) * f), 0, 255);
  return `rgb(${r},${g},${b})`;
}

function ensureCCW(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.z - q.x * p.z;
  }
  if (a < 0) pts.reverse();
}

/* ------------------------- acabamento das paredes ----------------------- */
const WALL_MATS = ['massa', 'gradiente', 'tijolo', 'azulejo'];

function lightHex(hex, f) {
  const v = parseInt(hex.slice(1), 16);
  const r = Math.round(((v >> 16) & 255) + (255 - ((v >> 16) & 255)) * f);
  const g = Math.round(((v >> 8) & 255) + (255 - ((v >> 8) & 255)) * f);
  const b = Math.round((v & 255) + (255 - (v & 255)) * f);
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function drawFbPattern(ctx, kind, color) {
  if (kind === 'gradiente') {
    const gr = ctx.createLinearGradient(0, 0, 0, 1);
    gr.addColorStop(0, lightHex(color, 0.16));
    gr.addColorStop(0.55, color);
    gr.addColorStop(1, fadeColor(color, 0.55));
    ctx.fillStyle = gr; ctx.fillRect(0, 0, 1, 1);
  } else if (kind === 'tijolo') {
    ctx.fillStyle = fadeColor(color, 0.5); ctx.fillRect(0, 0, 1, 1);
    ctx.lineWidth = 0.015; ctx.strokeStyle = fadeColor(color, 0.4);
    const rows = 4, rh = 1 / rows, bw = 0.5;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) ? bw / 2 : 0;
      for (let c = -1; c < 4; c++) {
        ctx.fillStyle = r % 2 ? lightHex(color, 0.05) : color;
        ctx.fillRect(c * bw + off + 0.008, r * rh + 0.008, bw - 0.016, rh - 0.016);
        ctx.strokeRect(c * bw + off + 0.008, r * rh + 0.008, bw - 0.016, rh - 0.016);
      }
    }
  } else if (kind === 'azulejo') {
    ctx.fillStyle = lightHex(color, 0.03); ctx.fillRect(0, 0, 1, 1);
    ctx.lineWidth = 0.018; ctx.strokeStyle = lightHex(color, 0.45);
    const n = 4, S = 1 / n;
    for (let i = 0; i <= n; i++) {
      ctx.beginPath(); ctx.moveTo(i * S, 0); ctx.lineTo(i * S, 1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * S); ctx.lineTo(1, i * S); ctx.stroke();
    }
  }
}

/* ----------------------------- multi-desenhos -------------------------- */
function listProjects() {
  try { const a = JSON.parse(localStorage.getItem(PROJECTS_KEY) || '[]'); return Array.isArray(a) ? a : []; }
  catch (e) { return []; }
}
function saveProjects(list) {
  try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(list)); } catch (e) {}
}
function projMeta(id) { return listProjects().find((p) => p.id === id) || null; }
function touchProjectMeta(id, updates) {
  const list = listProjects();
  const p = list.find((x) => x.id === id);
  if (p) { Object.assign(p, updates); saveProjects(list); }
}
function setName(id, name) {
  const n = (name || '').trim();
  if (!n) return;
  touchProjectMeta(id, { name: n.slice(0, 40) });
  if (id === currentId) curName = projMeta(id).name;
  const t = $('projTitle'); if (t) t.textContent = curName;
}

function migrateProjects() {
  let list = listProjects();
  if (!list.length) { list = [{ id: 'default', name: 'Meu desenho', updated: Date.now() }]; saveProjects(list); }
  currentId = localStorage.getItem(ACTIVE_KEY);
  if (!list.some((p) => p.id === currentId)) currentId = list[0].id;
  const m = projMeta(currentId);
  curName = m ? m.name : 'Meu desenho';
}

function applyProjectData(d) {
  proj.walls = (d && d.walls) || [];
  proj.furniture = (d && d.furniture) || [];
  proj.bg = (d && d.bg) || null;
  proj.colors = Object.assign({ wall: '#f4f1ea', floor: '#e9e3d5' }, (d && d.colors) || {});
  proj.mats = Object.assign({ wall: 'massa' }, (d && d.mats) || {});
  const l = d && d.layers;
  layers.walls = !l || l.walls !== false;
  layers.furn = !l || l.furn !== false;
  layers.bg = !l || l.bg !== false;
  for (const t of FURN_TYPES) layers.types[t] = !l || !l.types ? true : l.types[t] !== false;
  lastId = (d && d.lastId) || 1;
  syncLayerUI(); syncColors();
  preloadBg();
}
function preloadBg() {
  const bg = proj.bg;
  if (bg && bg.src && bg.width) {
    const img = bgImageCache[bg.src] || new Image(bg.width, bg.height);
    img.src = bg.src;
    bgImageCache[bg.src] = img;
  }
}
function readProjectData(id) {
  try { const s = localStorage.getItem(PROJ_PREFIX + id); return s ? JSON.parse(s) : null; } catch (e) { return null; }
}
function readLegacyData() {
  try { const s = localStorage.getItem('kitnet3d_proj'); return s ? JSON.parse(s) : null; } catch (e) { return null; }
}

function loadProject(id) {
  saveAuto();
  applyProjectData(readProjectData(id) || (id === 'default' ? readLegacyData() : null));
  currentId = id;
  const m = projMeta(id);
  curName = m ? m.name : 'Meu desenho';
  try { localStorage.setItem(ACTIVE_KEY, id); } catch (e) {}
  selId = null; selWall = -1; wallChain = []; undoStack = []; redoStack = []; updateNav();
  const t = $('projTitle'); if (t) t.textContent = curName;
  scheduleSave(); updateStats(); draw2d();
  toast('Desenho aberto: ' + curName);
}

function createProject(name) {
  const list = listProjects();
  if (list.length >= getPlan().maxProjects) { openUpgrade('projects'); return; }
  const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const n = (name || '').trim() || ('Desenho ' + (list.length + 1));
  list.push({ id, name: n, updated: Date.now(), walls: 0, furn: 0 });
  saveProjects(list);
  loadProject(id);
  renderGallery();
  toast('Novo desenho criado');
}

function duplicateProject(id) {
  const list = listProjects();
  if (list.length >= getPlan().maxProjects) { openUpgrade('projects'); return; }
  const src = readProjectData(id);
  const nid = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  if (src) { try { localStorage.setItem(PROJ_PREFIX + nid, JSON.stringify(src)); } catch (e) {} }
  const m = projMeta(id);
  const nm = (m ? m.name : 'Desenho') + ' (cópia)';
  list.push({ id: nid, name: nm, updated: Date.now(), walls: src ? src.walls.length : 0, furn: src ? src.furniture.length : 0 });
  saveProjects(list);
  loadProject(nid);
  renderGallery();
  toast('Desenho duplicado');
}

function renameProject(id) {
  const m = projMeta(id);
  const nn = prompt('Nome do desenho:', m ? m.name : '');
  if (nn && nn.trim()) { setName(id, nn); }
  renderGallery();
}

function deleteProject(id) {
  const m = projMeta(id);
  if (!m) return;
  if (!confirm('Excluir o desenho "' + m.name + '"? Essa ação não pode ser desfeita.')) return;
  try { localStorage.removeItem(PROJ_PREFIX + id); } catch (e) {}
  let list = listProjects().filter((p) => p.id !== id);
  if (!list.length) { list = [{ id: 'default', name: 'Meu desenho', updated: Date.now() }]; }
  saveProjects(list);
  if (currentId === id) currentId = list[0].id;
  loadProject(currentId);
  renderGallery();
  toast('Desenho excluído');
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDate(v) {
  const d = new Date(Number(v) || Date.now());
  return isNaN(d) ? '' : d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function renderGallery() {
  const grid = $('galleryGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const list = listProjects();
  for (const p of list) {
    const card = document.createElement('div');
    card.className = 'gcard' + (p.id === currentId ? ' current' : '');
    const cur = p.id === currentId ? '<span class="cur">aberto</span>' : '';
    card.innerHTML =
      '<h3>' + esc(p.name) + ' ' + cur + '</h3>' +
      '<div class="gmeta"><span>Paredes: <b>' + (p.walls || 0) + '</b></span><span>Móveis: <b>' + (p.furn || 0) + '</b></span><span>' + fmtDate(p.updated) + '</span></div>' +
      '<div class="gacts">' +
        '<button class="btn' + (p.id === currentId ? ' on' : '') + '" data-a="open">' + (p.id === currentId ? 'Aberto' : 'Abrir') + '</button>' +
        '<button class="btn" data-a="dup">Duplicar</button>' +
        '<button class="btn" data-a="ren">Renomear</button>' +
        '<button class="btn danger" data-a="del">Excluir</button>' +
      '</div>';
    card.querySelector('[data-a="open"]').onclick = () => { if (p.id !== currentId) loadProject(p.id); closeGallery(); };
    card.querySelector('[data-a="dup"]').onclick = () => duplicateProject(p.id);
    card.querySelector('[data-a="ren"]').onclick = () => renameProject(p.id);
    card.querySelector('[data-a="del"]').onclick = () => deleteProject(p.id);
    grid.appendChild(card);
  }
}
function openGallery() { renderGallery(); $('galleryOverlay').classList.remove('hidden'); }
function closeGallery() { $('galleryOverlay').classList.add('hidden'); }

/* ------------------------- camadas e aparência ------------------------- */
function applyLayerState(l) {
  layers.walls = !l || l.walls !== false;
  layers.furn = !l || l.furn !== false;
  layers.bg = !l || l.bg !== false;
  for (const t of FURN_TYPES) layers.types[t] = !l || !l.types ? true : l.types[t] !== false;
  syncLayerUI();
}
function syncLayerUI() {
  const s = (id, v) => { const el = $(id); if (el) el.checked = v; };
  s('lyWalls', layers.walls); s('lyFurn', layers.furn); s('lyBg', layers.bg);
  document.querySelectorAll('#lyCateg .lytype').forEach((el) => { el.checked = layers.types[el.dataset.type]; });
}
function buildLayerPalette() {
  const el = $('lyCateg');
  if (!el) return;
  el.innerHTML = '';
  for (const t of FURN_TYPES) {
    const def = FURNITURE_DEFS[t];
    const l = document.createElement('label');
    l.className = 'chk ty';
    const ck = document.createElement('input');
    ck.type = 'checkbox'; ck.checked = layers.types[t]; ck.dataset.type = t;
    ck.classList.add('lytype');
    ck.onchange = () => { layers.types[t] = ck.checked; applyLayerChange(); };
    l.appendChild(ck);
    l.appendChild(document.createTextNode(def.emoji + ' ' + def.label));
    el.appendChild(l);
  }
}
function applyLayerChange() { scheduleSave(); draw2d(); renderAerial(); }
function syncColors() {
  const s = (id, v) => { const el = $(id); if (el) el.value = v; };
  s('sideWallColor', proj.colors.wall); s('sideFloorColor', proj.colors.floor);
  s('sideWallMat', proj.mats.wall);
}
function set3DOption(kind, checked) {
  const gate = kind === 'Teto' ? 'teto' : kind === 'Sombra' ? 'shadows' : null;
  const sideId = 'chk' + (kind === 'Etiquetas' ? 'Etq' : kind);
  if (checked && gate && !getPlan()[gate]) {
    const a = $(sideId);
    if (a) a.checked = false;
    openUpgrade(gate);
    return;
  }
  const a = $(sideId);
  if (a) a.checked = checked;
  renderAerial();
}
function setWallMat(v) {
  proj.mats.wall = WALL_MATS.includes(v) ? v : 'massa';
  syncColors(); scheduleSave(); renderAerial();
}
function setWallColor(v) { proj.colors.wall = v; syncColors(); scheduleSave(); renderAerial(); }
function setFloorColor(v) { proj.colors.floor = v; syncColors(); scheduleSave(); renderAerial(); }

/* ----------------------- vista única: 2D + 3D aéreo -------------------- */
let v3dOn = false;
let v3dHideTimer = null;
const AERIAL_RISE = 0.3;

function show3D() {
  clearTimeout(v3dHideTimer);
  v3dOn = true;
  resizeV3d();
  renderAerial();
  $('v3dLayer').classList.add('on');
}
function hide3D() {
  v3dOn = false;
  clearTimeout(v3dHideTimer);
  $('v3dLayer').classList.remove('on');
}
function toggle3D() { if (v3dOn) hide3D(); else show3D(); }

function resizeV3d() {
  const cn = $('v3dLayer');
  const cv = $('c3d');
  if (!cn || !cv || !cn.clientWidth) return;
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.max(1, Math.round(cn.clientWidth * dpr));
  cv.height = Math.max(1, Math.round(cn.clientHeight * dpr));
  cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
}

function renderAerial() {
  if (!v3dOn) return;
  const cn = $('v3dLayer');
  const cv = $('c3d');
  if (!cn || !cv) return;
  const ctx = cv.getContext('2d');
  const W = cn.clientWidth, H = cn.clientHeight;
  if (!W || !H) return;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(244,246,248,.45)';
  ctx.fillRect(0, 0, W, H);

  const boxes = [];
  if (layers.walls) {
    for (const w of mergeWalls(proj.walls)) {
      const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
      if (len < 1e-6) continue;
      const nx = -(w.y2 - w.y1) / len * (WALL_T / 2);
      const nz = (w.x2 - w.x1) / len * (WALL_T / 2);
      const base = [
        { x: w.x1 + nx, y: w.y1 + nz },
        { x: w.x2 + nx, y: w.y2 + nz },
        { x: w.x2 - nx, y: w.y2 - nz },
        { x: w.x1 - nx, y: w.y1 - nz },
      ];
      boxes.push({ base, h: WALL_H, color: proj.colors.wall, kind: proj.mats.wall, depth: (w.y1 + w.y2) / 2 });
    }
  }
  if (layers.furn) {
    for (const it of proj.furniture) {
      if (!layers.types[it.type]) continue;
      const def = FURNITURE_DEFS[it.type];
      const base = rectCorners(def.w, def.d, rad(it.rot)).map(([a, b]) => ({ x: it.x + a, y: it.y + b }));
      boxes.push({ base, h: FURN_H[it.type] || 0.8, color: def.color, depth: it.y, label: def.label });
    }
  }
  boxes.sort((p, q) => p.depth - q.depth);
  for (const box of boxes) drawAerialBox(ctx, box);
}

function drawAerialBox(ctx, box) {
  const base = box.base.map((p) => w2s(p.x, p.y));
  const rise = clamp(box.h * view.scale * AERIAL_RISE, 4, 160);
  const top = base.map(([x, y]) => [x, y - rise]);

  if ($('chkSombra').checked) {
    ctx.beginPath();
    base.forEach(([x, y], i) => { const X = x, Y = y + rise * 0.6; if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); });
    ctx.closePath();
    ctx.fillStyle = 'rgba(20,30,45,.10)';
    ctx.fill();
  }

  for (let i = 0; i < 4; i++) {
    const p0 = base[i], p1 = base[(i + 1) % 4];
    const t0 = top[i], t1 = top[(i + 1) % 4];
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
    const l = Math.hypot(dx, dy) || 1e-6;
    const ny = -dx / l;
    const shade = ny > 0.15 ? 0.88 : ny < -0.15 ? 0.7 : 0.78;
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(t1[0], t1[1]); ctx.lineTo(t0[0], t0[1]);
    ctx.closePath();
    ctx.fillStyle = fadeColor(box.color, shade);
    ctx.fill();
    if (box.kind) {
      ctx.save();
      ctx.clip();
      ctx.transform(dx, dy, t0[0] - p0[0], t0[1] - p0[1], p0[0], p0[1]);
      drawFbPattern(ctx, box.kind, box.color);
      ctx.restore();
    }
    ctx.strokeStyle = 'rgba(30,40,55,.18)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.moveTo(top[0][0], top[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(top[i][0], top[i][1]);
  ctx.closePath();
  ctx.fillStyle = box.color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(30,40,55,.35)';
  ctx.lineWidth = 1;
  ctx.stroke();

  if (box.label && $('chkEtq').checked) {
    const cx = (top[0][0] + top[1][0] + top[2][0] + top[3][0]) / 4;
    const cy = (top[0][1] + top[1][1] + top[2][1] + top[3][1]) / 4;
    ctx.font = '10px system-ui';
    ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(30,40,55,.5)';
    ctx.strokeText(box.label, cx, cy + 3);
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.fillText(box.label, cx, cy + 3);
  }
}

/* --------------------- vista 3D completa (Three.js) --------------------- */
let scene3d = null, renderer3d = null, camera3d = null, controls3d = null;
let cssRenderer3d = null, animRunning = false;

function stdMat(color, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? 0.7, metalness: opts.metalness ?? 0.05 });
  if (opts.transparent) { m.transparent = true; m.opacity = opts.opacity; }
  if (opts.emissive != null) { m.emissive = new THREE.Color(opts.emissive); if (opts.emissiveIntensity != null) m.emissiveIntensity = opts.emissiveIntensity; }
  return m;
}

function init3d() {
  if (scene3d) return;
  const cn = $('view3dLayer');
  try {
    renderer3d = new THREE.WebGLRenderer({ antialias: true });
  } catch (e) { renderer3d = null; }
  if (!renderer3d || !renderer3d.domElement) {
    cn.innerHTML = '<div style="padding:18px 20px; color:var(--muted); font-size:12.5px">WebGL indisponível neste navegador — a vista 3D não pôde ser criada.</div>';
    renderer3d = null;
    return;
  }
  renderer3d.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer3d.setSize(cn.clientWidth || 640, cn.clientHeight || 480);
  renderer3d.setClearColor(0xdfe9f2);
  cn.appendChild(renderer3d.domElement);

  cssRenderer3d = new CSS2DRenderer();
  cssRenderer3d.setSize(cn.clientWidth || 640, cn.clientHeight || 480);
  cssRenderer3d.domElement.style.position = 'absolute';
  cssRenderer3d.domElement.style.top = '0';
  cssRenderer3d.domElement.style.left = '0';
  cssRenderer3d.domElement.style.pointerEvents = 'none';
  cn.appendChild(cssRenderer3d.domElement);

  scene3d = new THREE.Scene();
  camera3d = new THREE.PerspectiveCamera(50, (cn.clientWidth || 640) / Math.max(1, cn.clientHeight || 480), 0.05, 300);
  controls3d = new OrbitControls(camera3d, renderer3d.domElement);
  controls3d.enableDamping = true;
  controls3d.dampingFactor = 0.12;
  controls3d.maxPolarAngle = Math.PI * 0.49;
  controls3d.minDistance = 1.2;
  controls3d.maxDistance = 40;
  new ResizeObserver(() => {
    const w = cn.clientWidth, h = cn.clientHeight;
    if (!w || !h || !renderer3d) return;
    camera3d.aspect = w / h;
    camera3d.updateProjectionMatrix();
    renderer3d.setSize(w, h);
    if (cssRenderer3d) cssRenderer3d.setSize(w, h);
  }).observe(cn);
}

function makeFinishTexture(kind, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.setTransform(256, 0, 0, 256, 0, 0);
  drawFbPattern(ctx, kind, color);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function viewOpts() {
  return {
    teto: $('mVwTeto').checked,
    sombra: $('mVwSombra').checked,
    etq: $('mVwEtq').checked,
    wall: $('mVwWallColor').value,
    floor: $('mVwFloorColor').value,
  };
}

function rebuild3d() {
  if (!scene3d) return;
  while (scene3d.children.length) scene3d.remove(scene3d.children[0]);

  const o = viewOpts();
  const shadows = o.sombra;
  renderer3d.shadowMap.enabled = shadows;
  renderer3d.shadowMap.type = THREE.PCFSoftShadowMap;

  const wallsM = mergeWalls(proj.walls);
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  if (wallsM.length) {
    for (const w of wallsM) {
      minX = Math.min(minX, w.x1, w.x2); minY = Math.min(minY, w.y1, w.y2);
      maxX = Math.max(maxX, w.x1, w.x2); maxY = Math.max(maxY, w.y1, w.y2);
    }
  } else { minX = -3; maxX = 3; minY = -2; maxY = 2; }

  const cx = (minX + maxX) / 2, cz = (minY + maxY) / 2;
  const bw = Math.max(maxX - minX, 0.1), bd = Math.max(maxY - minY, 0.1);

  scene3d.add(new THREE.HemisphereLight(0xffffff, 0xc8d6e4, 0.95));
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.15);
  sun.position.set(cx + 9, 16, cz - 7);
  if (shadows) {
    const e = Math.max(bw, bd) + 2;
    sun.castShadow = true;
    sun.shadow.mapSize.set(1536, 1536);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 70;
    sun.shadow.camera.left = -e; sun.shadow.camera.right = e;
    sun.shadow.camera.top = e; sun.shadow.camera.bottom = -e;
    sun.shadow.bias = -0.0006;
  }
  scene3d.add(sun);
  const fill = new THREE.DirectionalLight(0xbcd6ff, 0.4);
  fill.position.set(cx - 9, 9, cz + 9);
  scene3d.add(fill);

  const floorMat = new THREE.MeshStandardMaterial({ color: o.floor, roughness: 0.88, metalness: 0.03 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(bw + 2.2, bd + 2.2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0, cz);
  floor.receiveShadow = shadows;
  scene3d.add(floor);

  const grid = new THREE.GridHelper(Math.max(bw, bd) + 2.2, Math.max(1, Math.round((Math.max(bw, bd) + 2.2) / 0.5)), 0x8ba2bb, 0xa3b6cc);
  grid.position.set(cx, 0.004, cz);
  scene3d.add(grid);

  const hasFinish = proj.mats && proj.mats.wall && proj.mats.wall !== 'massa';
  for (const w of wallsM) {
    const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
    if (len < 1e-6) continue;
    const wallMat = new THREE.MeshStandardMaterial({ color: o.wall, roughness: 0.72, metalness: 0.03 });
    if (hasFinish) {
      const tex = makeFinishTexture(proj.mats.wall, o.wall);
      tex.repeat.set(Math.max(1, Math.round(len / 0.6)), 1);
      wallMat.map = tex;
    }
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, WALL_H, WALL_T), wallMat);
    m.position.set((w.x1 + w.x2) / 2, WALL_H / 2, (w.y1 + w.y2) / 2);
    m.rotation.y = Math.atan2(w.y2 - w.y1, w.x2 - w.x1);
    m.castShadow = shadows;
    m.receiveShadow = shadows;
    scene3d.add(m);

    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(len, 0.09, WALL_T + 0.02),
      new THREE.MeshStandardMaterial({ color: 0xf3f0e9, roughness: 0.6 })
    );
    trim.position.set((w.x1 + w.x2) / 2, 0.045, (w.y1 + w.y2) / 2);
    trim.rotation.y = Math.atan2(w.y2 - w.y1, w.x2 - w.x1);
    scene3d.add(trim);
  }

  if (o.teto) {
    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(bw + 2.2, bd + 2.2),
      new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.9 })
    );
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(cx, WALL_H, cz);
    scene3d.add(ceil);
  }

  for (const it of proj.furniture) {
    if (!layers.types[it.type]) continue;
    const grp = furnitureMesh(it);
    if (!grp) continue;
    grp.position.set(it.x, 0, it.y);
    grp.rotation.y = rad(it.rot);
    if (shadows) grp.traverse((nd) => { if (nd.isMesh) { nd.castShadow = true; nd.receiveShadow = true; } });
    scene3d.add(grp);
  }

  if (o.etq) {
    for (const it of proj.furniture) {
      if (!layers.types[it.type]) continue;
      const label = furnitureLabel(it);
      if (!label) continue;
      label.position.set(it.x, 1.55, it.y);
      scene3d.add(label);
    }
  }

  const dist = Math.max(bw, bd, 4) * 1.15;
  camera3d.position.set(cx + dist * 0.75, dist * 0.9, cz + dist * 0.95);
  controls3d.target.set(cx, 1.0, cz);
  controls3d.update();
}

function furnitureMesh(item) {
  const def = FURNITURE_DEFS[item.type];
  const w = def.w, d = def.d;
  const g = new THREE.Group();
  const mat = (c, o) => stdMat(c, o);
  const wood = (c = 0x8a6d4b) => stdMat(c, { roughness: 0.55, metalness: 0.04 });
  const steel = () => stdMat(0xcfd6dc, { roughness: 0.25, metalness: 0.9 });
  const porcelain = () => stdMat(0xf4f6f8, { roughness: 0.35, metalness: 0.02 });
  const box = (bw, bh, bd2, ml, oy = 0, xoff = 0, zoff = 0) => {
    if (bw < 0.004 || bh < 0.004 || bd2 < 0.004) return null;
    const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd2), ml);
    m.position.set(xoff, oy + bh / 2, zoff);
    g.add(m);
    return m;
  };
  const cyl = (rt, rb, h, ml, oy = 0, xoff = 0, zoff = 0, seg = 18) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), ml);
    m.position.set(xoff, oy + h / 2, zoff);
    g.add(m);
    return m;
  };
  const sph = (r, ml, oy = 0, xoff = 0, zoff = 0, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), ml);
    m.scale.set(sx, sy, sz);
    m.position.set(xoff, oy, zoff);
    g.add(m);
    return m;
  };
  const legs4 = (bh, legC, ox, oz) => {
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
      box(0.06, bh, 0.06, legC, 0, lx * ox, lz * oz);
  };

  switch (item.type) {
    case 'cama': {
      const wd = wood(0x8a5a36);
      for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
        box(0.09, 0.16, 0.09, wd, 0, lx * (w / 2 - 0.06), lz * (d / 2 - 0.06));
      box(w, 0.16, d, wd, 0.16);
      box(w + 0.06, 0.5, 0.06, wd, 0, 0, -d / 2 + 0.03);
      box(w + 0.06, 0.08, 0.05, wood(0x6d4a2b), 0.66, 0, -d / 2 + 0.02);
      const mz = (d - 0.5) / 2;
      box(w - 0.08, 0.2, d - 0.5, porcelain(), 0.32);
      box(w - 0.08, 0.08, mz, stdMat(0x5f8fbb, { roughness: 0.92, metalness: 0.02 }), 0.42, 0, mz / 2);
      box(0.76, 0.1, 0.42, stdMat(0xffffff, { roughness: 0.95 }), 0.43, 0.08, -mz + 0.21);
      break;
    }
    case 'sofa': {
      const c = 0x8a6a8c, cL = 0x9d80a1;
      const seatW = (w - 0.3) / 2;
      box(w - 0.18, 0.28, d - 0.1, mat(c, { roughness: 0.85 }), 0.06);
      box(w - 0.18, 0.55, 0.16, mat(c, { roughness: 0.85 }), 0.34, 0, -d / 2 + 0.08);
      for (const s of [-1, 1])
        box(0.14, 0.5, d - 0.06, mat(c, { roughness: 0.85 }), 0.06, s * (w / 2 - 0.07));
      for (const s of [-1, 1])
        box(seatW - 0.02, 0.14, d - 0.4, mat(cL, { roughness: 0.9 }), 0.34, s * (seatW + 0.02));
      box(w - 0.1, 0.06, 0.09, mat(0x5e4353, { roughness: 0.8 }), 0.5, 0, -d / 2 + 0.0);
      legs4(0.07, wood(0x2f241d), w / 2 - 0.06, d / 2 - 0.04);
      break;
    }
    case 'mesa': {
      const wd = wood(0x9a7446), wd2 = wood(0x6f4e28);
      box(w, 0.05, d, wd, 0.74);
      box(w - 0.08, 0.09, d - 0.08, wd2, 0.62);
      for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
        box(0.07, 0.62, 0.07, wd2, 0, lx * (w / 2 - 0.06), lz * (d / 2 - 0.06));
      box(w - 0.14, 0.035, d - 0.14, wd2, 0.3);
      break;
    }
    case 'cadeira': {
      const wd = wood(0xb98b55), wd2 = wood(0x7a5a33);
      box(w, 0.06, d, wd, 0.45);
      box(w - 0.05, 0.44, 0.05, wd, 0.45, 0, -d / 2 + 0.025);
      box(w - 0.1, 0.07, 0.05, wd, 0.62, 0, -d / 2 + 0.025);
      box(w - 0.1, 0.07, 0.05, wd, 0.84, 0, -d / 2 + 0.025);
      for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
        box(0.045, 0.45, 0.045, wd2, 0, lx * (w / 2 - 0.03), lz * (d / 2 - 0.03));
      break;
    }
    case 'cozinha': {
      const wd = wood(0x9c6b3f), wd2 = wood(0x7d5130);
      box(w, 0.82, d, wd, 0);
      for (let i = 0; i < 3; i++) box(w / 3 - 0.035, 0.78, 0.04, wd2, 0.02, -w / 3 + i * (w / 3), d / 2 + 0.005);
      box(w + 0.03, 0.045, d + 0.03, stdMat(0xeae6de, { roughness: 0.25, metalness: 0.08 }), 0.82);
      box(w - 0.02, 0.04, 0.34, stdMat(0xaab5bd, { roughness: 0.35, metalness: 0.65 }), 0.865);
      box(0.36, 0.045, 0.26, stdMat(0x39424a, { roughness: 0.4, metalness: 0.7 }), 0.895);
      box(w - 0.04, 0.18, 0.02, stdMat(0xcfd6dc, { roughness: 0.3, metalness: 0.4 }), 0.86, 0, -d / 2 - 0.02);
      cyl(0.014, 0.014, 0.18, steel(), 0.865, 0.16, 0.1, 12);
      const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 12), steel());
      spout.rotation.x = Math.PI / 2;
      spout.position.set(0.24, 1.03, 0.1);
      g.add(spout);
      break;
    }
    case 'fogao': {
      const body = stdMat(0xf4f6f8, { roughness: 0.5, metalness: 0.04 });
      const dark = stdMat(0x2f363c, { roughness: 0.45, metalness: 0.35 });
      box(w, 0.84, d, body, 0);
      box(w + 0.01, 0.04, d + 0.01, dark, 0.84);
      box(w, 0.1, d, dark, 0.84, 0, d / 2 - 0.04);
      for (const [bx, bz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
        cyl(0.045, 0.045, 0.012, stdMat(0x191d22, { metalness: 0.5 }), 0.876, bx * 0.17, bz * 0.17, 22);
      for (let i = 0; i < 4; i++)
        cyl(0.014, 0.014, 0.035, dark, 0.9, -0.18 + i * 0.12, d / 2 - 0.03, 12);
      box(w - 0.06, 0.03, 0.05, steel(), 0.865, 0, d / 2 - 0.06);
      break;
    }
    case 'geladeira': {
      const body = stdMat(0xe9edf2, { roughness: 0.35, metalness: 0.4 });
      box(w, 1.8, d, body, 0.02);
      box(w + 0.01, 0.03, d + 0.01, stdMat(0x0f1215, { roughness: 0.3 }), 1.97);
      box(w - 0.03, 0.52, d - 0.03, stdMat(0xfbfcfe, { roughness: 0.3, metalness: 0.25 }), 0.48, 0, 0);
      box(w - 0.02, 0.015, d - 0.03, stdMat(0x8d98a3, { roughness: 0.4 }), 0.72, 0, 0);
      box(w - 0.03, 1.0, d - 0.03, stdMat(0xfbfcfe, { roughness: 0.3, metalness: 0.25 }), 0.76, 0, 0);
      box(0.025, 0.42, 0.02, stdMat(0x2c3038, { roughness: 0.3, metalness: 0.6 }), 0.94, w / 2 - 0.06, d / 2 + 0.0);
      box(0.025, 0.75, 0.02, stdMat(0x2c3038, { roughness: 0.3, metalness: 0.6 }), 0.02, w / 2 - 0.06, d / 2 - 0.0);
      legs4(0.06, stdMat(0x9aa3a9), w / 2 - 0.02, d / 2 - 0.02);
      break;
    }
    case 'rouparia': {
      const wd = wood(0xa97c50), wd2 = wood(0xc2945f);
      box(w, 2.08, d, wd, 0);
      box(w, 0.09, d + 0.02, wood(0x6f4a2a), 0);
      for (const s of [-1, 1]) box(w / 2 - 0.03, 1.98, 0.05, wd2, 0.06, s * w / 4, d / 2 - 0.025);
      for (const s of [-1, 1]) box(0.022, 0.4, 0.025, stdMat(0x2c2c2c, { metalness: 0.5 }), 0.8, s * w / 4, d / 2 - 0.01);
      box(w * 0.72, 0.04, d * 0.4, wood(0x6f4a2a), 2.02, 0, d / 2 - 0.1);
      break;
    }
    case 'vaso': {
      box(0.44, 0.42, 0.16, porcelain(), 0.16, 0, -d / 2 + 0.08);
      box(0.46, 0.05, 0.18, porcelain(), 0.58, 0, -d / 2 + 0.08);
      cyl(0.018, 0.018, 0.03, stdMat(0xcfd6dc, { metalness: 0.7 }), 0.6, 0, -d / 2 + 0.08, 10);
      sph(0.15, porcelain(), 0.18, 0, 0.08, 1, 0.75, 1.4);
      cyl(0.15, 0.18, 0.16, porcelain(), 0, 0, 0.05, 20);
      cyl(0.35, 0.35, 0.035, stdMat(0xf8fafc), 0.47, 0, 0.05, 24);
      cyl(0.12, 0.16, 0.22, porcelain(), 0, 0, 0.03, 16);
      break;
    }
    case 'chuveiro': {
      box(w, 0.08, d, stdMat(0xe6eaee, { roughness: 0.35 }), 0.04);
      cyl(0.012, 0.012, 0.6, steel(), 0.3, 0, -d / 2 + 0.05, 10);
      cyl(0.012, 0.012, 0.5, steel(), 1.6, 0, -d / 2 + 0.05, 10);
      cyl(0.16, 0.16, 0.04, steel(), 2.0, 0, -d / 2 + 0.12, 24);
      const glass = stdMat(0xbfdcec, { transparent: true, opacity: 0.3, roughness: 0.1, metalness: 0.05 });
      box(w, 1.9, 0.02, glass, 0.1, 0, d / 2 - 0.01);
      box(0.02, 1.9, d, glass, 0.1, w / 2 - 0.01, 0);
      const rail = stdMat(0xc8d2db, { roughness: 0.3, metalness: 0.7 });
      box(w, 0.03, 0.03, rail, 1.92, 0, d / 2 - 0.03);
      box(0.03, 0.03, d, rail, 1.92, w / 2 - 0.03, 0);
      break;
    }
    case 'piaB': {
      cyl(0.1, 0.14, 0.52, porcelain(), 0, 0, -0.02, 16);
      box(w, 0.15, d, porcelain(), 0.5, 0, -0.02);
      box(w - 0.08, 0.08, d - 0.08, stdMat(0xe9e4d8, { roughness: 0.4 }), 0.545, 0, -0.02);
      cyl(0.014, 0.014, 0.14, steel(), 0.66, 0.16, 0.04, 12);
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.11, 12), steel());
      sp.rotation.x = Math.PI / 2;
      sp.position.set(0.25, 0.78, 0.04);
      g.add(sp);
      box(0.36, 0.42, 0.03, stdMat(0xcfe2ee, { roughness: 0.15, metalness: 0.1 }), 1.12, 0.02, -d / 2 - 0.01);
      box(0.36, 0.05, 0.03, stdMat(0xd8e6f0, { roughness: 0.3 }), 1.36, 0.02, -d / 2 - 0.01);
      break;
    }
    case 'maquina': {
      box(w, 0.85, d, stdMat(0xf2f4f6, { roughness: 0.4, metalness: 0.05 }), 0.04);
      cyl(0.17, 0.17, 0.03, stdMat(0xa8b6c0, { roughness: 0.2, metalness: 0.4 }), 0.52, 0.1, d / 2 + 0.01, 30);
      cyl(0.14, 0.14, 0.025, stdMat(0x4a5560, { roughness: 0.15, metalness: 0.3, transparent: true, opacity: 0.82 }), 0.52, 0.1, d / 2 + 0.023, 30);
      cyl(0.028, 0.028, 0.03, stdMat(0x2c3038, { roughness: 0.3, metalness: 0.5 }), 0.52, 0.18, d / 2 + 0.012, 12);
      box(w, 0.05, d, stdMat(0xdfe3e8, { roughness: 0.5 }), 0);
      break;
    }
    case 'tv': {
      const dark = stdMat(0x22262c, { roughness: 0.5, metalness: 0.1 });
      box(0.26, 0.05, 0.26, dark, 0);
      box(0.08, 0.3, 0.08, dark, 0.05);
      box(w, 0.7, 0.035, stdMat(0x0d1117, { roughness: 0.2, metalness: 0.2, emissive: 0x2a4a6b, emissiveIntensity: 0.5 }), 0.3, 0, -0.01);
      box(w - 0.06, 0.63, 0.005, stdMat(0x08121f, { roughness: 0.1, metalness: 0.1, emissive: 0x9ec9ff, emissiveIntensity: 0.8 }), 0.305, 0, -0.025);
      box(0.02, 0.7, 0.04, dark, 0.3, -w / 2 + 0.01, -0.01);
      box(0.02, 0.7, 0.04, dark, 0.3, w / 2 - 0.01, -0.01);
      break;
    }
    case 'porta': {
      const wd = wood(0x9a7b52), fr = wood(0x6f522f);
      box(0.08, WALL_H, d, fr, 0, -w / 2 + 0.01, 0);
      box(0.08, WALL_H, d, fr, 0, w / 2 - 0.01, 0);
      box(w, 0.08, d, fr, WALL_H - 0.08, 0, 0);
      box(w, 1.98, 0.05, wd, 0.02, 0, d / 2 - 0.025);
      box(w, 0.3, 0.05, wd, 1.5, 0, d / 2 - 0.025);
      box(w, 0.16, 0.05, wd, 0.85, 0, d / 2 - 0.025);
      box(w - 0.12, 0.03, 0.05, wd, 1.72, 0, d / 2 - 0.025);
      cyl(0.03, 0.03, 0.08, steel(), 1.04, -w / 2 + 0.04, d / 2 + 0.0, 12);
      cyl(0.015, 0.015, 0.04, steel(), 1.78, -w / 2 + 0.09, d / 2, 10);
      break;
    }
    case 'janela': {
      const wh = 1.2, sill = 0.98;
      const frC = stdMat(0xeceae2, { roughness: 0.6 });
      const glass = stdMat(0xaad4ea, { roughness: 0.08, metalness: 0.05, transparent: true, opacity: 0.45 });
      box(w, 0.05, 0.06, frC, sill, 0, 0);
      box(w, 0.05, 0.06, frC, sill + wh, 0, 0);
      box(0.05, wh, 0.06, frC, sill, -w / 2 + 0.025, 0);
      box(0.05, wh, 0.06, frC, sill, w / 2 - 0.025, 0);
      box(w - 0.05, wh - 0.02, 0.03, glass, sill + 0.01, 0, 0);
      box(0.04, wh - 0.1, 0.03, frC, sill + 0.05, 0, 0);
      box(0.02, wh - 0.1, 0.03, frC, sill + 0.05, -w / 4, 0);
      box(0.02, wh - 0.1, 0.03, frC, sill + 0.05, w / 4, 0);
      break;
    }
    case 'planta': {
      cyl(0.13, 0.09, 0.26, stdMat(0xc0693b, { roughness: 0.75 }), 0, 0, 0, 14);
      cyl(0.11, 0.11, 0.03, stdMat(0x3a2a20, { roughness: 0.9 }), 0.26, 0, 0, 14);
      cyl(0.015, 0.02, 0.34, stdMat(0x5d4524, { roughness: 0.7 }), 0.29, 0, 0, 8);
      const leaf = stdMat(0x4e9c56, { roughness: 0.8 });
      sph(0.13, leaf, 0.72, 0, 0, 1, 1, 1);
      sph(0.11, leaf, 0.92, 0.09, 0.05, 1, 1.2, 1);
      sph(0.11, leaf, 0.9, -0.1, -0.06, 1, 1.2, 1);
      sph(0.1, leaf, 0.86, -0.02, 0.12, 1, 1, 1);
      sph(0.09, leaf, 0.85, 0.12, 0.0, 1, 1, 1);
      break;
    }
    default:
      return null;
  }
  return g;
}

function furnitureLabel(item) {
  const def = FURNITURE_DEFS[item.type];
  if (!def) return null;
  const el = document.createElement('div');
  el.className = 'css2d-label';
  el.textContent = def.emoji + ' ' + def.label + ' · ' +
    def.w.toLocaleString('pt-BR') + '×' + def.d.toLocaleString('pt-BR') + 'm';
  return new CSS2DObject(el);
}

function startAnimation() {
  if (animRunning) return;
  animRunning = true;
  const loop = () => {
    if (!renderer3d || $('viewModal').classList.contains('hidden')) { animRunning = false; return; }
    controls3d.update();
    renderer3d.render(scene3d, camera3d);
    if (cssRenderer3d) cssRenderer3d.render(scene3d, camera3d);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

function syncViewModalOpts() {
  const s = (id, v) => { const el = $(id); if (el) el.checked = v; };
  s('mVwTeto', $('chkTeto').checked);
  s('mVwSombra', $('chkSombra').checked);
  s('mVwEtq', $('chkEtq').checked);
  $('mVwWallColor').value = proj.colors.wall;
  $('mVwFloorColor').value = proj.colors.floor;
}

function snapshot2d() {
  const cn = $('c2dmod');
  if (!cn) return;
  const ctx = cn.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  cn.width = Math.max(1, Math.round(cn.clientWidth * dpr));
  cn.height = Math.max(1, Math.round(cn.clientHeight * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw2dTo(ctx, cn.clientWidth, cn.clientHeight, true);
}

function resize3dView() {
  const cn = $('view3dLayer');
  if (!renderer3d) return;
  const w = cn.clientWidth, h = cn.clientHeight;
  if (!w || !h) return;
  camera3d.aspect = w / h;
  camera3d.updateProjectionMatrix();
  renderer3d.setSize(w, h);
  if (cssRenderer3d) cssRenderer3d.setSize(w, h);
}

function applyFusion() {
  const r = clamp(+$('fusionRange').value, 0, 100) / 100;
  $('view3dLayer').style.opacity = '1';
  $('view3dLayer').style.pointerEvents = r > 0 ? 'auto' : 'none';
  $('c2dmod').style.opacity = (1 - r).toFixed(2);
}

function openView3d() {
  init3d();
  syncViewModalOpts();
  $('viewModal').classList.remove('hidden');
  applyFusion();
  if (!renderer3d) return;
  rebuild3d();
  snapshot2d();
  resize3dView();
  requestAnimationFrame(() => { resize3dView(); startAnimation(); });
  toast('Vista 3D — planta 2D sobre a cena · arraste para orbitar, role para zoom');
}
function closeView3d() { $('viewModal').classList.add('hidden'); }

/* ------------------------------ exemplo -------------------------------- */
function loadExample() {
  pushUndo();
  proj.walls = [
    { x1: 0, y1: 0, x2: 6, y2: 0 },
    { x1: 6, y1: 0, x2: 6, y2: 4.2 },
    { x1: 6, y1: 4.2, x2: 0, y2: 4.2 },
    { x1: 0, y1: 4.2, x2: 0, y2: 0 },
    // banheiro: x 4.2..6, y 2.6..4.2, com porta aberta à esquerda
    { x1: 4.2, y1: 2.6, x2: 4.2, y2: 3.4 },
    { x1: 4.2, y1: 2.6, x2: 6, y2: 2.6 },
    { x1: 6, y1: 2.6, x2: 6, y2: 4.2 },
  ];
  proj.furniture = [];
  lastId = 1;
  const F = (type, x, y, rot) => proj.furniture.push({ type, x, y, rot, id: nextId() });
  F('rouparia', 1.3, 0.35, 0);
  F('cama', 3.2, 1.8, 0);
  F('mesa', 1.5, 2.8, 0);
  F('cadeira', 1.5, 3.35, 0);
  F('cadeira', 1.9, 2.8, 90);
  F('sofa', 4.95, 1.35, 0);
  F('cozinha', 3.0, 3.8, 0);
  F('fogao', 4.1, 3.85, 0);
  F('geladeira', 5.4, 1.9, 0);
  F('vaso', 4.45, 2.95, 0);
  F('piaB', 4.75, 3.85, 0);
  F('chuveiro', 5.5, 3.15, 0);
  F('janela', 2.4, 4.15, 0);
  F('porta', 0.03, 1.9, 0);
  F('planta', 0.5, 1.3, 0);
  selId = null; selWall = -1; wallChain = [];
  view.scale = 80; view.ox = 80; view.oy = 60;
  scheduleSave(); updateStats(); draw2d();
  toast('Espaço de exemplo carregado');
}

/* --------------------------- importar/exportar ------------------------- */
function exportProject() {
  if (!requirePro('export')) return;
  const data = { v: 2, walls: proj.walls, furniture: proj.furniture, bg: bgMeta(), colors: proj.colors, layers, mats: proj.mats, lastId };
  saveAuto();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'espaco.json';
  a.click();
  toast('Projeto exportado');
}
async function importProjectFile(f) {
  try {
    const txt = await f.text();
    const data = JSON.parse(txt);
    pushUndo();
    proj.walls = data.walls || [];
    proj.furniture = data.furniture || [];
    proj.bg = data.bg || null;
    proj.colors = Object.assign({ wall: '#f4f1ea', floor: '#e9e3d5' }, data.colors || {});
    proj.mats = Object.assign({ wall: 'massa' }, data.mats || {});
    if (data.layers) applyLayerState(data.layers);
    if (data.bg && data.bg.src && data.bg.width) {
      const img = new Image(proj.bg.width, proj.bg.height);
      img.src = proj.bg.src;
      bgImageCache[proj.bg.src] = img;
    }
    lastId = Math.max(1, data.lastId || 0, ...proj.furniture.map((f) => f.id || 0)) + 1;
    selId = null; selWall = -1; wallChain = [];
    scheduleSave(); updateStats(); draw2d(); renderProps(); syncColors();
    toast('Projeto importado');
  } catch (e) { toast('JSON inválido'); }
}

/* ------------------------------ imagem de fundo ------------------------ */
function loadBgFile(f) {
  const rd = new FileReader();
  rd.onload = () => {
    const img = new Image();
    img.onload = () => {
      pushUndo();
      proj.bg = { src: rd.result, width: img.width, height: img.height, scale: 4 / img.width, x: 0, y: 0, visible: true };
      bgImageCache[rd.result] = img;
      const [cx0, cy0] = s2w(c2.cn.clientWidth / 2, c2.cn.clientHeight / 2);
      proj.bg.x = cx0 - (img.width * proj.bg.scale) / 2;
      proj.bg.y = cy0 - (img.height * proj.bg.scale) / 2;
      scheduleSave(); draw2d();
      toast('Imagem no fundo — trace as paredes por cima');
    };
    img.src = rd.result;
  };
  rd.readAsDataURL(f);
}

/* ------------------------- detecção de paredes ------------------------- */
function detectWalls() {
  if (!requirePro('detect')) return;
  const bg = proj.bg;
  if (!bg) { toast('Carregue antes uma imagem de planta no fundo'); return; }
  const img = bgImageCache[bg.src];
  if (!img || !img.complete) { toast('Imagem ainda não carregada'); return; }

  const W = 700;
  const H = Math.max(1, Math.round(img.height * W / img.width));
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const cx = cv.getContext('2d');
  cx.drawImage(img, 0, 0, W, H);
  const idat = cx.getImageData(0, 0, W, H);
  const data = idat.data;
  const gray = new Uint8Array(W * H);
  let min = 255, max = 0;
  for (let i = 0, k = 0; i < data.length; i += 4, k++) {
    const v = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
    gray[k] = v;
    if (v < min) min = v; if (v > max) max = v;
  }
  const bin = otsu(gray, min, max);
  const comps = components(bin, W, H);

  const mPerPx = bg.scale;
  const found = [];
  for (const c of comps) {
    const bw = c.maxX - c.minX + 1, bh = c.maxY - c.minY + 1;
    const lenM = Math.max(bw, bh) * mPerPx;
    const thkM = Math.min(bw, bh) * mPerPx;
    const aspect = lenM / Math.max(thkM, 1e-6);
    if (lenM < 0.45 || thkM < 0.05 || thkM > 0.6 || aspect < 2.0) continue;
    if (c.count / (bw * bh) < 0.25) continue;
    let x1, y1, x2, y2;
    if (bw >= bh) {
      x1 = bg.x + c.minX * mPerPx; x2 = bg.x + (c.maxX + 1) * mPerPx;
      y1 = y2 = bg.y + (c.minY + c.maxY) / 2 * mPerPx;
    } else {
      y1 = bg.y + c.minY * mPerPx; y2 = bg.y + (c.maxY + 1) * mPerPx;
      x1 = x2 = bg.x + (c.minX + c.maxX) / 2 * mPerPx;
    }
    found.push({ x1: round2(x1), y1: round2(y1), x2: round2(x2), y2: round2(y2) });
  }
  if (!found.length) { toast('Nenhuma parede detectada'); return; }
  let added = 0;
  for (const f of found) {
    if (!canAddWalls()) { openUpgrade('walls'); break; }
    if (!added) pushUndo();
    proj.walls.push(f); added++;
  }
  scheduleSave(); updateStats(); draw2d();
  toast(added ? added + ' paredes detectadas' : 'Limite de paredes do plano atingido');
}

function otsu(gray, min, max) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const N = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let bgSum = 0, bgW = 0;
  let best = 0, bestVar = -1;
  for (let t = 0; t < 256; t++) {
    bgW += hist[t];
    if (!bgW) continue;
    const fgW = N - bgW;
    if (!fgW) break;
    bgSum += t * hist[t];
    const mb = bgSum / bgW, mf = (sum - bgSum) / fgW;
    const v = bgW * fgW * (mb - mf) * (mb - mf);
    if (v > bestVar) { bestVar = v; best = t; }
  }
  const bin = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) bin[i] = gray[i] <= best ? 1 : 0;
  return bin;
}

function components(bin, W, H) {
  const seen = new Uint8Array(bin.length);
  const comps = [];
  const stack = [];
  for (let i = 0; i < bin.length; i++) {
    if (!bin[i] || seen[i]) continue;
    let count = 0, minX = W, minY = H, maxX = 0, maxY = 0;
    stack.length = 0; stack.push(i); seen[i] = 1;
    while (stack.length) {
      const p = stack.pop();
      count++; seen[p] = 1;
      const px = p % W, py = (p / W) | 0;
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
      const nbrs = [p - 1, p + 1, p - W, p + W];
      for (const q of nbrs) {
        if (q < 0 || q >= bin.length) continue;
        if (bin[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    if (maxX - minX < 3 && maxY - minY < 3 && count < 24) continue;
    comps.push({ count, minX, minY, maxX, maxY });
  }
  return comps;
}

/* ---------------------------- restauração e UI ------------------------- */
function buildFurniturePalette() {
  const el = $('furnList');
  el.innerHTML = '';
  for (const t of FURN_TYPES) {
    const def = FURNITURE_DEFS[t];
    const b = document.createElement('button');
    b.className = 'fbtn' + (t === selFurnType ? ' on' : '');
    b.innerHTML = `<span class="em">${def.emoji}</span><b>${def.label}</b><small>${def.w.toLocaleString('pt-BR')} × ${def.d.toLocaleString('pt-BR')} m</small>`;
    b.title = def.label + ' — ' + def.w + ' × ' + def.d + ' m';
    b.onclick = () => {
      selFurnType = t;
      setTool('furn');
      document.querySelectorAll('.fbtn').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
    };
    el.appendChild(b);
  }
}

function wireUI() {
  $('tWall').onclick = () => setTool('wall');
  $('tFurn').onclick = () => setTool('furn');
  $('tErase').onclick = () => setTool('erase');
  $('tPanT').onclick = () => setTool('pan');
  $('btnExample').onclick = loadExample;
  $('btnUndo').onclick = undo;
  $('btnRedo').onclick = redo;
  $('btnClear').onclick = () => {
    if (!proj.walls.length && !proj.furniture.length) { toast('Já está vazio'); return; }
    pushUndo();
    proj.walls = []; proj.furniture = []; proj.bg = null;
    selId = null; selWall = -1; wallChain = [];
    scheduleSave(); updateStats(); draw2d(); renderProps();
    toast('Projeto limpo');
  };
  $('btnExport').onclick = exportProject;
  $('btnImport').onclick = () => $('fileJson').click();
  $('fileJson').addEventListener('change', (e) => {
    if (e.target.files[0]) importProjectFile(e.target.files[0]);
    e.target.value = '';
  });
  $('btnSaveImg').onclick = () => $('fileImg').click();
  $('fileImg').addEventListener('change', (e) => {
    if (e.target.files[0]) loadBgFile(e.target.files[0]);
    e.target.value = '';
  });
  $('btnSolve').onclick = detectWalls;
  $('chkGrid').onchange = draw2d;
  $('chkSnap').onchange = draw2d;
  $('chkTeto').onchange = () => set3DOption('Teto', $('chkTeto').checked);
  $('chkSombra').onchange = () => set3DOption('Sombra', $('chkSombra').checked);
  $('chkEtq').onchange = () => set3DOption('Etiquetas', $('chkEtq').checked);
  $('btnUpgrade').onclick = () => openUpgrade();
  $('btnUpgradePlan').onclick = () => openUpgrade();
  $('planBadge').onclick = () => openUpgrade();
  $('btnStayFree').onclick = closeUpgrade;
  function buyPlan(k) {
    closeUpgrade();
    const link = MPAGO_LINKS[k];
    if (!link || link.indexOf('SUA_URL') === 0) {
      toast('Configure a URL do Mercado Pago no código (MPAGO_LINKS.' + k + ').');
      return false;
    }
    return true;
  }
  $('btnBuyAvulso').onclick = () => buyPlan('avulso');
  $('btnBuyEssencial').onclick = () => buyPlan('essencial');
  $('btnSubscribe').onclick = () => buyPlan('pro');
  $('btnDemo').onclick = () => {
    const d = new Date(); d.setDate(d.getDate() + 7);
    applyPlan('pro', d); closeUpgrade();
  };

  const b3 = $('btn3d');
  b3.addEventListener('pointerenter', () => { clearTimeout(v3dHideTimer); show3D(); });
  b3.addEventListener('pointerleave', () => { v3dHideTimer = setTimeout(hide3D, 350); });
  b3.addEventListener('click', (e) => { e.stopPropagation(); toggle3D(); });
  $('btnCenter3d').onclick = openView3d;
  $('btnCloseView').onclick = closeView3d;
  $('viewModal').addEventListener('click', (e) => { if (e.target === $('viewModal')) closeView3d(); });
  $('fusionRange').oninput = applyFusion;
  $('mVwTeto').onchange = rebuild3d;
  $('mVwSombra').onchange = rebuild3d;
  $('mVwEtq').onchange = rebuild3d;
  $('mVwWallColor').oninput = rebuild3d;
  $('mVwFloorColor').oninput = rebuild3d;
  $('btnCloseGallery').onclick = closeGallery;
  $('btnGallery').onclick = openGallery;
  $('btnOpenOther').onclick = openGallery;
  $('btnNewProject').onclick = () => createProject();
  $('btnNewProjectG').onclick = () => createProject();
  $('galleryOverlay').addEventListener('click', (e) => { if (e.target === $('galleryOverlay')) closeGallery(); });
  $('lyWalls').onchange = () => { layers.walls = $('lyWalls').checked; applyLayerChange(); };
  $('lyFurn').onchange = () => { layers.furn = $('lyFurn').checked; applyLayerChange(); };
  $('lyBg').onchange = () => { layers.bg = $('lyBg').checked; applyLayerChange(); };
  $('sideWallColor').oninput = (e) => setWallColor(e.target.value);
  $('sideFloorColor').oninput = (e) => setFloorColor(e.target.value);
  $('sideWallMat').onchange = (e) => setWallMat(e.target.value);
}

/* --------------------------------- init -------------------------------- */
(function boot() {
  migrateProjects();
  loadProject(currentId);
  loadPlan();
  buildFurniturePalette();
  buildLayerPalette();
  wireUI();
  resize2d();
  updateStats();
  updateNav();
  setTool('wall');
  const y = $('yearNow'); if (y) y.textContent = new Date().getFullYear();
  if (!proj.walls.length && !proj.furniture.length) loadExample();
  const q = new URLSearchParams(location.search);
  if (q.get('pagamento_aprovado') === '1') {
    const k = planForKey(q.get('plano'));
    if (k !== 'free' && plan !== k) {
      const d = new Date(); d.setDate(d.getDate() + (PLANS[k].dias || 30));
      applyPlan(k, d);
      history.replaceState(null, '', location.pathname);
    }
  }
})();