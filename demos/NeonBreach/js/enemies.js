/* ================================================================
   enemies.js — Enemy base class + Drone, Trooper, HeavyMech, Boss
   Each enemy has a procedurally-built model, a small finite-state
   AI (idle → chase → attack), obstacle avoidance via wall repulsion
   plus collision sliding, distinct tactics, an attack animation, a
   floating health bar, and a colourful death effect.
   ================================================================ */

"use strict";

class Enemy {
  constructor(game, pos){
    this.game = game;
    this.pos = new THREE.Vector3(pos.x, 0, pos.z);
    this.vel = new THREE.Vector3();
    this.state = "idle";
    this.alerted = false;
    this.dead = false;
    this.dying = 0;            // >0 while death animation plays
    this.fireCd = Utils.rand(0.3, 1.2);
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.strafeTimer = Utils.rand(1, 2.5);
    this.hurtFlash = 0;
    this.bob = Math.random() * Math.PI * 2;
    this.stuckTimer = 0;
    this.lastPos = this.pos.clone();

    // Subclasses set: hp, maxHp, speed, radius, detectRange, attackRange,
    // idealRange, fireRate, projDamage, projSpeed, hoverHeight, centerY,
    // color, name. Then call _afterStats() and _buildHealthBar().
  }

  center(){
    return new THREE.Vector3(this.pos.x, this.pos.y + this.centerY, this.pos.z);
  }

  /* ---------- shared model helpers ---------- */
  _buildHealthBar(){
    // Two billboarded sprites: dark backing + coloured fill.
    this.hpBack = new THREE.Sprite(new THREE.SpriteMaterial({
      color: 0x220000, depthTest: false, depthWrite: false, transparent: true }));
    this.hpFill = new THREE.Sprite(new THREE.SpriteMaterial({
      color: 0x4dff88, depthTest: false, depthWrite: false, transparent: true }));
    const w = this.barWidth || 1.4;
    this.hpBack.scale.set(w, 0.14, 1);
    this.hpFill.center.set(0, 0.5);          // left-anchored
    this.hpBack.center.set(0.5, 0.5);
    this.hpFill.scale.set(w, 0.12, 1);
    this.barW = w;
    this.hpGroup = new THREE.Group();
    this.hpGroup.position.y = this.barHeight || (this.centerY + this.radius + 0.6);
    this.hpFill.position.x = -w / 2;
    this.hpGroup.add(this.hpBack, this.hpFill);
    this.hpGroup.visible = false;
    this.group.add(this.hpGroup);
  }

  _updateHealthBar(){
    if (!this.hpGroup) return;
    const f = Utils.clamp(this.hp / this.maxHp, 0, 1);
    this.hpFill.scale.x = this.barW * f;
    const c = f > 0.5 ? 0x4dff88 : (f > 0.25 ? 0xffc23d : 0xff4d5e);
    this.hpFill.material.color.setHex(c);
  }

  /* ---------- damage / death ---------- */
  takeDamage(dmg, atPos){
    if (this.dead) return;
    this.hp -= dmg;
    this.hurtFlash = 0.12;
    this.alerted = true;          // shooting it wakes it up
    if (this.hpGroup) this.hpGroup.visible = true;
    this.game.audio.play("hit");
    if (atPos) this.game.effects.enemyHitSpark(atPos, this.color);
    this._updateHealthBar();
    if (this.hp <= 0) this.die();
  }

  die(){
    if (this.dead) return;
    this.dead = true;
    this.dying = 0.001;
    this.game.audio.play("enemyDeath");
    const scale = this.radius;
    this.game.effects.deathBurst(this.center(), this.color, scale);
    // A small extra explosion for the heavy mech / boss.
    if (this.explodesOnDeath){
      this.game.effects.explosion(this.center(), this.radius * 1.5, this.color);
    }
    this.game.onEnemyKilled(this);
  }

  /* ---------- movement with obstacle avoidance ---------- */
  _move(dir, speed, dt){
    // Wall repulsion: steer away from nearby colliders so enemies flow
    // around obstacles instead of grinding into them.
    const avoid = new THREE.Vector3();
    for (const c of this.game.colliders){
      if (!c.solid) continue;
      const nx = Utils.clamp(this.pos.x, c.minX, c.maxX);
      const nz = Utils.clamp(this.pos.z, c.minZ, c.maxZ);
      const dx = this.pos.x - nx, dz = this.pos.z - nz;
      const d2 = dx * dx + dz * dz;
      const reach = this.radius + 1.6;
      if (d2 < reach * reach && d2 > 1e-4){
        const d = Math.sqrt(d2);
        const strength = (reach - d) / reach;
        avoid.x += (dx / d) * strength;
        avoid.z += (dz / d) * strength;
      }
    }
    const move = dir.clone().multiplyScalar(speed);
    move.x += avoid.x * speed * 0.9;
    move.z += avoid.z * speed * 0.9;

    // Integrate then resolve against colliders (slide).
    let nx = this.pos.x + move.x * dt;
    let nz = this.pos.z + move.z * dt;
    for (const c of this.game.colliders){
      [nx, nz] = c.resolveCircle(nx, nz, this.radius);
    }
    this.pos.x = nx; this.pos.z = nz;
  }

  // Direction toward the player on the XZ plane.
  _toPlayer(){
    const p = this.game.player.position;
    return new THREE.Vector3(p.x - this.pos.x, 0, p.z - this.pos.z);
  }

  _distToPlayer(){
    const p = this.game.player.position;
    return Utils.dist2D(this.pos.x, this.pos.z, p.x, p.z);
  }

  // Fire a projectile (or several) at the player.
  _shoot(spread = 0, count = 1, speedMul = 1){
    const p = this.game.player.position;
    const origin = this.center();
    // Aim slightly toward the eye, with a touch of inaccuracy.
    for (let i = 0; i < count; i++){
      const dir = new THREE.Vector3(p.x - origin.x, p.y - origin.y, p.z - origin.z).normalize();
      const s = spread + (count > 1 ? (i - (count - 1) / 2) * 0.12 : 0);
      dir.x += Utils.rand(-0.04, 0.04) + s;
      dir.y += Utils.rand(-0.03, 0.03);
      dir.normalize();
      this.game.spawnProjectile({
        owner: "enemy", shooter: this, pos: origin.clone(), dir,
        speed: this.projSpeed * speedMul, damage: this.projDamage,
        color: this.color, radius: this.projRadius || 0.22,
        aoe: this.projAoe || 0, life: 5,
      });
    }
    this.game.audio.play("enemyShot");
    this._attackAnim = 0.18;        // trigger attack pose
    if (this.muzzle){
      this.muzzle.material.opacity = 1;
    }
  }

  /* ---------- per-frame AI ---------- */
  update(dt){
    if (this.dying > 0){ this._updateDeath(dt); return; }

    // Hurt flash decay.
    if (this.hurtFlash > 0){
      this.hurtFlash -= dt;
      const k = Math.max(0, this.hurtFlash / 0.12);
      if (this.bodyMat) this.bodyMat.emissiveIntensity = this.baseEmissive + k * 2.5;
    }
    if (this.muzzle && this.muzzle.material.opacity > 0){
      this.muzzle.material.opacity = Math.max(0, this.muzzle.material.opacity - dt * 6);
    }
    if (this._attackAnim > 0) this._attackAnim -= dt;

    const dist = this._distToPlayer();

    // Detection: become alerted within range + line of sight.
    if (!this.alerted){
      if (dist < this.detectRange &&
          !this.game.segmentHitsWall(this.center(), this.game.player.position)){
        this.alerted = true;
        if (this.hpGroup) this.hpGroup.visible = true;
      }
    }

    if (this.alerted){
      this.state = (dist <= this.attackRange) ? "attack" : "chase";
      this._think(dt, dist);
    } else {
      // Idle: gentle drift so they "avoid standing still".
      this._idle(dt);
    }

    // Anti-stuck: if barely moved while chasing, sidestep.
    if (this.alerted){
      const moved = this.pos.distanceTo(this.lastPos);
      if (moved < 0.02 * dt * 60) this.stuckTimer += dt; else this.stuckTimer = 0;
      if (this.stuckTimer > 0.4){ this.strafeDir *= -1; this.stuckTimer = 0; }
    }
    this.lastPos.copy(this.pos);

    // Strafe direction flip timer.
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0){ this.strafeDir *= -1; this.strafeTimer = Utils.rand(1.2, 2.6); }

    // Hover bob for flyers.
    this.bob += dt * 3;

    // Commit transform.
    this._applyTransform(dt);
    this._faceMovementOrPlayer(dt);
    this._updateHealthBar();
  }

  _idle(dt){
    // Slow wander to feel alive (overridden by some types).
    this.bob += dt;
  }

  // Subclasses implement specific tactics here.
  _think(dt, dist){ /* overridden */ }

  _applyTransform(dt){
    // Ground enemies sit on floor; flyers hover with bob.
    if (this.hoverHeight != null){
      this.pos.y = this.hoverHeight + Math.sin(this.bob) * 0.25;
    } else {
      this.pos.y = 0;
    }
    this.group.position.copy(this.pos);
  }

  _faceMovementOrPlayer(dt){
    // Face the player when alerted, else face travel direction.
    let yaw;
    if (this.alerted){
      const d = this._toPlayer();
      yaw = Math.atan2(d.x, d.z);
    } else {
      yaw = Math.atan2(this.vel.x, this.vel.z);
    }
    // Smoothly rotate body toward target yaw.
    const cur = this.group.rotation.y;
    let diff = yaw - cur;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.group.rotation.y = cur + diff * Math.min(1, dt * 8);
  }

  _updateDeath(dt){
    this.dying += dt;
    const t = this.dying / 0.45;
    if (t >= 1){ this.dispose(); return; }
    this.body.scale.setScalar(Math.max(0.01, 1 - t));
    this.group.rotation.y += dt * 10;
    this.group.position.y = this.pos.y + t * 1.2;
    if (this.hpGroup) this.hpGroup.visible = false;
  }

  dispose(){
    this.game.scene.remove(this.group);
    const i = this.game.enemies.indexOf(this);
    if (i >= 0) this.game.enemies.splice(i, 1);
  }
}

/* ================================================================
   DRONE — fast, fragile flyer that kites the player at range.
   ================================================================ */
class Drone extends Enemy {
  constructor(game, pos){
    super(game, pos);
    this.name = "Drone";
    this.maxHp = this.hp = 30;
    this.speed = 8.5;
    this.radius = 0.55;
    this.detectRange = 46;
    this.attackRange = 26;
    this.idealRange = 16;     // tries to hold this distance
    this.fireRate = 1.25;
    this.projDamage = 7;
    this.projSpeed = 34;
    this.projRadius = 0.2;
    this.hoverHeight = 2.2;
    this.centerY = 0;
    this.color = 0xff5ad0;
    this.baseEmissive = 0.6;
    this.barWidth = 1.0;
    this.barHeight = 1.1;
    this._buildModel();
    this._buildHealthBar();
    this.pos.y = this.hoverHeight;
    this.group.position.copy(this.pos);
  }

  _buildModel(){
    this.group = new THREE.Group();
    this.bodyMat = new THREE.MeshStandardMaterial({
      color: this.color, emissive: this.color, emissiveIntensity: this.baseEmissive,
      metalness: 0.5, roughness: 0.35 });
    this.body = new THREE.Group();
    // Central pod + glowing eye.
    const pod = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 0), this.bodyMat);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.6 }));
    eye.position.z = 0.4;
    // Two side fins.
    const finMat = new THREE.MeshStandardMaterial({ color: 0x331030, metalness: 0.6, roughness: 0.4 });
    const finL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.3), finMat);
    finL.position.x = -0.5; const finR = finL.clone(); finR.position.x = 0.5;
    this.muzzle = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTex(), color: this.color, blending: THREE.AdditiveBlending,
      transparent: true, opacity: 0, depthWrite: false }));
    this.muzzle.position.z = 0.55; this.muzzle.scale.setScalar(0.7);
    this.body.add(pod, eye, finL, finR, this.muzzle);
    this.group.add(this.body);
    this.game.scene.add(this.group);
  }

  _idle(dt){ this.group.rotation.y += dt * 0.6; }

  _think(dt, dist){
    const dir = this._toPlayer().normalize();
    // Kite: move away if too close, approach if too far.
    let radial = 0;
    if (dist < this.idealRange - 2) radial = -1;
    else if (dist > this.idealRange + 2) radial = 1;
    const move = dir.clone().multiplyScalar(radial);
    // Strafe perpendicular for evasive flight.
    const perp = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(this.strafeDir * 0.9);
    move.add(perp);
    if (move.lengthSq() > 0) move.normalize();
    this._move(move, this.speed, dt);

    // Fire when roughly in range and LOS clear.
    this.fireCd -= dt;
    if (this.fireCd <= 0 && dist <= this.attackRange &&
        !this.game.segmentHitsWall(this.center(), this.game.player.position)){
      this._shoot(0, 1, 1);
      this.fireCd = this.fireRate + Utils.rand(-0.2, 0.4);
    }
  }
}

/* ================================================================
   TROOPER — grounded soldier; advances, strafes, fires bursts.
   ================================================================ */
class Trooper extends Enemy {
  constructor(game, pos){
    super(game, pos);
    this.name = "Trooper";
    this.maxHp = this.hp = 75;
    this.speed = 4.6;
    this.radius = 0.6;
    this.detectRange = 42;
    this.attackRange = 24;
    this.idealRange = 14;
    this.fireRate = 0.95;
    this.projDamage = 11;
    this.projSpeed = 30;
    this.projRadius = 0.22;
    this.hoverHeight = null;
    this.centerY = 1.1;
    this.color = 0x33e0ff;
    this.baseEmissive = 0.5;
    this.barWidth = 1.3;
    this.barHeight = 2.4;
    this._buildModel();
    this._buildHealthBar();
    this.group.position.copy(this.pos);
  }

  _buildModel(){
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x274a63, metalness: 0.7, roughness: 0.4 });
    this.bodyMat = new THREE.MeshStandardMaterial({
      color: this.color, emissive: this.color, emissiveIntensity: this.baseEmissive,
      metalness: 0.5, roughness: 0.35 });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, 0.5), metal);
    torso.position.y = 1.25;
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.1), this.bodyMat);
    core.position.set(0, 1.3, 0.27);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.35, 0.4), metal);
    head.position.y = 1.85;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.05), this.bodyMat);
    visor.position.set(0, 1.88, 0.2);
    // legs
    const legGeo = new THREE.BoxGeometry(0.26, 0.8, 0.28);
    const legL = new THREE.Mesh(legGeo, metal); legL.position.set(-0.22, 0.4, 0);
    const legR = new THREE.Mesh(legGeo, metal); legR.position.set(0.22, 0.4, 0);
    this.legL = legL; this.legR = legR;
    // arm cannon
    this.arm = new THREE.Group();
    const armBox = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.7), metal);
    armBox.position.z = 0.25;
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.2, 12), this.bodyMat);
    tip.rotation.x = Math.PI / 2; tip.position.z = 0.6;
    this.muzzle = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTex(), color: this.color, blending: THREE.AdditiveBlending,
      transparent: true, opacity: 0, depthWrite: false }));
    this.muzzle.position.z = 0.72; this.muzzle.scale.setScalar(0.6);
    this.arm.add(armBox, tip, this.muzzle);
    this.arm.position.set(0.5, 1.3, 0);

    [torso, head, legL, legR].forEach(m => { m.castShadow = true; });
    this.body.add(torso, core, head, visor, legL, legR, this.arm);
    this.group.add(this.body);
    this.game.scene.add(this.group);
  }

  _idle(dt){ /* stand guard */ }

  _think(dt, dist){
    const dir = this._toPlayer().normalize();
    let radial = 0;
    if (dist > this.idealRange + 2) radial = 1;
    else if (dist < this.idealRange - 3) radial = -0.6;
    const move = dir.clone().multiplyScalar(radial);
    const perp = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(this.strafeDir * 0.7);
    move.add(perp);
    if (move.lengthSq() > 0) move.normalize();
    const moving = radial !== 0 || true;
    this._move(move, this.speed, dt);

    // Walk animation (leg swing) while moving.
    const t = performance.now() * 0.008;
    if (this.legL){ this.legL.rotation.x = Math.sin(t) * 0.5; this.legR.rotation.x = -Math.sin(t) * 0.5; }

    // Point arm at player.
    if (this.arm) this.arm.rotation.x = -Math.atan2(
      (this.game.player.position.y - 1.3), Math.max(2, dist)) ;

    this.fireCd -= dt;
    if (this.fireCd <= 0 && dist <= this.attackRange &&
        !this.game.segmentHitsWall(this.center(), this.game.player.position)){
      this._shoot(0, 1, 1);
      this.fireCd = this.fireRate + Utils.rand(-0.15, 0.35);
    }
  }
}

/* ================================================================
   HEAVY MECH — slow, tanky, fires heavy AoE shells; slams up close.
   ================================================================ */
class HeavyMech extends Enemy {
  constructor(game, pos, boss = false){
    super(game, pos);
    this.isBoss = boss;
    this.name = boss ? "OVERSEER MECH" : "Heavy Mech";
    this.maxHp = this.hp = boss ? 1500 : 280;
    this.speed = boss ? 2.9 : 2.3;
    this.radius = boss ? 1.9 : 1.2;
    this.detectRange = boss ? 90 : 50;
    this.attackRange = boss ? 60 : 30;
    this.idealRange = boss ? 18 : 16;
    this.fireRate = boss ? 1.1 : 1.9;
    this.projDamage = boss ? 20 : 26;
    this.projSpeed = boss ? 30 : 24;
    this.projRadius = boss ? 0.5 : 0.4;
    this.projAoe = boss ? 4.5 : 4.0;
    this.hoverHeight = null;
    this.centerY = boss ? 3.0 : 2.0;
    this.color = boss ? 0xc04dff : 0xff6a2b;
    this.baseEmissive = 0.55;
    this.explodesOnDeath = true;
    this.barWidth = boss ? 3.0 : 1.8;
    this.barHeight = boss ? 6.4 : 4.2;
    this.slamCd = 2.5;
    this.barrageCd = 5;
    this._buildModel(boss);
    this._buildHealthBar();
    this.group.position.copy(this.pos);
    if (boss){
      this.group.scale.setScalar(1.5);
    }
  }

  _buildModel(boss){
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({
      color: boss ? 0x3a1f55 : 0x5a3120, metalness: 0.75, roughness: 0.4 });
    this.bodyMat = new THREE.MeshStandardMaterial({
      color: this.color, emissive: this.color, emissiveIntensity: this.baseEmissive,
      metalness: 0.4, roughness: 0.3 });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.6, 1.2), metal);
    torso.position.y = 2.2;
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 16), this.bodyMat);
    core.position.set(0, 2.3, 0.6);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.7), metal);
    head.position.y = 3.25;
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.1), this.bodyMat);
    eye.position.set(0, 3.3, 0.36);
    // shoulder cannons
    const cannonGeo = new THREE.CylinderGeometry(0.22, 0.26, 1.0, 14);
    this.cannonL = new THREE.Mesh(cannonGeo, metal);
    this.cannonL.rotation.x = Math.PI / 2;
    this.cannonL.position.set(-1.0, 2.6, 0.3);
    this.cannonR = this.cannonL.clone();
    this.cannonR.position.x = 1.0;
    this.muzzle = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTex(), color: this.color, blending: THREE.AdditiveBlending,
      transparent: true, opacity: 0, depthWrite: false }));
    this.muzzle.position.set(0, 2.6, 1.0); this.muzzle.scale.setScalar(1.1);
    // legs
    const legGeo = new THREE.BoxGeometry(0.55, 1.4, 0.6);
    this.legL = new THREE.Mesh(legGeo, metal); this.legL.position.set(-0.5, 0.7, 0);
    this.legR = new THREE.Mesh(legGeo, metal); this.legR.position.set(0.5, 0.7, 0);

    [torso, head, this.legL, this.legR, this.cannonL, this.cannonR].forEach(m => m.castShadow = true);
    this.body.add(torso, core, head, eye, this.cannonL, this.cannonR, this.legL, this.legR, this.muzzle);

    if (boss){
      // A glowing "crown" of spikes to make the boss read as special.
      for (let i = 0; i < 6; i++){
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 8), this.bodyMat);
        const a = (i / 6) * Math.PI * 2;
        spike.position.set(Math.cos(a) * 0.5, 3.7, Math.sin(a) * 0.5);
        this.body.add(spike);
      }
    }

    this.group.add(this.body);
    this.game.scene.add(this.group);

    if (boss) this.game.audio.play("bossRoar");
  }

  _idle(dt){ /* dormant until seen */ }

  _think(dt, dist){
    const dir = this._toPlayer().normalize();
    let radial = dist > this.idealRange ? 1 : (dist < this.idealRange - 4 ? -0.4 : 0);
    const move = dir.clone().multiplyScalar(radial);
    const perp = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(this.strafeDir * (this.isBoss ? 0.5 : 0.25));
    move.add(perp);
    if (move.lengthSq() > 0) move.normalize();
    this._move(move, this.speed, dt);

    // heavy walk wobble
    const t = performance.now() * 0.005;
    if (this.legL){ this.legL.rotation.x = Math.sin(t) * 0.35; this.legR.rotation.x = -Math.sin(t) * 0.35; }

    const losClear = !this.game.segmentHitsWall(this.center(), this.game.player.position);

    // Close-range slam (AoE around the mech).
    this.slamCd -= dt;
    if (dist < 5 && this.slamCd <= 0){
      this._slam();
      this.slamCd = this.isBoss ? 2.2 : 3.2;
      return;
    }

    // Primary fire — heavy AoE shell.
    this.fireCd -= dt;
    if (this.fireCd <= 0 && dist <= this.attackRange && losClear){
      this._shoot(0, 1, 1);
      this.fireCd = this.fireRate + Utils.rand(-0.2, 0.5);
    }

    // Boss barrage: occasional 5-shot spread.
    if (this.isBoss){
      this.barrageCd -= dt;
      if (this.barrageCd <= 0 && dist <= this.attackRange && losClear){
        this._shoot(0, 5, 0.9);
        this.barrageCd = Utils.rand(5, 7);
      }
    }
  }

  _slam(){
    const here = this.center(); here.y = 0.5;
    this.game.effects.explosion(here, this.radius * 2, this.color);
    const d = this._distToPlayer();
    if (d < this.radius + 4){
      this.game.player.takeDamage(this.isBoss ? 32 : 24);
    }
    this.game.shakeCamera(0.6, 0.4);
  }
}
