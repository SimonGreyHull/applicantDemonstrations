/* ================================================================
   game.js — Game
   The orchestrator: WebGL renderer + scene + camera, input handling,
   the state machine (menu / playing / paused / …), level loading and
   cleanup, the main loop, and the combat helpers used by everything
   else (raycasting, projectile spawning, hit/stat tracking).
   ================================================================ */

"use strict";

class Game {
  constructor(){
    // Settings (mirrored by the settings menu; defaults match the HTML).
    this.settings = {
      master: 0.8, music: 0.55, sfx: 0.9,
      sensitivity: 1.0, quality: "medium",
    };

    this.state = "menu";
    this.keys = {};
    this.mouseDown = false;

    // World containers.
    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];
    this.keycards = [];
    this.doors = [];
    this.buttons = [];
    this.colliders = [];
    this.hazards = [];
    this.levelObjects = [];     // walls/floor/lights/sky to clean up
    this.exit = null;

    // Run statistics.
    this.stats = { shots: 0, hits: 0, kills: 0, elapsed: 0, levelStart: 0 };
    this.currentLevel = 0;

    // Camera shake + misc transient state.
    this.shake = { t: 0, mag: 0 };
    this.nearInteractable = null;
    this.interactLabel = "";
    this.hazardAccum = 0;
  }

  /* ============================================================
     INITIALISATION
     ============================================================ */
  init(){
    if (typeof THREE === "undefined"){
      document.body.innerHTML =
        "<div style='color:#fff;padding:40px;font-family:sans-serif'>" +
        "Failed to load Three.js from the CDN. Please check your internet connection and reload.</div>";
      return;
    }

    this.container = document.getElementById("gameContainer");

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: this.settings.quality !== "low" });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // (Left at the default linear output: our procedural canvas textures
    //  and neon emissives look punchiest without the sRGB conversion.)
    this.renderer.setClearColor(0x05080d, 1);
    this.container.appendChild(this.renderer.domElement);
    this.applyQuality();

    // Scene + camera
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      CONFIG.fov, innerWidth / innerHeight, CONFIG.near, CONFIG.far);
    this.scene.add(this.camera);

    // Core systems
    this.audio = new AudioManager();
    this.effects = new Effects(this);
    this.player = new Player(this);
    this.hud = new HUD(this);
    this.menus = new Menus(this);

    this.clock = new THREE.Clock();

    this._bindInput();
    window.addEventListener("resize", () => this._onResize());

    // Start on the main menu.
    this.menus.show("start");
    this.hud.hide();

    // Kick off the render loop.
    this._loop();
  }

  applyQuality(){
    const q = this.settings.quality;
    const pr = q === "low" ? 0.7 : (q === "high" ? Math.min(devicePixelRatio, 2) : 1.0);
    this.renderer.setPixelRatio(pr);
  }

  _onResize(){
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  /* ============================================================
     INPUT
     ============================================================ */
  _bindInput(){
    addEventListener("keydown", (e) => {
      this.keys[e.code] = true;
      if (this.state === "playing"){
        if (e.code === "Digit1") this.player.switchTo(0);
        else if (e.code === "Digit2") this.player.switchTo(1);
        else if (e.code === "Digit3") this.player.switchTo(2);
        else if (e.code === "KeyE") this._tryInteract();
        if (["Space", "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault();
      }
      if (e.code === "Escape" && this.state === "paused") this.resume();
    });
    addEventListener("keyup", (e) => { this.keys[e.code] = false; });

    // Mouse fire (only while pointer-locked & playing).
    addEventListener("mousedown", (e) => {
      if (this.state === "playing" && document.pointerLockElement && e.button === 0){
        this.mouseDown = true;
      }
    });
    addEventListener("mouseup", (e) => { if (e.button === 0) this.mouseDown = false; });

    // Mouse-look via pointer lock movement.
    addEventListener("mousemove", (e) => {
      if (this.state === "playing" && document.pointerLockElement){
        this.player.look(e.movementX || 0, e.movementY || 0);
      }
    });

    // Click the world to (re)lock the pointer while playing.
    this.container.addEventListener("mousedown", () => {
      if (this.state === "playing" && !document.pointerLockElement) this._requestLock();
    });

    // Auto-pause if the pointer lock is lost mid-game (e.g. pressing Esc).
    document.addEventListener("pointerlockchange", () => {
      if (!document.pointerLockElement && this.state === "playing") this.pause();
    });

    // First interaction unlocks audio + starts menu music.
    const firstGesture = () => {
      this.audio.init();
      if (this.state === "menu") this.audio.startMusic("menu");
      removeEventListener("pointerdown", firstGesture);
    };
    addEventListener("pointerdown", firstGesture);
  }

  _requestLock(){
    if (this.container.requestPointerLock) this.container.requestPointerLock();
  }

  _tryInteract(){
    if (!this.nearInteractable) return;
    const o = this.nearInteractable;
    if (o instanceof Door) o.interact(this.player);
    else if (o instanceof Button) o.interact();
  }

  /* ============================================================
     STATE TRANSITIONS
     ============================================================ */
  startGame(){
    this.audio.init();
    this.stats = { shots: 0, hits: 0, kills: 0, elapsed: 0, levelStart: 0 };
    this.currentLevel = 0;
    this.player.resetVitals(true);
    this.loadLevel(0);
    this.state = "playing";
    this.hud.show();
    this.menus.showNone();
    this.audio.startMusic("combat");
    this._requestLock();
  }

  loadLevel(index){
    this.clearLevel();
    this.currentLevel = index;
    // Each level has its own keycard set.
    this.player.keycards = { red: false, blue: false, yellow: false };

    const meta = buildLevel(this, index);
    this.currentMeta = meta;
    this.player.spawn(meta.spawn, meta.spawn.yaw);
    this.player.equipCurrent();
    this.stats.levelStart = this.stats.elapsed;

    this.hud.setLevelInfo(meta.name, meta.objective);
    this.hud.update();
    this.message("ENTERING " + meta.name, "#2ff3ff");
  }

  nextLevel(){
    const next = this.currentLevel + 1;
    if (next >= LEVELS.length){ this.onVictory(); return; }
    this.player.resetVitals(false);   // keep loadout, small heal
    this.loadLevel(next);
    this.state = "playing";
    this.hud.show();
    this.menus.showNone();
    this.audio.startMusic("combat");
    this._requestLock();
  }

  restartLevel(){
    this.player.resetVitals(true);
    this.loadLevel(this.currentLevel);
    this.state = "playing";
    this.hud.show();
    this.menus.showNone();
    this.audio.startMusic("combat");
    this._requestLock();
  }

  completeLevel(){
    if (this.state !== "playing") return;
    this.audio.play("levelComplete");
    if (this.currentLevel >= LEVELS.length - 1){ this.onVictory(); return; }

    this.state = "levelcomplete";
    if (document.exitPointerLock) document.exitPointerLock();
    const t = this.stats.elapsed - this.stats.levelStart;
    this.menus.fillStats("levelStats", [
      ["Sector", this.currentMeta.name],
      ["Time", Utils.formatTime(t)],
      ["Kills", this.stats.kills],
      ["Accuracy", this._accuracy() + "%"],
    ]);
    this.menus.show("levelcomplete");
  }

  onVictory(){
    this.state = "victory";
    if (document.exitPointerLock) document.exitPointerLock();
    this.hud.hide();
    this.audio.stopMusic();
    this.audio.play("victory");
    this.menus.fillStats("victoryStats", [
      ["Sectors cleared", LEVELS.length + " / " + LEVELS.length],
      ["Total time", Utils.formatTime(this.stats.elapsed)],
      ["Total kills", this.stats.kills],
      ["Accuracy", this._accuracy() + "%"],
    ]);
    this.menus.show("victory");
  }

  onPlayerDead(){
    if (this.state !== "playing") return;
    this.state = "gameover";
    this.mouseDown = false;
    if (document.exitPointerLock) document.exitPointerLock();
    this.hud.hide();
    this.audio.stopMusic();
    this.audio.play("gameover");
    this.menus.fillStats("gameoverStats", [
      ["Sector", this.currentMeta.name],
      ["Time survived", Utils.formatTime(this.stats.elapsed)],
      ["Kills", this.stats.kills],
      ["Accuracy", this._accuracy() + "%"],
    ]);
    this.menus.show("gameover");
  }

  pause(){
    if (this.state !== "playing") return;
    this.state = "paused";
    this.mouseDown = false;
    this.menus.show("pause");
  }

  resume(){
    if (this.state !== "paused") return;
    this.state = "playing";
    this.menus.showNone();
    this.hud.show();
    this._requestLock();
  }

  toMainMenu(){
    this.state = "menu";
    this.mouseDown = false;
    if (document.exitPointerLock) document.exitPointerLock();
    this.clearLevel();
    this.hud.hide();
    this.audio.startMusic("menu");
    this.menus.show("start");
  }

  _accuracy(){
    if (this.stats.shots === 0) return 100;
    return Utils.clamp(Math.round(this.stats.hits / this.stats.shots * 100), 0, 100);
  }

  /* ============================================================
     LEVEL CLEANUP
     ============================================================ */
  _dispose(root){
    root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material){
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          // Never dispose the globally-shared glow sprite texture — the
          // persistent effects pool and future levels still need it.
          if (m.map && m.map !== GLOW_TEX) m.map.dispose();
          if (m.dispose) m.dispose();
        });
      }
    });
    this.scene.remove(root);
  }

  clearLevel(){
    for (const e of this.enemies) this._dispose(e.group);
    for (const p of this.projectiles) p.dispose();
    for (const o of this.pickups) this._dispose(o.group);
    for (const k of this.keycards) this._dispose(k.group);
    for (const d of this.doors) this._dispose(d.group);
    for (const b of this.buttons) this._dispose(b.group);
    for (const obj of this.levelObjects) this._dispose(obj);
    if (this.exit) this._dispose(this.exit.group);

    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];
    this.keycards = [];
    this.doors = [];
    this.buttons = [];
    this.colliders = [];
    this.hazards = [];
    this.levelObjects = [];
    this.exit = null;
    this.nearInteractable = null;
    this.hud.hideInteract();
  }

  /* ============================================================
     COMBAT HELPERS
     ============================================================ */
  spawnProjectile(opts){
    this.projectiles.push(new Projectile(this, opts));
  }

  registerShot(){ this.stats.shots++; }
  registerHit(){ this.stats.hits++; this.hud.hitMarker(); }

  onEnemyKilled(enemy){
    this.stats.kills++;
    if (enemy.isBoss) this.message("OVERSEER DESTROYED", "#ff3df0");
    this.hud.update();
  }

  enemiesRemaining(){
    let n = 0;
    for (const e of this.enemies) if (!e.dead) n++;
    return n;
  }

  message(text, color){ this.hud.message(text, color); }

  shakeCamera(mag, dur){
    this.shake.mag = Math.max(this.shake.mag, mag);
    this.shake.t = Math.max(this.shake.t, dur);
  }

  // Ray vs the world: returns the nearest wall or enemy hit.
  raycastWorld(origin, dir, maxDist){
    let best = { type: "none", point: null, enemy: null, dist: maxDist };

    // Walls
    for (const c of this.colliders){
      if (!c.solid) continue;
      const t = this._rayAABB(origin, dir, c);
      if (t != null && t >= 0 && t < best.dist){
        best = { type: "wall", point: origin.clone().addScaledVector(dir, t),
                 enemy: null, dist: t };
      }
    }
    // Enemies
    for (const e of this.enemies){
      if (e.dead) continue;
      const t = this._raySphere(origin, dir, e.center(), e.radius);
      if (t != null && t >= 0 && t < best.dist){
        best = { type: "enemy", point: origin.clone().addScaledVector(dir, t),
                 enemy: e, dist: t };
      }
    }
    return best;
  }

  // Line-of-sight test: does the segment from→to cross any solid wall?
  segmentHitsWall(from, to){
    const dir = new THREE.Vector3().subVectors(to, from);
    const dist = dir.length();
    if (dist < 1e-4) return false;
    dir.multiplyScalar(1 / dist);
    for (const c of this.colliders){
      if (!c.solid) continue;
      const t = this._rayAABB(from, dir, c);
      if (t != null && t > 0.05 && t < dist - 0.05) return true;
    }
    return false;
  }

  // Slab-method ray/AABB. Returns entry distance or null.
  _rayAABB(o, d, box){
    let tmin = -Infinity, tmax = Infinity;
    const axes = [
      [o.x, d.x, box.minX, box.maxX],
      [o.y, d.y, box.minY, box.maxY],
      [o.z, d.z, box.minZ, box.maxZ],
    ];
    for (const [oo, dd, lo, hi] of axes){
      if (Math.abs(dd) < 1e-8){
        if (oo < lo || oo > hi) return null;     // parallel & outside
      } else {
        let t1 = (lo - oo) / dd, t2 = (hi - oo) / dd;
        if (t1 > t2){ const tmp = t1; t1 = t2; t2 = tmp; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return null;
      }
    }
    return tmin >= 0 ? tmin : (tmax >= 0 ? 0 : null);
  }

  // Ray/sphere. Returns nearest positive distance or null.
  _raySphere(o, d, center, r){
    const ox = o.x - center.x, oy = o.y - center.y, oz = o.z - center.z;
    const b = ox * d.x + oy * d.y + oz * d.z;
    const c = ox * ox + oy * oy + oz * oz - r * r;
    const disc = b * b - c;
    if (disc < 0) return null;
    const s = Math.sqrt(disc);
    let t = -b - s;
    if (t < 0) t = -b + s;
    return t >= 0 ? t : null;
  }

  /* ============================================================
     INTERACTION SCAN
     ============================================================ */
  _scanInteractables(){
    const p = this.player.position;
    let best = null, bestDist = CONFIG.interactRange, label = "";
    for (const d of this.doors){
      const dist = d.distanceTo(p);
      if (dist < bestDist){
        bestDist = dist; best = d;
        if (d.open) label = "[E] CLOSE DOOR";
        else if (d.kind === "keycard")
          label = this.player.keycards[d.keycard]
            ? "[E] OPEN (" + d.keycard.toUpperCase() + " KEYCARD)"
            : "[E] LOCKED — " + d.keycard.toUpperCase() + " KEYCARD REQUIRED";
        else if (d.kind === "security" && !d.unlocked) label = "[E] SECURITY LOCK";
        else label = "[E] OPEN DOOR";
      }
    }
    for (const b of this.buttons){
      const dist = b.distanceTo(p);
      if (dist < bestDist){ bestDist = dist; best = b; label = "[E] ACTIVATE CONTROL"; }
    }
    this.nearInteractable = best;
    this.interactLabel = label;
    if (best) this.hud.showInteract(label); else this.hud.hideInteract();
  }

  /* ============================================================
     EXIT + HAZARDS
     ============================================================ */
  _updateExit(dt){
    if (!this.exit) return;
    const ex = this.exit;
    ex.ring.rotation.z += dt * 1.5;
    const pulse = 0.6 + Math.sin(performance.now() * 0.004) * 0.3;
    ex.beam.material.opacity = (ex.active ? 0.22 : 0.12) * pulse;

    if (!ex.active && this.enemiesRemaining() === 0){
      ex.active = true;
      ex.ringMat.color.setHex(0x4dff88);
      ex.padMat.emissive.setHex(0x2dff77);
      ex.beam.material.color.setHex(0x4dff88);
      ex.light.color.setHex(0x4dff88);
      this.audio.play("button");
      this.message("SECTOR CLEAR — EXIT ONLINE", "#4dff88");
      this.hud.setLevelInfo(this.currentMeta.name, "Reach the glowing exit pad");
    }
    if (ex.active){
      if (Utils.dist2D(this.player.position.x, this.player.position.z,
                       ex.pos.x, ex.pos.z) < ex.radius){
        this.completeLevel();
      }
    }
  }

  _updateHazards(dt){
    // Visual shimmer.
    const k = 0.5 + Math.sin(performance.now() * 0.006) * 0.3;
    for (const h of this.hazards) h.mat.emissiveIntensity = k;

    // Damage tick every 0.5s while standing in a hazard.
    this.hazardAccum += dt;
    if (this.hazardAccum < 0.5) return;
    this.hazardAccum = 0;
    if (this.player.feetY > 1.0) return;   // jumping over it is safe
    const px = this.player.position.x, pz = this.player.position.z;
    for (const h of this.hazards){
      if (px >= h.minX && px <= h.maxX && pz >= h.minZ && pz <= h.maxZ){
        this.player.takeDamage(h.dps * 0.5);
        break;
      }
    }
  }

  /* ============================================================
     MAIN LOOP
     ============================================================ */
  _loop(){
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (this.state === "playing"){
      this._update(dt);
    }
    this.renderer.render(this.scene, this.camera);
  }

  _update(dt){
    this.stats.elapsed += dt;

    this.player.update(dt);

    // Enemies (iterate backwards; some may dispose themselves).
    for (let i = this.enemies.length - 1; i >= 0; i--){
      if (this.enemies[i]) this.enemies[i].update(dt);
    }
    // Projectiles (remove dead).
    for (let i = this.projectiles.length - 1; i >= 0; i--){
      const p = this.projectiles[i];
      p.update(dt);
      if (p.dead) this.projectiles.splice(i, 1);
    }
    // Pickups / keycards (may splice themselves on collect).
    for (let i = this.pickups.length - 1; i >= 0; i--) this.pickups[i].update(dt);
    for (let i = this.keycards.length - 1; i >= 0; i--) this.keycards[i].update(dt);
    // Doors / buttons.
    for (const d of this.doors) d.update(dt);
    for (const b of this.buttons) b.update(dt);

    this.effects.update(dt);
    this._updateExit(dt);
    this._updateHazards(dt);
    this._scanInteractables();

    // Camera shake (applied after the player set the camera transform).
    if (this.shake.t > 0){
      this.shake.t -= dt;
      const a = this.shake.mag * Math.min(1, this.shake.t * 3);
      this.camera.position.x += Utils.rand(-a, a);
      this.camera.position.y += Utils.rand(-a, a);
      this.camera.position.z += Utils.rand(-a, a);
      this.camera.rotation.z += Utils.rand(-a, a) * 0.1;
      if (this.shake.t <= 0) this.shake.mag = 0;
    }

    // Keep the HUD enemy counter live.
    this.hud.el.enemyCount.textContent = this.enemiesRemaining();
  }
}

/* ---- Boot ---- */
const game = new Game();
game.init();
