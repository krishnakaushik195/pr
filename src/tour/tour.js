import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as TX from './textures.js';
import { ROOMS } from './rooms.js';

const EYE = 1.62;
const RADIUS = 0.22;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a, b, t) => a + (b - a) * t;
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class RoomTour {
  /**
   * @param {HTMLElement} host   container that will receive the canvas
   * @param {object} opts        { minimap, labels, onStop, onReady }
   */
  constructor(host, opts = {}) {
    this.host = host;
    this.opts = opts;
    this.keys = new Set();
    this.yaw = 0;
    this.pitch = 0;
    this.yawVel = 0;
    this.pitchVel = 0;
    this.pos = new THREE.Vector3(0, EYE, 0);
    this.tween = null;
    this.index = 0;
    this.mood = 0; // 0 day -> 1 night
    this.moodTarget = 0;
    this.fovExtra = 0;
    this.zoom = 0;
    this.baseFov = 74;
    this.auto = false;
    this.autoTimer = 0;
    this.visible = true;
    this.disposed = false;
    this.last = performance.now();
    this.elapsed = 0;
    this.fans = [];
    this.lamps = [];
    this.pois = [];
    this.rings = [];
    this.obstacles = [];
    this.walk = [];

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'tour-canvas';
    this.canvas.setAttribute('aria-label', '3D room walkthrough. Drag to look around, click the glowing rings to move.');
    host.prepend(this.canvas);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.05, 80);
    this.camera.rotation.order = 'YXZ';

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envTex;
    pmrem.dispose();

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.blobTex = TX.blobShadowTexture();

    this.bindEvents();
    this.resize();
    this.observe();
    this.loop = this.loop.bind(this);
    this.renderer.setAnimationLoop(this.loop);
  }

  /* ---------------------------------------------------------------- setup */

  bindEvents() {
    const c = this.canvas;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.host);

    let down = null;
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId };
      c.setPointerCapture(e.pointerId);
      this.stopAuto();
      c.classList.add('grabbing');
    });
    c.addEventListener('pointermove', (e) => {
      if (down && e.pointerId === down.id) {
        const dx = e.clientX - down.x;
        const dy = e.clientY - down.y;
        down.moved += Math.abs(dx) + Math.abs(dy);
        down.x = e.clientX;
        down.y = e.clientY;
        if (!this.tween) {
          const k = 0.0042 * (this.camera.fov / 72);
          this.yawVel = -dx * k;
          this.pitchVel = -dy * k;
          this.yaw += this.yawVel;
          this.pitch = THREE.MathUtils.clamp(this.pitch + this.pitchVel, -1.15, 1.15);
        }
      } else {
        this.hover(e);
      }
    });
    const up = (e) => {
      if (!down || e.pointerId !== down.id) return;
      const wasClick = down.moved < 6;
      down = null;
      c.classList.remove('grabbing');
      if (wasClick) this.clickAt(e);
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoom = THREE.MathUtils.clamp(this.zoom + e.deltaY * 0.03, -22, 22);
      },
      { passive: false }
    );

    this.onKey = (down_) => (e) => {
      if (!this.visible || !this.isFocusedArea(e)) return;
      const k = e.key.toLowerCase();
      const map = { w: 'f', arrowup: 'f', s: 'b', arrowdown: 'b', a: 'l', arrowleft: 'l', d: 'r', arrowright: 'r', q: 'tl', e: 'tr', shift: 'run' };
      if (!map[k]) return;
      e.preventDefault();
      if (down_) {
        this.stopAuto();
        this.keys.add(map[k]);
      } else this.keys.delete(map[k]);
    };
    this.kd = this.onKey(true);
    this.ku = this.onKey(false);
    window.addEventListener('keydown', this.kd);
    window.addEventListener('keyup', this.ku);
  }

  // keyboard movement only while the tour region has focus or the pointer is over it
  isFocusedArea() {
    return this.host.matches(':hover') || this.host.contains(document.activeElement) || document.fullscreenElement === this.host;
  }

  observe() {
    this.io = new IntersectionObserver(([en]) => (this.visible = en.isIntersecting), { threshold: 0.05 });
    this.io.observe(this.host);
  }

  resize() {
    const w = this.host.clientWidth || 800;
    const h = this.host.clientHeight || 500;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.camera.aspect = w / h;
    // keep a generous horizontal view on tall / mobile screens
    const wide = this.userFov || 74;
    const hMin = THREE.MathUtils.degToRad(88);
    const vForH = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hMin / 2) / this.camera.aspect));
    this.baseFov = this.camera.aspect < 1.5 ? Math.min(Math.max(wide, vForH), 104) : wide;
    this.applyFov(true);
  }

  applyFov(force) {
    const f = THREE.MathUtils.clamp(this.baseFov + this.fovExtra + this.zoom, 50, 108);
    if (force || Math.abs(f - this.camera.fov) > 0.01) {
      this.camera.fov = f;
      this.camera.updateProjectionMatrix();
    }
  }

  /* ----------------------------------------------------------- room build */

  clearRoom() {
    if (!this.room) return;
    this.scene.remove(this.room);
    this.room.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
    this.fans = [];
    this.lamps = [];
    this.pois = [];
    this.rings = [];
    this.obstacles = [];
    this.walk = [];
    this.opts.labels && (this.opts.labels.innerHTML = '');
  }

  loadRoom(key) {
    const cfg = ROOMS[key];
    this.clearRoom();
    this.cfg = cfg;
    this.key = key;
    const room = (this.room = new THREE.Group());
    this.scene.add(room);

    const L = (this.L = {
      x0: -cfg.w / 2,
      x1: cfg.w / 2,
      z0: -cfg.d / 2,
      z1: cfg.d / 2,
      h: cfg.h,
    });
    L.bedX = cfg.bedX;
    L.bx0 = L.x1 - cfg.bathW;
    L.bz0 = L.z0 - cfg.bathD;
    L.doorX = L.x1 - (cfg.suite ? 0.85 : 0.85);
    L.entX = L.x1 - 0.9;
    L.deskZ = L.z0 + (cfg.suite ? 1.1 : 0.95);
    L.sofaZ = cfg.suite ? 0.4 : 0.45;

    this.makeMaterials();
    this.buildShell();
    this.buildBedArea();
    this.buildLounge();
    this.buildDeskArea();
    this.buildBathroom();
    this.buildCeiling();
    this.buildOutside();
    this.buildLights();
    this.buildRings();
    this.buildWalkArea();
    this.applyMood(true);
    this.goTo(0, true);
    this.opts.onReady && this.opts.onReady(cfg);
  }

  makeMaterials() {
    const { cfg, L } = this;
    const std = (o) => new THREE.MeshStandardMaterial(o);
    this.mat = {
      wall: std({ color: '#f1ede5', roughness: 0.92 }),
      ceiling: std({ color: '#f8f6f1', roughness: 0.95 }),
      floor: std({ map: TX.floorTexture([cfg.w / 0.8, cfg.d / 0.8]), roughness: 0.16, metalness: 0.0 }),
      bathFloor: std({ map: TX.floorTexture([cfg.bathW / 0.6, cfg.bathD / 0.6]), color: '#b9b4aa', roughness: 0.2 }),
      wood: std({ map: TX.woodTexture('#3a2216'), roughness: 0.5 }),
      woodLight: std({ map: TX.woodTexture('#8a6a47'), roughness: 0.55 }),
      marble: std({ map: TX.marbleTexture([cfg.bathW / 1.3, 2.2 / 1.3]), roughness: 0.22 }),
      white: std({ color: '#f4f4f2', roughness: 0.35 }),
      linen: std({ color: '#f1efe9', roughness: 0.9 }),
      duvet: std({ map: TX.duvetTexture(cfg.runner), roughness: 0.92 }),
      cushion: std({ color: cfg.cushion, roughness: 0.9 }),
      padded: std({ map: TX.paddedTexture(cfg.headboard), roughness: 0.85 }),
      sofa: std({ map: TX.fabricTexture('#43332c'), roughness: 0.95 }),
      black: std({ color: '#0c0c0e', roughness: 0.3, metalness: 0.2 }),
      chrome: std({ color: '#d5d7da', roughness: 0.18, metalness: 1 }),
      mesh: std({ color: '#1b1b1d', roughness: 0.7 }),
      curtain: std({ color: '#d8c8aa', roughness: 0.95, side: THREE.DoubleSide }),
      sheer: std({ color: '#fbf8f1', roughness: 1, side: THREE.DoubleSide, transparent: true, opacity: 0.5 }),
      frame: std({ color: '#e9e6df', roughness: 0.5, metalness: 0.1 }),
      door: std({ map: TX.slatDoorTexture(), roughness: 0.5 }),
      glass: new THREE.MeshPhysicalMaterial({ color: '#cfe3ee', transparent: true, opacity: 0.1, roughness: 0.02, metalness: 0, side: THREE.DoubleSide }),
      mirror: std({ color: '#ffffff', roughness: 0.04, metalness: 1 }),
      gold: std({ color: '#c8a35a', roughness: 0.3, metalness: 0.9 }),
      steel: std({ color: '#b9bcc0', roughness: 0.25, metalness: 1 }),
      glow: new THREE.MeshBasicMaterial({ color: '#fff4d8', toneMapped: false }),
      cove: new THREE.MeshBasicMaterial({ color: '#ffd9a0', toneMapped: false }),
      shade: std({ color: '#f6e6c8', emissive: '#ffb860', emissiveIntensity: 0, roughness: 0.9, side: THREE.DoubleSide }),
    };
    this.mat.art = std({ map: this.loadTex('art.webp'), roughness: 0.8 });
    this.mat.tv = std({ color: '#08090b', roughness: 0.12, metalness: 0.35 });
    void L;
  }

  loadTex(name) {
    const t = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}img/${name}`);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }

  /* wall-local frames: local +X runs along the wall, +Z points into the room */
  frames(r) {
    return {
      north: { P: [r.x0, r.z0], d: [1, 0], n: [0, 1], len: r.x1 - r.x0, rot: 0 },
      south: { P: [r.x1, r.z1], d: [-1, 0], n: [0, -1], len: r.x1 - r.x0, rot: Math.PI },
      west: { P: [r.x0, r.z1], d: [0, -1], n: [1, 0], len: r.z1 - r.z0, rot: Math.PI / 2 },
      east: { P: [r.x1, r.z0], d: [0, 1], n: [-1, 0], len: r.z1 - r.z0, rot: -Math.PI / 2 },
    };
  }

  wallGroup(name, u = 0, y = 0, off = 0, rect) {
    const f = this.frames(rect || this.L)[name];
    const g = new THREE.Group();
    g.position.set(f.P[0] + f.d[0] * u + f.n[0] * off, y, f.P[1] + f.d[1] * u + f.n[1] * off);
    g.rotation.y = f.rot;
    this.room.add(g);
    return g;
  }

  /** u coordinate (along wall) for a world x/z */
  uOf(name, x, z) {
    const f = this.frames(this.L)[name];
    return (x - f.P[0]) * f.d[0] + (z - f.P[1]) * f.d[1];
  }

  mesh(geo, mat, parent, [x, y, z], { cast = true, receive = true, rot } = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rot) m.rotation.set(...rot);
    m.castShadow = cast;
    m.receiveShadow = receive;
    parent.add(m);
    return m;
  }

  box(w, h, d, mat, parent, pos, o) {
    return this.mesh(new THREE.BoxGeometry(w, h, d), mat, parent, pos, o);
  }

  rbox(w, h, d, r, mat, parent, pos, o) {
    return this.mesh(new RoundedBoxGeometry(w, h, d, 4, Math.min(r, w / 2, h / 2, d / 2)), mat, parent, pos, o);
  }

  cyl(rt, rb, h, mat, parent, pos, o, seg = 24) {
    return this.mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, parent, pos, o);
  }

  contactShadow(parent, w, d, [x, z], strength = 1) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 1.25, d * 1.25),
      new THREE.MeshBasicMaterial({ map: this.blobTex, transparent: true, depthWrite: false, opacity: 0.8 * strength, toneMapped: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.004, z);
    m.renderOrder = 1;
    m.userData.nc = true; // excluded from collision boxes
    parent.add(m);
  }

  /** Build wall pieces around openings: [{u0,u1,y0,y1}] */
  buildWalls(rect, names, openings, inMat, outFn) {
    const frames = this.frames(rect);
    const T = 0.15;
    const H = this.L.h;
    for (const name of names) {
      const f = frames[name];
      const ops = (openings[name] || []).slice().sort((a, b) => a.u0 - b.u0);
      const g = this.wallGroup(name, 0, 0, 0, rect);
      const pieces = [];
      let cur = 0;
      for (const o of ops) {
        if (o.u0 > cur) pieces.push([cur, o.u0, 0, H]);
        if (o.y1 < H) pieces.push([o.u0, o.u1, o.y1, H]);
        if (o.y0 > 0) pieces.push([o.u0, o.u1, 0, o.y0]);
        cur = o.u1;
      }
      if (cur < f.len) pieces.push([cur, f.len, 0, H]);
      // split on the bathroom boundary so each piece gets a single outside finish
      const cuts = (outFn && outFn.cuts && outFn.cuts[name]) || [];
      const split = [];
      for (const p of pieces) {
        let a = p[0];
        for (const c of cuts.filter((c) => c > p[0] && c < p[1])) {
          split.push([a, c, p[2], p[3]]);
          a = c;
        }
        split.push([a, p[1], p[2], p[3]]);
      }
      for (const [u0, u1, y0, y1] of split) {
        const out = outFn ? outFn(name, (u0 + u1) / 2) : this.mat.wall;
        const mats = [this.mat.wall, this.mat.wall, this.mat.wall, this.mat.wall, inMat, out];
        const m = this.mesh(new THREE.BoxGeometry(u1 - u0, y1 - y0, T), mats, g, [(u0 + u1) / 2, (y0 + y1) / 2, -T / 2], { receive: true });
        m.castShadow = true;
      }
    }
  }

  buildShell() {
    const { L, cfg, mat, room } = this;
    // floor + ceiling
    const floor = this.mesh(new THREE.PlaneGeometry(cfg.w, cfg.d), mat.floor, room, [0, 0, 0], { cast: false });
    floor.rotation.x = -Math.PI / 2;
    const ceil = this.mesh(new THREE.PlaneGeometry(cfg.w, cfg.d), mat.ceiling, room, [0, L.h, 0], { cast: false });
    ceil.rotation.x = Math.PI / 2;

    const winU0 = this.uOf('east', L.x1, L.deskZ) - cfg.winW / 2;
    const doorU = this.uOf('north', L.doorX, L.z0);
    const entU = this.uOf('south', L.entX, L.z1);
    this.openings = {
      east: [{ u0: winU0, u1: winU0 + cfg.winW, y0: 0.95, y1: 2.2 }],
      north: [{ u0: doorU - 0.4, u1: doorU + 0.4, y0: 0, y1: 2.1 }],
      south: [{ u0: entU - 0.45, u1: entU + 0.45, y0: 0, y1: 2.1 }],
    };
    const bathCutU = L.bx0 - L.x0;
    const outFn = (name, uMid) => (name === 'north' && uMid > bathCutU ? this.mat.marble : this.mat.wall);
    outFn.cuts = { north: [bathCutU] };
    this.buildWalls(L, ['north', 'south', 'west', 'east'], this.openings, mat.wall, outFn);

    // door frames & doors
    const frameOpen = (name, u0, u1, h) => {
      const g = this.wallGroup(name, 0, 0, 0.0);
      const t = 0.07;
      this.box(t, h, 0.19, mat.wood, g, [u0 - t / 2, h / 2, -0.04], { cast: false });
      this.box(t, h, 0.19, mat.wood, g, [u1 + t / 2, h / 2, -0.04], { cast: false });
      this.box(u1 - u0 + 2 * t, t, 0.19, mat.wood, g, [(u0 + u1) / 2, h + t / 2, -0.04], { cast: false });
    };
    frameOpen('north', doorU - 0.4, doorU + 0.4, 2.1);
    frameOpen('south', entU - 0.45, entU + 0.45, 2.1);

    // entrance door (closed)
    const eg = this.wallGroup('south', entU, 0, -0.04);
    this.box(0.9, 2.08, 0.045, mat.door, eg, [0, 1.04, 0]);
    this.cyl(0.012, 0.012, 0.16, mat.chrome, eg, [0.32, 1.0, 0.06], { cast: false }).rotation.z = Math.PI / 2;
    // bathroom door (open into the bathroom)
    const bg = this.wallGroup('north', doorU + 0.4, 0, -0.04);
    const leaf = new THREE.Group();
    leaf.rotation.y = -(Math.PI / 2) - 0.3;
    bg.add(leaf);
    this.box(0.8, 2.05, 0.04, mat.door, leaf, [-0.4, 1.03, 0]);
    this.cyl(0.012, 0.012, 0.14, mat.chrome, leaf, [-0.68, 1.0, 0.05], { cast: false }).rotation.z = Math.PI / 2;

    // window frame, glass, curtains
    const wg = this.wallGroup('east', winU0, 0, 0);
    const ww = cfg.winW;
    const f = 0.045;
    const y0 = 0.95;
    const y1 = 2.2;
    this.box(ww + f * 2, f, 0.16, mat.frame, wg, [ww / 2, y0 - f / 2, -0.05], { cast: false });
    this.box(ww + f * 2, f, 0.16, mat.frame, wg, [ww / 2, y1 + f / 2, -0.05], { cast: false });
    this.box(f, y1 - y0, 0.16, mat.frame, wg, [-f / 2, (y0 + y1) / 2, -0.05], { cast: false });
    this.box(f, y1 - y0, 0.16, mat.frame, wg, [ww + f / 2, (y0 + y1) / 2, -0.05], { cast: false });
    this.box(0.035, y1 - y0, 0.1, mat.frame, wg, [ww / 2, (y0 + y1) / 2, -0.06], { cast: false });
    const glass = this.mesh(new THREE.PlaneGeometry(ww, y1 - y0), mat.glass, wg, [ww / 2, (y0 + y1) / 2, -0.07], { cast: false, receive: false });
    glass.renderOrder = 3;
    this.box(ww + 0.5, 0.025, 0.12, mat.steel, wg, [ww / 2, 2.45, 0.06], { cast: false });
    const curtain = (cx, w, material, off) => {
      const geo = new THREE.PlaneGeometry(w, 2.15, 36, 1);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getX(i) + cx) * 24) * 0.035);
      geo.computeVertexNormals();
      this.mesh(geo, material, wg, [cx, 1.35, 0.1 + off], { cast: false });
    };
    curtain(ww * 0.5, ww + 0.3, mat.sheer, 0);
    curtain(-0.02, 0.55, mat.curtain, 0.05);
    curtain(ww + 0.02, 0.55, mat.curtain, 0.05);
    this.addPoi('Hill view', wg.localToWorld(new THREE.Vector3(ww / 2, 1.9, 0.2)));
    this.windowGroup = wg;

    // skirting along the sofa wall
    const sk = this.wallGroup('west', 0, 0.045, 0.012);
    this.box(L.z1 - L.z0, 0.09, 0.025, mat.wood, sk, [(L.z1 - L.z0) / 2, 0, 0], { cast: false });
  }

  buildBedArea() {
    const { cfg, L, mat } = this;
    const u = L.bedX - L.x0;
    const g = this.wallGroup('north', u, 0, 0);
    const bw = cfg.bedW;
    const len = 2.05;
    // frame + mattress
    this.rbox(bw + 0.12, 0.3, len, 0.03, mat.wood, g, [0, 0.15, len / 2 + 0.02]);
    this.rbox(bw, 0.24, len - 0.06, 0.07, mat.linen, g, [0, 0.42, len / 2 + 0.02]);
    this.rbox(bw + 0.06, 0.07, len * 0.8, 0.03, mat.duvet, g, [0, 0.58, len * 0.6 + 0.03]);
    // headboard
    this.box(bw + 0.5, 1.12, 0.07, mat.padded, g, [0, 0.62, 0.05]);
    this.box(bw + 0.56, 0.05, 0.09, mat.wood, g, [0, 1.2, 0.05]);
    this.box(0.05, 1.2, 0.09, mat.wood, g, [-(bw + 0.5) / 2 - 0.0, 0.6, 0.05]);
    this.box(0.05, 1.2, 0.09, mat.wood, g, [(bw + 0.5) / 2 + 0.0, 0.6, 0.05]);
    // pillows + cushions
    const pw = bw > 1.6 ? 0.58 : 0.62;
    [-1, 1].forEach((s) => {
      const p = this.rbox(pw, 0.15, 0.4, 0.07, mat.linen, g, [s * (bw / 4), 0.7, 0.3]);
      p.rotation.x = -0.28;
      const c = this.rbox(0.36, 0.34, 0.1, 0.04, mat.cushion, g, [s * (bw / 4), 0.75, 0.55]);
      c.rotation.x = -0.42;
      c.rotation.z = s * 0.05;
    });
    // bench at foot of bed
    const bench = this.wallGroup('north', u, 0, 0);
    this.box(0.9 + (cfg.suite ? 0.3 : 0), 0.06, 0.34, mat.wood, bench, [0, 0.43, len + 0.38]);
    [-1, 1].forEach((s) => this.box(0.05, 0.4, 0.3, mat.wood, bench, [s * (0.4 + (cfg.suite ? 0.15 : 0)), 0.2, len + 0.38]));
    this.addObstacle([g, bench], '#7b5a4c');
    this.contactShadow(g, bw + 0.3, len + 0.3, [0, len / 2 + 0.05]);
    this.addPoi('Padded headboard', g.localToWorld(new THREE.Vector3(0, 1.1, 0.15)));
    this.addPoi(cfg.suite ? 'King bed, white linen' : 'Double bed, white linen', g.localToWorld(new THREE.Vector3(0, 0.7, 1.1)));

    // nightstands + lamps
    [-1, 1].forEach((s) => {
      const nx = s * (bw / 2 + 0.07 + 0.22);
      const ng = this.wallGroup('north', u + nx, 0, 0);
      this.box(0.4, 0.5, 0.38, mat.wood, ng, [0, 0.35, 0.2]);
      this.box(0.4, 0.04, 0.38, mat.wood, ng, [0, 0.62, 0.2]);
      this.box(0.34, 0.14, 0.012, mat.black, ng, [0, 0.45, 0.4]);
      this.cyl(0.012, 0.012, 0.09, mat.gold, ng, [0, 0.5, 0.41], { cast: false }).rotation.x = Math.PI / 2;
      this.cyl(0.045, 0.055, 0.06, mat.gold, ng, [0, 0.67, 0.18]);
      this.cyl(0.012, 0.012, 0.22, mat.gold, ng, [0, 0.8, 0.18], { cast: false });
      const shade = this.cyl(0.075, 0.115, 0.17, mat.shade.clone(), ng, [0, 0.98, 0.18], { cast: false }, 28);
      shade.material.side = THREE.DoubleSide;
      const light = new THREE.PointLight('#ffb35c', 0, 5, 2);
      light.position.copy(ng.localToWorld(new THREE.Vector3(0, 0.98, 0.2)));
      this.room.add(light);
      this.lamps.push({ shade, light });
      this.addObstacle(ng, '#6a4a38');
      this.contactShadow(ng, 0.4, 0.4, [0, 0.2], 0.8);
    });

    // AC above the bed wall
    const ac = this.wallGroup('north', u - 0.95, 2.28, 0);
    this.rbox(1.0, 0.3, 0.22, 0.05, mat.white, ac, [0, 0.15, 0.11]);
    this.box(0.9, 0.025, 0.02, new THREE.MeshStandardMaterial({ color: '#cfd2d5' }), ac, [0, 0.05, 0.23], { cast: false });
    this.mesh(new THREE.SphereGeometry(0.008, 8, 8), new THREE.MeshBasicMaterial({ color: '#35e08a', toneMapped: false }), ac, [0.4, 0.2, 0.23], { cast: false });
    this.addPoi('Air conditioning', ac.localToWorld(new THREE.Vector3(0, 0.3, 0.2)));
  }

  buildLounge() {
    const { cfg, L, mat } = this;
    // TV console on south wall (opposite the bed)
    const u = this.uOf('south', L.bedX, L.z1);
    const g = this.wallGroup('south', u, 0, 0);
    const cw = cfg.suite ? 1.7 : 1.4;
    this.box(cw, 0.04, 0.4, mat.wood, g, [0, 0.72, 0.2]);
    this.box(0.04, 0.7, 0.38, mat.wood, g, [-cw / 2 + 0.02, 0.36, 0.2]);
    this.box(0.04, 0.7, 0.38, mat.wood, g, [cw / 2 - 0.02, 0.36, 0.2]);
    this.box(cw - 0.08, 0.03, 0.36, mat.wood, g, [0, 0.3, 0.2]);
    this.box(cw - 0.08, 0.5, 0.02, mat.wood, g, [0, 0.46, 0.03]);
    // TV
    const tvw = cfg.suite ? 1.15 : 1.0;
    this.box(tvw, tvw * 0.56, 0.04, mat.tv, g, [0, 1.5, 0.04]);
    this.box(tvw + 0.02, 0.012, 0.045, mat.black, g, [0, 1.5 - tvw * 0.28, 0.04], { cast: false });
    this.addPoi('Wall-mounted TV', g.localToWorld(new THREE.Vector3(0, 1.85, 0.1)));
    // bottles / kettle
    [-0.45, -0.38].forEach((x) => this.cyl(0.03, 0.03, 0.22, mat.glass.clone(), g, [x, 0.85, 0.3], { cast: false }));
    if (cfg.suite) {
      this.cyl(0.07, 0.085, 0.18, mat.steel, g, [0.55, 0.83, 0.25]);
      this.cyl(0.085, 0.085, 0.02, mat.black, g, [0.55, 0.75, 0.25], { cast: false });
      this.rbox(0.3, 0.035, 0.2, 0.01, mat.black, g, [0.3, 0.755, 0.25], { cast: false });
      this.addPoi('Kettle, tea & coffee', g.localToWorld(new THREE.Vector3(0.55, 1.02, 0.25)));
    }
    this.addObstacle(g, '#5b4336');
    this.contactShadow(g, cw, 0.45, [0, 0.2], 0.9);
    // mirror beside the console
    const mg = this.wallGroup('south', this.uOf('south', L.x0 + 0.5, L.z1), 0.4, 0);
    this.box(0.5, 1.5, 0.025, mat.wood, mg, [0, 0.75, 0.012]);
    this.box(0.44, 1.44, 0.01, mat.mirror, mg, [0, 0.75, 0.03], { cast: false });

    // sofa on west wall
    const sg = this.wallGroup('west', L.z1 - (L.sofaZ + cfg.sofaL / 2), 0, 0);
    const sl = cfg.sofaL;
    this.rbox(sl, 0.4, 0.86, 0.06, mat.sofa, sg, [sl / 2, 0.22, 0.43]);
    [0, 1, 2].forEach((i) => {
      const w = (sl - 0.34) / 3;
      this.rbox(w - 0.02, 0.15, 0.6, 0.06, mat.sofa, sg, [0.17 + w * (i + 0.5), 0.5, 0.52]);
    });
    this.rbox(sl, 0.52, 0.2, 0.07, mat.sofa, sg, [sl / 2, 0.66, 0.1]);
    this.rbox(0.17, 0.32, 0.86, 0.06, mat.sofa, sg, [0.085, 0.52, 0.43]);
    this.rbox(0.17, 0.32, 0.86, 0.06, mat.sofa, sg, [sl - 0.085, 0.52, 0.43]);
    this.addObstacle(sg, '#5a4640');
    this.contactShadow(sg, sl + 0.2, 1.0, [sl / 2, 0.45]);
    this.addPoi('Lounge sofa', sg.localToWorld(new THREE.Vector3(sl / 2, 1.05, 0.3)));

    // coffee table (0.7 x 0.4), centred just in front of the sofa
    const tg = this.wallGroup('west', L.z1 - (L.sofaZ + 0.35 + 0.35), 0, 0);
    this.box(0.7, 0.04, 0.4, mat.wood, tg, [0.35, 0.4, 1.15]);
    this.box(0.62, 0.025, 0.32, mat.wood, tg, [0.35, 0.15, 1.15]);
    [[0.04, 0.04], [0.66, 0.04], [0.04, 0.36], [0.66, 0.36]].forEach(([x, z]) => this.box(0.035, 0.4, 0.035, mat.wood, tg, [x, 0.2, 0.95 + z]));
    this.addObstacle(tg, '#7a5a46');
    this.contactShadow(tg, 0.7, 0.4, [0.35, 1.15], 0.7);

    // artwork above the sofa (real print from the property photos)
    const ag = this.wallGroup('west', L.z1 - L.sofaZ, 1.12, 0.01);
    this.box(1.12, 1.0, 0.02, mat.black, ag, [0, 0.5, 0.01], { cast: false });
    const art = new THREE.Mesh(new THREE.PlaneGeometry(1.06, 0.94), mat.art);
    art.position.set(0, 0.5, 0.023);
    ag.add(art);
    this.addPoi('Tropical arch print', ag.localToWorld(new THREE.Vector3(0, 1.1, 0.2)));
  }

  buildDeskArea() {
    const { cfg, L, mat } = this;
    // desk on the east wall
    const dg = this.wallGroup('east', L.deskZ - L.z0 - 0.55, 0, 0);
    this.box(1.1, 0.04, 0.5, mat.wood, dg, [0.55, 0.75, 0.25]);
    this.box(0.04, 0.73, 0.48, mat.wood, dg, [0.02, 0.37, 0.25]);
    this.box(0.4, 0.55, 0.46, mat.wood, dg, [0.88, 0.45, 0.25]);
    this.box(0.36, 0.14, 0.01, mat.black, dg, [0.88, 0.6, 0.49], { cast: false });
    // tea tray + kettle
    this.rbox(0.28, 0.02, 0.18, 0.01, mat.black, dg, [0.5, 0.78, 0.15], { cast: false });
    this.cyl(0.055, 0.07, 0.15, mat.steel, dg, [0.45, 0.86, 0.15]);
    this.cyl(0.026, 0.026, 0.07, mat.white, dg, [0.6, 0.83, 0.15]);
    this.addObstacle(dg, '#6c4f3d');
    this.contactShadow(dg, 1.2, 0.55, [0.55, 0.25]);
    this.addPoi('Work desk & chair', dg.localToWorld(new THREE.Vector3(0.55, 1.05, 0.25)));

    // chair
    const cg = this.wallGroup('east', L.deskZ - L.z0 + 0.0, 0, 0.78);
    cg.rotation.y += Math.PI * 0.12;
    this.rbox(0.46, 0.08, 0.46, 0.04, mat.mesh, cg, [0, 0.5, 0]);
    this.rbox(0.44, 0.52, 0.06, 0.03, mat.mesh, cg, [0, 0.85, 0.22]);
    this.cyl(0.025, 0.025, 0.3, mat.black, cg, [0, 0.3, 0], { cast: false });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const leg = this.box(0.28, 0.025, 0.03, mat.black, cg, [Math.cos(a) * 0.14, 0.1, Math.sin(a) * 0.14], { cast: false });
      leg.rotation.y = -a;
    }
    [-1, 1].forEach((s) => this.box(0.03, 0.03, 0.26, mat.black, cg, [s * 0.25, 0.65, -0.05], { cast: false }));
    this.contactShadow(cg, 0.55, 0.55, [0, 0], 0.6);

    // wardrobe
    const wz = L.z1 - 1.15;
    const wg = this.wallGroup('east', wz - L.z0, 0, 0);
    this.box(0.92, 2.1, 0.58, mat.wood, wg, [0, 1.05, 0.29]);
    this.box(0.01, 2.0, 0.01, mat.black, wg, [0, 1.05, 0.585], { cast: false });
    [-0.06, 0.06].forEach((x) => this.cyl(0.01, 0.01, 0.4, mat.chrome, wg, [x, 1.05, 0.6], { cast: false }));
    this.addObstacle(wg, '#4f3a2d');
    this.contactShadow(wg, 1.0, 0.6, [0, 0.29], 0.8);
    this.addPoi('Closet', wg.localToWorld(new THREE.Vector3(0, 2.0, 0.6)));
    this.wardrobeWorld = wg.localToWorld(new THREE.Vector3(0, 1.0, 0.6));
  }

  buildBathroom() {
    const { cfg, L, mat, room } = this;
    const r = { x0: L.bx0, x1: L.x1, z0: L.bz0, z1: L.z0 };
    this.bathRect = r;
    const floor = this.mesh(new THREE.PlaneGeometry(cfg.bathW, cfg.bathD), mat.bathFloor, room, [(r.x0 + r.x1) / 2, 0.001, (r.z0 + r.z1) / 2], { cast: false });
    floor.rotation.x = -Math.PI / 2;
    const ceil = this.mesh(new THREE.PlaneGeometry(cfg.bathW, cfg.bathD), mat.ceiling, room, [(r.x0 + r.x1) / 2, L.h, (r.z0 + r.z1) / 2], { cast: false });
    ceil.rotation.x = Math.PI / 2;
    this.buildWalls(r, ['north', 'west', 'east'], {}, mat.marble, null);

    // wood-effect band behind the toilet (north wall of the bath)
    const nb = this.wallGroup('north', 0, 0, 0.01, r);
    this.box(cfg.bathW - 0.02, 1.25, 0.02, mat.woodLight, nb, [cfg.bathW / 2, 0.625, 0.01], { cast: false });
    this.box(cfg.bathW - 0.02, 0.02, 0.03, mat.gold, nb, [cfg.bathW / 2, 1.26, 0.015], { cast: false });

    // toilet (against north wall, nearer the west side)
    const wcx = cfg.bathW * 0.3;
    const wc = this.wallGroup('north', wcx, 0, 0.0, r);
    this.rbox(0.38, 0.38, 0.2, 0.05, mat.white, wc, [0, 0.55, 0.14]);
    this.rbox(0.37, 0.4, 0.5, 0.15, mat.white, wc, [0, 0.2, 0.3]);
    this.cyl(0.17, 0.17, 0.03, mat.white, wc, [0, 0.42, 0.34]);
    this.addObstacle(wc, '#cfcfcf');
    this.addPoi('Toilet & health faucet', wc.localToWorld(new THREE.Vector3(0, 1.0, 0.3)), 'bath');

    // basin + mirror on the west wall
    const bz = r.z0 + 0.9;
    const bg = this.wallGroup('west', r.z1 - bz, 0, 0, r);
    this.rbox(0.5, 0.16, 0.38, 0.05, mat.white, bg, [0, 0.85, 0.21]);
    this.cyl(0.012, 0.012, 0.17, mat.chrome, bg, [0, 0.98, 0.07], { cast: false });
    this.box(0.04, 0.7, 0.04, mat.white, bg, [0, 0.45, 0.06], { cast: false });
    this.rbox(0.5, 0.7, 0.012, 0.005, mat.mirror, bg, [0, 1.55, 0.006], { cast: false });
    this.box(0.54, 0.74, 0.01, mat.wood, bg, [0, 1.55, 0.002], { cast: false });
    this.addObstacle(bg, '#d8d8d8');
    this.addPoi('Wall basin & mirror', bg.localToWorld(new THREE.Vector3(0, 1.4, 0.2)), 'bath');

    // shower corner (north-east) with glass screen + geyser
    const sw = cfg.suite ? 0.85 : 0.7;
    const sd = cfg.suite ? 1.1 : 0.95;
    const sg = this.wallGroup('east', 0, 0, 0, r);
    // east frame local x runs along z (from z0 to z1)
    this.box(0.012, 2.0, sd, mat.glass, sg, [sd / 2, 1.0, sw], { cast: false });
    this.box(0.04, 2.0, 0.04, mat.chrome, sg, [0.02, 1.0, sw], { cast: false });
    this.box(sd, 0.06, sw, new THREE.MeshStandardMaterial({ color: '#25272b', roughness: 0.4 }), sg, [sd / 2, 0.03, sw / 2], { cast: false });
    this.cyl(0.011, 0.011, 0.5, mat.chrome, sg, [0.3, 2.0, 0.03], { cast: false }).rotation.x = Math.PI / 2;
    this.cyl(0.09, 0.09, 0.015, mat.chrome, sg, [0.3, 1.99, 0.28], { cast: false });
    this.cyl(0.015, 0.015, 0.2, mat.chrome, sg, [0.3, 1.1, 0.02], { cast: false });
    const gy = this.wallGroup('north', cfg.bathW - 0.55, 1.95, 0, r);
    this.rbox(0.36, 0.42, 0.28, 0.05, mat.white, gy, [0, 0.1, 0.16]);
    this.addPoi('Shower', sg.localToWorld(new THREE.Vector3(0.3, 2.0, 0.4)), 'bath');
    this.addObstacle(sg, '#9fb3c1');

    // bath light
    const bl = new THREE.PointLight('#fff6e5', 0, 6, 2);
    bl.position.set((r.x0 + r.x1) / 2, L.h - 0.3, (r.z0 + r.z1) / 2);
    room.add(bl);
    this.bathLight = bl;
    this.mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 32), mat.glow, room, [(r.x0 + r.x1) / 2, L.h - 0.01, (r.z0 + r.z1) / 2], { cast: false, receive: false });
  }

  buildCeiling() {
    const { cfg, L, mat, room } = this;
    // cove LED strips
    const m = mat.cove;
    const o = 0.14;
    const y = L.h - 0.04;
    this.box(cfg.w - 2 * o, 0.03, 0.04, m, room, [0, y, L.z0 + o], { cast: false, receive: false });
    this.box(cfg.w - 2 * o, 0.03, 0.04, m, room, [0, y, L.z1 - o], { cast: false, receive: false });
    this.box(0.04, 0.03, cfg.d - 2 * o, m, room, [L.x0 + o, y, 0], { cast: false, receive: false });
    this.box(0.04, 0.03, cfg.d - 2 * o, m, room, [L.x1 - o, y, 0], { cast: false, receive: false });
    // panel lights
    this.ceilLights = [];
    const spots = cfg.suite ? [[-1.2, -0.3], [1.0, 0.4]] : [[-0.9, 0.2]];
    spots.forEach(([x, z]) => {
      this.cyl(0.16, 0.16, 0.02, mat.glow, room, [x, L.h - 0.01, z], { cast: false, receive: false });
      const pl = new THREE.PointLight('#fff1d6', 0, 7, 2);
      pl.position.set(x, L.h - 0.25, z);
      room.add(pl);
      this.ceilLights.push(pl);
    });
    // fan
    const fan = new THREE.Group();
    fan.position.set(cfg.suite ? 0.5 : 0.35, L.h - 0.28, -0.2);
    room.add(fan);
    this.cyl(0.012, 0.012, 0.26, mat.black, room, [fan.position.x, L.h - 0.14, fan.position.z], { cast: false });
    const hub = this.cyl(0.09, 0.09, 0.07, mat.black, fan, [0, 0, 0], { cast: false });
    void hub;
    const blades = new THREE.Group();
    fan.add(blades);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const b = this.rbox(0.55, 0.012, 0.13, 0.005, mat.white, blades, [Math.cos(a) * 0.37, 0, Math.sin(a) * 0.37], { cast: false });
      b.rotation.y = -a;
      b.rotation.z = 0.06;
    }
    this.fans.push(blades);
  }

  buildOutside() {
    const { L, room, cfg } = this;
    const mk = (mode) => {
      const mat = new THREE.MeshBasicMaterial({ map: TX.outsideTexture(mode), transparent: true, toneMapped: false, depthWrite: false });
      const p = new THREE.Mesh(new THREE.PlaneGeometry(48, 12), mat);
      p.position.set(L.x1 + 9 + (mode === 'night' ? 0.01 : 0), 3.6, L.deskZ);
      p.rotation.y = -Math.PI / 2;
      p.renderOrder = mode === 'night' ? 1 : 0;
      room.add(p);
      return mat;
    };
    this.outDay = mk('day');
    this.outNight = mk('night');
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ color: '#2f6a3a', toneMapped: false }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(L.x1 + 30, -2.5, L.deskZ);
    room.add(ground);
    this.ground = ground;
    // sill glow so the window reads bright from inside
    void cfg;
  }

  buildLights() {
    const { L, room } = this;
    this.hemi = new THREE.HemisphereLight('#ffffff', '#cdbfa6', 0.5);
    room.add(this.hemi);
    const sun = (this.sun = new THREE.DirectionalLight('#fff0d4', 3));
    sun.position.set(L.x1 + 7, 5.2, L.deskZ + 2.5);
    sun.target.position.set(-0.5, 0, 0);
    room.add(sun, sun.target);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -5;
    sc.right = 5;
    sc.top = 5;
    sc.bottom = -5;
    sc.near = 1;
    sc.far = 24;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 4;
  }

  buildRings() {
    const { cfg, L } = this;
    const sx = L.bedX + cfg.bedW / 2 + 0.6; // free strip between the bed and the desk/wardrobe wall
    const stops = [
      { pos: [L.entX, L.z1 - 0.45], look: [L.bedX - 0.5, 1.0, L.z0 + 0.8], fov: 8 },
      { pos: [sx + 0.1, 0.15], look: [L.bedX, 0.85, L.z0 + 0.4], fov: 4 },
      { pos: [L.bedX + 0.3, L.z1 - 0.6], look: [L.x0 + 0.3, 1.25, L.sofaZ], fov: 6 },
      { pos: [sx - 0.15, L.deskZ], look: [L.x1, 1.25, L.deskZ - 0.15], fov: 18 },
      { pos: [L.doorX, L.z0 + 0.5], look: [L.bx0 + 0.45, 0.95, L.bz0 + 0.25], fov: 12 },
    ];
    this.stops = stops.map((s, i) => ({ ...s, ...cfg.stops[i] }));
    const ringMat = () => new THREE.MeshBasicMaterial({ color: '#f7e1a6', transparent: true, opacity: 0.9, depthTest: false, toneMapped: false });
    this.stops.forEach((s, i) => {
      const g = new THREE.Group();
      g.position.set(s.pos[0], 0.03, s.pos[1]);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.17, 0.215, 48), ringMat());
      ring.rotation.x = -Math.PI / 2;
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.075, 32), ringMat());
      dot.rotation.x = -Math.PI / 2;
      const halo = new THREE.Mesh(new THREE.CircleGeometry(0.36, 40), new THREE.MeshBasicMaterial({ color: '#f7e1a6', transparent: true, opacity: 0.16, depthTest: false, toneMapped: false }));
      halo.rotation.x = -Math.PI / 2;
      [halo, ring, dot].forEach((m) => (m.renderOrder = 10));
      g.add(halo, ring, dot);
      g.userData = { index: i, ring, dot, halo };
      ring.userData.index = i;
      halo.userData.index = i;
      dot.userData.index = i;
      this.room.add(g);
      this.rings.push(g);
    });
  }

  buildWalkArea() {
    const { L } = this;
    const dx0 = L.doorX - 0.4;
    const dx1 = L.doorX + 0.4;
    this.rects = {
      room: { x0: L.x0, x1: L.x1, z0: L.z0, z1: L.z1 },
      bath: { ...this.bathRect },
    };
    this.walk = [
      this.rects.room,
      this.rects.bath,
      { x0: dx0, x1: dx1, z0: L.z0 - 0.6, z1: L.z0 + 0.6 },
    ];
  }

  addObstacle(objs, color) {
    const box = new THREE.Box3();
    [].concat(objs).forEach((root) => {
      root.updateWorldMatrix(true, true);
      root.traverse((o) => o.isMesh && !o.userData.nc && o.material !== this.mat.glass && box.expandByObject(o));
    });
    this.obstacles.push({ box, color });
  }

  addPoi(text, world, zone) {
    const z = zone || (world.z < this.L.z0 - 0.05 ? 'bath' : 'room');
    const el = document.createElement('button');
    el.className = 'poi';
    el.type = 'button';
    el.innerHTML = `<i></i><span>${text}</span>`;
    el.tabIndex = -1;
    el.addEventListener('click', () => this.lookAt(world));
    this.opts.labels && this.opts.labels.appendChild(el);
    this.pois.push({ el, world, zone: z });
  }

  /* ----------------------------------------------------------- navigation */

  lookAt(v) {
    const d = v.clone().sub(this.pos);
    this.yawGoal = Math.atan2(-d.x, -d.z);
    this.pitchGoal = THREE.MathUtils.clamp(Math.atan2(d.y - 0.0, Math.hypot(d.x, d.z)), -0.6, 0.6);
    this.tween = { t: 0, dur: 0.7, from: this.pos.clone(), to: this.pos.clone(), y0: this.yaw, p0: this.pitch, y1: this.yaw + wrapAngle(this.yawGoal - this.yaw), p1: this.pitchGoal, look: true };
  }

  goTo(i, instant = false) {
    const s = this.stops[i];
    if (!s) return;
    this.index = i;
    const to = new THREE.Vector3(s.pos[0], EYE, s.pos[1]);
    const d = new THREE.Vector3(s.look[0], s.look[1], s.look[2]).sub(to);
    const yaw1 = Math.atan2(-d.x, -d.z);
    const pitch1 = Math.atan2(d.y, Math.hypot(d.x, d.z));
    if (instant) {
      this.pos.copy(to);
      this.yaw = yaw1;
      this.pitch = pitch1;
      this.fovExtra = s.fov || 0;
      this.tween = null;
    } else {
      const dist = this.pos.distanceTo(to);
      this.tween = { t: 0, dur: THREE.MathUtils.clamp(0.8 + dist * 0.4, 0.9, 2.0), from: this.pos.clone(), to, y0: this.yaw, p0: this.pitch, y1: this.yaw + wrapAngle(yaw1 - this.yaw), p1: pitch1, f0: this.fovExtra, f1: s.fov || 0 };
    }
    this.opts.onStop && this.opts.onStop(i, this.stops[i]);
  }

  next() {
    this.goTo((this.index + 1) % this.stops.length);
  }

  startAuto() {
    this.auto = true;
    this.autoTimer = 0;
    this.goTo(0);
    this.opts.onAuto && this.opts.onAuto(true);
  }

  stopAuto() {
    if (!this.auto) return;
    this.auto = false;
    this.opts.onAuto && this.opts.onAuto(false);
  }

  setKey(k, on) {
    this.stopAuto();
    on ? this.keys.add(k) : this.keys.delete(k);
  }

  setMood(name) {
    this.moodTarget = name === 'night' ? 1 : 0;
  }

  applyMood(instant = false) {
    if (instant) this.mood = this.moodTarget;
    const m = this.mood;
    const day = 1 - m;
    this.renderer.toneMappingExposure = lerp(0.92, 1.1, m);
    this.scene.environmentIntensity = lerp(0.4, 0.08, m);
    this.hemi.intensity = lerp(0.3, 0.02, m);
    this.sun.intensity = 2.4 * day;
    this.sun.visible = day > 0.01;
    this.ceilLights.forEach((l) => (l.intensity = lerp(1.0, 2.2, m)));
    this.bathLight.intensity = 2.2;
    this.lamps.forEach(({ light, shade }) => {
      light.intensity = lerp(0.0, 14, m);
      shade.material.emissiveIntensity = lerp(0, 2.4, m);
    });
    this.mat.cove.color.set('#ece6da').lerp(new THREE.Color('#ffd9a0'), m);
    this.mat.glow.color.set('#f4f0e6').lerp(new THREE.Color('#fff1cf'), m);
    this.outDay.opacity = day;
    this.outNight.opacity = m;
    this.ground.material.color.set(m > 0.5 ? '#0a1026' : '#2f6a3a');
    this.opts.onMood && this.opts.onMood(m > 0.5 ? 'night' : 'day');
  }

  /* ------------------------------------------------------------ main loop */

  canStand(x, z) {
    const inside = this.walk.some((r) => x >= r.x0 + RADIUS && x <= r.x1 - RADIUS && z >= r.z0 + RADIUS && z <= r.z1 - RADIUS);
    if (!inside) return false;
    return !this.obstacles.some(({ box }) => x > box.min.x - RADIUS && x < box.max.x + RADIUS && z > box.min.z - RADIUS && z < box.max.z + RADIUS && box.min.y < 1.2);
  }

  update(dt) {
    // mood easing
    if (Math.abs(this.mood - this.moodTarget) > 0.001) {
      this.mood += Math.sign(this.moodTarget - this.mood) * Math.min(dt * 1.6, Math.abs(this.moodTarget - this.mood));
      this.applyMood();
    }

    if (this.tween) {
      const t = this.tween;
      t.t += dt / t.dur;
      const k = ease(Math.min(t.t, 1));
      this.pos.lerpVectors(t.from, t.to, k);
      this.yaw = lerp(t.y0, t.y1, k);
      this.pitch = lerp(t.p0, t.p1, k);
      if (t.f1 !== undefined) this.fovExtra = lerp(t.f0, t.f1, k);
      if (t.t >= 1) {
        this.tween = null;
        this.autoTimer = 0;
      }
    } else {
      // inertia
      this.yawVel *= 0.9;
      this.pitchVel *= 0.9;
      if (Math.abs(this.yawVel) > 0.0002) this.yaw += this.yawVel * 0.4;
      // keyboard
      const k = this.keys;
      if (k.size) {
        const sp = (k.has('run') ? 2.6 : 1.5) * dt;
        const fw = (k.has('f') ? 1 : 0) - (k.has('b') ? 1 : 0);
        const st = (k.has('r') ? 1 : 0) - (k.has('l') ? 1 : 0);
        this.yaw -= ((k.has('tr') ? 1 : 0) - (k.has('tl') ? 1 : 0)) * dt * 1.6;
        // forward = (-sin yaw, -cos yaw); right = (cos yaw, -sin yaw)
        const mx = -Math.sin(this.yaw) * fw * sp + Math.cos(this.yaw) * st * sp;
        const mz = -Math.cos(this.yaw) * fw * sp - Math.sin(this.yaw) * st * sp;
        if (this.canStand(this.pos.x + mx, this.pos.z)) this.pos.x += mx;
        if (this.canStand(this.pos.x, this.pos.z + mz)) this.pos.z += mz;
      }
      if (this.auto) {
        this.autoTimer += dt;
        if (this.autoTimer > 4.6) {
          this.autoTimer = 0;
          if (this.index === this.stops.length - 1) this.stopAuto();
          else this.next();
        }
      }
    }

    this.camera.position.copy(this.pos);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.applyFov();

    const t = this.elapsed;
    this.fans.forEach((f) => (f.rotation.y += dt * 2.2));
    this.rings.forEach((g, i) => {
      g.visible = !(i === this.index && !this.tween);
      const s = 1 + Math.sin(t * 2.4 + i) * 0.08;
      g.userData.halo.scale.setScalar(s * 1.1);
      g.userData.ring.scale.setScalar(s);
    });
  }

  updateLabels() {
    if (!this.opts.labels) return;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const zone = this.pos.z < this.L.z0 - 0.15 ? 'bath' : 'room';
    const atDoor = this.pos.z < this.L.z0 + 0.8 && Math.abs(this.pos.x - this.L.doorX) < 0.7;
    const inBath = zone === 'bath' || atDoor;
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const v = new THREE.Vector3();
    for (const p of this.pois) {
      v.copy(p.world).project(this.camera);
      const to = p.world.clone().sub(this.pos);
      const dist = to.length();
      const facing = to.normalize().dot(dir);
      const zoneOk = p.zone === 'bath' ? inBath : zone === 'room';
      const show = zoneOk && v.z < 1 && facing > 0.55 && dist > 0.7 && dist < 6.2 && !this.tween;
      p.el.style.opacity = show ? String(Math.min(1, (facing - 0.55) * 4)) : '0';
      p.el.style.pointerEvents = show ? 'auto' : 'none';
      p.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px) translate(-12px,-12px)`;
    }
  }

  drawMap() {
    const cv = this.opts.minimap;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const W = cv.width;
    const H = cv.height;
    const { L, rects } = this;
    const minX = L.x0;
    const maxX = L.x1;
    const minZ = L.bz0;
    const maxZ = L.z1;
    const pad = 10;
    const s = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxZ - minZ));
    const ox = (W - s * (maxX - minX)) / 2;
    const oz = (H - s * (maxZ - minZ)) / 2;
    const X = (x) => ox + (x - minX) * s;
    const Z = (z) => oz + (z - minZ) * s;
    ctx.clearRect(0, 0, W, H);
    const rr = (r, fill, stroke) => {
      ctx.beginPath();
      ctx.roundRect(X(r.x0), Z(r.z0), (r.x1 - r.x0) * s, (r.z1 - r.z0) * s, 3);
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    };
    rr(rects.room, 'rgba(246,240,230,0.10)', 'rgba(246,240,230,0.7)');
    rr(rects.bath, 'rgba(246,240,230,0.10)', 'rgba(246,240,230,0.7)');
    ctx.clearRect(X(L.doorX - 0.4), Z(L.z0) - 2, 0.8 * s, 4);
    ctx.fillStyle = 'rgba(200,163,90,0.9)';
    ctx.fillRect(X(L.doorX - 0.4), Z(L.z0) - 1, 0.8 * s, 2);
    for (const { box, color } of this.obstacles) {
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.roundRect(X(box.min.x), Z(box.min.z), (box.max.x - box.min.x) * s, (box.max.z - box.min.z) * s, 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    this.stops.forEach((st, i) => {
      ctx.beginPath();
      ctx.arc(X(st.pos[0]), Z(st.pos[1]), i === this.index ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = i === this.index ? '#f7c948' : 'rgba(247,225,166,0.65)';
      ctx.fill();
    });
    // player + view cone
    const px = X(this.pos.x);
    const pz = Z(this.pos.z);
    const a = -this.yaw - Math.PI / 2;
    const fov = THREE.MathUtils.degToRad(this.camera.fov * Math.min(this.camera.aspect, 1.8) * 0.55);
    ctx.beginPath();
    ctx.moveTo(px, pz);
    ctx.arc(px, pz, 30, a - fov / 2, a + fov / 2);
    ctx.closePath();
    const gr = ctx.createRadialGradient(px, pz, 0, px, pz, 30);
    gr.addColorStop(0, 'rgba(247,201,72,0.65)');
    gr.addColorStop(1, 'rgba(247,201,72,0)');
    ctx.fillStyle = gr;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px, pz, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#f7c948';
    ctx.fill();
    ctx.strokeStyle = '#150f33';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  loop() {
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    if (!this.room || !this.visible || document.hidden) return;
    this.elapsed += dt;
    this.update(dt);
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
    this.drawMap();
  }

  /* -------------------------------------------------------- interactions */

  ndc(e) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  pickRing(e) {
    this.ndc(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets = [];
    this.rings.forEach((g) => g.visible && targets.push(g.userData.halo, g.userData.ring, g.userData.dot));
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    return hit ? hit.object.userData.index : -1;
  }

  hover(e) {
    if (!this.room) return;
    this.canvas.style.cursor = this.pickRing(e) >= 0 ? 'pointer' : 'grab';
  }

  clickAt(e) {
    if (!this.room) return;
    const i = this.pickRing(e);
    if (i >= 0) {
      this.stopAuto();
      this.goTo(i);
    }
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.ro && this.ro.disconnect();
    this.io && this.io.disconnect();
    window.removeEventListener('keydown', this.kd);
    window.removeEventListener('keyup', this.ku);
    this.clearRoom();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
