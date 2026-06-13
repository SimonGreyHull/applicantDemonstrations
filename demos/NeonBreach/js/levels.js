/* ================================================================
   levels.js — LevelBuilder + three level definitions
   The builder offers a small, declarative API (addWall, addDoor,
   spawnEnemy, …) that creates meshes, colliders and entities and
   registers them with the Game so they can be cleared on transition.
   Everything is procedural — geometry, textures, lights and sky.
   ================================================================ */

"use strict";

class LevelBuilder {
  constructor(game){
    this.game = game;
    this.meta = { name: "SECTOR", objective: "Eliminate all hostiles",
                  spawn: { x: 0, z: 0, yaw: 0 } };
    this.theme = null;
  }

  /* ---- helper: track a scene object for later cleanup ---- */
  _track(obj){ this.game.scene.add(obj); this.game.levelObjects.push(obj); return obj; }

  /* ---- theme: sky, fog, lights, shared textures ---- */
  setTheme(t){
    this.theme = t;
    const scene = this.game.scene;

    // Gradient sky dome (BackSide sphere with a vertical colour ramp).
    const skyGeo = new THREE.SphereGeometry(420, 24, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: {
        top:    { value: new THREE.Color(t.skyTop) },
        bottom: { value: new THREE.Color(t.skyBottom) },
        exponent: { value: 0.6 },
      },
      vertexShader: `
        varying vec3 vPos;
        void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        varying vec3 vPos; uniform vec3 top; uniform vec3 bottom; uniform float exponent;
        void main(){
          float h = normalize(vPos).y * 0.5 + 0.5;
          float k = pow(clamp(h,0.0,1.0), exponent);
          gl_FragColor = vec4(mix(bottom, top, k), 1.0);
        }`,
    });
    this._track(new THREE.Mesh(skyGeo, skyMat));

    scene.fog = new THREE.Fog(t.fog, 30, 160);

    // Ambient + hemisphere give the colourful base wash.
    this._track(new THREE.AmbientLight(t.ambient, 0.5));
    const hemi = new THREE.HemisphereLight(t.skyTop, t.floorTint || 0x101018, 0.7);
    this._track(hemi);

    // One shadow-casting directional "sun".
    const sun = new THREE.DirectionalLight(t.sun || 0xffffff, 0.9);
    sun.position.set(40, 80, 30);
    sun.castShadow = true;
    const q = this.game.settings.quality;
    const sm = q === "low" ? 1024 : (q === "high" ? 4096 : 2048);
    sun.shadow.mapSize.set(sm, sm);
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 220;
    const r = 80;
    sun.shadow.camera.left = -r; sun.shadow.camera.right = r;
    sun.shadow.camera.top = r; sun.shadow.camera.bottom = -r;
    sun.shadow.bias = -0.0006;
    this._track(sun);

    // Cache textures for this theme.
    this._floorTex = Tex.floor(t.floorBase, t.floorLine, 8);
    this._wallTex  = Tex.wall(t.wallBase, t.wallLine, t.accent);
  }

  /* ---- floor (one big plane sized to the arena) ---- */
  addFloor(minX, maxX, minZ, maxZ){
    const w = maxX - minX, d = maxZ - minZ;
    const tex = this._floorTex.clone();
    tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(w / 4, d / 4);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0.1 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    floor.receiveShadow = true;
    this._track(floor);
    this.bounds = { minX, maxX, minZ, maxZ };
  }

  /* ---- a solid wall (mesh + collider) ---- */
  addWall(cx, cz, w, d, h = 7){
    const tex = this._wallTex.clone();
    tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(Math.max(1, Math.max(w, d) / 3), Math.max(1, h / 3));
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, metalness: 0.2 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(cx, h / 2, cz);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this._track(mesh);
    const c = new AABB(cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2, 0, h);
    this.game.colliders.push(c);
    return mesh;
  }

  /* ---- outer boundary made of four walls ---- */
  addBoundary(minX, maxX, minZ, maxZ, h = 9){
    const t = 1.5;
    const w = maxX - minX, d = maxZ - minZ;
    this.addWall((minX + maxX) / 2, minZ - t / 2, w + t * 2, t, h);
    this.addWall((minX + maxX) / 2, maxZ + t / 2, w + t * 2, t, h);
    this.addWall(minX - t / 2, (minZ + maxZ) / 2, t, d, h);
    this.addWall(maxX + t / 2, (minZ + maxZ) / 2, t, d, h);
  }

  /* ---- coloured accent point light ---- */
  addLight(x, y, z, color, intensity = 1, dist = 22){
    const l = new THREE.PointLight(color, intensity, dist, 2);
    l.position.set(x, y, z);
    this._track(l);
    return l;
  }

  /* ---- environmental hazard (damaging floor zone) ---- */
  addHazard(minX, maxX, minZ, maxZ, dps = 14){
    const w = maxX - minX, d = maxZ - minZ;
    const tex = Tex.hazard("#ff5a3d", "#1a0804");
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(w / 3, d / 3);
    const mat = new THREE.MeshStandardMaterial({
      map: tex, emissive: 0xff5a3d, emissiveIntensity: 0.7, roughness: 0.6 });
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set((minX + maxX) / 2, 0.04, (minZ + maxZ) / 2);
    this._track(pool);
    this.addLight((minX + maxX) / 2, 1.5, (minZ + maxZ) / 2, 0xff5a3d, 0.8, 14);
    this.game.hazards.push({ minX, maxX, minZ, maxZ, dps, mat });
  }

  /* ---- doors & buttons ---- */
  addDoor(opts){ const d = new Door(this.game, opts); this.game.doors.push(d); return d; }
  addButton(opts){ const b = new Button(this.game, opts); this.game.buttons.push(b); return b; }

  /* ---- pickups & keycards ---- */
  addPickup(type, x, z, respawn = 0){
    this.game.pickups.push(new Pickup(this.game, type, new THREE.Vector3(x, 1.1, z), respawn));
  }
  addKeycard(color, x, z){
    this.game.keycards.push(new Keycard(this.game, color, new THREE.Vector3(x, 1.2, z)));
  }

  /* ---- enemies ---- */
  spawnEnemy(type, x, z){
    const p = { x, z };
    let e;
    if (type === "drone") e = new Drone(this.game, p);
    else if (type === "trooper") e = new Trooper(this.game, p);
    else if (type === "mech") e = new HeavyMech(this.game, p, false);
    else if (type === "boss") e = new HeavyMech(this.game, p, true);
    if (e) this.game.enemies.push(e);
    return e;
  }

  /* ---- exit pad (activates once the sector is clear) ---- */
  setExit(x, z){
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const padMat = new THREE.MeshStandardMaterial({
      color: 0x113322, emissive: 0x115533, emissiveIntensity: 0.6, roughness: 0.5 });
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.2, 32), padMat);
    pad.position.y = 0.1;
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff4d5e, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.12, 8, 40), ringMat);
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.3;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.2, 12, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff4d5e, transparent: true, opacity: 0.12,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
    beam.position.y = 6;
    group.add(pad, ring, beam);
    this._track(group);
    const light = this.addLight(x, 2, z, 0xff4d5e, 1.2, 16);
    this.game.exit = {
      group, ring, ringMat, beam, light, pad, padMat,
      pos: new THREE.Vector3(x, 0, z), radius: 2.8, active: false,
    };
  }
}

/* ================================================================
   LEVEL 1 — RESEARCH FACILITY
   Tutorial: a few weak enemies, health pickups, one keycard door.
   ================================================================ */
function buildLevel1(b){
  b.meta.name = "RESEARCH FACILITY";
  b.meta.objective = "Find the BLUE keycard, clear hostiles, reach the exit.";
  b.meta.spawn = { x: 0, z: 22, yaw: 0 };

  b.setTheme({
    skyTop: 0x1f6fae, skyBottom: 0x07131f, fog: 0x0a1622, ambient: 0x335577,
    sun: 0xcfeeff, wallBase: "#17324d", wallLine: "#214a70", accent: "#2ff3ff",
    floorBase: "#0a1622", floorLine: "#2ff3ff", floorTint: 0x0a1622,
  });

  const X0 = -24, X1 = 24, Z0 = -28, Z1 = 24;
  b.addFloor(X0, X1, Z0, Z1);
  b.addBoundary(X0, X1, Z0, Z1, 8);

  // Cover blocks in the main hall.
  b.addWall(-8, 8, 3, 3, 2.6);
  b.addWall(8, 8, 3, 3, 2.6);
  b.addWall(-11, -4, 3, 6, 3);
  b.addWall(11, -4, 3, 6, 3);
  b.addWall(0, 2, 2.2, 2.2, 4);

  // Vault room (north) holding the exit, gated by a blue keycard door.
  b.addWall(-10, -23, 1, 10, 8);     // left vault wall
  b.addWall(10, -23, 1, 10, 8);      // right vault wall
  b.addWall(-6.25, -18, 7.5, 1, 8);  // front-left segment
  b.addWall(6.25, -18, 7.5, 1, 8);   // front-right segment
  b.addDoor({ pos: { x: 0, z: -18 }, axis: "x", width: 5, height: 8,
              thickness: 0.6, kind: "keycard", keycard: "blue" });

  // Accent lighting.
  b.addLight(0, 5, 18, 0x2ff3ff, 1.0, 26);
  b.addLight(0, 5, -22, 0x4dff88, 1.2, 22);
  b.addLight(-18, 5, 0, 0xff3df0, 0.8, 22);
  b.addLight(18, 5, 0, 0xff3df0, 0.8, 22);

  // The blue keycard sits in the open so the player learns to grab it.
  b.addKeycard("blue", 18, -10);

  // Enemies — gentle introduction.
  b.spawnEnemy("drone", -12, 4);
  b.spawnEnemy("drone", 12, 0);
  b.spawnEnemy("drone", 0, -8);
  b.spawnEnemy("trooper", -6, -10);
  b.spawnEnemy("trooper", 7, -12);

  // Pickups.
  b.addPickup("health", -18, 16, 18);
  b.addPickup("health", 16, 14);
  b.addPickup("ammo", 0, 16, 22);
  b.addPickup("armor", 16, -14);

  b.setExit(0, -23);
}

/* ================================================================
   LEVEL 2 — INDUSTRIAL COMPLEX
   Larger; a button-operated security door, a red keycard door,
   environmental hazards and a heavy mech.
   ================================================================ */
function buildLevel2(b){
  b.meta.name = "INDUSTRIAL COMPLEX";
  b.meta.objective = "Open the security gate, grab the RED keycard, reach the exit.";
  b.meta.spawn = { x: 0, z: 24, yaw: 0 };

  b.setTheme({
    skyTop: 0xff8a3d, skyBottom: 0x140a05, fog: 0x1a0f08, ambient: 0x664433,
    sun: 0xffd9a8, wallBase: "#3a2418", wallLine: "#5a3a22", accent: "#ff8a2b",
    floorBase: "#161008", floorLine: "#ff8a2b", floorTint: 0x161008,
  });

  const X0 = -32, X1 = 32, Z0 = -44, Z1 = 28;
  b.addFloor(X0, X1, Z0, Z1);
  b.addBoundary(X0, X1, Z0, Z1, 9);

  // Central divider with a security door (opened by a button in the south).
  b.addWall(-17.5, 0, 29, 1.2, 9);   // left of gap
  b.addWall(17.5, 0, 29, 1.2, 9);    // right of gap
  b.addDoor({ pos: { x: 0, z: 0 }, axis: "x", width: 6, height: 9,
              thickness: 0.7, kind: "security", id: "sec2" });
  b.addButton({ pos: { x: 9, y: 1.5, z: 1.2 }, targetId: "sec2" });

  // South staging area cover.
  b.addWall(-12, 14, 3, 3, 3);
  b.addWall(12, 14, 3, 3, 3);
  b.addWall(0, 10, 4, 2, 3);

  // North industrial hall: hazards + machinery cover.
  b.addWall(-14, -16, 4, 4, 4);
  b.addWall(14, -16, 4, 4, 4);
  b.addWall(0, -22, 6, 2, 4);
  b.addHazard(-22, -12, -22, -10, 16);
  b.addHazard(12, 22, -26, -14, 16);

  // Exit vault (far north) behind a RED keycard door.
  b.addWall(-10, -39, 1, 10, 9);
  b.addWall(10, -39, 1, 10, 9);
  b.addWall(-7, -34, 6, 1, 9);
  b.addWall(7, -34, 6, 1, 9);
  b.addDoor({ pos: { x: 0, z: -34 }, axis: "x", width: 6, height: 9,
              thickness: 0.7, kind: "keycard", keycard: "red" });

  // Lights.
  b.addLight(0, 6, 16, 0xff8a2b, 1.0, 30);
  b.addLight(-20, 6, -20, 0xff3df0, 0.9, 26);
  b.addLight(20, 6, -20, 0x2ff3ff, 0.9, 26);
  b.addLight(0, 6, -38, 0x4dff88, 1.2, 22);

  // Red keycard tucked in a north corner.
  b.addKeycard("red", -26, -30);

  // Enemies — south.
  b.spawnEnemy("drone", -10, 16);
  b.spawnEnemy("drone", 10, 12);
  b.spawnEnemy("drone", 0, 4);
  b.spawnEnemy("trooper", -14, 6);
  b.spawnEnemy("trooper", 14, 8);
  // Enemies — north.
  b.spawnEnemy("trooper", -8, -12);
  b.spawnEnemy("trooper", 8, -10);
  b.spawnEnemy("drone", -18, -28);
  b.spawnEnemy("drone", 18, -30);
  b.spawnEnemy("mech", 0, -26);

  // Pickups.
  b.addPickup("health", -28, 22, 20);
  b.addPickup("health", 28, 18);
  b.addPickup("ammo", 0, 20, 18);
  b.addPickup("ammo", -28, -8, 24);
  b.addPickup("armor", 26, 6);
  b.addPickup("armor", 0, -16);

  b.setExit(0, -39);
}

/* ================================================================
   LEVEL 3 — REACTOR CORE
   Three keycard doors in sequence (yellow → blue → red), large
   encounters, environmental hazards and a boss Heavy Mech.
   ================================================================ */
function buildLevel3(b){
  b.meta.name = "REACTOR CORE";
  b.meta.objective = "Breach the core (YELLOW→BLUE→RED) and destroy the Overseer.";
  b.meta.spawn = { x: 0, z: 26, yaw: 0 };

  b.setTheme({
    skyTop: 0xb43dff, skyBottom: 0x10041c, fog: 0x150820, ambient: 0x442266,
    sun: 0xffd0ff, wallBase: "#2a1540", wallLine: "#46266e", accent: "#ff3df0",
    floorBase: "#150820", floorLine: "#ff3df0", floorTint: 0x150820,
  });

  const X0 = -36, X1 = 36, Z0 = -52, Z1 = 30;
  b.addFloor(X0, X1, Z0, Z1);
  b.addBoundary(X0, X1, Z0, Z1, 10);

  // Three dividers, each with a coloured keycard door.
  const divider = (z, color) => {
    b.addWall(-19.5, z, 33, 1.2, 10);
    b.addWall(19.5, z, 33, 1.2, 10);
    b.addDoor({ pos: { x: 0, z }, axis: "x", width: 6, height: 10,
                thickness: 0.7, kind: "keycard", keycard: color });
  };
  divider(8,  "yellow");   // south → mid
  divider(-12, "blue");    // mid → antechamber
  divider(-30, "red");     // antechamber → reactor

  // Cover throughout.
  b.addWall(-12, 18, 3, 3, 3); b.addWall(12, 18, 3, 3, 3);
  b.addWall(-14, -2, 3, 3, 3); b.addWall(14, -2, 3, 3, 3);
  b.addWall(0, -4, 4, 2, 3);
  b.addWall(-12, -22, 3, 3, 3); b.addWall(12, -22, 3, 3, 3);

  // Reactor hazards near the core.
  b.addHazard(-30, -22, -48, -34, 18);
  b.addHazard(22, 30, -48, -34, 18);

  // The reactor column (decorative, also cover) at the core centre.
  const col = new THREE.Mesh(
    new THREE.CylinderGeometry(2, 2.4, 12, 24),
    new THREE.MeshStandardMaterial({ color: 0x3a1060, emissive: 0xff3df0,
      emissiveIntensity: 0.8, metalness: 0.6, roughness: 0.3 }));
  col.position.set(0, 6, -50.5);
  b._track(col);
  b.game.colliders.push(new AABB(-2.4, 2.4, -52.9, -48.1, 0, 12));
  b.addLight(0, 8, -48, 0xff3df0, 1.6, 36);

  // Keycards — one per gated zone (collected in order).
  b.addKeycard("yellow", -28, 20);
  b.addKeycard("blue",   28, -4);
  b.addKeycard("red",    -28, -22);

  // Atmosphere lights.
  b.addLight(0, 7, 18, 0xff3df0, 1.0, 30);
  b.addLight(-24, 7, 0, 0x2ff3ff, 0.9, 28);
  b.addLight(24, 7, -2, 0x4dff88, 0.9, 28);

  // Encounters — south.
  b.spawnEnemy("drone", -12, 18);
  b.spawnEnemy("drone", 12, 16);
  b.spawnEnemy("trooper", -16, 10);
  b.spawnEnemy("trooper", 16, 12);
  // Mid.
  b.spawnEnemy("drone", -10, 0);
  b.spawnEnemy("drone", 10, -2);
  b.spawnEnemy("trooper", 0, -6);
  b.spawnEnemy("mech", -14, -6);
  // Antechamber.
  b.spawnEnemy("trooper", -10, -20);
  b.spawnEnemy("trooper", 10, -22);
  b.spawnEnemy("drone", 0, -18);
  b.spawnEnemy("mech", 14, -24);
  // Reactor / boss arena.
  b.spawnEnemy("boss", 0, -44);
  b.spawnEnemy("drone", -16, -42);
  b.spawnEnemy("drone", 16, -42);

  // Pickups (several respawn since the run is long).
  b.addPickup("health", -30, 24, 16);
  b.addPickup("health", 30, 22, 16);
  b.addPickup("ammo",   0, 22, 14);
  b.addPickup("ammo",   -30, 2, 18);
  b.addPickup("armor",  30, 0, 22);
  b.addPickup("health", 0, -14, 16);
  b.addPickup("ammo",   -30, -20, 16);
  b.addPickup("armor",  30, -22, 22);
  b.addPickup("health", -16, -38, 14);
  b.addPickup("ammo",   16, -38, 12);

  b.setExit(0, -38);
}

/* ---- registry + dispatcher ---- */
const LEVELS = [buildLevel1, buildLevel2, buildLevel3];

function buildLevel(game, index){
  const b = new LevelBuilder(game);
  LEVELS[index](b);
  return b.meta;
}
