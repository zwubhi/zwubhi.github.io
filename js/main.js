(() => {
  'use strict';
  const root = document.documentElement;
  root.classList.add('js');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const css = name => getComputedStyle(root).getPropertyValue(name).trim();
  const fmt = n => n == null ? '–' : Number(n).toLocaleString('en-AU');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- Theme: Street / Satellite ---------- */
  const themeBtns = document.querySelectorAll('[data-theme-set]');
  function applyTheme(t, save) {
    root.dataset.theme = t;
    themeBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themeSet === t)));
    document.querySelector('meta[name="theme-color"]').content = t === 'dark' ? '#0d1222' : '#f6f4ee';
    if (save) { try { localStorage.setItem('theme', t); } catch (e) {} }
    document.dispatchEvent(new Event('themechange'));
  }
  let startTheme = root.dataset.theme;
  if (!startTheme) startTheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  applyTheme(startTheme, false);
  themeBtns.forEach(b => b.addEventListener('click', () => applyTheme(b.dataset.themeSet, true)));

  /* ---------- Reveal on scroll ---------- */
  const revealEls = document.querySelectorAll('.sec-head, .project, .job, .edu article, .features li, .layer-panel');
  if ('IntersectionObserver' in window && !reduceMotion) {
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
    revealEls.forEach(el => { el.classList.add('reveal'); io.observe(el); });
  }

  /* =========================================================
     HERO MAP: Brisbane SA2 bus service, drawn from GeoJSON
     ========================================================= */
  const fig = document.getElementById('map');
  const holder = document.getElementById('map-canvas');
  const tip = document.getElementById('map-tip');
  const panel = document.getElementById('map-panel');
  const zoomBox = document.getElementById('map-zoom');
  const coordsEl = document.getElementById('map-coords');
  const scaleEl = document.getElementById('map-scale');
  const legendEl = document.getElementById('map-legend');
  const SVGNS = 'http://www.w3.org/2000/svg';
  const K = 1000; // projected units per degree of latitude

  const getJSON = url => fetch(url).then(r => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });

  Promise.all([
    getJSON('data/brisbane_deficit.geojson'),
    getJSON('data/bus_routes.geojson').catch(() => null),
    null // bus stops are not shown
  ]).then(([sa2, routes, stops]) => initMap(sa2, routes, stops))
    .catch(err => { console.warn('Map data not loaded:', err); });

  function initMap(sa2, routes, stops) {
    // bounds and projection
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const eachCoord = (geom, fn) => geom.coordinates.forEach(poly => poly.forEach(ring => ring.forEach(fn)));
    sa2.features.forEach(f => eachCoord(f.geometry, ([x, y]) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }));
    const lon0 = (minX + maxX) / 2, lat0 = (minY + maxY) / 2;
    const kx = Math.cos(lat0 * Math.PI / 180) * K;
    const P = (lon, lat) => [(lon - lon0) * kx, -(lat - lat0) * K];
    const inv = (x, y) => [x / kx + lon0, -y / K + lat0];
    const [bx0, by1] = P(minX, minY), [bx1, by0] = P(maxX, maxY);
    // initial view: the urban core rather than the full metro extent
    const [cx0, cy1] = P(152.84, -27.75), [cx1, cy0] = P(153.24, -27.2);
    const core = [cx0, cy0, cx1, cy1];
    const ringPath = ring => 'M' + ring.map(([lo, la]) => { const [x, y] = P(lo, la); return x.toFixed(1) + ' ' + y.toFixed(1); }).join('L') + 'Z';

    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Brisbane suburbs shaded by bus service. Use the panel to change the shading or find a suburb.');
    const world = document.createElementNS(SVGNS, 'g');
    const gSub = document.createElementNS(SVGNS, 'g');
    const gRoutes = document.createElementNS(SVGNS, 'g');
    const gStops = document.createElementNS(SVGNS, 'g');
    gRoutes.setAttribute('class', 'routes');
    gStops.setAttribute('class', 'stops');
    world.append(gSub, gRoutes, gStops);
    svg.append(world);

    const subs = sa2.features.map(f => {
      const p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('d', f.geometry.coordinates.map(poly => poly.map(ringPath).join('')).join(''));
      p.setAttribute('class', 'suburb');
      p.setAttribute('fill-rule', 'evenodd');
      let sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity;
      eachCoord(f.geometry, ([lo, la]) => { const [x, y] = P(lo, la); if (x < sx0) sx0 = x; if (x > sx1) sx1 = x; if (y < sy0) sy0 = y; if (y > sy1) sy1 = y; });
      const s = { el: p, props: f.properties, box: [sx0, sy0, sx1, sy1] };
      p.__sub = s;
      gSub.append(p);
      return s;
    });

    if (routes) {
      const frag = document.createDocumentFragment();
      routes.features.forEach(f => {
        const p = document.createElementNS(SVGNS, 'path');
        p.setAttribute('d', 'M' + f.geometry.coordinates.map(([lo, la]) => { const [x, y] = P(lo, la); return x.toFixed(1) + ' ' + y.toFixed(1); }).join('L'));
        frag.append(p);
      });
      gRoutes.append(frag);
    }
    const stopEls = [];
    if (stops) {
      stops.features.forEach(f => {
        const c = document.createElementNS(SVGNS, 'circle');
        const [x, y] = P(...f.geometry.coordinates);
        c.setAttribute('cx', x.toFixed(1)); c.setAttribute('cy', y.toFixed(1));
        c.__stop = f.properties;
        gStops.append(c); stopEls.push(c);
      });
    }

    holder.append(svg);
    fig.classList.add('ready');
    panel.hidden = false;
    zoomBox.hidden = false;

    /* --- view transform --- */
    let W = 0, H = 0, s = 1, tx = 0, ty = 0, base = 1;
    const PANEL_R = 284; // space kept clear for the control panel (its width plus margins)
    const isNarrow = () => innerWidth <= 640;
    function fit(box, pad = 0.9) {
      const [x0, y0, x1, y1] = box;
      // keep clear of the floating panel on wide screens
      const reserveR = !isNarrow() && W > 700 ? PANEL_R : 0;
      const reserveB = isNarrow() ? 0 : 70;
      const aw = W - reserveR, ah = H - reserveB;
      const sc = Math.min(aw / (x1 - x0), ah / (y1 - y0)) * pad;
      return { s: sc, tx: aw / 2 - sc * (x0 + x1) / 2, ty: ah / 2 - sc * (y0 + y1) / 2 };
    }
    function apply() {
      world.setAttribute('transform', `translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${s.toFixed(5)})`);
      const r = (5 / s).toFixed(3);
      stopEls.forEach(c => c.setAttribute('r', r));
      updateScale();
      svg.style.touchAction = (s > base * 1.05) ? 'none' : 'pan-y';
    }
    function resize(keep) {
      const r = holder.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const cx = keep ? (W / 2 - tx) / s : null, cy = keep ? (H / 2 - ty) / s : null, rel = s / base;
      W = r.width; H = r.height;
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      const f = fit(core);
      base = f.s;
      if (keep) { s = base * rel; tx = W / 2 - cx * s; ty = H / 2 - cy * s; }
      else { s = f.s; tx = f.tx; ty = f.ty; }
      apply();
    }
    resize(false);
    new ResizeObserver(() => resize(W > 0)).observe(holder);

    let anim = null;
    function animateTo(ns, ntx, nty) {
      cancelAnimationFrame(anim);
      if (reduceMotion) { s = ns; tx = ntx; ty = nty; apply(); return; }
      const s0 = s, x0 = tx, y0 = ty, t0 = performance.now(), D = 650;
      const step = now => {
        const k = Math.min(1, (now - t0) / D), e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        s = s0 + (ns - s0) * e; tx = x0 + (ntx - x0) * e; ty = y0 + (nty - y0) * e; apply();
        if (k < 1) anim = requestAnimationFrame(step);
      };
      anim = requestAnimationFrame(step);
    }
    function zoomAt(factor, px, py, smooth) {
      const ns = Math.max(base * .45, Math.min(base * 12, s * factor));
      const wx = (px - tx) / s, wy = (py - ty) / s;
      const ntx = px - wx * ns, nty = py - wy * ns;
      if (smooth) animateTo(ns, ntx, nty); else { s = ns; tx = ntx; ty = nty; apply(); }
    }

    function updateScale() {
      const mPerPx = (111320 / K) / s;
      const target = 90 * mPerPx;
      const nice = [250, 500, 1000, 2000, 5000, 10000, 20000, 50000];
      let len = nice[0];
      for (const n of nice) if (n <= target) len = n;
      const px = len / mPerPx; // true on-screen length of `len` metres at this zoom
      scaleEl.querySelector('.bar').style.width = px.toFixed(1) + 'px';
      scaleEl.querySelector('.ticks').style.width = px.toFixed(1) + 'px';
      const km = len >= 1000, v = km ? len / 1000 : len;
      scaleEl.querySelector('.t1').textContent = String(v / 2);
      scaleEl.querySelector('.t2').textContent = String(v);
      scaleEl.querySelector('.unit').textContent = km ? 'km' : 'm';
    }

    /* --- interaction: pan, zoom --- */
    const pt = e => { const r = svg.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    let drag = null, moved = false;
    const pointers = new Map();
    svg.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch' && s <= base * 1.05) return; // let the page scroll until zoomed in
      pointers.set(e.pointerId, pt(e));
      if (pointers.size === 1) { drag = { p: pt(e), tx, ty }; moved = false; }
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', e => {
      const p = pt(e);
      const [lon, lat] = inv((p[0] - tx) / s, (p[1] - ty) / s);
      coordsEl.textContent = `${Math.abs(lat).toFixed(4)}°${lat < 0 ? 'S' : 'N'} ${lon.toFixed(4)}°E`;
      if (pointers.has(e.pointerId)) {
        const prev = pointers.get(e.pointerId);
        pointers.set(e.pointerId, p);
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          const others = [...pointers.entries()].find(([id]) => id !== e.pointerId)[1];
          const d0 = Math.hypot(prev[0] - others[0], prev[1] - others[1]);
          const d1 = Math.hypot(a[0] - b[0], a[1] - b[1]);
          if (d0 > 0) zoomAt(d1 / d0, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, false);
          moved = true; return;
        }
        if (drag) {
          const dx = p[0] - drag.p[0], dy = p[1] - drag.p[1];
          if (Math.abs(dx) + Math.abs(dy) > 3) { moved = true; svg.classList.add('dragging'); hideTip(); }
          if (moved) { tx = drag.tx + dx; ty = drag.ty + dy; apply(); }
          return;
        }
      }
      if (e.pointerType === 'mouse') hoverAt(e);
    });
    const endPtr = e => { pointers.delete(e.pointerId); if (!pointers.size) { drag = null; svg.classList.remove('dragging'); } };
    svg.addEventListener('pointerup', endPtr);
    svg.addEventListener('pointercancel', endPtr);
    svg.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !selected) hideTip(); });

    let wheelHintT;
    svg.addEventListener('wheel', e => {
      if (!(e.ctrlKey || e.metaKey)) {
        showHint('Hold Ctrl (⌘ on Mac) and scroll to zoom');
        return;
      }
      e.preventDefault();
      const p = pt(e);
      zoomAt(Math.exp(-e.deltaY * 0.0022), p[0], p[1], false);
    }, { passive: false });
    function showHint(msg) {
      tip.hidden = false; tip.innerHTML = esc(msg);
      tip.style.left = (W / 2 - tip.offsetWidth / 2) + 'px'; tip.style.top = (H / 2 - 20) + 'px';
      clearTimeout(wheelHintT); wheelHintT = setTimeout(() => { if (!selected) hideTip(); }, 1100);
    }
    zoomBox.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.zoom === 'reset') { const f = fit(core); animateTo(f.s, f.tx, f.ty); clearSel(); return; }
      const cx = (!isNarrow() && W > 700 ? W - PANEL_R : W) / 2;
      zoomAt(b.dataset.zoom === 'in' ? 1.6 : 1 / 1.6, cx, H / 2, true);
    });

    /* --- shading layers --- */
    let layer = 'category';
    const CAT = { 'Under-served': '--c-under', 'Balanced': '--c-bal', 'Well-served': '--c-well', 'No data': '--c-none' };
    function quantiles(key) {
      const v = subs.map(d => d.props[key]).filter(x => x != null && isFinite(x)).sort((a, b) => a - b);
      return [.2, .4, .6, .8].map(q => v[Math.floor(q * (v.length - 1))]);
    }
    function shade() {
      if (layer === 'category') {
        const counts = {};
        subs.forEach(d => { const c = d.props.category || 'No data'; counts[c] = (counts[c] || 0) + 1; d.el.style.fill = `var(${CAT[c] || '--c-none'})`; });
        legendEl.innerHTML = ['Under-served', 'Balanced', 'Well-served', 'No data'].filter(c => counts[c]).map(c =>
          `<div class="legend-row"><i style="background:var(${CAT[c]})"></i>${c}<span class="n">${counts[c]}</span></div>`).join('') +
          `<p class="legend-note">Deficit = demand (density) − supply (departures). Balanced: score rounds to 0.</p>`;
      } else {
        const br = quantiles(layer);
        const cls = v => v == null ? -1 : br.findIndex(b => v <= b) === -1 ? 4 : br.findIndex(b => v <= b);
        const counts = [0, 0, 0, 0, 0]; let nd = 0;
        subs.forEach(d => { const c = cls(d.props[layer]); if (c < 0) { nd++; d.el.style.fill = 'var(--c-none)'; } else { counts[c]++; d.el.style.fill = `var(--r${c + 1})`; } });
        const lo = [subs.reduce((m, d) => d.props[layer] != null ? Math.min(m, d.props[layer]) : m, Infinity), ...br];
        legendEl.innerHTML = counts.map((n, i) => {
          const a = Math.round(lo[i]), b = i < 4 ? Math.round(br[i]) : null;
          return `<div class="legend-row"><i style="background:var(--r${i + 1})"></i>${b == null ? fmt(a) + '+' : fmt(a) + ' – ' + fmt(b)}<span class="n">${n}</span></div>`;
        }).join('') + (nd ? `<div class="legend-row"><i style="background:var(--c-none)"></i>No data<span class="n">${nd}</span></div>` : '') +
          `<p class="legend-note">${layer === 'density' ? 'People per km², five equal-count classes.' : 'Five equal-count classes, full GTFS timetable.'}</p>`;
      }
    }
    panel.querySelectorAll('input[name="layer"]').forEach(r => r.addEventListener('change', () => { layer = r.value; shade(); }));
    shade();

    /* --- tooltip / selection --- */
    let selected = null;
    function tipHTML(d) {
      const p = d.props;
      return `<b>${esc(p.name)}</b><span class="cat">${esc(p.category || 'No data')}</span>
        <div class="tip-grid">
          <span>Residents</span><span>${fmt(p.population)}</span>
          <span>Density</span><span>${fmt(p.density)} /km²</span>
          <span>Bus stops</span><span>${fmt(p.stops)}</span>
          <span>Departures per 1,000</span><span>${fmt(p.departures_per_1000)}</span>
          <span>Deficit score</span><span>${p.deficit == null ? '–' : p.deficit}</span>
        </div>`;
    }
    function placeTip(x, y) {
      const fw = fig.clientWidth, w = tip.offsetWidth, h = tip.offsetHeight;
      const holderTop = holder.offsetTop;
      let left = x + 16, top = y + holderTop + 16;
      if (left + w > fw - 8) left = x - w - 16;
      if (left < 8) left = 8;
      if (top + h > holderTop + H - 8) top = y + holderTop - h - 16;
      if (top < 8) top = 8;
      tip.style.left = left + 'px'; tip.style.top = top + 'px';
    }
    function showTipFor(d, x, y) { tip.innerHTML = tipHTML(d); tip.hidden = false; placeTip(x, y); }
    function hideTip() { tip.hidden = true; }
    let hovered = null;
    function hoverAt(e) {
      if (selected) return;
      const t = e.target;
      if (t.__stop) {
        tip.innerHTML = `<b>${esc(t.__stop.name)}</b><div class="tip-grid"><span>Departures</span><span>${fmt(t.__stop.departures)}</span></div><span class="legend-note" style="color:inherit;opacity:.7">One of the 20 busiest stops</span>`;
        tip.hidden = false; const p = pt(e); placeTip(p[0], p[1]); return;
      }
      const d = t.__sub;
      if (hovered && hovered !== d) hovered.el.classList.remove('hl');
      if (!d) { hovered = null; hideTip(); return; }
      hovered = d; d.el.classList.add('hl');
      gSub.append(d.el); // bring outline to front
      const p = pt(e); showTipFor(d, p[0], p[1]);
    }
    function clearSel() { if (selected) selected.el.classList.remove('sel'); selected = null; hideTip(); }
    function select(d, x, y) {
      clearSel(); selected = d; d.el.classList.add('sel'); gSub.append(d.el);
      if (x == null) { const [x0, y0, x1, y1] = d.box; x = tx + s * (x0 + x1) / 2; y = ty + s * (y0 + y1) / 2; }
      showTipFor(d, x, y);
    }
    svg.addEventListener('click', e => {
      if (moved) { moved = false; return; }
      const hit = document.elementFromPoint(e.clientX, e.clientY); // the map captures the pointer, so find the suburb under the cursor
      const d = hit && hit.__sub;
      if (!d || d === selected) { clearSel(); if (hovered && e.pointerType === 'mouse') hoverAt(e); return; }
      flyTo(d);
    });
    svg.addEventListener('mouseleave', () => { if (hovered) hovered.el.classList.remove('hl'); hovered = null; });
    fig.addEventListener('mouseleave', () => { if (hovered) hovered.el.classList.remove('hl'); hovered = null; hideTip(); });
    fig.addEventListener('mouseenter', () => { if (selected && tip.hidden) select(selected); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') clearSel(); });

    /* --- search --- */
    const search = document.getElementById('map-search');
    const dl = document.getElementById('suburb-list');
    dl.innerHTML = subs.map(d => d.props.name).sort().map(n => `<option value="${esc(n)}">`).join('');
    function goTo(name) {
      const d = subs.find(x => x.props.name.toLowerCase() === name.trim().toLowerCase());
      if (!d) return false;
      flyTo(d);
      return true;
    }
    function flyTo(d) {
      const f = fit(d.box, .5);
      const ns = Math.min(f.s, base * 5);
      const [x0, y0, x1, y1] = d.box;
      const aw = (!isNarrow() && W > 700) ? W - PANEL_R : W;
      const ntx = aw / 2 - ns * (x0 + x1) / 2, nty = (H - (isNarrow() ? 0 : 70)) / 2 - ns * (y0 + y1) / 2;
      animateTo(ns, ntx, nty);
      setTimeout(() => select(d), reduceMotion ? 0 : 680);
    }
    const isName = v => subs.some(x => x.props.name.toLowerCase() === v.trim().toLowerCase());
    function clearForNew() { // after a pick, clicking the box empties it so the full list shows again
      if (search.value && isName(search.value)) { search.placeholder = search.value; search.value = ''; }
    }
    search.addEventListener('pointerdown', clearForNew);
    search.addEventListener('focus', clearForNew);
    search.addEventListener('change', () => goTo(search.value));
    search.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); goTo(search.value); } });
  }

  /* =========================================================
     PROJECTS GLOBE (orthographic, canvas) with a Moon mode
     ========================================================= */
  const canvas = document.getElementById('globe');
  const projects = [...document.querySelectorAll('.project')];
  const pinBox = document.getElementById('globe-pins');
  const gLabel = document.getElementById('globe-label');
  if (canvas && canvas.getContext) {
    const ctx = canvas.getContext('2d');
    const D2R = Math.PI / 180;
    const short = { 'p-paper': 'Rajasthan', 'p-bus': 'Brisbane', 'p-fake': 'UQ', 'p-fall': 'Chennai', 'p-moon': 'Moon' };
    const pins = projects.map(el => ({
      id: el.id, el, lat: +el.dataset.lat, lon: +el.dataset.lon, moon: !!el.dataset.moon,
      place: el.dataset.place, loc: el.querySelector('.p-loc').textContent, name: short[el.id] || el.id
    }));
    let lam = 120, phi = 5;       // view centre (lon, lat)
    let target = null, moonMix = 0, moonSpin = 0, active = null, inView = true, dragging = null;
    let colors = {};
    const readColors = () => { colors = { ink: css('--ink'), ink2: css('--ink-2'), line: css('--line'), sea: css('--globe-sea'), accent: css('--accent'), route: css('--route'), under: css('--c-under'), paper: css('--paper') }; };
    readColors();
    document.addEventListener('themechange', () => { readColors(); });

    // deterministic craters for the Moon
    let seed = 11;
    const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
    const craters = Array.from({ length: 70 }, () => ({ lat: Math.asin(rnd() * 2 - 1) / D2R, lon: rnd() * 360 - 180, r: Math.pow(rnd(), 2.4) * 16 + 1.5 }));
    const maria = Array.from({ length: 7 }, () => ({ lat: (rnd() - .5) * 90, lon: rnd() * 360 - 180, r: 14 + rnd() * 20 }));

    let size = 0, dpr = 1, R = 0, cx = 0, cy = 0;
    function resize() {
      const w = canvas.getBoundingClientRect().width;
      if (!w) return;
      dpr = Math.min(2, devicePixelRatio || 1);
      size = w; canvas.width = w * dpr; canvas.height = w * dpr;
      R = w * 0.4; cx = w / 2; cy = w / 2;
    }
    new ResizeObserver(resize).observe(canvas);
    resize();

    function proj(lat, lon, l0 = lam, p0 = phi) {
      const la = lat * D2R, lo = (lon - l0) * D2R, pp = p0 * D2R;
      const cosc = Math.sin(pp) * Math.sin(la) + Math.cos(pp) * Math.cos(la) * Math.cos(lo);
      return [cx + R * Math.cos(la) * Math.sin(lo), cy - R * (Math.cos(pp) * Math.sin(la) - Math.sin(pp) * Math.cos(la) * Math.cos(lo)), cosc];
    }
    function polyline(points, l0, p0) {
      ctx.beginPath(); let pen = false;
      for (const [la, lo] of points) {
        const [x, y, c] = proj(la, lo, l0, p0);
        if (c > 0) { pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y); pen = true; } else pen = false;
      }
      ctx.stroke();
    }
    function slerp(a, b, t) {
      const v = (la, lo) => [Math.cos(la * D2R) * Math.cos(lo * D2R), Math.cos(la * D2R) * Math.sin(lo * D2R), Math.sin(la * D2R)];
      const A = v(a[0], a[1]), B = v(b[0], b[1]);
      const w = Math.acos(A[0] * B[0] + A[1] * B[1] + A[2] * B[2]);
      const s1 = Math.sin((1 - t) * w) / Math.sin(w), s2 = Math.sin(t * w) / Math.sin(w);
      const P = [s1 * A[0] + s2 * B[0], s1 * A[1] + s2 * B[1], s1 * A[2] + s2 * B[2]];
      return [Math.asin(P[2]) / D2R, Math.atan2(P[1], P[0]) / D2R];
    }
    const journey = Array.from({ length: 80 }, (_, i) => slerp([12.84, 80.15], [-27.47, 153.03], i / 79));
    const graticule = [];
    for (let lo = -180; lo < 180; lo += 15) graticule.push(Array.from({ length: 61 }, (_, i) => [-90 + i * 3, lo]));
    for (let la = -75; la <= 75; la += 15) graticule.push(Array.from({ length: 121 }, (_, i) => [la, -180 + i * 3]));
    const tropics = [23.44, -23.44].map(la => Array.from({ length: 121 }, (_, i) => [la, -180 + i * 3]));
    const equator = Array.from({ length: 121 }, (_, i) => [0, -180 + i * 3]);

    function drawBezel(alpha) {
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.strokeStyle = colors.ink; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.12, 0, Math.PI * 2); ctx.stroke();
      for (let i = 0; i < 72; i++) {
        const a = i * 5 * D2R, l = i % 6 === 0 ? 10 : 4;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R * 1.12, cy + Math.sin(a) * R * 1.12);
        ctx.lineTo(cx + Math.cos(a) * (R * 1.12 - l), cy + Math.sin(a) * (R * 1.12 - l)); ctx.stroke();
      }
      ctx.fillStyle = colors.ink2; ctx.font = `${Math.max(9, size * 0.022)}px "JetBrains Mono", monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ['N', 'E', 'S', 'W'].forEach((t, i) => { const a = (i * 90 - 90) * D2R; ctx.fillText(t, cx + Math.cos(a) * R * 1.2, cy + Math.sin(a) * R * 1.2); });
      ctx.restore();
    }
    function shadeSphere(alpha) {
      const g = ctx.createRadialGradient(cx - R * .35, cy - R * .4, R * .1, cx, cy, R);
      g.addColorStop(0, 'rgba(255,255,255,0.18)'); g.addColorStop(.7, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.16)');
      ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    function drawEarth(alpha, t) {
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.fillStyle = colors.sea; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = colors.ink; ctx.globalAlpha = alpha * .14; ctx.lineWidth = .8;
      graticule.forEach(l => polyline(l));
      ctx.globalAlpha = alpha * .45; ctx.lineWidth = 1; polyline(equator);
      ctx.setLineDash([3, 4]); ctx.globalAlpha = alpha * .3; tropics.forEach(l => polyline(l)); ctx.setLineDash([]);
      // journey arc
      ctx.globalAlpha = alpha * .9; ctx.strokeStyle = colors.route; ctx.lineWidth = 1.6; ctx.setLineDash([5, 5]);
      ctx.lineDashOffset = reduceMotion ? 0 : -t / 60;
      polyline(journey); ctx.setLineDash([]);
      ctx.globalAlpha = alpha; ctx.strokeStyle = colors.ink; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      shadeSphere(alpha);
      // pins
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.font = `500 ${Math.max(10, size * 0.026)}px "JetBrains Mono", monospace`; ctx.textBaseline = 'middle';
      pins.filter(p => !p.moon).forEach(p => {
        const [x, y, c] = proj(p.lat, p.lon); p.sx = x; p.sy = y; p.vis = c > 0.05;
        if (!p.vis) return;
        const on = active === p;
        if (on && !reduceMotion) { const pr = (t / 1400) % 1; ctx.strokeStyle = colors.accent; ctx.globalAlpha = alpha * (1 - pr); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 6 + pr * 18, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = alpha; }
        ctx.fillStyle = on ? colors.accent : colors.paper; ctx.strokeStyle = colors.ink; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, on ? 7 : 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (on || p.id !== 'p-fake') {
          const label = p.name; const w = ctx.measureText(label).width;
          const lx = x + 12, ly = y - (p.id === 'p-bus' ? 12 : 0);
          ctx.fillStyle = colors.paper; ctx.globalAlpha = alpha * .85; ctx.fillRect(lx - 4, ly - 9, w + 8, 18);
          ctx.globalAlpha = alpha; ctx.fillStyle = on ? colors.ink : colors.ink2; ctx.fillText(label, lx, ly);
        }
      });
      ctx.restore();
    }
    function drawMoon(alpha, t) {
      const dark = root.dataset.theme === 'dark';
      const l0 = moonSpin, p0 = 8;
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.fillStyle = dark ? '#3b4157' : '#cfcac0';
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
      const blob = (c, fill, stroke) => {
        const [x, y, k] = proj(c.lat, c.lon, l0, p0);
        if (k <= 0.02) return;
        const r = R * Math.sin(c.r * D2R);
        const ang = Math.atan2(y - cy, x - cx);
        ctx.beginPath(); ctx.ellipse(x, y, Math.max(.5, r * k), r, ang, 0, Math.PI * 2);
        if (fill) { ctx.fillStyle = fill; ctx.fill(); }
        if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
      };
      maria.forEach(m => blob(m, dark ? 'rgba(15,20,40,.35)' : 'rgba(80,76,70,.16)'));
      craters.forEach(c => blob(c, dark ? 'rgba(10,14,30,.35)' : 'rgba(70,66,60,.18)', dark ? 'rgba(255,255,255,.12)' : 'rgba(255,255,255,.55)'));
      ctx.restore();
      ctx.strokeStyle = colors.ink; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
      // detection boxes, a nod to the YOLO project
      ctx.strokeStyle = colors.accent; ctx.lineWidth = 1.5; ctx.font = `500 ${Math.max(9, size * 0.021)}px "JetBrains Mono", monospace`; ctx.fillStyle = colors.accent;
      craters.filter(c => c.r > 7).forEach(c => {
        const [x, y, k] = proj(c.lat, c.lon, l0, p0);
        if (k < 0.62) return;
        const r = R * Math.sin(c.r * D2R) * 1.15;
        ctx.strokeRect(x - r * k, y - r, r * 2 * k, r * 2);
        ctx.fillText('crater ' + (0.5 + (c.r % 0.4)).toFixed(2), x - r * k, y - r - 7);
      });
      ctx.restore();
      shadeSphere(alpha);
    }

    let last = performance.now();
    function frame(now) {
      const dt = Math.min(50, now - last); last = now;
      if (target && !dragging) {
        const k = reduceMotion ? 1 : Math.min(1, dt / 220);
        let dl = ((target.lon - lam + 540) % 360) - 180;
        lam += dl * k; phi += (target.lat - phi) * k;
        if (Math.abs(dl) < .05 && Math.abs(target.lat - phi) < .05) { lam = target.lon; phi = target.lat; }
      }
      const wantMoon = active && active.moon ? 1 : 0;
      moonMix += (wantMoon - moonMix) * (reduceMotion ? 1 : Math.min(1, dt / 160));
      if (!reduceMotion) moonSpin = (moonSpin + dt * 0.006) % 360;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      drawBezel(1);
      if (moonMix < .99) drawEarth(1 - moonMix, now);
      if (moonMix > .01) drawMoon(moonMix, now);
      if (inView) requestAnimationFrame(frame);
    }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(es => { const v = es[0].isIntersecting; if (v && !inView) { inView = true; last = performance.now(); requestAnimationFrame(frame); } inView = v; }).observe(canvas);
    }
    requestAnimationFrame(frame);

    function setActive(p, fromScroll) {
      if (active === p) return;
      active = p;
      projects.forEach(el => el.classList.toggle('active', el === p.el));
      pinBox.querySelectorAll('button').forEach(b => b.setAttribute('aria-current', String(b.dataset.id === p.id)));
      gLabel.innerHTML = `<b>${esc(p.place)}</b> · ${esc(p.loc.split('·')[0].trim())}`;
      if (!p.moon) target = { lon: p.lon, lat: Math.max(-35, Math.min(35, p.lat)) };
    }
    pinBox.innerHTML = pins.map(p => `<button type="button" data-id="${p.id}">${esc(p.name)}</button>`).join('');
    pinBox.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const p = pins.find(x => x.id === b.dataset.id);
      setActive(p);
      p.el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    });
    // scroll-linked: the project crossing the middle of the screen is active
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) setActive(pins.find(p => p.el === e.target), true); }), { rootMargin: '-45% 0px -45% 0px' });
      projects.forEach(el => io.observe(el));
    }
    setActive(pins[0]);

    // drag to rotate, click a pin to jump
    const cpt = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    canvas.addEventListener('pointerdown', e => { dragging = { p: cpt(e), lam, phi, moved: false }; canvas.setPointerCapture(e.pointerId); canvas.classList.add('dragging'); });
    canvas.addEventListener('pointermove', e => {
      if (!dragging) return;
      const p = cpt(e), dx = p[0] - dragging.p[0], dy = p[1] - dragging.p[1];
      if (Math.abs(dx) + Math.abs(dy) > 3) dragging.moved = true;
      lam = dragging.lam - dx * 0.35; phi = Math.max(-60, Math.min(60, dragging.phi + dy * 0.35));
      target = null;
    });
    const endDrag = e => {
      if (!dragging) return;
      const wasClick = !dragging.moved; dragging = null; canvas.classList.remove('dragging');
      if (wasClick) {
        const [x, y] = cpt(e);
        const hit = pins.find(p => !p.moon && p.vis && Math.hypot(p.sx - x, p.sy - y) < 16);
        if (hit) { setActive(hit); hit.el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' }); }
      }
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', () => { dragging = null; canvas.classList.remove('dragging'); });
  }

  /* =========================================================
     EXPERIENCE: transit line with a train that follows scroll
     ========================================================= */
  const line = document.getElementById('line');
  if (line) {
    const fill = document.createElement('div'); fill.className = 'line-fill';
    const train = document.createElement('div'); train.className = 'train'; train.setAttribute('aria-hidden', 'true');
    line.append(fill, train);
    const stops = [...line.querySelectorAll('.stop')];
    const transfer = line.querySelector('.stop.transfer');
    function update() {
      const r = line.getBoundingClientRect();
      const h = line.offsetHeight - 20;
      const split = transfer ? transfer.offsetTop + 12 : h;
      line.style.setProperty('--split', (split / line.offsetHeight * 100).toFixed(1) + '%');
      fill.style.setProperty('--split-px', split + 'px');
      const prog = Math.max(0, Math.min(1, (innerHeight * 0.55 - r.top) / h));
      const y = prog * h;
      fill.style.height = y + 'px';
      train.style.top = (y) + 'px';
      train.style.background = y > split ? 'var(--route)' : 'var(--ink)';
      stops.forEach(s => s.classList.toggle('reached', s.offsetTop + 8 <= y + 10));
    }
    let raf = 0;
    addEventListener('scroll', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); }, { passive: true });
    addEventListener('resize', update);
    update();
  }

  /* =========================================================
     SKILLS AS LAYERS
     ========================================================= */
  const layerInputs = [...document.querySelectorAll('.layer input')];
  const feats = [...document.querySelectorAll('#features li')];
  function updateLayers() {
    const on = layerInputs.filter(i => i.checked).map(i => i.value);
    feats.forEach(li => {
      const sk = li.dataset.skills.split(' ');
      const match = on.filter(x => sk.includes(x));
      li.classList.toggle('on', on.length > 0 && match.length > 0);
      li.classList.toggle('off', on.length > 0 && match.length === 0);
      li.querySelector('.dots').innerHTML = match.map(m => `<i style="background:var(--l-${m})" title="${m}"></i>`).join('');
    });
  }
  layerInputs.forEach(i => i.addEventListener('change', updateLayers));
  updateLayers();
})();
