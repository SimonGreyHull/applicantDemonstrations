/* ================================================================
   hud.js — HUD (in-game overlay) and Menus (screen system)
   HUD pushes player/world state into the DOM each time it changes.
   Menus handles screen switching, button wiring, the settings
   controls and the animated menu starfield.
   ================================================================ */

"use strict";

/* ---------------- In-game HUD ---------------- */
class HUD {
  constructor(game){
    this.game = game;
    this.el = {
      hud: document.getElementById("hud"),
      health: document.getElementById("healthValue"),
      healthBar: document.getElementById("healthBar"),
      armor: document.getElementById("armorValue"),
      armorBar: document.getElementById("armorBar"),
      weaponName: document.getElementById("weaponName"),
      ammoValue: document.getElementById("ammoValue"),
      ammoType: document.getElementById("ammoType"),
      levelName: document.getElementById("levelName"),
      objective: document.getElementById("objective"),
      enemyCount: document.getElementById("enemyCount"),
      messageLog: document.getElementById("messageLog"),
      interact: document.getElementById("interactPrompt"),
      vignette: document.getElementById("damageVignette"),
      lowHealth: document.getElementById("lowHealthPulse"),
      hitMarker: document.getElementById("hitMarker"),
      slots: Array.from(document.querySelectorAll("#weaponSlots .slot")),
      kc: {
        red: document.querySelector(".kc-red"),
        blue: document.querySelector(".kc-blue"),
        yellow: document.querySelector(".kc-yellow"),
      },
    };
    this._hitTimer = null;
  }

  show(){ this.el.hud.classList.remove("hidden"); }
  hide(){ this.el.hud.classList.add("hidden"); }

  setLevelInfo(name, objective){
    this.el.levelName.textContent = name;
    this.el.objective.textContent = objective;
  }

  update(){
    const p = this.game.player;
    if (!p) return;
    const hp = Math.max(0, Math.round(p.health));
    const ar = Math.max(0, Math.round(p.armor));
    this.el.health.textContent = hp;
    this.el.armor.textContent = ar;
    this.el.healthBar.style.width = (hp / CONFIG.maxHealth * 100) + "%";
    this.el.armorBar.style.width = (ar / CONFIG.maxArmor * 100) + "%";

    // Low-health warning pulse.
    if (hp <= 25 && this.game.state === "playing") this.el.lowHealth.classList.add("active");
    else this.el.lowHealth.classList.remove("active");

    // Weapon + ammo.
    const w = p.current;
    this.el.weaponName.textContent = w.def.name;
    if (!w.def.ammoType){
      this.el.ammoValue.textContent = "∞";
      this.el.ammoType.textContent = "";
    } else {
      this.el.ammoValue.textContent = p.ammo[w.def.ammoType];
      this.el.ammoType.textContent = w.def.ammoType.toUpperCase();
    }

    // Weapon slots (active / empty).
    this.el.slots.forEach((s, i) => {
      s.classList.toggle("active", i === p.weaponIndex);
      const def = p.weapons[i].def;
      const empty = def.ammoType && p.ammo[def.ammoType] <= 0;
      s.classList.toggle("empty", !!empty);
    });

    // Keycards.
    for (const c of ["red", "blue", "yellow"]){
      this.el.kc[c].setAttribute("data-have", p.keycards[c] ? "1" : "0");
    }

    // Enemy count.
    this.el.enemyCount.textContent = this.game.enemiesRemaining();
  }

  message(text, color){
    const div = document.createElement("div");
    div.className = "logMsg";
    div.textContent = text;
    if (color) div.style.color = color;
    this.el.messageLog.appendChild(div);
    setTimeout(() => { if (div.parentNode) div.parentNode.removeChild(div); }, 3100);
  }

  flashDamage(){
    this.el.vignette.style.transition = "none";
    this.el.vignette.style.opacity = "1";
    // force reflow then fade
    void this.el.vignette.offsetWidth;
    this.el.vignette.style.transition = "opacity 0.5s ease-out";
    this.el.vignette.style.opacity = "0";
  }

  hitMarker(){
    const hm = this.el.hitMarker;
    hm.classList.remove("show");
    void hm.offsetWidth;
    hm.classList.add("show");
  }

  showInteract(text){
    this.el.interact.textContent = text;
    this.el.interact.classList.remove("hidden");
  }
  hideInteract(){ this.el.interact.classList.add("hidden"); }
}

/* ---------------- Menus / screens ---------------- */
class Menus {
  constructor(game){
    this.game = game;
    this.screens = {
      start: document.getElementById("startScreen"),
      controls: document.getElementById("controlsScreen"),
      credits: document.getElementById("creditsScreen"),
      settings: document.getElementById("settingsScreen"),
      pause: document.getElementById("pauseScreen"),
      levelcomplete: document.getElementById("levelcompleteScreen"),
      gameover: document.getElementById("gameoverScreen"),
      victory: document.getElementById("victoryScreen"),
      loading: document.getElementById("loadingScreen"),
    };
    this.settingsReturn = "start";   // where BACK from settings goes
    this._bindButtons();
    this._bindSettings();
    this._initStarfield();
  }

  hideAll(){
    for (const k in this.screens) this.screens[k].classList.add("hidden");
  }

  show(name){
    this.hideAll();
    if (this.screens[name]) this.screens[name].classList.remove("hidden");
    // Starfield shows behind menus only (not loading during play).
    const showFx = ["start", "controls", "credits", "settings", "victory", "gameover"].includes(name);
    document.getElementById("menuFx").classList.toggle("show", showFx);
  }

  showNone(){
    this.hideAll();
    document.getElementById("menuFx").classList.remove("show");
  }

  _bindButtons(){
    const handlers = {
      start: () => this.game.startGame(),
      settings: () => { this.settingsReturn = "start"; this.show("settings"); },
      controls: () => this.show("controls"),
      credits: () => this.show("credits"),
      back: () => this.show("start"),
      settingsBack: () => this.show(this.settingsReturn),
      resume: () => this.game.resume(),
      restart: () => this.game.restartLevel(),
      settingsFromPause: () => { this.settingsReturn = "pause"; this.show("settings"); },
      toMenu: () => this.game.toMainMenu(),
      continue: () => this.game.nextLevel(),
      retry: () => this.game.restartLevel(),
      playAgain: () => this.game.startGame(),
    };
    document.querySelectorAll("[data-action]").forEach(btn => {
      const action = btn.getAttribute("data-action");
      btn.addEventListener("click", () => {
        this.game.audio.init();
        this.game.audio.play("uiClick");
        if (handlers[action]) handlers[action]();
      });
      btn.addEventListener("mouseenter", () => this.game.audio.play("uiHover"));
    });
  }

  _bindSettings(){
    const s = this.game.settings;
    const bind = (id, valId, fn, fmt) => {
      const input = document.getElementById(id);
      const label = document.getElementById(valId);
      const apply = () => {
        const v = parseInt(input.value, 10);
        fn(v);
        if (label) label.textContent = fmt ? fmt(v) : v;
      };
      input.addEventListener("input", () => { apply(); });
      apply();
    };
    bind("setMaster", "setMasterVal", v => { s.master = v/100; this.game.audio.setMaster(s.master); });
    bind("setMusic",  "setMusicVal",  v => { s.music  = v/100; this.game.audio.setMusic(s.music); });
    bind("setSfx",    "setSfxVal",    v => { s.sfx    = v/100; this.game.audio.setSfx(s.sfx); });
    bind("setSens",   "setSensVal",   v => { s.sensitivity = v/100; },
         v => (v/100).toFixed(2));

    const quality = document.getElementById("setQuality");
    quality.addEventListener("change", () => {
      s.quality = quality.value;
      this.game.applyQuality();
    });
    s.quality = quality.value;
  }

  fillStats(id, rows){
    const el = document.getElementById(id);
    el.innerHTML = rows.map(r => `<div class="row"><span>${r[0]}</span><b>${r[1]}</b></div>`).join("");
  }

  /* Animated starfield drawn on the #menuFx canvas behind menus. */
  _initStarfield(){
    this.fx = document.getElementById("menuFx");
    this.fxCtx = this.fx.getContext("2d");
    this.stars = [];
    const resize = () => { this.fx.width = innerWidth; this.fx.height = innerHeight; };
    resize(); window.addEventListener("resize", resize);
    for (let i = 0; i < 160; i++){
      this.stars.push({
        x: Math.random(), y: Math.random(),
        z: Math.random() * 0.9 + 0.1,
        hue: Utils.choice([190, 300, 90, 330]),
      });
    }
    const loop = () => {
      requestAnimationFrame(loop);
      if (!this.fx.classList.contains("show")) return;
      const ctx = this.fxCtx, W = this.fx.width, H = this.fx.height;
      ctx.clearRect(0, 0, W, H);
      for (const st of this.stars){
        st.y += st.z * 0.0009;
        if (st.y > 1) st.y = 0;
        const x = st.x * W, y = st.y * H, r = st.z * 1.8;
        ctx.beginPath();
        ctx.fillStyle = `hsla(${st.hue},90%,70%,${0.3 + st.z * 0.5})`;
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    loop();
  }
}
