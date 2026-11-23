import * as THREE from 'three';

const mk = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
};

const toTex = (c, repeat, srgb = true) => {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  return t;
};

// seeded random so textures are identical between loads
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function speckle(ctx, w, h, r, count, alpha, light = true) {
  for (let i = 0; i < count; i++) {
    const v = light ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${r() * alpha})`;
    ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
}

/** Large glossy vitrified tile, one tile per texture repeat. */
export function floorTexture(repeat) {
  const [c, ctx] = mk(512, 512);
  const r = rng(11);
  const g = ctx.createLinearGradient(0, 0, 512, 512);
  g.addColorStop(0, '#ece8de');
  g.addColorStop(1, '#e2ddd0');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  speckle(ctx, 512, 512, r, 3500, 0.12, false);
  speckle(ctx, 512, 512, r, 2500, 0.25, true);
  ctx.strokeStyle = 'rgba(120,112,98,0.55)';
  ctx.lineWidth = 5;
  ctx.strokeRect(0, 0, 512, 512);
  return toTex(c, repeat);
}

/** Dark wood grain. `base` is any CSS colour. */
export function woodTexture(base = '#3a2216', repeat = [1, 1]) {
  const [c, ctx] = mk(512, 512);
  const r = rng(base.length * 31 + 7);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 130; i++) {
    const x = r() * 512;
    const w = 1 + r() * 5;
    ctx.strokeStyle = r() > 0.5 ? `rgba(0,0,0,${0.06 + r() * 0.18})` : `rgba(255,220,170,${0.02 + r() * 0.07})`;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    for (let y = 0; y <= 512; y += 64) ctx.lineTo(x + Math.sin(y * 0.02 + i) * (0.6 + r() * 2), y);
    ctx.stroke();
  }
  return toTex(c, repeat);
}

/** Grey bathroom marble with veins. */
export function marbleTexture(repeat = [1, 1], base = '#8f9091') {
  const [c, ctx] = mk(1024, 1024);
  const r = rng(99);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 1024, 1024);
  const cloud = ctx.createRadialGradient(300, 300, 20, 300, 300, 700);
  cloud.addColorStop(0, 'rgba(255,255,255,0.18)');
  cloud.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = cloud;
  ctx.fillRect(0, 0, 1024, 1024);
  ctx.filter = 'blur(1.2px)';
  for (let i = 0; i < 18; i++) {
    ctx.strokeStyle = r() > 0.35 ? `rgba(245,245,245,${0.12 + r() * 0.2})` : `rgba(40,40,44,${0.1 + r() * 0.2})`;
    ctx.lineWidth = 0.6 + r() * 1.6;
    ctx.beginPath();
    let x = r() * 1024;
    let y = 0;
    ctx.moveTo(x, y);
    while (y < 1024) {
      x += (r() - 0.45) * 90;
      y += 40 + r() * 70;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.filter = 'none';
  speckle(ctx, 1024, 1024, r, 2500, 0.1, true);
  return toTex(c, repeat);
}

/** Padded headboard with vertical channels. */
export function paddedTexture(base = '#7f8fa3') {
  const [c, ctx] = mk(512, 512);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 512);
  const n = 8;
  for (let i = 0; i < n; i++) {
    const x0 = (i * 512) / n;
    const g = ctx.createLinearGradient(x0, 0, x0 + 512 / n, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.38)');
    g.addColorStop(0.12, 'rgba(255,255,255,0.1)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.14)');
    g.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = g;
    ctx.fillRect(x0, 0, 512 / n, 512);
  }
  speckle(ctx, 512, 512, rng(5), 4000, 0.08, false);
  return toTex(c);
}

/** Woven fabric noise for sofas. */
export function fabricTexture(base = '#3a2c27', repeat = [3, 3]) {
  const [c, ctx] = mk(256, 256);
  const r = rng(base.length + 3);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 2) {
    ctx.fillStyle = `rgba(255,255,255,${r() * 0.05})`;
    ctx.fillRect(0, y, 256, 1);
  }
  for (let x = 0; x < 256; x += 2) {
    ctx.fillStyle = `rgba(0,0,0,${r() * 0.07})`;
    ctx.fillRect(x, 0, 1, 256);
  }
  return toTex(c, repeat);
}

/** Dark slatted door (horizontal grooves), like the property's room doors. */
export function slatDoorTexture() {
  const [c, ctx] = mk(256, 512);
  ctx.fillStyle = '#3b2519';
  ctx.fillRect(0, 0, 256, 512);
  for (let y = 40; y < 470; y += 38) {
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(150, y);
    ctx.lineTo(230, y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,200,150,0.14)';
    ctx.beginPath();
    ctx.moveTo(150, y + 4);
    ctx.lineTo(230, y + 4);
    ctx.stroke();
  }
  speckle(ctx, 256, 512, rng(77), 1500, 0.1, false);
  return toTex(c);
}

/** Wide landscape seen through the window: hills, palms, sky. */
export function outsideTexture(mode = 'day') {
  const [c, ctx] = mk(2048, 512);
  const r = rng(mode === 'day' ? 4 : 8);
  const sky = ctx.createLinearGradient(0, 0, 0, 512);
  if (mode === 'day') {
    sky.addColorStop(0, '#5aa4de');
    sky.addColorStop(0.55, '#bfe0f2');
    sky.addColorStop(1, '#f6efdc');
  } else {
    sky.addColorStop(0, '#0a1230');
    sky.addColorStop(0.6, '#1d2a55');
    sky.addColorStop(1, '#5a4a6a');
  }
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 2048, 512);

  if (mode === 'night') {
    for (let i = 0; i < 160; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.7})`;
      ctx.fillRect(r() * 2048, r() * 260, 1.6, 1.6);
    }
    ctx.fillStyle = '#f3ecd0';
    ctx.beginPath();
    ctx.arc(1500, 110, 26, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (let i = 0; i < 9; i++) {
      const x = r() * 2048;
      const y = 60 + r() * 150;
      for (let k = 0; k < 6; k++) {
        ctx.beginPath();
        ctx.ellipse(x + k * 30, y + Math.sin(k) * 8, 55 + r() * 25, 20 + r() * 8, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  const hill = (baseY, amp, color, seed) => {
    const rr = rng(seed);
    const ph = [rr() * 6, rr() * 6, rr() * 6];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 512);
    for (let x = 0; x <= 2048; x += 8) {
      const y = baseY - amp * (0.55 * Math.sin(x * 0.0035 + ph[0]) + 0.3 * Math.sin(x * 0.011 + ph[1]) + 0.15 * Math.sin(x * 0.03 + ph[2]));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(2048, 512);
    ctx.fill();
  };
  if (mode === 'day') {
    hill(300, 90, '#7aa0b8', 1);
    hill(345, 70, '#5f8f8a', 2);
    hill(395, 55, '#3f7a4c', 3);
    hill(450, 35, '#2f6a3a', 4);
  } else {
    hill(300, 90, '#1b2547', 1);
    hill(345, 70, '#141c3a', 2);
    hill(395, 55, '#0e1530', 3);
    hill(450, 35, '#0a1026', 4);
  }
  const palm = (x, h) => {
    ctx.strokeStyle = mode === 'day' ? '#27502d' : '#070b1a';
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(x, 512);
    ctx.quadraticCurveTo(x + 14, 512 - h / 2, x + 6, 512 - h);
    ctx.stroke();
    ctx.lineWidth = 3;
    for (let a = 0; a < 9; a++) {
      const ang = -Math.PI / 2 + (a - 4) * 0.42;
      ctx.beginPath();
      ctx.moveTo(x + 6, 512 - h);
      ctx.quadraticCurveTo(x + 6 + Math.cos(ang) * 40, 512 - h + Math.sin(ang) * 40 - 14, x + 6 + Math.cos(ang) * 80, 512 - h + Math.sin(ang) * 80 + 28);
      ctx.stroke();
    }
  };
  [120, 410, 760, 1180, 1620, 1930].forEach((x, i) => palm(x, 170 + (i % 3) * 40));

  if (mode === 'night') {
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(255,210,130,${0.4 + r() * 0.6})`;
      ctx.fillRect(r() * 2048, 430 + r() * 70, 2.5, 2.5);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft blob used as fake ambient occlusion under furniture. */
export function blobShadowTexture() {
  const [c, ctx] = mk(128, 128);
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.22)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** Bedspread: white duvet with a coloured runner across the lower third. */
export function duvetTexture(runner = '#9b1c2e') {
  const [c, ctx] = mk(512, 512);
  ctx.fillStyle = '#f3f1ec';
  ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = runner;
  ctx.fillRect(0, 300, 512, 130);
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 512; i += 18) {
    ctx.beginPath();
    ctx.moveTo(i, 300);
    ctx.lineTo(i, 430);
    ctx.stroke();
  }
  speckle(ctx, 512, 512, rng(21), 3000, 0.07, false);
  return toTex(c);
}
