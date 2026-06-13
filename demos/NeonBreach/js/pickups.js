/* ================================================================
   pickups.js — Pickup (power-ups) and Keycard
   Both are floating, rotating, glowing 3D objects built procedurally.
   Pickups apply an effect to the player and may respawn; keycards are
   added to the inventory and never respawn.
   ================================================================ */

"use strict";

/* ---------------- Power-up pickups ---------------- */
class Pickup {
  /*
    type: "health" | "armor" | "ammo"
    pos:  THREE.Vector3 (centre, floats above floor)
    respawn: seconds before it returns (0 = never)
  */
  constructor(game, type, pos, respawn = 0){
    this.game = game;
    this.type = type;
    this.basePos = pos.clone();
    this.respawnTime = respawn;
    this.cooldown = 0;            // >0 while collected/hidden
    this.bob = Math.random() * Math.PI * 2;
    this.radius = 1.0;

    this.group = new THREE.Group();
    this.group.position.copy(pos);
    this._build();
    game.scene.add(this.group);
  }

  _build(){
    let color, mesh;
    if (this.type === "health"){
      color = 0x4dff88;
      // A medkit: white box with a glowing green cross on top.
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.45, 0.7),
        new THREE.MeshStandardMaterial({ color: 0xf2f6ff, roughness: 0.4, metalness: 0.1 }));
      const barMat = new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 1.2 });
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.5), barMat);
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.16), barMat);
      v.position.y = 0.24; h.position.y = 0.24;
      mesh = new THREE.Group(); mesh.add(box, v, h);
    } else if (this.type === "armor"){
      color = 0x2ff3ff;
      // An armour shard: a glowing octahedron crystal.
      mesh = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.5),
        new THREE.MeshStandardMaterial({
          color, emissive: color, emissiveIntensity: 0.8,
          metalness: 0.6, roughness: 0.2, transparent: true, opacity: 0.92 }));
    } else { // ammo
      color = 0xffb13d;
      // An ammo crate: orange box with dark banding.
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.55, 0.7),
        new THREE.MeshStandardMaterial({
          color, emissive: color, emissiveIntensity: 0.35,
          roughness: 0.5, metalness: 0.3 }));
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(0.74, 0.12, 0.74),
        new THREE.MeshStandardMaterial({ color: 0x221100 }));
      mesh = new THREE.Group(); mesh.add(box, band);
    }
    this.color = color;
    this.core = mesh;
    this.group.add(mesh);

    // Glow sprite halo.
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTex(), color, blending: THREE.AdditiveBlending,
      transparent: true, opacity: 0.6, depthWrite: false }));
    this.halo.scale.setScalar(2.2);
    this.group.add(this.halo);

    // (No PointLight — the emissive core, additive halo and floor ring
    // make pickups read as glowing beacons without spending a light.)

    // A floor ring marker.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.75, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.9;
    this.group.add(ring);
  }

  update(dt){
    if (this.cooldown > 0){
      this.cooldown -= dt;
      if (this.cooldown <= 0){ this.group.visible = true; }   // respawn
      return;
    }
    this.bob += dt * 2.2;
    this.core.rotation.y += dt * 1.6;
    this.group.position.y = this.basePos.y + Math.sin(this.bob) * 0.18;

    // Pickup check
    const p = this.game.player.position;
    if (Utils.dist2D(p.x, p.z, this.basePos.x, this.basePos.z) < this.radius &&
        Math.abs(p.y - this.basePos.y) < 2.0){
      this._collect();
    }
  }

  _collect(){
    let msg = null;
    const pl = this.game.player;
    if (this.type === "health"){
      if (pl.health >= CONFIG.maxHealth) return;             // don't waste it
      pl.health = Utils.clamp(pl.health + 30, 0, CONFIG.maxHealth);
      msg = "+30 HEALTH";
    } else if (this.type === "armor"){
      if (pl.armor >= CONFIG.maxArmor) return;
      pl.armor = Utils.clamp(pl.armor + 30, 0, CONFIG.maxArmor);
      msg = "+30 ARMOUR";
    } else {
      pl.giveAmmo("plasma", 30);
      pl.giveAmmo("rocket", 2);
      msg = "+30 PLASMA  +2 ROCKETS";
    }
    this.game.audio.play("pickup");
    this.game.effects.pickupBurst(this.group.position.clone(), this.color);
    this.game.message(msg, "#" + this.color.toString(16).padStart(6, "0"));
    this.game.hud.update();

    if (this.respawnTime > 0){
      this.cooldown = this.respawnTime;
      this.group.visible = false;
    } else {
      this.dispose();
      const i = this.game.pickups.indexOf(this);
      if (i >= 0) this.game.pickups.splice(i, 1);
    }
  }

  dispose(){ this.game.scene.remove(this.group); }
}

/* ---------------- Keycards ---------------- */
class Keycard {
  /* color: "red" | "blue" | "yellow" */
  constructor(game, color, pos){
    this.game = game;
    this.color = color;
    this.basePos = pos.clone();
    this.bob = Math.random() * Math.PI * 2;
    this.radius = 1.1;
    this.collected = false;

    const hex = Keycard.HEX[color];
    this.hex = hex;

    this.group = new THREE.Group();
    this.group.position.copy(pos);

    // A flat keycard with a chip stripe, standing on edge & spinning.
    const card = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.8, 0.06),
      new THREE.MeshStandardMaterial({ color: hex, emissive: hex,
        emissiveIntensity: 0.7, metalness: 0.4, roughness: 0.3 }));
    const chip = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.18, 0.08),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff,
        emissiveIntensity: 0.5 }));
    chip.position.set(0, 0.18, 0.02);
    this.card = new THREE.Group(); this.card.add(card, chip);
    this.group.add(this.card);

    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTex(), color: hex, blending: THREE.AdditiveBlending,
      transparent: true, opacity: 0.7, depthWrite: false }));
    this.halo.scale.setScalar(2.4);
    this.group.add(this.halo);

    // Emissive card + additive halo provide the glow (no PointLight).

    game.scene.add(this.group);
  }

  update(dt){
    if (this.collected) return;
    this.bob += dt * 2;
    this.card.rotation.y += dt * 2.2;
    this.group.position.y = this.basePos.y + Math.sin(this.bob) * 0.2;

    const p = this.game.player.position;
    if (Utils.dist2D(p.x, p.z, this.basePos.x, this.basePos.z) < this.radius &&
        Math.abs(p.y - this.basePos.y) < 2.2){
      this._collect();
    }
  }

  _collect(){
    this.collected = true;
    this.game.player.keycards[this.color] = true;
    this.game.audio.play("keycard");
    this.game.effects.pickupBurst(this.group.position.clone(), this.hex);
    this.game.message(this.color.toUpperCase() + " KEYCARD ACQUIRED",
                      "#" + this.hex.toString(16).padStart(6, "0"));
    this.game.hud.update();
    this.dispose();
    const i = this.game.keycards.indexOf(this);
    if (i >= 0) this.game.keycards.splice(i, 1);
  }

  dispose(){ this.game.scene.remove(this.group); }
}
Keycard.HEX = { red: 0xff5a5a, blue: 0x5aa8ff, yellow: 0xffe45a };
