/* ================================================================
   utils.js — Configuration, math helpers, and procedural textures.
   Loaded first; everything below is a global available to later files.
   ================================================================ */

"use strict";

/* ----------------------------------------------------------------
   CONFIG — central tuning values for the whole game.
   ---------------------------------------------------------------- */
const CONFIG = {
  // Player physics
  playerHeight: 1.7,
  playerRadius: 0.42,
  eyeHeight:    1.6,
  gravity:      24,
  walkSpeed:    7.0,
  sprintSpeed:  11.5,
  jumpSpeed:    8.6,
  airControl:   0.5,
  accel:        60,      // ground acceleration
  friction:     10,

  // Player vitals
  maxHealth: 100,
  maxArmor:  100,
  armorAbsorb: 0.6,      // fraction of incoming damage soaked by armour

  // Combat / world
  interactRange: 3.2,
  doorOpenRange: 3.4,

  // Camera
  fov: 78,
  near: 0.05,
  far: 600,
};

/* ----------------------------------------------------------------
   Small math helpers
   ---------------------------------------------------------------- */
const Utils = {
  clamp(v, lo, hi){ return v < lo ? lo : (v > hi ? hi : v); },
  lerp(a, b, t){ return a + (b - a) * t; },
  rand(min, max){ return min + Math.random() * (max - min); },
  randInt(min, max){ return Math.floor(Utils.rand(min, max + 1)); },
  choice(arr){ return arr[Math.floor(Math.random() * arr.length)]; },

  // 2D (XZ-plane) distance — used a lot for movement/AI.
  dist2D(ax, az, bx, bz){
    const dx = ax - bx, dz = az - bz;
    return Math.sqrt(dx * dx + dz * dz);
  },

  // Move `current` toward `target` by at most `maxDelta`.
  approach(current, target, maxDelta){
    if (current < target) return Math.min(current + maxDelta, target);
    return Math.max(current - maxDelta, target);
  },

  // Format seconds as M:SS.t
  formatTime(sec){
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const t = Math.floor((sec * 10) % 10);
    return `${m}:${s.toString().padStart(2, "0")}.${t}`;
  },
};

/* ----------------------------------------------------------------
   AABB collider helper.
   Walls/closed doors are represented as axis-aligned boxes on the
   XZ plane (with a y range). The player and enemies are circles in
   XZ, so collision resolution expands the box by the entity radius
   and pushes out along the axis of least penetration.
   ---------------------------------------------------------------- */
class AABB {
  constructor(minX, maxX, minZ, maxZ, minY = 0, maxY = 100){
    this.minX = minX; this.maxX = maxX;
    this.minZ = minZ; this.maxZ = maxZ;
    this.minY = minY; this.maxY = maxY;
    this.solid = true;          // doors toggle this
  }
  // Push a circle (cx,cz,r) out of this box. Returns adjusted [x,z].
  resolveCircle(cx, cz, r){
    if (!this.solid) return [cx, cz];
    const nx = Utils.clamp(cx, this.minX, this.maxX);
    const nz = Utils.clamp(cz, this.minZ, this.maxZ);
    const dx = cx - nx, dz = cz - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 > r * r) return [cx, cz];          // not overlapping

    if (d2 > 1e-6){
      // Circle centre is outside the box (corner/edge case): push along normal.
      const d = Math.sqrt(d2);
      const push = (r - d);
      return [cx + (dx / d) * push, cz + (dz / d) * push];
    }
    // Centre inside the box: push out along axis of least penetration.
    const left   = cx - this.minX, right = this.maxX - cx;
    const back    = cz - this.minZ, front = this.maxZ - cz;
    const minPen = Math.min(left, right, back, front);
    if (minPen === left)  return [this.minX - r, cz];
    if (minPen === right) return [this.maxX + r, cz];
    if (minPen === back)  return [cx, this.minZ - r];
    return [cx, this.maxZ + r];
  }
  // Point-in-box test on XZ (with optional padding) — used by projectiles.
  containsXZ(x, z, pad = 0){
    return this.solid &&
           x >= this.minX - pad && x <= this.maxX + pad &&
           z >= this.minZ - pad && z <= this.maxZ + pad;
  }
}

/* ----------------------------------------------------------------
   Procedural textures (CanvasTexture). No external image assets.
   Each returns a THREE.CanvasTexture ready to assign to a material.
   ---------------------------------------------------------------- */
const Tex = {
  _canvas(size = 256){
    const c = document.createElement("canvas");
    c.width = c.height = size;
    return c;
  },

  // Glowing grid floor — bright lines on a dark panel.
  floor(baseHex = "#0a1622", lineHex = "#2ff3ff", cells = 8){
    const s = 256, c = this._canvas(s), g = c.getContext("2d");
    g.fillStyle = baseHex; g.fillRect(0, 0, s, s);
    // subtle panel gradient
    const grad = g.createLinearGradient(0, 0, s, s);
    grad.addColorStop(0, "rgba(255,255,255,0.04)");
    grad.addColorStop(1, "rgba(0,0,0,0.18)");
    g.fillStyle = grad; g.fillRect(0, 0, s, s);
    g.strokeStyle = lineHex; g.lineWidth = 2; g.globalAlpha = 0.9;
    const step = s / cells;
    g.shadowColor = lineHex; g.shadowBlur = 6;
    for (let i = 0; i <= cells; i++){
      g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, s); g.stroke();
      g.beginPath(); g.moveTo(0, i * step); g.lineTo(s, i * step); g.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  },

  // Panelled wall — riveted plates with a coloured accent stripe.
  wall(baseHex = "#13243a", lineHex = "#1f3a5c", accentHex = "#2ff3ff"){
    const s = 256, c = this._canvas(s), g = c.getContext("2d");
    g.fillStyle = baseHex; g.fillRect(0, 0, s, s);
    g.strokeStyle = lineHex; g.lineWidth = 4;
    for (let y = 0; y <= s; y += 64){
      g.beginPath(); g.moveTo(0, y); g.lineTo(s, y); g.stroke();
    }
    for (let x = 0; x <= s; x += 128){
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, s); g.stroke();
    }
    // rivets
    g.fillStyle = lineHex;
    for (let y = 16; y < s; y += 64)
      for (let x = 24; x < s; x += 64){
        g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill();
      }
    // accent stripe
    g.fillStyle = accentHex; g.globalAlpha = 0.85;
    g.shadowColor = accentHex; g.shadowBlur = 12;
    g.fillRect(0, s / 2 - 3, s, 6);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  },

  // Hazard stripes — used on environmental hazards & exit pads.
  hazard(aHex = "#ffd23d", bHex = "#1a1206"){
    const s = 128, c = this._canvas(s), g = c.getContext("2d");
    g.fillStyle = bHex; g.fillRect(0, 0, s, s);
    g.fillStyle = aHex;
    for (let i = -s; i < s * 2; i += 40){
      g.beginPath();
      g.moveTo(i, 0); g.lineTo(i + 20, 0);
      g.lineTo(i + 20 - s, s); g.lineTo(i - s, s);
      g.closePath(); g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  },

  // A soft radial sprite used for glows, muzzle flashes & particles.
  glow(hex = "#ffffff"){
    const s = 128, c = this._canvas(s), g = c.getContext("2d");
    const grad = g.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
    grad.addColorStop(0,   hex);
    grad.addColorStop(0.25, hex);
    grad.addColorStop(1,   "rgba(0,0,0,0)");
    g.fillStyle = grad; g.fillRect(0, 0, s, s);
    return new THREE.CanvasTexture(c);
  },
};

// A single shared soft-glow texture (white) reused by many sprites.
let GLOW_TEX = null;
function getGlowTex(){
  if (!GLOW_TEX) GLOW_TEX = Tex.glow("#ffffff");
  return GLOW_TEX;
}
