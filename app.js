(() => {
'use strict';

/* ─────────── data ─────────── */
const CATS = window.CATEGORIES || [];
const CAT = Object.fromEntries(CATS.map(c => [c.id, c]));
const seen = new Set();
const FOODS = (window.FOODS || []).filter(f => {
  f.id = f.id || f.name;
  if (!CAT[f.category]) { console.warn(`[今天吃啥] "${f.name}" has unknown category "${f.category}" — skipped`); return false; }
  if (seen.has(f.id)) { console.warn(`[今天吃啥] "${f.id}" appears twice — give one an id`); return false; }
  seen.add(f.id);
  f.tags = f.tags || [];
  return true;
});
const BY_ID = Object.fromEntries(FOODS.map(f => [f.id, f]));

const KEY = 'jintian-chisha-v7';
const BASE = 46;     // words are laid out at this font size, then scaled per spot

const $ = s => document.querySelector(s);
const vp = $('#viewport'), world = $('#world'), label = $('#label'), ghost = $('#ghost');
const cartEl = $('#cart'), cartBtn = $('#cartBtn'), list = $('#cartList');

/* ─────────── saved state (this browser only) ─────────── */
const fresh = () => ({ positions: {}, cart: [], liked: {}, eaten: {}, filters: { q: '', cats: [], tags: [], mode: 'and' } });
let S = (() => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (!s) return fresh();
    const f = fresh();
    return { ...f, ...s, filters: { ...f.filters, ...(s.filters || {}) }, cart: (s.cart || []).filter(id => BY_ID[id]) };
  } catch (e) { return fresh(); }
})();
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }, 150);
}

/* ─────────── utils ─────────── */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function hash(str) { let h = 2166136261; for (const ch of str) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) {
  return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function ago(ts) {
  const d = Math.floor((Date.now() - ts) / 864e5);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

/* ─────────── the kitchen picture ───────────
   kitchen.jpg is 1408×768; the world is that picture at 2×. Coordinates below are picture pixels.
   Automatic placement: each category fills its regions' rows (baseline y, from x0 to x1);
   anything left over goes on the rug. layout.js overrides this with your own positions. */
const IMG_W = 1408, IMG_H = 768, K = 2, W = IMG_W * K, H = IMG_H * K;
const FS = 13;                       // text size in picture px
const range = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const REGIONS = {
  table:    [[372, 1068, 512], [382, 1058, 490], [392, 1048, 470]],
  fridge:   range(17, i => [1134, 1280, 196 + 22.5 * i]),
  shelf:    [[276, 622, 216], [810, 1084, 216]],
  counterL: [[296, 630, 398], [300, 630, 377]],
  counterR: [[806, 1106, 398], [812, 1104, 377]],
  cabinet:  range(17, i => [1300, 1402, 196 + 22.5 * i]),
  rug:      range(5, i => [250 + i * 10, 1190 - i * 10, 712 - i * 21]),
};
const HOME = {
  dish: ['table', 'rug'], 'dish-ish': ['counterL', 'cabinet', 'rug'], dessert: ['fridge', 'rug'],
  snack: ['shelf', 'rug'], fruit: ['counterL', 'rug'], ingredient: ['counterR', 'rug'],
};
const LAYOUT = window.LAYOUT || {};
const HAS_LAYOUT = Object.keys(LAYOUT).length > 0;
// foods added after the layout was saved line up here, on the rug, until you place them
REGIONS.new = range(4, i => [400, 1010, 612 + i * 24]);

/* ─────────── build the kitchen ─────────── */
world.style.width = W + 'px'; world.style.height = H + 'px';
world.innerHTML = `<img id="scene" src="kitchen.jpg" alt="" width="${W}" height="${H}" draggable="false"><div id="content"></div>`;
const content = $('#content');

const els = {};
FOODS.forEach(f => {
  const el = document.createElement('div');
  el.className = 'item'; el.dataset.id = f.id;
  el.style.setProperty('--c', CAT[f.category].color);
  el.innerHTML = `<div class="inner"><span class="word">${esc(f.name)}</span><span class="heart">★</span><span class="mark"></span></div>`;
  el.addEventListener('animationend', () => el.classList.remove('bounce', 'hop'));
  content.appendChild(el);
  els[f.id] = el;
  bindItem(el, f);
});

/* ─────────── default positions ───────────
   layout.js wins; otherwise each word takes the first row with room in its category's regions. */
const DEF = {}, KS = FS * K / BASE;
function layoutDefaults() {
  const rows = {};
  Object.entries(REGIONS).forEach(([n, rs]) => (rows[n] = rs.map(([x0, x1, y]) => ({ x0: x0 * K, x1: x1 * K, y: y * K, used: 0, n: 0 }))));
  const gap = FS * K * .9;
  FOODS.forEach(f => {
    const el = els[f.id], w = el.offsetWidth * KS, h = el.offsetHeight * KS;
    const q = rng(hash(f.id));
    if (LAYOUT[f.id]) { const [x, y] = LAYOUT[f.id]; DEF[f.id] = { x: x * K, y: y * K, r: (q() - .5) * 3, k: KS }; return; }
    const list = HAS_LAYOUT ? [...rows.new, ...rows.rug] : (HOME[f.category] || ['rug']).flatMap(n => rows[n]);
    let row = list.find(r => r.used + (r.n ? gap : 0) + w <= r.x1 - r.x0);
    if (!row) { const last = rows.rug[rows.rug.length - 1]; row = { ...last, y: last.y - 24 * K, used: 0, n: 0 }; rows.rug.push(row); }
    const x = row.x0 + row.used + (row.n ? gap : 0);
    row.used += (row.n ? gap : 0) + w; row.n++;
    DEF[f.id] = { x, y: row.y - h, r: (q() - .5) * 3, k: KS };
  });
}
const pos = id => S.positions[id] || DEF[id];
layoutDefaults();
FOODS.forEach(f => place(f.id));
// widths change once the web font arrives — re-pack
if (document.fonts) document.fonts.ready.then(() => { layoutDefaults(); FOODS.forEach(f => place(f.id)); });

function place(id) {
  const p = pos(id), el = els[id], k = p.k || DEF[id].k;
  el.style.transform = `translate(${p.x}px,${p.y}px) rotate(${p.r}deg) scale(${k})`;
  el.style.zIndex = Math.round(p.y + 100); // lower on screen = closer to you
}
function styleItem(id) {
  const el = els[id], i = S.cart.indexOf(id);
  el.classList.toggle('incart', i >= 0);
  el.classList.toggle('liked', !!S.liked[id]);
  el.querySelector('.mark').textContent = i >= 0 ? i + 1 : '';
}

/* ─────────── view: the picture covers the screen ─────────── */
let V = { z: 1 };
function fit() {
  const r = vp.getBoundingClientRect(); if (!r.width || !r.height) return;
  const z = Math.max(r.width / W, r.height / H);
  // crop mostly from the right (window edge) and from the top (ceiling) / bottom (floor)
  const x = (r.width - W * z) * .2, y = (r.height - H * z) * .4;
  V = { z };
  world.style.transform = `translate(${x}px,${y}px) scale(${z})`;
  if (hoverId) positionLabel();
}
new ResizeObserver(() => fit()).observe(vp);
$('#copyLayout').addEventListener('click', async () => {
  const out = {};
  FOODS.forEach(f => { const p = pos(f.id); out[f.id] = [Math.round(p.x / K), Math.round(p.y / K)]; });
  const text = '// Starting positions in the kitchen picture (pixels of kitchen.jpg, top-left of each word).\n' +
    '// Foods not listed here line up on the rug until placed.\n' +
    'window.LAYOUT = {\n' + Object.entries(out).map(([k, v]) => `  ${JSON.stringify(k)}: [${v}],`).join('\n') + '\n};\n';
  try { await navigator.clipboard.writeText(text); }
  catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  toast('layout copied — paste it to Claude');
});
$('#tidyBtn').addEventListener('click', () => {
  S.positions = {};
  FOODS.forEach(f => place(f.id));
  save(); toast('everything is back in its place');
});

/* ─────────── food: hover, click, drag ─────────── */
let drag = null;
const inRect = (el, x, y) => { const r = el.getBoundingClientRect(); return r.width && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; };
const overCart = (x, y) => inRect(cartBtn, x, y) || (cartEl.classList.contains('open') && inRect(cartEl, x, y));

function bindItem(el, f) {
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    const p = pos(f.id);
    drag = { id: f.id, pid: e.pointerId, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, moved: false, over: false };
  });
  el.addEventListener('pointermove', e => {
    if (!drag || drag.pid !== e.pointerId || drag.id !== f.id) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) > 4) { drag.moved = true; el.classList.add('dragging'); hideLabel(); document.body.classList.add('dragging-food'); }
    if (!drag.moved) return;
    const p = S.positions[f.id] = { ...pos(f.id), x: drag.ox + dx / V.z, y: drag.oy + dy / V.z };
    el.style.transform = `translate(${p.x}px,${p.y}px) rotate(${p.r}deg) scale(${p.k})`;
    el.style.zIndex = 99999;
    const over = overCart(e.clientX, e.clientY);
    if (over !== drag.over) {
      drag.over = over;
      el.classList.toggle('overcart', over); cartBtn.classList.toggle('hot', over); cartEl.classList.toggle('hot', over);
      ghost.style.display = over ? 'block' : 'none';
      if (over) ghost.textContent = f.name;
    }
    if (over) ghost.style.transform = `translate(${e.clientX}px,${e.clientY}px) translate(-50%,-50%) rotate(-3deg)`;
  });
  const finish = (e, cancelled) => {
    if (!drag || drag.pid !== e.pointerId) return;
    const d = drag; drag = null;
    document.body.classList.remove('dragging-food');
    el.classList.remove('dragging', 'overcart'); cartBtn.classList.remove('hot'); cartEl.classList.remove('hot'); ghost.style.display = 'none';
    if (!d.moved) { if (!cancelled) clickItem(f.id); return; }
    if (d.over || cancelled) {
      S.positions[f.id] = { ...pos(f.id), x: d.ox, y: d.oy }; // slides back to where it was
      if (d.over && !cancelled) addToCart(f.id);
    }
    place(f.id); save();
  };
  el.addEventListener('pointerup', e => finish(e, false));
  el.addEventListener('pointercancel', e => finish(e, true));
  el.addEventListener('pointerenter', () => { if (!drag) showLabel(f.id); });
  el.addEventListener('pointerleave', () => { if (!drag && hoverId === f.id) hideLabel(); });
}

function clickItem(id) {
  const el = els[id];
  el.classList.remove('bounce'); void el.offsetWidth; el.classList.add('bounce');
  addToCart(id);
  if (hoverId === id) fillLabel();
}

/* ─────────── hover tag ─────────── */
let hoverId = null;
function showLabel(id) { hoverId = id; fillLabel(); positionLabel(); label.classList.add('show'); }
function fillLabel() {
  const f = BY_ID[hoverId]; if (!f) return;
  const ea = S.eaten[f.id], inCart = S.cart.indexOf(f.id);
  const meta = [];
  if (S.liked[f.id]) meta.push('★ liked');
  if (inCart >= 0) meta.push('in cart');
  if (ea) meta.push(`last eaten ${ago(ea.last)}`);
  const c = CAT[f.category];
  label.innerHTML =
    `<div class="lb-cat" style="--c:${c.color}">${esc(c.name)}</div>` +
    (f.tags.length ? `<div class="lb-tags">${f.tags.map(esc).join(' · ')}</div>` : '') +
    (meta.length ? `<div class="lb-meta">${meta.join(' · ')}</div>` : '');
}
function positionLabel() {
  const el = els[hoverId]; if (!el) return;
  const r = el.getBoundingClientRect();
  const below = r.bottom + 14 + 70 < innerHeight;
  label.classList.toggle('above', !below);
  label.style.left = (r.left + r.width / 2) + 'px';
  label.style.top = below ? (r.bottom + 12) + 'px' : (r.top - 12 - label.offsetHeight) + 'px';
}
function hideLabel() { hoverId = null; label.classList.remove('show'); }

/* ─────────── filters ─────────── */
const TAGS = (() => {
  const m = {}; FOODS.forEach(f => f.tags.forEach(t => (m[t] = (m[t] || 0) + 1)));
  return Object.keys(m).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
})();
S.filters.tags = S.filters.tags.filter(t => TAGS.includes(t));

$('#catChips').innerHTML = CATS.map(c =>
  `<button class="chip" data-cat="${c.id}" style="--c:${c.color}"><span class="dot"></span>${esc(c.name)}</button>`).join('');
$('#tagChips').innerHTML = TAGS.map(t => `<button class="chip" data-tag="${esc(t)}">${esc(t)}</button>`).join('');

function matches(f) {
  const { q, cats, tags, mode } = S.filters;
  const s = q.trim().toLowerCase();
  if (s && ![f.name, f.id, ...f.tags].some(x => x.toLowerCase().includes(s))) return false;
  if (cats.length && !cats.includes(f.category)) return false;
  if (tags.length) {
    const has = t => f.tags.includes(t);
    if (mode === 'and' ? !tags.every(has) : !tags.some(has)) return false;
  }
  return true;
}
function applyFilters() {
  const { q, cats, tags, mode } = S.filters;
  const active = !!(q.trim() || cats.length || tags.length);
  let n = 0;
  FOODS.forEach(f => { const m = matches(f); if (m) n++; els[f.id].classList.toggle('dim', !m); });
  world.classList.toggle('filtering', active);
  $('#count').textContent = active ? `${n} of ${FOODS.length}` : `${FOODS.length} foods`;
  $('#modeBtn').textContent = mode === 'and' ? 'match all' : 'match any';
  $('#clearFilters').hidden = !active;
  $('#filterCount').textContent = (cats.length + tags.length) || '';
  document.querySelectorAll('[data-cat]').forEach(b => b.classList.toggle('on', cats.includes(b.dataset.cat)));
  document.querySelectorAll('[data-tag]').forEach(b => b.classList.toggle('on', tags.includes(b.dataset.tag)));
  if ($('#search').value !== q) $('#search').value = q;
  save();
}
const toggleIn = (arr, v) => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];
$('#catChips').addEventListener('click', e => {
  const b = e.target.closest('[data-cat]'); if (!b) return;
  S.filters.cats = toggleIn(S.filters.cats, b.dataset.cat); applyFilters();
});
$('#tagChips').addEventListener('click', e => {
  const b = e.target.closest('[data-tag]'); if (!b) return;
  S.filters.tags = toggleIn(S.filters.tags, b.dataset.tag); applyFilters();
});
$('#modeBtn').addEventListener('click', () => { S.filters.mode = S.filters.mode === 'and' ? 'or' : 'and'; applyFilters(); });
$('#search').addEventListener('input', e => { S.filters.q = e.target.value; applyFilters(); });
$('#clearFilters').addEventListener('click', () => { S.filters = { ...fresh().filters, mode: S.filters.mode }; applyFilters(); });
addEventListener('keydown', e => {
  if (e.key === '/' && document.activeElement !== $('#search')) { e.preventDefault(); $('#search').focus(); }
  if (e.key === 'Escape') { if (document.activeElement === $('#search')) $('#search').blur(); openCart(false); openPanel(filtersEl, filterBtn, false); closeDraw(); }
});

/* ─────────── random draw: 今天吃啥? ───────────
   Picks from whatever the filters currently show (everything when no filter is on).
   A spotlight hops between candidates, slows down, and lands on one. */
const drawCard = $('#drawCard');
let drawing = false, drawn = null;
function drawPool() { return FOODS.filter(matches); }
function spotlight(id, on) { const el = els[id]; if (el) el.classList.toggle('spot', on); }
async function draw() {
  if (drawing) return;
  const pool = drawPool();
  if (!pool.length) { toast('nothing matches the filters'); return; }
  drawing = true; hideLabel(); openCart(false); openPanel(filtersEl, filterBtn, false);
  drawCard.classList.remove('show');
  if (drawn) spotlight(drawn, false);
  const pick = pool[Math.floor(Math.random() * pool.length)];
  const steps = Math.min(18, Math.max(6, pool.length * 2));
  let prev = null;
  for (let i = 0; i < steps; i++) {
    let f = pool[Math.floor(Math.random() * pool.length)];
    if (i === steps - 1) f = pick;
    else if (pool.length > 1) while (f.id === prev || f.id === pick.id && i < steps - 1 && pool.length > 2) f = pool[Math.floor(Math.random() * pool.length)];
    if (prev) spotlight(prev, false);
    spotlight(f.id, true); prev = f.id;
    await new Promise(r => setTimeout(r, 60 + Math.pow(i / steps, 2.4) * 420));
  }
  drawn = pick.id;
  const el = els[pick.id];
  el.classList.remove('hop'); void el.offsetWidth; el.classList.add('hop');
  const c = CAT[pick.category], filtered = pool.length < FOODS.length;
  drawCard.innerHTML =
    `<div class="dc-head">今天吃</div><div class="dc-name">${esc(pick.name)}</div>` +
    `<div class="dc-meta"><span class="dot" style="background:${c.color}"></span>${esc(c.name)}${pick.tags.length ? ' · ' + pick.tags.map(esc).join(' · ') : ''}</div>` +
    `<div class="dc-from">${filtered ? `from ${pool.length} filtered foods` : `from all ${FOODS.length} foods`}</div>` +
    `<div class="dc-actions"><button class="pillbtn" data-act="cart">add to cart</button><button class="pillbtn" data-act="again">🎲 again</button><button class="link" data-act="close">close</button></div>`;
  drawCard.classList.add('show');
  drawing = false;
}
function closeDraw() { drawCard.classList.remove('show'); if (drawn) spotlight(drawn, false); drawn = null; }
$('#drawBtn').addEventListener('click', e => { e.stopPropagation(); draw(); });
drawCard.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  if (b.dataset.act === 'cart' && drawn) { addToCart(drawn); closeDraw(); }
  else if (b.dataset.act === 'again') draw();
  else closeDraw();
});

/* ─────────── shopping cart (dropdown) ─────────── */
// two dropdowns under the header: filters (left) and cart (right) — only one open at a time
const filtersEl = $('#filters'), filterBtn = $('#filterBtn');
function openPanel(panel, btn, open = !panel.classList.contains('open')) {
  if (open) [[cartEl, cartBtn], [filtersEl, filterBtn]].forEach(([p, b]) => { if (p !== panel) { p.classList.remove('open'); b.setAttribute('aria-expanded', false); } });
  panel.style.top = ($('#topbar').offsetHeight + 6) + 'px';
  panel.classList.toggle('open', open);
  btn.setAttribute('aria-expanded', open);
}
const openCart = (open) => openPanel(cartEl, cartBtn, open);
cartBtn.addEventListener('click', e => { e.stopPropagation(); openCart(); });
filterBtn.addEventListener('click', e => { e.stopPropagation(); openPanel(filtersEl, filterBtn); });
document.addEventListener('pointerdown', e => {
  if (drag || rd) return;
  if (cartEl.classList.contains('open') && !e.target.closest('#cart, #cartBtn')) openCart(false);
  if (filtersEl.classList.contains('open') && !e.target.closest('#filters, #filterBtn')) openPanel(filtersEl, filterBtn, false);
});

function addToCart(id) {
  if (S.cart.includes(id)) { flashRow(id); toast(`${BY_ID[id].name} is already in the cart`); return; }
  S.cart.push(id);
  renderCart(); flashRow(id); save();
  cartBtn.classList.remove('pop'); void cartBtn.offsetWidth; cartBtn.classList.add('pop');
  if (!cartEl.classList.contains('open')) toast(`${BY_ID[id].name} → cart`);
}
function renderCart() {
  list.innerHTML = '';
  S.cart.forEach((id, i) => {
    const f = BY_ID[id];
    const li = document.createElement('li');
    const liked = !!S.liked[id];
    li.className = 'row' + (liked ? ' is-liked' : ''); li.dataset.id = id;
    li.innerHTML =
      `<span class="num">${i + 1}</span><span class="dot" style="background:${CAT[f.category].color}"></span>` +
      `<div class="names"><div class="nm">${esc(f.name)}</div><div class="tg">${f.tags.map(esc).join(' · ')}</div></div>` +
      `<button class="like" title="${liked ? 'Unstar' : 'Star'}" aria-pressed="${liked}">${liked ? '★' : '☆'}</button>` +
      `<button class="ate" title="Ate">✓</button>` +
      `<button class="rm" title="Remove">✕</button>`;
    list.appendChild(li);
  });
  cartEl.classList.toggle('empty', !S.cart.length);
  $('#cartCount').textContent = S.cart.length || '';
  FOODS.forEach(f => styleItem(f.id));
}
function flashRow(id) {
  const li = list.querySelector(`[data-id="${CSS.escape(id)}"]`); if (!li) return;
  li.classList.remove('flash'); void li.offsetWidth; li.classList.add('flash');
  li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function locate(id) {
  const el = els[id];
  el.classList.remove('hop'); void el.offsetWidth; el.classList.add('hop');
}

list.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const id = b.closest('.row').dataset.id;
  if (b.classList.contains('like')) {
    if (S.liked[id]) delete S.liked[id]; else S.liked[id] = true;
    renderCart(); save(); return;
  }
  if (b.classList.contains('ate')) {
    const prev = S.eaten[id] || { n: 0 };
    S.eaten[id] = { n: prev.n + 1, last: Date.now() };
    toast(`${BY_ID[id].name} — eaten 🍽️`);
  }
  S.cart = S.cart.filter(x => x !== id);
  renderCart(); save();
});

// reorder by dragging rows
let rd = null;
list.addEventListener('pointerdown', e => {
  const row = e.target.closest('.row');
  if (!row || e.target.closest('button') || e.button !== 0) return;
  e.preventDefault();
  rd = { row, sx: e.clientX, sy: e.clientY, moved: false };
});
addEventListener('pointermove', e => {
  if (!rd) return;
  if (!rd.moved) {
    if (Math.hypot(e.clientX - rd.sx, e.clientY - rd.sy) < 5) return;
    rd.moved = true;
    const r = rd.row.getBoundingClientRect();
    rd.offX = e.clientX - r.left; rd.offY = e.clientY - r.top;
    rd.clone = rd.row.cloneNode(true);
    rd.clone.classList.add('floating'); rd.clone.style.width = r.width + 'px';
    document.body.appendChild(rd.clone);
    rd.row.classList.add('ghost');
  }
  rd.clone.style.left = e.clientX - rd.offX + 'px';
  rd.clone.style.top = e.clientY - rd.offY + 'px';
  let before = null;
  for (const r of list.children) {
    if (r === rd.row) continue;
    const b = r.getBoundingClientRect();
    if (e.clientY < b.top + b.height / 2) { before = r; break; }
  }
  if (rd.row.nextElementSibling !== before) list.insertBefore(rd.row, before);
  const lr = list.getBoundingClientRect();
  if (e.clientY < lr.top + 30) list.scrollTop -= 8;
  else if (e.clientY > lr.bottom - 30) list.scrollTop += 8;
});
const endRowDrag = () => {
  if (!rd) return;
  const d = rd; rd = null;
  if (!d.moved) { locate(d.row.dataset.id); return; }
  d.clone.remove(); d.row.classList.remove('ghost');
  S.cart = [...list.children].map(r => r.dataset.id);
  renderCart(); save();
};
addEventListener('pointerup', endRowDrag);
addEventListener('pointercancel', endRowDrag);

$('#clearCart').addEventListener('click', () => {
  if (S.cart.length && confirm('Empty the shopping cart?')) { S.cart = []; renderCart(); save(); }
});

/* ─────────── go ─────────── */
renderCart();
applyFilters();
fit();
})();
