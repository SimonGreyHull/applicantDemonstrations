/* ================================================================
   effects.js — Effects
   A pooled particle system plus one-shot helpers for explosions,
   sparks, enemy death bursts, hitscan tracers and muzzle flashes.
   Particles are small additive sprites recycled from a pool so we
   never allocate during combat.
   ================================================================ */

"use strict";

class Effects {
  constructor(game){
    this.game = game;
    this.scene = game.scene;

    // ---- Particle pool (additive sprites) ----
    this.maxParticles = 600;
    this.particles = [];           // live particles
    this.pool = [];                // free sprites
    const tex = getGlowTex();
    for (let i = 0; i < this.maxParticles; i++){
      const mat = new THREE.SpriteMaterial({
        map: tex, color: 0xffffff, blending: THREE.AdditiveBlending,
        transparent: true, depthWrite: false,
      });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      this.scene.add(s);
      this.pool.push(s);
    }

    // ---- Tracers (line segments for hitscan) ----
    this.tracers = [];

    // ---- Transient point lights (explosions / muzzle) ----
    // Kept always-visible at intensity 0 so the scene's light *count*
    // never changes — that avoids per-flash shader recompiles. We just
    // animate intensity. The pool is small to stay within GPU limits.
    this.lights = [];
    this.maxLights = 6;
    for (let i = 0; i < this.maxLights; i++){
      const l = new THREE.PointLight(0xffffff, 0, 18, 2);
      this.scene.add(l);
      this.lights.push({ light: l, life: 0, maxLife: 1, baseIntensity: 0 });
    }
  }

  _getParticle(){
    return this.pool.length ? this.pool.pop() : null;
  }

  // Spawn a single particle. Accepts a config object.
  spawn(opts){
    const s = this._getParticle();
    if (!s) return;
    s.visible = true;
    s.position.copy(opts.pos);
    s.material.color.setHex(opts.color != null ? opts.color : 0xffffff);
    s.material.opacity = 1;
    const sc = opts.size || 0.4;
    s.scale.set(sc, sc, sc);
    this.particles.push({
      sprite: s,
      vel: opts.vel ? opts.vel.clone() : new THREE.Vector3(),
      life: 0,
      maxLife: opts.life || 0.6,
      gravity: opts.gravity != null ? opts.gravity : 0,
      drag: opts.drag != null ? opts.drag : 1.0,
      startSize: sc,
      endSize: opts.endSize != null ? opts.endSize : 0,
      fade: opts.fade != null ? opts.fade : true,
    });
  }

  // Flash a transient point light at a position. Picks the most-idle
  // slot (smallest remaining life) so bursts of flashes look right.
  flashLight(pos, color, intensity, life, dist = 16){
    let slot = this.lights[0];
    let bestRemain = Infinity;
    for (const o of this.lights){
      const remain = o.maxLife - o.life;
      if (remain < bestRemain){ bestRemain = remain; slot = o; }
    }
    slot.light.color.setHex(color);
    slot.light.intensity = intensity;
    slot.light.distance = dist;
    slot.light.position.copy(pos);
    slot.life = 0; slot.maxLife = life; slot.baseIntensity = intensity;
  }

  /* ---------------- One-shot effect presets ---------------- */

  // Small spark burst where a shot hits a surface.
  hitSpark(pos, color = 0x9fe8ff, count = 8){
    for (let i = 0; i < count * this._density(); i++){
      const v = new THREE.Vector3(
        Utils.rand(-1, 1), Utils.rand(-0.2, 1), Utils.rand(-1, 1)
      ).normalize().multiplyScalar(Utils.rand(2, 6));
      this.spawn({ pos, vel: v, color, size: 0.18, endSize: 0.02,
                   life: Utils.rand(0.15, 0.35), gravity: 6, drag: 0.86 });
    }
    this.flashLight(pos, color, 2, 0.08, 6);
  }

  // Blood/energy splat when an enemy is hit.
  enemyHitSpark(pos, color){
    this.hitSpark(pos, color, 6);
  }

  // Big explosion (rockets, mech attacks, enemy deaths).
  explosion(pos, radius = 4, color = 0xff8822){
    const n = Math.floor(36 * this._density());
    for (let i = 0; i < n; i++){
      const v = new THREE.Vector3(
        Utils.rand(-1, 1), Utils.rand(-0.3, 1), Utils.rand(-1, 1)
      ).normalize().multiplyScalar(Utils.rand(3, 10));
      const c = Math.random() < 0.5 ? color : 0xffe089;
      this.spawn({ pos, vel: v, color: c, size: Utils.rand(0.4, 0.9),
                   endSize: 0.05, life: Utils.rand(0.3, 0.7),
                   gravity: 4, drag: 0.88 });
    }
    // smoke-ish dark puffs
    for (let i = 0; i < Math.floor(10 * this._density()); i++){
      const v = new THREE.Vector3(Utils.rand(-1,1), Utils.rand(0,1), Utils.rand(-1,1))
        .normalize().multiplyScalar(Utils.rand(1, 3));
      this.spawn({ pos, vel: v, color: 0x442211, size: 0.8, endSize: 1.6,
                   life: Utils.rand(0.5, 0.9), drag: 0.9 });
    }
    this.flashLight(pos, color, 6, 0.35, radius * 4);
    this.game.audio.play("explosion");
    this.game.shakeCamera(0.5, 0.35);
  }

  // Colourful burst when an enemy dies (no audio here — caller handles).
  deathBurst(pos, color, scale = 1){
    const n = Math.floor(26 * scale * this._density());
    for (let i = 0; i < n; i++){
      const v = new THREE.Vector3(
        Utils.rand(-1, 1), Utils.rand(0, 1.2), Utils.rand(-1, 1)
      ).normalize().multiplyScalar(Utils.rand(2, 8) * scale);
      this.spawn({ pos, vel: v, color, size: Utils.rand(0.25, 0.6) * scale,
                   endSize: 0.02, life: Utils.rand(0.4, 0.8),
                   gravity: 8, drag: 0.9 });
    }
    this.flashLight(pos, color, 3, 0.25, 10);
  }

  // Pickup sparkle.
  pickupBurst(pos, color){
    for (let i = 0; i < Math.floor(16 * this._density()); i++){
      const a = (i / 16) * Math.PI * 2;
      const v = new THREE.Vector3(Math.cos(a), Utils.rand(1, 2), Math.sin(a))
        .multiplyScalar(Utils.rand(2, 4));
      this.spawn({ pos, vel: v, color, size: 0.25, endSize: 0.02,
                   life: 0.5, gravity: 4, drag: 0.9 });
    }
    this.flashLight(pos, color, 2.5, 0.2, 8);
  }

  // A quick hitscan tracer line that fades out.
  tracer(from, to, color = 0x66e0ff){
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const mat = new THREE.LineBasicMaterial({
      color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.tracers.push({ line, life: 0, maxLife: 0.08 });
  }

  // Density multiplier from graphics-quality setting.
  _density(){
    const q = this.game.settings.quality;
    return q === "low" ? 0.45 : (q === "high" ? 1.25 : 0.85);
  }

  /* ---------------- Per-frame update ---------------- */
  update(dt){
    // Particles
    for (let i = this.particles.length - 1; i >= 0; i--){
      const p = this.particles[i];
      p.life += dt;
      const t = p.life / p.maxLife;
      if (t >= 1){
        p.sprite.visible = false;
        this.pool.push(p.sprite);
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(Math.pow(p.drag, dt * 60));
      p.sprite.position.addScaledVector(p.vel, dt);
      const size = Utils.lerp(p.startSize, p.endSize, t);
      p.sprite.scale.set(size, size, size);
      if (p.fade) p.sprite.material.opacity = 1 - t;
    }

    // Tracers
    for (let i = this.tracers.length - 1; i >= 0; i--){
      const tr = this.tracers[i];
      tr.life += dt;
      const t = tr.life / tr.maxLife;
      if (t >= 1){
        this.scene.remove(tr.line);
        tr.line.geometry.dispose();
        tr.line.material.dispose();
        this.tracers.splice(i, 1);
        continue;
      }
      tr.line.material.opacity = 0.9 * (1 - t);
    }

    // Transient lights (intensity-only animation; count stays constant)
    for (const o of this.lights){
      if (o.light.intensity <= 0) continue;
      o.life += dt;
      const t = o.life / o.maxLife;
      if (t >= 1){ o.light.intensity = 0; continue; }
      o.light.intensity = o.baseIntensity * (1 - t);
    }
  }
}
