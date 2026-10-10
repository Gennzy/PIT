/* Cosmetic enhancement only. No networking, credentials or business actions. */
(() => {
  'use strict';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const tiles = '.service-card,.booking-card,.vehicle-card,.kpi,.tenant-card,.attention,.free-post,.metrics .card';
  const surfaces = tiles + ',.panel,.ticket,.contact-card,.login';
  const seen = new WeakSet();
  let active = null, moveFrame = 0, scanFrame = 0, lastAccent = '';
  function reset() {
    if (moveFrame) cancelAnimationFrame(moveFrame);
    moveFrame = 0;
    if (active) {
      active.classList.remove('is-tilting');
      for (const key of ['--tilt-x','--tilt-y','--glow-x','--glow-y']) active.style.removeProperty(key);
    }
    active = null;
  }
  const watcher = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    for (const {target, isIntersecting} of entries) {
      if (!isIntersecting) continue;
      if (!reduced.matches) {
        target.classList.add('motion-enter');
        target.addEventListener('animationend', () => target.classList.add('motion-finished'), {once:true});
      }
      watcher.unobserve(target);
    }
  }, {threshold:0.06}) : null;
  function scan() {
    scanFrame = 0;
    let index = 0;
    for (const node of document.querySelectorAll(surfaces)) {
      if (node.matches(tiles)) node.classList.add('depth-tile');
      if (seen.has(node)) continue;
      seen.add(node);
      node.style.setProperty('--enter-delay', Math.min(index++, 6) * 35 + 'ms');
      if (!reduced.matches && watcher) watcher.observe(node);
    }
  }
  function scheduleScan() {if (!scanFrame) scanFrame = requestAnimationFrame(scan);}
  document.addEventListener('pointermove', event => {
    if (reduced.matches || !fine.matches || event.pointerType !== 'mouse' || document.hidden) return reset();
    const tile = event.target.closest?.('.depth-tile');
    if (!tile || event.target.closest('input,select,textarea,form') || tile.closest('form')) return reset();
    if (active !== tile) {reset();active=tile;tile.classList.add('is-tilting');}
    const box = tile.getBoundingClientRect();
    const x = Math.min(1,Math.max(0,(event.clientX-box.left)/box.width));
    const y = Math.min(1,Math.max(0,(event.clientY-box.top)/box.height));
    if (moveFrame) cancelAnimationFrame(moveFrame);
    moveFrame = requestAnimationFrame(() => {
      moveFrame=0;
      if(active!==tile || !tile.isConnected) return;
      tile.style.setProperty('--tilt-x',((.5-y)*5).toFixed(2)+'deg');
      tile.style.setProperty('--tilt-y',((x-.5)*7).toFixed(2)+'deg');
      tile.style.setProperty('--glow-x',(x*100).toFixed(1)+'%');
      tile.style.setProperty('--glow-y',(y*100).toFixed(1)+'%');
    });
  }, {passive:true});
  document.addEventListener('pointerout', event => {if(active && !active.contains(event.relatedTarget)) reset();}, {passive:true});
  document.addEventListener('pointerdown', event => {if(event.pointerType!=='mouse')reset();}, {passive:true});
  window.addEventListener('blur',reset);
  window.addEventListener('scroll',reset,{passive:true,capture:true});
  reduced.addEventListener('change',() => {reset();if(reduced.matches)document.querySelectorAll('.motion-enter').forEach(n=>n.classList.add('motion-finished'));});
  fine.addEventListener('change',reset);
  document.addEventListener('visibilitychange',() => {document.documentElement.toggleAttribute('data-motion-paused',document.hidden);if(document.hidden)reset();});
  // Keep text readable even when an owner chooses a very light accent colour.
  const luminance = rgb => rgb.map(v => {v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
  function syncAccent() {
    const accent=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    if(accent===lastAccent)return;
    lastAccent=accent;
    if(!/^#[a-f\d]{6}$/i.test(accent))return;
    const channels=[1,3,5].map(i=>parseInt(accent.slice(i,i+2),16));
    const l=luminance(channels),white=1.05/(l+.05),dark=(l+.05)/.05;
    document.documentElement.style.setProperty('--accent-ink',white>=4.5?'#ffffff':'#000000');
    const top=channels.map(v=>Math.round(white>=dark?v*.95:v*.95+255*.05));
    document.documentElement.style.setProperty('--accent-top','rgb('+top.join(',')+')');
  }
  new MutationObserver(syncAccent).observe(document.documentElement,{attributes:true,attributeFilter:['style']});
  new MutationObserver(scheduleScan).observe(document.body,{childList:true,subtree:true});
  syncAccent();scan();
})();
