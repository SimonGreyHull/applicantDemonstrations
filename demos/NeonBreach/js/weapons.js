/* ================================================================
   weapons.js — weapon definitions + Weapon controller
   Three distinct weapons, each with its own procedurally-built
   viewmodel, fire mode, sound, recoil and visual effect:
     1) Pulse Pistol  — hitscan, infinite reserve, moderate
     2) Plasma Rifle  — fast green projectiles, uses ammo
     3) Rocket Launcher — slow rockets with AoE, limited ammo
   ================================================================ */

"use strict";

const WEAPONS = {
  pistol: {
    name: "PULSE PISTOL", slot: 1, mode: "hitscan",
    damage: 18, fireRate: 0.30, spread: 0.012, range: 120,
    ammoType: null, ammoPerShot: 0, recoil: 0.9, color: 0x2ff3ff,
  },
  rifle: {
    name: "PLASMA RIFLE", slot: 2, mode: "projectile",
    damage: 20, fireRate: 0.11, spread: 0.03,
    ammoType: "plasma", ammoPerShot: 1, recoil: 0.5, color: 0x6bff6b,
    projSpeed: 70, projRadius: 0.22, aoe: 0,
  },
  rocket: {
    name: "ROCKET LAUNCHER", slot: 3, mode: "projectile",
    damage: 95, fireRate: 0.85, spread: 0.0,
    ammoType: "rocket", ammoPerShot: 1, recoil: 3.2, color: 0xff8a2b,
    projSpeed: 38, projRadius: 0.35, aoe: 5.5,
  },
};

class Weapon {
  constructor(game, key){
    this.game = game;
    this.key = key;
    this.def = WEAPONS[key];
    this.cooldown = 0;

    this._buildViewmodel();
  }

  /* Build a small first-person viewmodel parented to the camera. */
  _buildViewmodel(){
    const g = new THREE.Group();
    const c = this.def.color;
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x20303f, metalness: 0.75, roughness: 0.35 });
    const glowMat = new THREE.MeshStandardMaterial({
      color: c, emissive: c, emissiveIntensity: 1.2, metalness: 0.4, roughness: 0.3 });

    if (this.key === "pistol"){
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.42), bodyMat);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.24, 0.14), bodyMat);
      grip.position.set(0, -0.18, 0.12);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.2, 12), glowMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.02, -0.3);
      g.add(body, grip, barrel);
      this.muzzleLocal = new THREE.Vector3(0, 0.02, -0.42);
    } else if (this.key === "rifle"){
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.16, 0.7), bodyMat);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.13), bodyMat);
      grip.position.set(0, -0.17, 0.18);
      const core = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.5), glowMat);
      core.position.set(0, 0.06, -0.1);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.34, 14), bodyMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.0, -0.46);
      g.add(body, grip, core, barrel);
      this.muzzleLocal = new THREE.Vector3(0, 0, -0.64);
    } else { // rocket
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.55), bodyMat);
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.13, 0.8, 16), bodyMat);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(0, 0.04, -0.3);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.03, 8, 16), glowMat);
      ring.position.set(0, 0.04, -0.68);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.24, 0.14), bodyMat);
      grip.position.set(0, -0.2, 0.16);
      g.add(body, tube, ring, grip);
      this.muzzleLocal = new THREE.Vector3(0, 0.04, -0.72);
    }

    // Muzzle flash sprite + light (hidden until firing).
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTex(), color: c, blending: THREE.AdditiveBlending,
      transparent: true, opacity: 0, depthWrite: false }));
    this.flash.position.copy(this.muzzleLocal);
    this.flash.scale.setScalar(0.7);
    g.add(this.flash);
    this.flashLight = new THREE.PointLight(c, 0, 6, 2);
    this.flashLight.position.copy(this.muzzleLocal);
    g.add(this.flashLight);

    // Resting pose (bottom-right of view). Bob/recoil offset from here.
    this.basePos = new THREE.Vector3(0.26, -0.26, -0.55);
    g.position.copy(this.basePos);
    g.rotation.y = 0.05;
    g.visible = false;
    this.group = g;
    this.game.camera.add(g);

    this.recoilOffset = 0;   // viewmodel kick back along z
    this.flashTime = 0;
  }

  show(){ this.group.visible = true; }
  hide(){ this.group.visible = false; }

  canFire(player){
    if (this.cooldown > 0) return false;
    if (this.def.ammoType && player.ammo[this.def.ammoType] < this.def.ammoPerShot) return false;
    return true;
  }

  // Returns true if a shot was actually fired.
  fire(player){
    if (this.cooldown > 0) return false;
    if (this.def.ammoType && player.ammo[this.def.ammoType] < this.def.ammoPerShot){
      this.game.audio.play("empty");
      this.cooldown = 0.18;
      return false;
    }
    this.cooldown = this.def.fireRate;
    if (this.def.ammoType) player.ammo[this.def.ammoType] -= this.def.ammoPerShot;

    // Muzzle flash + recoil
    this.flashTime = 0.06;
    this.flash.material.opacity = 1;
    this.flashLight.intensity = 3;
    this.recoilOffset = 0.12;
    player.addRecoil(this.def.recoil);
    this.game.registerShot();

    // Camera basis for aiming.
    const cam = this.game.camera;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    // Apply random spread.
    if (this.def.spread > 0){
      dir.x += Utils.rand(-this.def.spread, this.def.spread);
      dir.y += Utils.rand(-this.def.spread, this.def.spread);
      dir.z += Utils.rand(-this.def.spread, this.def.spread);
      dir.normalize();
    }
    const muzzleWorld = this.flash.getWorldPosition(new THREE.Vector3());

    if (this.def.mode === "hitscan"){
      this._fireHitscan(cam.getWorldPosition(new THREE.Vector3()), dir, muzzleWorld);
      this.game.audio.play("pistol");
    } else {
      // Spawn a visible projectile.
      this.game.spawnProjectile({
        owner: "player", pos: muzzleWorld, dir,
        speed: this.def.projSpeed, damage: this.def.damage,
        color: this.def.color, radius: this.def.projRadius,
        aoe: this.def.aoe, life: 6,
      });
      this.game.audio.play(this.key === "rocket" ? "rocket" : "plasma");
    }
    this.game.hud.update();
    return true;
  }

  _fireHitscan(origin, dir, muzzle){
    const hit = this.game.raycastWorld(origin, dir, this.def.range);
    const end = hit.point ? hit.point : origin.clone().addScaledVector(dir, this.def.range);
    this.game.effects.tracer(muzzle, end, this.def.color);
    if (hit.type === "enemy"){
      hit.enemy.takeDamage(this.def.damage, end);
      this.game.registerHit();
      this.game.effects.enemyHitSpark(end, 0xffd0ff);
    } else if (hit.type === "wall"){
      this.game.effects.hitSpark(end, this.def.color, 7);
    }
  }

  update(dt, player, moving, sprinting){
    if (this.cooldown > 0) this.cooldown -= dt;

    // Muzzle flash decay.
    if (this.flashTime > 0){
      this.flashTime -= dt;
      const k = Math.max(0, this.flashTime / 0.06);
      this.flash.material.opacity = k;
      this.flashLight.intensity = 3 * k;
      this.flash.material.rotation += dt * 20;
    }

    // Recoil recovery (viewmodel slides back to rest).
    this.recoilOffset = Utils.approach(this.recoilOffset, 0, dt * 0.9);

    // Weapon bob while moving.
    const t = performance.now() * 0.001;
    const bobAmp = moving ? (sprinting ? 0.05 : 0.03) : 0.008;
    const bobSpeed = sprinting ? 13 : 9;
    const bx = Math.cos(t * bobSpeed) * bobAmp;
    const by = Math.abs(Math.sin(t * bobSpeed)) * bobAmp;

    this.group.position.set(
      this.basePos.x + bx,
      this.basePos.y - by,
      this.basePos.z + this.recoilOffset
    );
    // Slight upward tilt while sprinting (lowered/ready feel).
    this.group.rotation.x = sprinting ? 0.25 : (this.recoilOffset * 1.5);
  }
}
