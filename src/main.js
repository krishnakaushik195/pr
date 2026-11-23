import './style.css';
import { CONFIG } from './config.js';
import GALLERY from './gallery.json';
import { ROOMS } from './tour/rooms.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const img = (n, w) => `/img/${n}${w === 'sm' ? '-sm' : ''}.webp`;

/* ------------------------------------------------------------ boot / intro */
const root = document.documentElement;
const finishIntro = () => {
  $('#intro').classList.add('done');
  root.classList.add('is-loaded');
};
window.addEventListener('load', () => setTimeout(finishIntro, reduced ? 0 : 900));
setTimeout(finishIntro, 3000);
$('#yr').textContent = new Date().getFullYear();

/* ------------------------------------------------------------------ header */
const header = $('#header');
const burger = $('#burger');
const nav = $('#nav');
const onScroll = () => {
  header.classList.toggle('solid', scrollY > 40);
  const s = $('#stage').getBoundingClientRect();
  const stageInView = s.top < innerHeight * 0.85 && s.bottom > innerHeight * 0.15;
  $('#mbar').classList.toggle('show', scrollY > 700 && !nearReserve() && !stageInView);
};
const nearReserve = () => {
  const r = $('#reserve').getBoundingClientRect();
  return r.top < innerHeight * 0.7;
};
burger.addEventListener('click', () => {
  const open = burger.getAttribute('aria-expanded') !== 'true';
  burger.setAttribute('aria-expanded', open);
  nav.classList.toggle('open', open);
  document.body.style.overflow = open ? 'hidden' : '';
});
nav.addEventListener('click', (e) => {
  if (e.target.closest('a')) {
    burger.setAttribute('aria-expanded', 'false');
    nav.classList.remove('open');
    document.body.style.overflow = '';
  }
});

/* ------------------------------------------------------- reveal + parallax */
$$('.reveal').forEach((el) => {
  const sibs = $$(':scope > .reveal', el.parentElement);
  el.style.setProperty('--d', `${Math.max(0, sibs.indexOf(el)) * 0.08}s`);
});
$$('.hero-copy .reveal').forEach((el, i) => el.style.setProperty('--i', i));
const io = new IntersectionObserver(
  (entries) =>
    entries.forEach((en) => {
      if (en.isIntersecting) {
        en.target.classList.add('in');
        io.unobserve(en.target);
      }
    }),
  { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
);
const observeReveals = () => $$('.reveal:not(.in)').forEach((el) => io.observe(el));
observeReveals();
setTimeout(() => $$('.hero-copy .reveal').forEach((el) => el.classList.add('in')), 350);

const para = $$('[data-parallax]');
let ticking = false;
const doParallax = () => {
  ticking = false;
  if (reduced) return;
  for (const el of para) {
    const r = el.getBoundingClientRect();
    if (r.bottom < -100 || r.top > innerHeight + 100) continue;
    const off = (r.top + r.height / 2 - innerHeight / 2) * -parseFloat(el.dataset.parallax);
    el.style.translate = `0 ${off.toFixed(1)}px`;
  }
};
addEventListener(
  'scroll',
  () => {
    onScroll();
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(doParallax);
    }
  },
  { passive: true }
);
onScroll();
doParallax();

/* nav highlight */
const links = $$('.nav a');
const secIo = new IntersectionObserver(
  (es) =>
    es.forEach((e) => {
      if (e.isIntersecting) links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#${e.target.id}`));
    }),
  { rootMargin: '-45% 0px -50% 0px' }
);
['tour', 'rooms', 'gallery', 'amenities', 'reviews', 'location'].forEach((id) => secIo.observe($(`#${id}`)));

/* counters */
const countIo = new IntersectionObserver((es) =>
  es.forEach((e) => {
    if (!e.isIntersecting) return;
    countIo.unobserve(e.target);
    const el = e.target;
    const to = parseFloat(el.dataset.count);
    const dec = parseInt(el.dataset.dec || '0', 10);
    if (reduced) return (el.textContent = to.toFixed(dec));
    const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min((t - t0) / 1400, 1);
      el.textContent = (to * (1 - Math.pow(1 - k, 3))).toFixed(dec);
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })
);
$$('[data-count]').forEach((el) => countIo.observe(el));

/* ------------------------------------------------------------------- rooms */
const svg = (p, s = 18) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ICON = {
  area: '<path d="M4 4h6M4 4v6M20 20h-6M20 20v-6M4 20l16-16"/>',
  view: '<path d="m3 20 6.5-11 4 6.5 2-3L21 20H3Z"/><circle cx="17" cy="6" r="1.6"/>',
  bed: '<path d="M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5"/><circle cx="7" cy="11" r="1.6"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.4 2.6-6 6-6s6 2.6 6 6M16 5.2a3 3 0 0 1 0 5.6M18 14.3c1.8.8 3 2.7 3 5.7"/>',
  bath: '<path d="M6 3h3a3 3 0 0 1 3 3v1M4 9h16v3a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6V9ZM8 21l1-3m6 3-1-3"/>',
  wifi: '<path d="M2 8.8a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor"/>',
  snow: '<path d="M12 2v20M4.2 7l15.6 10M4.2 17 19.8 7M9 3.5l3 2.5 3-2.5M9 20.5l3-2.5 3 2.5"/>',
  car: '<path d="M5 16.5V19m14-2.5V19M3 16.5h18v-4l-2-5H5l-2 5v4Z"/><circle cx="7.5" cy="13.5" r=".8" fill="currentColor"/><circle cx="16.5" cy="13.5" r=".8" fill="currentColor"/>',
  food: '<path d="M7 3v8M4 3v5a3 3 0 0 0 6 0V3M7 11v10M17 3c-2 2-3 5-3 8h3v10"/>',
  bell: '<path d="M3 18h18M5 18a7 7 0 0 1 14 0M12 8V6m-2 0h4"/>',
  shirt: '<path d="M8 3 3 6l2 4 3-1v12h8V9l3 1 2-4-5-3a4 4 0 0 1-8 0Z"/>',
  desk: '<path d="M3 8h18M5 8v12M19 8v12M9 8v6h6V8"/>',
  tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
  sofa: '<path d="M5 11V8a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v3M3 13a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v5H3v-5ZM6 18v2m12-2v2"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.5 3 8 7.5 9.5 4.5-1.5 7.5-5 7.5-9.5V6L12 3Z"/><path d="m9 12 2 2 4-4"/>',
};

const roomCards = [
  {
    key: 'deluxe',
    badge: 'Comfort',
    name: 'Deluxe Room',
    desc: 'A calm, air-conditioned double room with walnut furniture, a padded headboard and a private marble bathroom.',
    photos: ['room-wide-bed', 'bed-close', 'room-art-sofa', 'room-wardrobe-desk', 'bath-basin'],
    specs: [['area', '160 sq ft'], ['view', 'Hill view'], ['bed', '1 double bed'], ['users', 'Up to 3 guests'], ['bath', '1 bathroom']],
    chips: ['Air conditioning', 'Closet', 'Work desk', 'Chair', 'Mineral water', 'Free Wi-Fi'],
    price: '₹2,000',
    note: 'incl. taxes · ₹2,300 with breakfast',
  },
  {
    key: 'suite',
    badge: 'More space',
    name: 'Suite with Hill View',
    desc: 'Our roomiest stay: a king bed, deeper lounge and a wide window that looks out to the hills.',
    photos: ['suite-bed', 'room-wide-window', 'room-tv-sofa', 'room-desk-curtain', 'bath-shower'],
    specs: [['area', '220 sq ft'], ['view', 'Hill view'], ['bed', '1 king bed'], ['users', 'Up to 3 guests'], ['bath', '1 bathroom']],
    chips: ['Air conditioning', 'Closet', 'Work desk', 'Chair', 'Mineral water', 'Kettle, tea & coffee', 'Free Wi-Fi'],
    price: '₹3,200',
    note: 'incl. taxes · ₹3,680 with breakfast',
  },
];
$('#roomsGrid').innerHTML = roomCards
  .map(
    (r) => `
  <article class="room reveal">
    <div class="room-media">
      <div class="room-track" data-track>${r.photos.map((p, i) => `<img src="${img(p, 'sm')}" srcset="${img(p, 'sm')} 640w, ${img(p)} 1600w" sizes="(max-width: 900px) 92vw, 600px" alt="${r.name} photo ${i + 1}" loading="lazy" width="640" height="480" />`).join('')}</div>
      <span class="room-badge">${r.badge}</span>
      <div class="room-nav"><button data-dir="-1" aria-label="Previous photo">‹</button><button data-dir="1" aria-label="Next photo">›</button></div>
    </div>
    <div class="room-body">
      <h3>${r.name}</h3>
      <p>${r.desc}</p>
      <ul class="specs">${r.specs.map(([i, t]) => `<li>${svg(ICON[i])}${t}</li>`).join('')}</ul>
      <div class="chips">${r.chips.map((c) => `<span>${c}</span>`).join('')}</div>
      <div class="room-foot">
        <div class="price"><small>Indicative · per night</small><b>${r.price}</b><span>${r.note}</span></div>
        <div class="room-cta">
          <button class="btn btn-ink" data-open-tour="${r.key}">${svg('<path d="M12 2 3 7v10l9 5 9-5V7l-9-5Z"/><path d="m3 7 9 5 9-5M12 12v10"/>', 16)} Walk in 3D</button>
          <a class="btn btn-outline-dark" href="#reserve" data-reserve data-room="${r.name}">Reserve</a>
        </div>
      </div>
    </div>
  </article>`
  )
  .join('');
$$('.room').forEach((card) => {
  const track = $('[data-track]', card);
  $$('.room-nav button', card).forEach((b) =>
    b.addEventListener('click', () => {
      const w = track.clientWidth;
      const max = track.scrollWidth - w;
      const next = track.scrollLeft + w * +b.dataset.dir;
      track.scrollTo({ left: next > max + 4 ? 0 : next < -4 ? max : next, behavior: 'smooth' });
    })
  );
});

/* --------------------------------------------------------------- amenities */
const amenities = [
  ['wifi', 'Free Wi-Fi', 'Complimentary Wi-Fi for every guest.'],
  ['snow', 'Air conditioning', 'Every room is air-conditioned for restful nights.'],
  ['car', 'Free parking', 'Secure on-site parking for up to 20 cars.'],
  ['food', 'Restaurant', 'On-site dining, with breakfast available as an add-on.'],
  ['bell', 'Room service', 'Meals and essentials brought to your door.'],
  ['shirt', 'Laundry service', 'Fresh clothes for longer stays.'],
  ['view', 'Hill-view windows', 'Wake up to green hills from your room.'],
  ['bath', 'Private bathroom', 'Marble finish with toiletries and mineral water.'],
  ['desk', 'Desk & closet', 'A proper work desk, chair and wardrobe in every room.'],
  ['tv', 'Wall-mounted TV', 'Sit back with your favourite shows after a long day.'],
  ['sofa', 'Lounge seating', 'A sofa and coffee table to unwind in your room.'],
  ['shield', 'CCTV-secured', 'Premises and parking under CCTV surveillance.'],
];
$('#amenGrid').innerHTML = amenities
  .map(([i, t, d]) => `<article class="amen reveal"><span class="ico">${svg(ICON[i], 24)}</span><h3>${t}</h3><p>${d}</p></article>`)
  .join('');
$$('.amen').forEach((c) =>
  c.addEventListener('pointermove', (e) => {
    const r = c.getBoundingClientRect();
    c.style.setProperty('--mx', `${e.clientX - r.left}px`);
    c.style.setProperty('--my', `${e.clientY - r.top}px`);
  })
);
observeReveals();

/* ----------------------------------------------------------------- gallery */
const CAP = {
  'room-wide-bed': 'Deluxe room, bed & lounge',
  'bed-close': 'Padded headboard & crimson runner',
  'room-art-sofa': 'Tropical arch print above the sofa',
  'suite-bed': 'Suite, teal-accent king bed',
  'room-wide-window': 'Room with hill-view window',
  'room-tv-sofa': 'TV wall & lounge sofa',
  'room-wardrobe-desk': 'Wardrobe & work desk',
  'room-desk-curtain': 'Desk by the curtained window',
  'room-bed-wide': 'Wide view of the bed',
  'bed-cushions': 'Crimson cushions & white linen',
  'room-corner': 'Corner of the room',
  'room-sofa-door': 'Sofa beside the room door',
  'room-bed-tv': 'Bed facing the TV',
  'bath-shower': 'Grey marble shower',
  'bath-wood': 'Wood-effect wall & basin',
  'bath-basin': 'Wall-mounted basin & mirror',
  'bath-wc': 'Bathroom, wood-effect tile',
  'bath-geyser': 'Shower with water heater',
  'facade-dusk': 'The facade at dusk',
  lounge: 'Lobby lounge',
  reception: 'Reception',
  'facade-night': 'The facade at night',
  parking: 'Secure parking',
  'facade-day': 'The facade by day',
};
const masonry = $('#masonry');
masonry.innerHTML = GALLERY.map(
  (g, i) => `<button class="shot reveal" data-cat="${g.cat}" data-i="${i}" data-cap="${CAP[g.name] || ''}" aria-label="Open photo: ${CAP[g.name] || g.name}"><img src="${img(g.name, 'sm')}" srcset="${img(g.name, 'sm')} 640w, ${img(g.name)} 1600w" sizes="(max-width: 600px) 92vw, (max-width: 1080px) 46vw, 390px" width="${g.w}" height="${g.h}" alt="${CAP[g.name] || 'PR Grand'}" loading="lazy" /></button>`
).join('');
observeReveals();
$('#filters').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  $$('#filters button').forEach((x) => x.classList.toggle('is-on', x === b));
  $$('.shot').forEach((s) => s.classList.toggle('hide', b.dataset.f !== 'all' && s.dataset.cat !== b.dataset.f));
});

/* ---------------------------------------------------------------- lightbox */
const lb = $('#lightbox');
let lbList = [];
let lbIdx = 0;
const lbShow = () => {
  const it = lbList[lbIdx];
  $('#lbImg').src = it.src;
  $('#lbImg').alt = it.cap;
  $('#lbCap').textContent = it.cap;
  const multi = lbList.length > 1;
  $('#lbPrev').style.visibility = $('#lbNext').style.visibility = multi ? 'visible' : 'hidden';
};
const openLb = (list, i = 0) => {
  lbList = list;
  lbIdx = i;
  lbShow();
  lb.showModal();
};
const lbStep = (d) => {
  lbIdx = (lbIdx + d + lbList.length) % lbList.length;
  lbShow();
};
masonry.addEventListener('click', (e) => {
  const s = e.target.closest('.shot');
  if (!s) return;
  const vis = $$('.shot:not(.hide)');
  openLb(
    vis.map((v) => ({ src: img(GALLERY[+v.dataset.i].name), cap: v.dataset.cap })),
    vis.indexOf(s)
  );
});
$('#lbClose').addEventListener('click', () => lb.close());
$('#lbPrev').addEventListener('click', () => lbStep(-1));
$('#lbNext').addEventListener('click', () => lbStep(1));
lb.addEventListener('click', (e) => e.target === lb && lb.close());
lb.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') lbStep(-1);
  if (e.key === 'ArrowRight') lbStep(1);
});

/* ---------------------------------------------------------------- 3D tour */
const stage = $('#stage');
const poster = $('#poster');
const ui = $('#ui');
const hasGL = (() => {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
})();
let tour = null;
let starting = null;
let roomKey = 'deluxe';

const setSeg = (sel, attr, val) => $$(sel).forEach((b) => { const on = b.dataset[attr] === val; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', on); });

function updateCaption(i, stop) {
  const cfg = ROOMS[roomKey];
  $('#capCount').textContent = `${String(i + 1).padStart(2, '0')} / ${String(cfg.stops.length).padStart(2, '0')}`;
  $('#capRoom').textContent = cfg.name;
  $('#capTitle').textContent = stop.title;
  $('#capText').textContent = stop.text;
  $('#capThumb').src = img(stop.photo, 'sm');
  $$('#steps button').forEach((b, k) => b.classList.toggle('is-on', k === i));
}

function buildSteps() {
  const cfg = ROOMS[roomKey];
  $('#steps').innerHTML = cfg.stops.map((s, i) => `<li><button type="button" data-i="${i}"><b>${i + 1}</b>${s.short}</button></li>`).join('');
}

async function startTour(key = 'deluxe') {
  stage.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
  if (!hasGL) {
    $('#nogl').hidden = false;
    return;
  }
  if (starting) return starting;
  starting = (async () => {
    $('#loading').hidden = false;
    try {
      if (!tour) {
        const { RoomTour } = await import('./tour/tour.js');
        tour = new RoomTour($('#stageGl'), {
          labels: $('#labels'),
          minimap: $('#minimap'),
          onStop: (i, stop) => updateCaption(i, stop),
          onAuto: (on) => {
            $('#autoBtn').setAttribute('aria-pressed', on);
            $('#autoBtn span').textContent = on ? 'Stop tour' : 'Guided tour';
          },
          onMood: (m) => setSeg('[data-mood]', 'mood', m),
        });
      }
      switchRoom(key);
      if (import.meta.env.DEV) window.__tour = tour;
      poster.classList.add('gone');
      ui.hidden = false;
      setTimeout(() => $('#hint').classList.add('off'), 8000);
    } catch (err) {
      console.error(err);
      $('#nogl').hidden = false;
    } finally {
      $('#loading').hidden = true;
      starting = null;
    }
  })();
  return starting;
}

function switchRoom(key) {
  roomKey = key;
  buildSteps();
  tour.loadRoom(key);
  setSeg('[data-room]', 'room', key);
  updateCaption(0, ROOMS[key].stops[0]);
}

$('#enterDeluxe').addEventListener('click', () => startTour('deluxe'));
$('#enterSuite').addEventListener('click', () => startTour('suite'));
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-open-tour]');
  if (!t) return;
  e.preventDefault();
  const key = t.dataset.openTour || 'deluxe';
  if (tour && !poster.classList.contains('gone')) {
    stage.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
    if (key !== roomKey) switchRoom(key);
  } else startTour(key);
});

$$('[data-room]').forEach((b) => b.addEventListener('click', () => tour && b.dataset.room !== roomKey && switchRoom(b.dataset.room)));
$$('[data-mood]').forEach((b) => b.addEventListener('click', () => tour && tour.setMood(b.dataset.mood)));
$('#steps').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !tour) return;
  tour.stopAuto();
  tour.goTo(+b.dataset.i);
});
$('#autoBtn').addEventListener('click', () => tour && (tour.auto ? tour.stopAuto() : tour.startAuto()));
$('#capPhoto').addEventListener('click', () => {
  if (!tour) return;
  const s = ROOMS[roomKey].stops[tour.index];
  openLb([{ src: img(s.photo), cap: `${s.title} · ${ROOMS[roomKey].name} (photo from the property)` }]);
});
$$('#dpad button').forEach((b) => {
  const on = (v) => (e) => {
    e.preventDefault();
    tour && tour.setKey(b.dataset.k, v);
  };
  b.addEventListener('pointerdown', on(true));
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, on(false)));
});
stage.addEventListener('pointerdown', () => $('#hint').classList.add('off'), { once: true });

const fsBtn = $('#fsBtn');
fsBtn.addEventListener('click', async () => {
  const toggleExpanded = () => {
    const on = stage.classList.toggle('expanded');
    document.body.style.overflow = on ? 'hidden' : '';
  };
  if (document.fullscreenElement) return document.exitFullscreen();
  if (stage.classList.contains('expanded')) return toggleExpanded();
  if (stage.requestFullscreen) {
    try {
      await stage.requestFullscreen();
      return;
    } catch {
      /* fall through */
    }
  }
  toggleExpanded();
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && stage.classList.contains('expanded')) {
    stage.classList.remove('expanded');
    document.body.style.overflow = '';
  }
});

/* ------------------------------------------------------- booking + contact */
const fmt = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const iso = (d) => d.toISOString().slice(0, 10);
const today = new Date();
const tomorrow = new Date(today.getTime() + 864e5);
const dayAfter = new Date(today.getTime() + 2 * 864e5);
$$('input[type=date]').forEach((el) => {
  el.min = iso(today);
  el.value = el.name === 'checkin' ? iso(tomorrow) : iso(dayAfter);
});
$$('form').forEach((f) =>
  f.addEventListener('change', (e) => {
    if (e.target.name !== 'checkin') return;
    const out = f.elements.checkout;
    if (out.value <= e.target.value) out.value = iso(new Date(new Date(e.target.value).getTime() + 864e5));
    out.min = e.target.value;
  })
);

const toast = (msg) => {
  let t = $('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 4200);
};

function enquire(form) {
  const f = form.elements;
  if (f.checkout.value <= f.checkin.value) return toast('Check-out must be after check-in.');
  const lines = [
    'Hello PR Grand, I would like to check availability.',
    `Room: ${f.room.value}`,
    `Check-in: ${fmt(f.checkin.value)}`,
    `Check-out: ${fmt(f.checkout.value)}`,
    `Guests: ${f.guests.value}`,
  ];
  if (f.name && f.name.value.trim()) lines.push(`Name: ${f.name.value.trim()}`);
  if (CONFIG.whatsapp) {
    window.open(`https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(lines.join('\n'))}`, '_blank', 'noopener');
  } else {
    toast('Opening MakeMyTrip to complete your booking.');
    window.open(CONFIG.mmtUrl, '_blank', 'noopener');
  }
}
$('#quickBook').addEventListener('submit', (e) => {
  e.preventDefault();
  enquire(e.target);
});
$('#reserveForm').addEventListener('submit', (e) => {
  e.preventDefault();
  enquire(e.target);
});
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-reserve][data-room]');
  if (a) $$('select[name=room]').forEach((s) => (s.value = a.dataset.room));
});
$('#mmtBtn').href = CONFIG.mmtUrl;
$('#dirBtn').href = CONFIG.mapsDirections;
if (CONFIG.phone) {
  const c = $('#callBtn');
  c.hidden = false;
  c.href = `tel:${CONFIG.phone.replace(/\s/g, '')}`;
  c.textContent = `Call ${CONFIG.phone}`;
}
$('#copyAddr').addEventListener('click', async (e) => {
  try {
    await navigator.clipboard.writeText(CONFIG.address);
    e.target.textContent = 'Copied ✓';
    setTimeout(() => (e.target.textContent = 'Copy address'), 2200);
  } catch {
    toast(CONFIG.address);
  }
});
