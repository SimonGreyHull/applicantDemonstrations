/* ================================================================
   projectiles.js — Projectile
   Visible moving shots used by the Plasma Rifle, Rocket Launcher and
   by enemies. Each projectile is a small glowing mesh + trailing
   sprite. It steps forward each frame and tests for collisions with
   walls and with valid targets (player or enemies depending on owner).
   ================================================================ */

"use strict";

class Projectile {
  /*
    opts = {
      owner: "player" | "enemy",
      pos:    THREE.Vector3,
      dir:    THREE.Vector3 (normalized),
      speed:  number,
      damage: number,
      color:  hex,
      radius: visual/contact radius,
      aoe:    explosion radius (0 = direct hit only),
      life:   seconds before auto-expiry,
      shooter: enemy reference (so enemies don't hit themselves)
    }
  */
  constructor(game, opts){
    this.game = game;
    this.owner = opts.owner;
    this.shooter = opts.shooter || null;
    this.vel = opts.dir.clone().multiplyScalar(opts.speed);
    this.damage = opts.damage;
    this.aoe = opts.aoe || 0;
    this.radius = opts.radius || 0.25;
    this.life = 0;
    this.maxLife = opts.life || 5;
    this.dead = false;
    this.color = opts.color;

    // Visual: an emissive core sphere…
    const geo = new THREE.SphereGeometry(this.radius, 10, 10);
    const mat = new THREE.MeshBasicMaterial({ color: opts.color });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.copy(opts.pos);

    // …wrapped in an additive glow sprite for that arcade pop.
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTex(), color: opts.color, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false,
    }));
    sprite.scale.setScalar(this.radius * 6);
    this.mesh.add(sprite);

    // NOTE: projectiles deliberately carry no PointLight. Shots can be
    // very numerous, and adding a light per shot would blow the GPU's
    // light budget and recompile shaders. The emissive core + additive
    // glow sprite read as self-lit, and impacts spawn a pooled flash.

    game.scene.add(this.mesh);
  }

  update(dt){
    this.life += dt;
    if (this.life >= this.maxLife){ this.explode(false); return; }

    const step = this.vel.clone().multiplyScalar(dt);
    const next = this.mesh.position.clone().add(step);

    // --- Wall collision (point test against colliders) ---
    for (const c of this.game.colliders){
      if (c.containsXZ(next.x, next.z, this.radius) &&
          next.y >= c.minY && next.y <= c.maxY){
        this.explode(true); return;
      }
    }
    // --- Floor / ceiling ---
    if (next.y <= 0.05 || next.y >= 24){ this.explode(true); return; }

    // --- Target collision ---
    if (this.owner === "player"){
      for (const e of this.game.enemies){
        if (e.dead) continue;
        if (next.distanceTo(e.center()) <= this.radius + e.radius){
          if (this.aoe > 0){ this.mesh.position.copy(next); this.explode(true); }
          else { e.takeDamage(this.damage, next); this.game.registerHit(); this.explode(true); }
          return;
        }
      }
    } else {
      // enemy projectile vs player
      const p = this.game.player;
      const pc = p.position.clone();
      if (next.distanceTo(pc) <= this.radius + CONFIG.playerRadius + 0.3 &&
          Math.abs(next.y - pc.y) < 1.4){
        if (this.aoe > 0){ this.mesh.position.copy(next); this.explode(true); }
        else { p.takeDamage(this.damage); this.explode(false); }
        return;
      }
    }

    this.mesh.position.copy(next);

    // Occasionally drop a trail particle.
    if (Math.random() < 0.6){
      this.game.effects.spawn({
        pos: this.mesh.position, color: this.color, size: this.radius * 2.4,
        endSize: 0.02, life: 0.25, drag: 0.85,
      });
    }
  }

  // Resolve impact. `doDamage` controls whether AoE damage is applied.
  explode(doDamage){
    if (this.dead) return;
    this.dead = true;

    if (this.aoe > 0){
      this.game.effects.explosion(this.mesh.position.clone(), this.aoe, this.color);
      if (doDamage) this._applyAoE();
    } else {
      this.game.effects.hitSpark(this.mesh.position.clone(), this.color, 6);
    }
    this.dispose();
  }

  // Splash damage to everything in range (and the player for enemy rockets).
  _applyAoE(){
    const origin = this.mesh.position;
    if (this.owner === "player"){
      for (const e of this.game.enemies){
        if (e.dead) continue;
        const d = origin.distanceTo(e.center());
        if (d <= this.aoe){
          const falloff = 1 - d / this.aoe;
          e.takeDamage(this.damage * falloff, origin);
          this.game.registerHit();
        }
      }
    }
    // Splash can also hurt the player (rockets are dangerous up close!).
    const dp = origin.distanceTo(this.game.player.position);
    if (dp <= this.aoe){
      const falloff = 1 - dp / this.aoe;
      this.game.player.takeDamage(this.damage * falloff * 0.7);
    }
  }

  dispose(){
    this.game.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
