/* ================================================================
   audio.js — AudioManager
   All sound is synthesized live with the Web Audio API; there are no
   audio files. A small bus graph routes everything through three
   gain nodes (master / music / sfx) so the settings sliders work.

      oscillators/noise ─┬─► sfxGain ─┐
                         └─► musicGain ┴─► masterGain ─► destination
   ================================================================ */

"use strict";

class AudioManager {
  constructor(){
    this.ctx = null;
    this.ready = false;

    // Volumes (0..1), updated by the settings menu.
    this.masterVol = 0.8;
    this.musicVol  = 0.55;
    this.sfxVol    = 0.9;

    // Music scheduler state
    this.music = { playing: false, track: null, timer: null, step: 0,
                   nextTime: 0, nodes: [] };
  }

  /* Must be called from a user gesture (button click) to satisfy
     browser autoplay policies. */
  init(){
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();

    this.masterGain = this.ctx.createGain();
    this.musicGain  = this.ctx.createGain();
    this.sfxGain    = this.ctx.createGain();

    this.musicGain.connect(this.masterGain);
    this.sfxGain.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);

    this._applyVolumes();
    this.ready = true;

    // A short, reusable noise buffer for percussive / explosion sounds.
    this.noiseBuffer = this._makeNoise(1.0);
  }

  _applyVolumes(){
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.masterGain.gain.setTargetAtTime(this.masterVol, t, 0.02);
    this.musicGain.gain.setTargetAtTime(this.musicVol * 0.6, t, 0.02);
    this.sfxGain.gain.setTargetAtTime(this.sfxVol, t, 0.02);
  }
  setMaster(v){ this.masterVol = v; this._applyVolumes(); }
  setMusic(v){ this.musicVol = v; this._applyVolumes(); }
  setSfx(v){ this.sfxVol = v; this._applyVolumes(); }

  _makeNoise(seconds){
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /* --------------------------------------------------------------
     Low-level voice helpers
     -------------------------------------------------------------- */

  // A pitched oscillator blip with an ADSR-ish envelope.
  _tone({ type = "sine", freq = 440, freqEnd = null, dur = 0.2,
          gain = 0.5, attack = 0.005, bus = this.sfxGain,
          detune = 0 } = {}){
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(bus);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  // A filtered noise burst (impacts, explosions, mech stomps).
  _noise({ dur = 0.3, gain = 0.6, filterType = "lowpass", freq = 1200,
           freqEnd = null, bus = this.sfxGain, q = 1 } = {}){
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType; filter.frequency.value = freq; filter.Q.value = q;
    if (freqEnd !== null) filter.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter); filter.connect(g); g.connect(bus);
    src.start(t); src.stop(t + dur + 0.02);
  }

  /* --------------------------------------------------------------
     Named sound effects
     -------------------------------------------------------------- */
  play(name){
    if (!this.ready) return;
    switch (name){
      case "pistol":
        this._tone({ type:"square", freq:880, freqEnd:240, dur:0.12, gain:0.28, attack:0.002 });
        this._tone({ type:"sine",   freq:1600, freqEnd:600, dur:0.07, gain:0.12 });
        break;
      case "plasma":
        this._tone({ type:"sawtooth", freq:520, freqEnd:1300, dur:0.13, gain:0.22, attack:0.002 });
        this._tone({ type:"square",   freq:1040, freqEnd:300, dur:0.09, gain:0.10 });
        break;
      case "rocket":
        this._noise({ dur:0.45, gain:0.5, filterType:"lowpass", freq:900, freqEnd:120 });
        this._tone({ type:"sawtooth", freq:160, freqEnd:60, dur:0.4, gain:0.3 });
        break;
      case "explosion":
        this._noise({ dur:0.7, gain:0.85, filterType:"lowpass", freq:1800, freqEnd:60, q:0.6 });
        this._tone({ type:"sine", freq:90, freqEnd:30, dur:0.6, gain:0.5 });
        break;
      case "empty":
        this._tone({ type:"square", freq:160, dur:0.05, gain:0.12 });
        break;
      case "enemyShot":
        this._tone({ type:"sawtooth", freq:300, freqEnd:900, dur:0.12, gain:0.16 });
        break;
      case "hit":           // player landed a hit on an enemy
        this._tone({ type:"square", freq:1400, freqEnd:700, dur:0.05, gain:0.16 });
        break;
      case "enemyDeath":
        this._noise({ dur:0.4, gain:0.4, filterType:"bandpass", freq:800, freqEnd:120, q:1.5 });
        this._tone({ type:"sawtooth", freq:400, freqEnd:60, dur:0.4, gain:0.25 });
        break;
      case "playerHurt":
        this._tone({ type:"sine", freq:220, freqEnd:120, dur:0.25, gain:0.4 });
        this._noise({ dur:0.18, gain:0.2, filterType:"lowpass", freq:600 });
        break;
      case "pickup":
        this._tone({ type:"sine", freq:660, dur:0.09, gain:0.25 });
        this._tone({ type:"sine", freq:990, dur:0.12, gain:0.25, attack:0.005 });
        break;
      case "keycard":
        this._tone({ type:"triangle", freq:520, freqEnd:1040, dur:0.16, gain:0.3 });
        this._tone({ type:"triangle", freq:780, freqEnd:1560, dur:0.18, gain:0.22 });
        break;
      case "doorOpen":
        this._noise({ dur:0.5, gain:0.3, filterType:"lowpass", freq:400, freqEnd:1200 });
        this._tone({ type:"sawtooth", freq:120, freqEnd:240, dur:0.4, gain:0.18 });
        break;
      case "doorLocked":
        this._tone({ type:"square", freq:180, dur:0.1, gain:0.25 });
        this._tone({ type:"square", freq:140, dur:0.14, gain:0.25, attack:0.04 });
        break;
      case "button":
        this._tone({ type:"square", freq:740, freqEnd:1100, dur:0.07, gain:0.22 });
        break;
      case "uiClick":
        this._tone({ type:"square", freq:900, freqEnd:1300, dur:0.05, gain:0.18 });
        break;
      case "uiHover":
        this._tone({ type:"sine", freq:1200, dur:0.03, gain:0.06 });
        break;
      case "levelComplete":
        this._arp([523, 659, 784, 1046], 0.12, 0.3);
        break;
      case "victory":
        this._arp([523, 659, 784, 1046, 1318], 0.16, 0.34);
        break;
      case "gameover":
        this._arp([392, 311, 261, 196], 0.22, 0.34, "sawtooth");
        break;
      case "switchWeapon":
        this._tone({ type:"square", freq:600, freqEnd:1000, dur:0.06, gain:0.16 });
        break;
      case "bossRoar":
        this._noise({ dur:1.0, gain:0.6, filterType:"lowpass", freq:300, freqEnd:60 });
        this._tone({ type:"sawtooth", freq:80, freqEnd:40, dur:1.0, gain:0.5 });
        break;
    }
  }

  // Simple ascending/melodic arpeggio used by UI stingers.
  _arp(freqs, spacing, dur, type = "triangle"){
    if (!this.ready) return;
    freqs.forEach((f, i) => {
      const t = this.ctx.currentTime + i * spacing;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type; osc.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(this.sfxGain);
      osc.start(t); osc.stop(t + dur + 0.02);
    });
  }

  /* --------------------------------------------------------------
     MUSIC — a lightweight step sequencer. Two "tracks":
       "menu"  : calm, spacious
       "combat": driving bassline + arpeggio
     Notes are scheduled a little ahead of time on a timer.
     -------------------------------------------------------------- */
  startMusic(track){
    if (!this.ready) return;
    if (this.music.playing && this.music.track === track) return;
    this.stopMusic();
    this.music.playing = true;
    this.music.track = track;
    this.music.step = 0;
    this.music.nextTime = this.ctx.currentTime + 0.1;
    this._scheduleLoop();
  }

  stopMusic(){
    this.music.playing = false;
    if (this.music.timer){ clearTimeout(this.music.timer); this.music.timer = null; }
  }

  _scheduleLoop(){
    if (!this.music.playing) return;
    const lookahead = 0.25;          // seconds to schedule ahead
    while (this.music.nextTime < this.ctx.currentTime + lookahead){
      this._scheduleStep(this.music.step, this.music.nextTime);
      const bpm = this.music.track === "combat" ? 132 : 84;
      const stepDur = 60 / bpm / 2;  // eighth notes
      this.music.nextTime += stepDur;
      this.music.step = (this.music.step + 1) % 16;
    }
    this.music.timer = setTimeout(() => this._scheduleLoop(), 60);
  }

  _scheduleStep(step, time){
    const isCombat = this.music.track === "combat";
    // Minor-ish scales for a sci-fi feel.
    const bass = isCombat
      ? [55, 55, 82.4, 55, 73.4, 55, 65.4, 55]    // A pattern
      : [49, 0, 65.4, 0, 55, 0, 49, 0];
    const lead = isCombat
      ? [440, 523, 659, 587, 523, 440, 392, 523, 440, 523, 659, 784, 659, 587, 523, 440]
      : [330, 0, 392, 0, 440, 0, 392, 0, 330, 0, 294, 0, 330, 0, 0, 0];

    // Bass (every other step)
    const b = bass[(step >> 1) % bass.length];
    if (b > 0 && step % 2 === 0){
      this._musicNote(b, time, isCombat ? 0.26 : 0.5, "sawtooth", isCombat ? 0.22 : 0.16);
    }
    // Lead arpeggio
    const l = lead[step % lead.length];
    if (l > 0){
      this._musicNote(l, time, isCombat ? 0.14 : 0.28, "triangle", isCombat ? 0.10 : 0.08);
    }
    // Combat kick on the beat
    if (isCombat && step % 4 === 0){
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = "sine"; osc.frequency.setValueAtTime(120, time);
      osc.frequency.exponentialRampToValueAtTime(40, time + 0.12);
      g.gain.setValueAtTime(0.4, time);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
      osc.connect(g); g.connect(this.musicGain);
      osc.start(time); osc.stop(time + 0.2);
    }
  }

  _musicNote(freq, time, dur, type, gain){
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type; osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(gain, time + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(g); g.connect(this.musicGain);
    osc.start(time); osc.stop(time + dur + 0.02);
  }
}
