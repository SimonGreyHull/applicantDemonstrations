/* ================================================================
   player.js — Player
   First-person controller: WASD + mouse-look, jumping, sprinting,
   circle-vs-AABB collision with wall sliding, health/armour/ammo,
   three weapons, recoil and head-bob. The camera *is* the player's
   eye, so `this.position` is the camera world position.
   ================================================================ */

"use strict";

class Player {
  constructor(game){
    this.game = game;
    this.camera = game.camera;

    // Look angles (radians). Euler order YXZ keeps roll at zero.
    this.yaw = 0;
    this.pitch = 0;
    this.recoilPitch = 0;     // transient upward kick from firing

    // Position state
    this.position = new THREE.Vector3(0, CONFIG.eyeHeight, 0);
    this.feetY = 0;
    this.vy = 0;
    this.vel = new THREE.Vector3();   // horizontal velocity (x,z)
    this.onGround = true;
    this.bobPhase = 0;

    // Vitals
    this.health = CONFIG.maxHealth;
    this.armor = 0;

    // Ammo + inventory
    this.ammo = { plasma: 80, rocket: 4 };
    this.maxAmmo = { plasma: 300, rocket: 30 };
    this.keycards = { red: false, blue: false, yellow: false };

    // Weapons
    this.weapons = [new Weapon(game, "pistol"),
                    new Weapon(game, "rifle"),
                    new Weapon(game, "rocket")];
    this.weaponIndex = 0;
    // Weapons start hidden; equipCurrent() is called when a level loads
    // so nothing shows behind the main menu.

    // Damage feedback
    this.damageFlash = 0;
    this.hazardCd = 0;        // throttles environmental-hazard ticks
  }

  /* Reset for a new level/run. */
  resetVitals(full){
    if (full){
      this.health = CONFIG.maxHealth;
      this.armor = 0;
      this.ammo = { plasma: 80, rocket: 4 };
      this.keycards = { red: false, blue: false, yellow: false };
      this.switchTo(0);
    } else {
      // Between levels: keep weapons/ammo, top a little health up.
      this.health = Math.min(CONFIG.maxHealth, this.health + 25);
    }
  }

  spawn(pos, yawDeg){
    this.position.set(pos.x, CONFIG.eyeHeight, pos.z);
    this.feetY = 0; this.vy = 0; this.onGround = true;
    this.vel.set(0, 0, 0);
    this.yaw = (yawDeg || 0) * Math.PI / 180;
    this.pitch = 0; this.recoilPitch = 0;
  }

  get current(){ return this.weapons[this.weaponIndex]; }

  // Show only the active weapon (used on level load).
  equipCurrent(){
    this.weapons.forEach(w => w.hide());
    this.weapons[this.weaponIndex].show();
  }

  switchTo(index){
    if (index < 0 || index >= this.weapons.length) return;
    if (index === this.weaponIndex){ return; }
    this.weapons[this.weaponIndex].hide();
    this.weaponIndex = index;
    this.weapons[index].show();
    this.game.audio.play("switchWeapon");
    this.game.hud.update();
  }

  addRecoil(amount){
    this.recoilPitch += amount * 0.012;   // radians
  }

  giveAmmo(type, amount){
    if (this.ammo[type] == null) return;
    this.ammo[type] = Utils.clamp(this.ammo[type] + amount, 0, this.maxAmmo[type]);
  }

  /* Look input from mouse movement (called by game). */
  look(dx, dy){
    const sens = this.game.settings.sensitivity * 0.0022;
    this.yaw -= dx * sens;
    this.pitch -= dy * sens;
    const lim = Math.PI / 2 - 0.02;
    this.pitch = Utils.clamp(this.pitch, -lim, lim);
  }

  takeDamage(dmg){
    if (this.game.state !== "playing") return;
    // Armour soaks a fraction first.
    if (this.armor > 0){
      const absorbed = Math.min(this.armor, dmg * CONFIG.armorAbsorb);
      this.armor -= absorbed;
      dmg -= absorbed;
    }
    this.health -= dmg;
    this.damageFlash = 1;
    this.game.audio.play("playerHurt");
    this.game.shakeCamera(0.35, 0.25);
    this.game.hud.flashDamage();
    this.game.hud.update();
    if (this.health <= 0){
      this.health = 0;
      this.game.onPlayerDead();
    }
  }

  heal(n){ this.health = Utils.clamp(this.health + n, 0, CONFIG.maxHealth); }

  /* ---------------- per-frame update ---------------- */
  update(dt){
    const k = this.game.keys;

    // --- Build wish direction from WASD relative to yaw ---
    let fwd = 0, strafe = 0;
    if (k["KeyW"]) fwd += 1;
    if (k["KeyS"]) fwd -= 1;
    if (k["KeyD"]) strafe += 1;
    if (k["KeyA"]) strafe -= 1;

    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // Forward vector (−Z is forward when yaw=0).
    const wish = new THREE.Vector3(
      (-sin) * fwd + cos * strafe,
      0,
      (-cos) * fwd + (-sin) * strafe
    );
    const moving = wish.lengthSq() > 0.001;
    if (moving) wish.normalize();

    const sprinting = (k["ShiftLeft"] || k["ShiftRight"]) && fwd > 0;
    const targetSpeed = sprinting ? CONFIG.sprintSpeed : CONFIG.walkSpeed;
    this.sprinting = sprinting && moving;

    // --- Accelerate / friction ---
    const control = this.onGround ? 1 : CONFIG.airControl;
    const desired = wish.clone().multiplyScalar(targetSpeed);
    this.vel.x = Utils.approach(this.vel.x, desired.x, CONFIG.accel * control * dt);
    this.vel.z = Utils.approach(this.vel.z, desired.z, CONFIG.accel * control * dt);
    if (!moving && this.onGround){
      const f = Math.max(0, 1 - CONFIG.friction * dt);
      this.vel.x *= f; this.vel.z *= f;
    }

    // --- Jump + gravity ---
    if (k["Space"] && this.onGround){
      this.vy = CONFIG.jumpSpeed;
      this.onGround = false;
    }
    this.vy -= CONFIG.gravity * dt;
    this.feetY += this.vy * dt;
    if (this.feetY <= 0){ this.feetY = 0; this.vy = 0; this.onGround = true; }

    // --- Horizontal move + collision resolution ---
    let nx = this.position.x + this.vel.x * dt;
    let nz = this.position.z + this.vel.z * dt;
    for (const c of this.game.colliders){
      [nx, nz] = c.resolveCircle(nx, nz, CONFIG.playerRadius);
    }
    this.position.x = nx; this.position.z = nz;

    // --- Head bob ---
    if (moving && this.onGround){
      this.bobPhase += dt * (sprinting ? 14 : 10);
    }
    const bobY = this.onGround ? Math.abs(Math.sin(this.bobPhase)) * (sprinting ? 0.09 : 0.05) : 0;
    this.position.y = this.feetY + CONFIG.eyeHeight + bobY;

    // --- Recoil recovery ---
    this.recoilPitch = Utils.approach(this.recoilPitch, 0, dt * 0.6);

    // --- Apply camera transform ---
    this.camera.position.copy(this.position);
    this.camera.rotation.set(this.pitch + this.recoilPitch, this.yaw, 0, "YXZ");

    // --- Firing (auto-fire while held) ---
    if (this.game.mouseDown){
      this.current.fire(this);
    }
    this.current.update(dt, this, moving, this.sprinting);

    // --- Damage flash decay ---
    if (this.damageFlash > 0) this.damageFlash -= dt * 2.5;
    if (this.hazardCd > 0) this.hazardCd -= dt;
  }
}
