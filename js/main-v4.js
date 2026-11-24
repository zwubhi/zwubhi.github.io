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

  /* ---------- Sound toggle: on by default, lasts for this visit only ---------- */
  const soundBtn = document.getElementById('sound-toggle');
  let soundOn = true, audioCtx = null, chimeBuf = null;
  if (soundBtn) soundBtn.addEventListener('click', () => {
    soundOn = !soundOn;
    soundBtn.setAttribute('aria-pressed', String(soundOn));
    soundBtn.setAttribute('aria-label', soundOn ? 'Sound on' : 'Sound off');
  });
  // browsers block sound until the visitor clicks, taps or presses a key (scrolling doesn't count),
  // so unlock the audio and preload the chime on the first one, anywhere on the page
  const unlockEvents = ['click', 'touchend', 'keydown'];
  function unlockAudio() {
    unlockEvents.forEach(t => document.removeEventListener(t, unlockAudio, true));
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      const prime = audioCtx.createBufferSource(); // a silent blip primes Safari and iPhone
      prime.buffer = audioCtx.createBuffer(1, 1, 22050);
      prime.connect(audioCtx.destination); prime.start();
    } catch (e) { audioCtx = null; return; }
    fetch('sounds/graduation-chime.mp3')
      .then(r => { if (!r.ok) throw new Error('chime ' + r.status); return r.arrayBuffer(); })
      .then(data => new Promise((res, rej) => audioCtx.decodeAudioData(data, res, rej)))
      .then(buf => { chimeBuf = buf; })
      .catch(() => {});
  }
  unlockEvents.forEach(t => document.addEventListener(t, unlockAudio, true));
  function playChime() {
    if (!soundOn || !audioCtx || !chimeBuf || audioCtx.state !== 'running') return; // not unlocked or still loading: skip silently
    const src = audioCtx.createBufferSource(), gain = audioCtx.createGain();
    gain.gain.value = 0.35;
    src.buffer = chimeBuf;
    src.connect(gain).connect(audioCtx.destination);
    src.start();
  }

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
          `<p class="legend-note">Deficit = demand (density) − supply (departures).</p>`;
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
          `<p class="legend-note">${layer === 'density' ? 'People per km²' : "Bus departures per 1,000 residents across Translink's full timetable"}</p>`;
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
    const DEFAULT_VIEW = 'Default view', startPlaceholder = search.placeholder;
    dl.innerHTML = `<option value="${DEFAULT_VIEW}">` + subs.map(d => d.props.name).sort().map(n => `<option value="${esc(n)}">`).join('');
    function goTo(name) {
      if (name.trim().toLowerCase() === DEFAULT_VIEW.toLowerCase()) { // same as the reset button, and the box goes back to the placeholder
        const f = fit(core); animateTo(f.s, f.tx, f.ty); clearSel();
        search.value = ''; search.placeholder = startPlaceholder;
        return true;
      }
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
    const short = { 'p-paper': 'Rajasthan', 'p-bus': 'Brisbane', 'p-fake': 'UQ', 'p-fall': 'Chennai', 'p-chatbot': 'Chennai', 'p-cloud': 'Chennai', 'p-moon': 'Moon' };
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
      pins.filter(p => !p.moon).sort((a, b) => (a === active) - (b === active)).forEach(p => { // active pin drawn last so shared spots (Chennai) still show it
        let [x, y, c] = proj(p.lat, p.lon); p.vis = c > 0.05;
        if (!p.vis) return;
        if (p.id === 'p-fake') { // UQ sits almost on top of Brisbane: draw it just below, with a thin line to its true location
          ctx.strokeStyle = colors.ink2; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 20); ctx.stroke();
          y += 20;
        }
        p.sx = x; p.sy = y;
        const on = active === p;
        if (on && !reduceMotion) { const pr = (t / 1400) % 1; ctx.strokeStyle = colors.accent; ctx.globalAlpha = alpha * (1 - pr); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 6 + pr * 18, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = alpha; }
        ctx.fillStyle = on ? colors.accent : colors.paper; ctx.strokeStyle = colors.ink; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, on ? 7 : 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        {
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
      pinBox.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.body === 'moon') === p.moon)));
      gLabel.innerHTML = p.moon ? '' : `<b>${esc(p.place)}</b> · ${esc(p.loc.split('·')[0].trim())}`;
      if (!p.moon) target = { lon: p.lon, lat: Math.max(-35, Math.min(35, p.lat)) };
    }
    pinBox.innerHTML = '<button type="button" data-body="earth" aria-pressed="true">Earth</button><button type="button" data-body="moon" aria-pressed="false">Moon</button>';
    pinBox.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const p = b.dataset.body === 'moon' ? pins.find(x => x.moon) : pins.find(x => !x.moon);
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
        const hit = pins.filter(p => !p.moon && p.vis && Math.hypot(p.sx - x, p.sy - y) < 16).sort((a, b) => Math.hypot(a.sx - x, a.sy - y) - Math.hypot(b.sx - x, b.sy - y))[0];
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
    // the rider (images/subhitcha-rider.svg) inlined so it can use the page colour variables; the cap waits for the finish line
    train.innerHTML = `<svg class="rider" viewBox="0 0 72 92" xmlns="http://www.w3.org/2000/svg" focusable="false">
  <defs>
    <clipPath id="sr-shirt"><path d="M20.5 61 C20.5 49.6 26.8 44.4 36 44.4 C45.2 44.4 51.5 49.6 51.5 61 Z"/></clipPath>
    <clipPath id="sr-glass"><path d="M19.5 58.5 L52.5 58.5 L56 66.5 L16 66.5 Z"/></clipPath>
  </defs>

  <!-- ground shadow -->
  <ellipse cx="36" cy="88.4" rx="27" ry="2.8" fill="#000" opacity=".14"/>

  <g class="me">
    <!-- hair, back layer: big, voluminous waves past the shoulders -->
    <path d="M35 5.8 C25 5.8 18.4 11.8 17.9 20.8 C17.6 25.8 15.9 28.4 16.1 31.8 C16.3 34.8 17.9 36.2 16.7 39.2 C15.5 42 13.7 43.8 14.5 47.2 C15.2 50 17.1 51 16.3 53.8 C15.9 55.8 15.5 57.6 16.9 58.8 L55.1 58.8 C56.5 57.6 56.1 55.8 55.7 53.8 C54.9 51 56.8 50 57.5 47.2 C58.3 43.8 56.5 42 55.3 39.2 C54.1 36.2 55.7 34.8 55.9 31.8 C56.1 28.4 54.4 25.8 54.1 20.8 C53.6 11.8 47 5.8 35 5.8 Z" fill="#1d1613"/>
    <path d="M18.4 44 C17.2 46.6 18.8 49 17.8 52" stroke="#7a4a2b" stroke-width="1" fill="none" stroke-linecap="round" opacity=".7"/>
    <path d="M53.6 44 C54.8 46.6 53.2 49 54.2 52" stroke="#7a4a2b" stroke-width="1" fill="none" stroke-linecap="round" opacity=".7"/>
    <!-- waving arm (her left), behind the shoulder -->
    <path d="M47.4 48.4 C53 44.6 56.2 38 57.2 31" stroke="#4a3027" stroke-width="5.8" fill="none" stroke-linecap="round"/>
    <path d="M48.8 46.8 C53.4 43.4 55.6 38 56.5 33" stroke="#b9998a" stroke-width=".45" fill="none" opacity=".55"/>
    <ellipse cx="57.4" cy="27.4" rx="2.9" ry="3.3" fill="#c68a5c"/>
    <g stroke="#c68a5c" stroke-width="1.3" stroke-linecap="round"><path d="M55.6 25.4 V22.6"/><path d="M57 24.8 V21.8"/><path d="M58.4 24.8 V22"/><path d="M59.7 25.6 V23.2"/><path d="M54.8 28.6 L53.2 27.2"/></g>
    <g stroke="var(--ink-2, #4b5373)" stroke-width="1.1" stroke-linecap="round"><path d="M62.6 21.4 l2.5 -1.9"/><path d="M63.4 25.8 l3 0"/><path d="M62.6 30.2 l2.5 1.8"/></g>

    <!-- neck -->
    <path d="M33.2 36.5 L38.8 36.5 L38.8 46 L33.2 46 Z" fill="#b07448"/>
    <path d="M33.2 38.2 C34.8 39.8 37.2 39.8 38.8 38.2 L38.8 40.4 C37.2 41.4 34.8 41.4 33.2 40.4 Z" fill="#8d5a38" opacity=".5"/>

    <!-- shirt: chocolate brown with fine pinstripes, open collar, buttons -->
    <path d="M20.5 61 C20.5 49.6 26.8 44.4 36 44.4 C45.2 44.4 51.5 49.6 51.5 61 Z" fill="#4a3027"/>
    <g clip-path="url(#sr-shirt)" stroke="#b9998a" stroke-width=".35" opacity=".6">
      <path d="M22.5 42 V62 M24.3 46 V62 M26.1 46 V62 M27.9 46 V62 M29.7 46 V62 M31.5 46 V62 M40.5 46 V62 M42.3 46 V62 M44.1 46 V62 M45.9 46 V62 M47.7 46 V62 M49.5 46 V62"/>
    </g>
    <path d="M33 44.4 L36 49 L39 44.4 Z" fill="#b07448"/>
    <path d="M31 44 L36 49.3 L33.4 43.7 Z" fill="#5b3b2e"/>
    <path d="M41 44 L36 49.3 L38.6 43.7 Z" fill="#5b3b2e"/>
    <circle cx="36" cy="52.2" r=".7" fill="#2c1b15"/><circle cx="36" cy="56.2" r=".7" fill="#2c1b15"/>

    <!-- face: slim oval, gently pointed chin, warm golden-brown -->
    <path d="M27 24.8 C27 17.9 31 14.6 36 14.6 C41 14.6 45 17.9 45 24.8 C45 32.2 41.2 38.4 36 38.9 C30.8 38.4 27 32.2 27 24.8 Z" fill="#c68a5c"/>
    <path d="M27.3 26.6 C27.7 32.4 30.4 37.2 34.2 38.7 C30.6 36.3 28.8 32 28.6 27 Z" fill="#9a623f" opacity=".28"/>

    <!-- hair, front: soft side part, bigger sweep to her left, framing the face and falling over the shoulders -->
    <path d="M33.5 13.6 C29 14 26 17.4 25.6 22.2 C25.3 26.4 26.1 30.2 25.1 34.2 C24.2 37.8 21.7 40.6 22.7 44.8 C23.5 48.2 21.3 51.4 19.5 54.6 C24.6 54.6 28.2 51.8 29.4 47.8 C30.4 44.4 31 41.8 30.2 38.8 C29.2 37.2 28 36.2 27.8 34.2 C27.4 30.6 27 26.8 27.6 23 C28.2 19.8 30.4 17.4 33 16.8 C33.6 16 33.8 14.8 33.5 13.6 Z" fill="#1d1613"/>
    <path d="M33.3 13.4 C40.2 12.4 46 16.2 46.8 22.2 C47.5 27.4 46 31 47.2 35 C48.2 38.4 50.4 41 49.4 45.2 C48.6 48.4 50.6 51.4 52.4 54.6 C47.1 54.6 43.6 51.6 42.6 47.6 C41.6 44.2 41 41.8 41.8 39 C43 37.6 44.2 36.4 44.6 34.4 C45 30.4 44.4 26.4 42.8 23 C41 19.6 37.6 18.2 34.4 18.8 C33.4 17.4 33 15.4 33.3 13.4 Z" fill="#1d1613"/>
    <!-- soft sheen and caramel tips on the front waves -->
    <path d="M37.6 14.4 C41.4 14.8 44.2 16.9 45.3 20 C43.5 18.3 40.9 17 37.8 16.4 Z" fill="#6e4127" opacity=".45"/>
    <path d="M19.5 54.6 C21 54.5 22.4 54 23.5 53.1 C22.9 52.5 22 52.4 21.2 52.8 C20.8 53.5 20.2 54.1 19.5 54.6 Z" fill="#8a5530"/>
    <path d="M52.4 54.6 C50.9 54.5 49.5 54 48.4 53.1 C49 52.5 49.9 52.4 50.7 52.8 C51.1 53.5 51.7 54.1 52.4 54.6 Z" fill="#8a5530"/>
    <path d="M46.3 36.6 C47.4 39.6 49.2 41.8 48.6 45.2" stroke="#7a4a2b" stroke-width=".7" fill="none" stroke-linecap="round" opacity=".8"/>
    <path d="M25.7 36.6 C24.6 39.6 22.8 41.8 23.4 45.2" stroke="#7a4a2b" stroke-width=".7" fill="none" stroke-linecap="round" opacity=".8"/>

    <!-- brows: defined, softly arched -->
    <path d="M28.8 23.5 C30.3 22.4 32.4 22.3 33.9 23" stroke="#1d1613" stroke-width="1.15" fill="none" stroke-linecap="round"/>
    <path d="M43.2 23.5 C41.7 22.4 39.6 22.3 38.1 23" stroke="#1d1613" stroke-width="1.15" fill="none" stroke-linecap="round"/>
    <!-- eyes: warm almond shape, smiling a little -->
    <path d="M29.4 26.8 C30.4 25.7 32.6 25.6 33.7 26.6 C32.7 27.5 30.5 27.6 29.4 26.8 Z" fill="#fff"/>
    <path d="M38.3 26.6 C39.4 25.6 41.6 25.7 42.6 26.8 C41.5 27.6 39.3 27.5 38.3 26.6 Z" fill="#fff"/>
    <circle cx="31.6" cy="26.55" r="1" fill="#2a1a12"/>
    <circle cx="40.4" cy="26.55" r="1" fill="#2a1a12"/>
    <circle cx="31.95" cy="26.2" r=".3" fill="#fff"/>
    <circle cx="40.75" cy="26.2" r=".3" fill="#fff"/>
    <path d="M29.1 26.9 C30.3 25.3 32.8 25.2 34 26.5" stroke="#1d1613" stroke-width=".85" fill="none" stroke-linecap="round"/>
    <path d="M42.9 26.9 C41.7 25.3 39.2 25.2 38 26.5" stroke="#1d1613" stroke-width=".85" fill="none" stroke-linecap="round"/>
    <!-- nose -->
    <path d="M35.3 27.6 C35.1 29.2 34.8 30.4 34.9 31.2" stroke="#9a623f" stroke-width=".45" fill="none" opacity=".65"/>
    <path d="M34.5 31.5 C35.1 32.3 36.9 32.3 37.5 31.5" stroke="#8a5536" stroke-width=".7" fill="none" stroke-linecap="round"/>
    <!-- gentle closed-lip smile, lifting a little more on one side -->
    <path d="M32.6 34.6 C34.4 35.9 37.8 35.9 39.8 34" stroke="#8a4636" stroke-width="1" fill="none" stroke-linecap="round"/>
    <path d="M33.1 34.9 C34.8 36.7 37.7 36.6 39.3 34.6 C37.7 35.5 34.8 35.6 33.1 34.9 Z" fill="#a85a4a"/>
    <path d="M39.8 34 C40.1 33.7 40.3 33.4 40.3 33.1" stroke="#9a623f" stroke-width=".5" fill="none" stroke-linecap="round" opacity=".7"/>
    <ellipse cx="30.2" cy="31.8" rx="1.8" ry="1" fill="#e07a5f" opacity=".2"/>
    <ellipse cx="41.8" cy="31.8" rx="1.8" ry="1" fill="#e07a5f" opacity=".2"/>
  </g>

  <!-- graduation cap (images/grad-cap.svg), nudged 3 units up so it sits on the hair -->
  <g transform="translate(0 -3)"><g class="cap">
    <path d="M36 4.5 L53 10.5 L36 16.5 L19 10.5 Z" fill="#172045"/>
  <path d="M25.5 13 L25.5 16.8 C29 19 43 19 46.5 16.8 L46.5 13 L36 16.5 Z" fill="#232c5c"/>
  <circle cx="36" cy="10.5" r="1.1" fill="#ff6a3d"/>
  <path d="M36 10.5 L48 13.5 L48.6 20" stroke="#ff6a3d" stroke-width="1" fill="none"/>
  <path d="M47.6 19.5 L49.6 19.5 L49.2 23.5 L48 23.5 Z" fill="#ff6a3d"/>
  </g></g>

  <!-- ===== the car: little convertible, front view, coming towards you ===== -->
  <!-- windscreen frame and glass (she sits behind it) -->
  
  <path d="M19.5 58.5 L52.5 58.5 L56 66.5 L16 66.5 Z" fill="#cfe3f2" opacity=".35"/>
  <path d="M19.5 58.5 L52.5 58.5 L56 66.5 L16 66.5 Z" fill="none" stroke="var(--route, #ff6a3d)" stroke-width="1.6" stroke-linejoin="round"/>
  <g clip-path="url(#sr-glass)"><path d="M22 58.5 L28 58.5 L22.5 66.5 L17.5 66.5 Z" fill="#fff" opacity=".45"/></g>
  <!-- her resting hand on the door -->
  <ellipse cx="15.6" cy="66.2" rx="3" ry="2.6" fill="#c68a5c"/>
  <!-- body -->
  <path d="M8 72 C8 68.2 10.6 66.4 14 66.4 L58 66.4 C61.4 66.4 64 68.2 64 72 L64 79 C64 81.2 62.4 82.4 60.4 82.4 L11.6 82.4 C9.6 82.4 8 81.2 8 79 Z" fill="var(--route, #ff6a3d)"/>
  <path d="M10 69.4 L62 69.4" stroke="#fff" stroke-width=".6" opacity=".35"/>
  <!-- mirrors -->
  <rect x="7.4" y="62.6" width="6" height="3.6" rx="1.8" fill="var(--route, #ff6a3d)"/>
  <rect x="58.6" y="62.6" width="6" height="3.6" rx="1.8" fill="var(--route, #ff6a3d)"/>
  <!-- headlights, grille, plate, bumper -->
  <circle cx="16.4" cy="74.2" r="3.4" fill="#fff7d6" stroke="#fff" stroke-width=".8"/>
  <circle cx="55.6" cy="74.2" r="3.4" fill="#fff7d6" stroke="#fff" stroke-width=".8"/>
  <rect x="26.5" y="71.8" width="19" height="4.6" rx="2.3" fill="#1b1f33" opacity=".5"/>
  <rect x="31" y="77.8" width="10" height="2.6" rx="1" fill="#fff" opacity=".9"/>
  <rect x="9" y="81" width="54" height="3" rx="1.5" fill="#1b1f33" opacity=".35"/>
  <!-- wheels -->
  <rect x="11" y="82" width="9" height="6" rx="2.5" fill="#2a2f45"/>
  <rect x="52" y="82" width="9" height="6" rx="2.5" fill="#2a2f45"/>
</svg>`;
    line.append(fill, train);
    const stops = [...line.querySelectorAll('.stop')];
    const transfer = line.querySelector('.stop.transfer');
    let lastReached = -1;

    // graduation celebration at the final stop: finish ribbon, flag, cap and confetti (plays once)
    const finish = stops[stops.length - 1];
    const ribbon = document.createElement('div'); ribbon.className = 'finish-ribbon'; ribbon.setAttribute('aria-hidden', 'true');
    ribbon.innerHTML = '<span class="half left"></span><span class="half right"></span>';
    const flag = document.createElement('div'); flag.className = 'finish-flag'; flag.setAttribute('aria-hidden', 'true');
    flag.innerHTML = '<span class="pole"></span><span class="pennant">Class of 2026</span>';
    finish.append(ribbon, flag);
    const confettiColours = ['#ff6a3d', '#2438c4', '#128063', '#a8740a', '#e07a5f'];
    let celebrated = false, lastY = null, navJump = -Infinity;
    const navType = (performance.getEntriesByType('navigation')[0] || {}).type;
    if (location.hash || navType === 'reload' || navType === 'back_forward') navJump = performance.now(); // opened at a section link, or the browser is restoring the scroll position
    document.addEventListener('click', e => { if (e.target.closest('a[href^="#"]')) navJump = performance.now(); }); // nav jumps show the end state
    function restingConfetti() {
      // five pieces left on the ground beside the wheels
      [[-4, 49, 0, 20], [1, 50.5, 2, -30], [6, 49.5, 1, 60], [35, 50, 3, -15], [40, 49, 4, 35]].forEach(([x, yy, c, r], i) => {
        const b = document.createElement('i'); b.className = 'confetti rest' + (i % 2 ? ' dot' : '');
        b.style.cssText = `left:${x}px;top:${yy}px;background:${confettiColours[c]};transform:rotate(${r}deg)`;
        train.append(b);
      });
    }
    function burstConfetti() {
      // two bursts from the car's sides, flying outwards and away from the face
      for (let i = 0; i < 40; i++) {
        const side = i % 2 ? 1 : -1;
        const b = document.createElement('i'); b.className = 'confetti burst' + (i % 3 === 0 ? ' dot' : '');
        const dx = side * (14 + Math.random() * 46), up = 18 + Math.random() * 34, fall = 30 + Math.random() * 40;
        b.style.cssText = `left:${side < 0 ? 4 : 34}px;top:${36 + Math.random() * 8}px;background:${confettiColours[i % 5]};--dx:${dx.toFixed(1)}px;--up:${(-up).toFixed(1)}px;--fall:${fall.toFixed(1)}px;--rot:${(side * (180 + Math.random() * 360)).toFixed(0)}deg;animation-delay:${(Math.random() * 120).toFixed(0)}ms`;
        train.append(b);
      }
      setTimeout(() => train.querySelectorAll('.confetti.burst').forEach(b => b.remove()), 1800);
    }
    function celebrate(animate, chime) {
      celebrated = true;
      if (chime) playChime();
      line.classList.add(animate ? 'celebrate' : 'celebrated');
      restingConfetti();
      if (animate) { burstConfetti(); setTimeout(() => line.classList.replace('celebrate', 'celebrated'), 1600); }
    }
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
      train.style.color = y > split ? 'var(--route)' : 'var(--ink)';
      let reached = 0;
      stops.forEach(s => { const on = s.offsetTop + 8 <= y + 10; s.classList.toggle('reached', on); if (on) reached++; });
      if (reached > lastReached && lastReached >= 0) { train.classList.remove('bounce'); void train.offsetWidth; train.classList.add('bounce'); } // tiny bounce on arriving at a stop
      lastReached = reached;
      // the car's front touches the finish ribbon
      if (!celebrated && y + 36.5 >= finish.offsetTop + ribbon.offsetTop) {
        const jumped = lastY === null || y - lastY > innerHeight * 0.6 || performance.now() - navJump < 2000;
        celebrate(!(jumped || reduceMotion), !jumped);
      }
      lastY = y;
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
  // flip cards: click, tap, Enter or Space toggles just that card
  const featList = document.getElementById('features');
  if (featList) featList.addEventListener('click', e => {
    const b = e.target.closest('.flip'); if (!b) return;
    b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'));
  });
})();
