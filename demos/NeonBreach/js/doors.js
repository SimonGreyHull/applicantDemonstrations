/* ================================================================
   doors.js — Door and Button
   Three door behaviours are supported:
     • standard      — toggled by pressing E (or a linked button)
     • security      — locked; only a linked button/switch opens it
     • keycard       — needs the matching keycard in the inventory
   A coloured light strip communicates state at a glance, and each
   door owns an AABB collider that is disabled while open.
   ================================================================ */

"use strict";

class Door {
  /*
    opts = {
      pos: {x,z}, axis: "x"|"z", width, height, thickness,
      kind: "standard"|"security"|"keycard",
      keycard: "red"|"blue"|"yellow" (for keycard doors),
      id: string (for buttons to target),
    }
  */
  constructor(game, opts){
    this.game = game;
    this.axis = opts.axis || "x";
    this.width = opts.width || 4;
    this.height = opts.height || 4;
    this.thickness = opts.thickness || 0.5;
    this.kind = opts.kind || "standard";
    this.keycard = opts.keycard || null;
    this.id = opts.id || null;
    this.pos = new THREE.Vector3(opts.pos.x, 0, opts.pos.z);

    this.open = false;
    this.progress = 0;          // 0 closed, 1 fully open
    this.unlocked = (this.kind === "standard"); // security starts locked
    this.flashTimer = 0;

    this._build();
    this._makeCollider();
  }

  _stateColor(){
    if (this.open) return 0x4dff88;                 // green = open
    if (this.kind === "keycard") return Keycard.HEX[this.keycard];
    if (this.kind === "security" && !this.unlocked) return 0xff4d5e; // red = locked
    return 0x2ff3ff;                                 // cyan = ready
  }

  _build(){
    this.group = new THREE.Group();
    this.group.position.copy(this.pos);

    const w = this.axis === "x" ? this.width : this.thickness;
    const d = this.axis === "x" ? this.thickness : this.width;

    // The sliding panel.
    const panelMat = new THREE.MeshStandardMaterial({
      color: 0x1b2b44, metalness: 0.7, roughness: 0.35,
      emissive: 0x081420, emissiveIntensity: 0.5 });
    this.panel = new THREE.Mesh(new THREE.BoxGeometry(w, this.height, d), panelMat);
    this.panel.position.y = this.height / 2;
    this.panel.castShadow = true; this.panel.receiveShadow = true;
    this.group.add(this.panel);

    // Glowing state strips on both faces.
    const stripGeo = this.axis === "x"
      ? new THREE.BoxGeometry(w * 0.9, 0.18, d + 0.08)
      : new THREE.BoxGeometry(w + 0.08, 0.18, d * 0.9);
    this.stripMat = new THREE.MeshStandardMaterial({
      color: this._stateColor(), emissive: this._stateColor(),
      emissiveIntensity: 1.4 });
    this.strip = new THREE.Mesh(stripGeo, this.stripMat);
    this.strip.position.y = this.height * 0.62;
    this.panel.add(this.strip);

    // Static door frame so the opening reads clearly.
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x0c1626, metalness: 0.6, roughness: 0.5 });
    const postW = 0.4;
    if (this.axis === "x"){
      const left = new THREE.Mesh(new THREE.BoxGeometry(postW, this.height + 0.4, d + 0.4), frameMat);
      const right = left.clone();
      left.position.set(-this.width/2 - postW/2, (this.height+0.4)/2, 0);
      right.position.set(this.width/2 + postW/2, (this.height+0.4)/2, 0);
      this.group.add(left, right);
    } else {
      const a = new THREE.Mesh(new THREE.BoxGeometry(d + 0.4, this.height + 0.4, postW), frameMat);
      const b = a.clone();
      a.position.set(0, (this.height+0.4)/2, -this.width/2 - postW/2);
      b.position.set(0, (this.height+0.4)/2,  this.width/2 + postW/2);
      this.group.add(a, b);
    }

    this.game.scene.add(this.group);
    // State is communicated entirely by the emissive strip (no PointLight),
    // keeping the scene's light count low and stable.
  }

  _makeCollider(){
    const half = this.width / 2, halfT = this.thickness / 2;
    let minX, maxX, minZ, maxZ;
    if (this.axis === "x"){
      minX = this.pos.x - half; maxX = this.pos.x + half;
      minZ = this.pos.z - halfT; maxZ = this.pos.z + halfT;
    } else {
      minX = this.pos.x - halfT; maxX = this.pos.x + halfT;
      minZ = this.pos.z - half; maxZ = this.pos.z + half;
    }
    this.collider = new AABB(minX, maxX, minZ, maxZ, 0, this.height);
    this.game.colliders.push(this.collider);
  }

  // Distance from a point to the door centre (XZ).
  distanceTo(p){ return Utils.dist2D(p.x, p.z, this.pos.x, this.pos.z); }

  // Player pressed E while looking at this door.
  interact(player){
    if (this.open){ this.close(); return; }
    if (this.kind === "keycard"){
      if (player.keycards[this.keycard]){
        this.unlocked = true;
        this.doOpen();
        this.game.message((this.keycard.toUpperCase()) + " KEYCARD ACCEPTED", "#4dff88");
      } else {
        this.lockedFeedback(this.keycard.toUpperCase() + " KEYCARD REQUIRED");
      }
    } else if (this.kind === "security" && !this.unlocked){
      this.lockedFeedback("ACCESS DENIED — FIND THE CONTROL PANEL");
    } else {
      this.doOpen();
    }
  }

  // Called by a linked button — bypasses lock checks.
  triggerFromButton(){
    this.unlocked = true;
    if (this.open) this.close(); else this.doOpen();
  }

  doOpen(){
    this.open = true;
    this.game.audio.play("doorOpen");
    this._refreshColor();
  }
  close(){
    this.open = false;
    this.game.audio.play("doorOpen");
    this._refreshColor();
  }

  lockedFeedback(msg){
    this.flashTimer = 0.6;
    this.game.audio.play("doorLocked");
    this.game.message(msg, "#ff4d5e");
  }

  _refreshColor(){
    const c = this._stateColor();
    this.stripMat.color.setHex(c);
    this.stripMat.emissive.setHex(c);
  }

  update(dt){
    // Slide the panel up into the ceiling when open.
    const target = this.open ? 1 : 0;
    if (this.progress !== target){
      this.progress = Utils.approach(this.progress, target, dt * 2.2);
      this.panel.position.y = this.height / 2 + this.progress * this.height;
      // Disable the collider once the panel is mostly clear.
      this.collider.solid = this.progress < 0.55;
    }
    // Locked flash (red pulse on the strip).
    if (this.flashTimer > 0){
      this.flashTimer -= dt;
      const k = (Math.sin(this.flashTimer * 40) * 0.5 + 0.5);
      this.stripMat.emissiveIntensity = 0.6 + k * 2;
      if (this.flashTimer <= 0) this.stripMat.emissiveIntensity = 1.4;
    }
  }
}

/* ---------------- Buttons / control panels ---------------- */
class Button {
  /*
    opts = { pos:{x,y,z}, axis, targetId, label }
    A wall-mounted panel. Pressing E pushes the cap in and toggles the
    door(s) whose id === targetId.
  */
  constructor(game, opts){
    this.game = game;
    this.pos = new THREE.Vector3(opts.pos.x, opts.pos.y != null ? opts.pos.y : 1.4, opts.pos.z);
    this.targetId = opts.targetId;
    this.pressAnim = 0;
    this.used = false;

    this.group = new THREE.Group();
    this.group.position.copy(this.pos);

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.7, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x12243a, metalness: 0.6, roughness: 0.4 }));
    this.cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.12, 16),
      new THREE.MeshStandardMaterial({ color: 0x4dff88, emissive: 0x4dff88,
        emissiveIntensity: 1.2 }));
    this.cap.rotation.x = Math.PI / 2;
    this.cap.position.z = 0.14;
    this.group.add(base, this.cap);
    // Emissive cap only — no PointLight.

    game.scene.add(this.group);
  }

  distanceTo(p){ return Utils.dist2D(p.x, p.z, this.pos.x, this.pos.z); }

  interact(){
    this.pressAnim = 0.25;
    this.game.audio.play("button");
    // Toggle all matching doors.
    let any = false;
    for (const d of this.game.doors){
      if (d.id === this.targetId){ d.triggerFromButton(); any = true; }
    }
    if (any && !this.used){
      this.used = true;
      this.cap.material.color.setHex(0x2ff3ff);
      this.cap.material.emissive.setHex(0x2ff3ff);
    }
  }

  update(dt){
    if (this.pressAnim > 0){
      this.pressAnim -= dt;
      this.cap.position.z = 0.14 - Math.max(0, this.pressAnim) * 0.3;
    }
  }
}
