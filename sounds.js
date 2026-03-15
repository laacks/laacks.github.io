// =============================================================
// sounds.js
// Ambient and triggered audio for WebXR scenes.
//
// HOW TO ADD SOUNDS:
// ------------------
// 1. Upload .mp3 files to your GitHub repo (e.g. /sounds/wind.mp3)
// 2. Add an entry to the SOUNDS map below
// 3. Add ambient sounds to AMBIENT_SOUNDS array to auto-play on entry
// 4. Trigger one-shots from any component with:
//      this.el.sceneEl.emit('play-sound', { name: 'sword-pickup' })
//
// FINDING FREE SOUNDS:
// --------------------
// Good royalty-free sources:
//   https://freesound.org         (requires free account)
//   https://mixkit.co/free-sound-effects/
//   https://pixabay.com/sound-effects/
// Download as .mp3, upload to your repo in a /sounds/ folder.
//
// NOTE: Audio only starts after the user enters VR (browser
// autoplay policy requires a user gesture first).
// =============================================================

// -------------------------------------------------------------
// SOUNDS MAP
// Add your sound files here.
// url:    path relative to index.html, or full https:// URL
// loop:   true for ambient, false for one-shots
// volume: 0.0 to 1.0
// -------------------------------------------------------------
const SOUNDS = {
  // -- Ambient loops --
  // Replace these URLs with files uploaded to your /sounds/ folder
  // e.g. 'wind': { url: 'sounds/wind.mp3', loop: true, volume: 0.3 }
  'wind':         { url: 'sounds/wind.mp3',         loop: true,  volume: 0.3  },
  'birds':        { url: 'sounds/birds.mp3',         loop: true,  volume: 0.2  },

  // -- One-shot effects --
  'sword-pickup': { url: 'sounds/sword-pickup.mp3',  loop: false, volume: 0.7  },
  'sword-drop':   { url: 'sounds/sword-drop.mp3',    loop: false, volume: 0.5  },
  'sword-hit':    { url: 'sounds/sword-hit.mp3',     loop: false, volume: 0.6  },
  'jump':         { url: 'sounds/jump.mp3',           loop: false, volume: 0.5  },
  'land':         { url: 'sounds/land.mp3',           loop: false, volume: 0.5  },
  'footstep':     { url: 'sounds/footstep.mp3',       loop: false, volume: 0.4  },
};

// Sounds that play automatically on entering VR
// Only include sounds that have files actually uploaded
const AMBIENT_SOUNDS = ['wind', 'birds'];

// =============================================================
// SCENE-AUDIO COMPONENT — no changes needed below this line
// unless you want to modify playback behaviour
// =============================================================
AFRAME.registerComponent('scene-audio', {
  init: function () {
    this.audioCtx  = null;
    this.buffers   = {};
    this.sources   = {};
    this.gainNodes = {};
    this.ready     = false;

    this.el.sceneEl.addEventListener('enter-vr', () => {
      this._startAudio();
    });

    this.el.sceneEl.addEventListener('loaded', () => {
      // Create audio context early so buffers can preload
      // (actual playback waits for enter-vr user gesture)
      try {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        this._preloadAll();
      } catch(e) {
        console.warn('[sounds.js] Could not create AudioContext:', e);
      }
    });

    this._onPlaySound = (e) => {
      if (e.detail && e.detail.name) this.play(e.detail.name);
    };
    this.el.sceneEl.addEventListener('play-sound', this._onPlaySound);
  },

  remove: function () {
    this._stopAllAmbient();
    this.el.sceneEl.removeEventListener('play-sound', this._onPlaySound);
    if (this.audioCtx) this.audioCtx.close();
  },

  _preloadAll: function () {
    Object.keys(SOUNDS).forEach(name => this._load(name));
  },

  _load: function (name) {
    const def = SOUNDS[name];
    fetch(def.url)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then(buf => this.audioCtx.decodeAudioData(buf))
      .then(decoded => {
        this.buffers[name] = decoded;
        console.log(`[sounds.js] Loaded: ${name}`);
      })
      .catch(err => {
        // Silently skip missing files — scene works fine without them
        console.info(`[sounds.js] Skipping "${name}" (${err.message}) — upload sounds/${name}.mp3 to enable`);
      });
  },

  _startAudio: function () {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      this._preloadAll();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    this.ready = true;
    // Start ambient loops — delay allows buffers to finish loading
    setTimeout(() => {
      AMBIENT_SOUNDS.forEach(name => this._startLoop(name));
    }, 2000);
  },

  _startLoop: function (name) {
    if (!this.buffers[name]) return;
    if (this.sources[name])  return;

    const def  = SOUNDS[name];
    const gain = this.audioCtx.createGain();
    gain.gain.setValueAtTime(0, this.audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(
      def.volume, this.audioCtx.currentTime + 3.0
    );
    gain.connect(this.audioCtx.destination);

    const src  = this.audioCtx.createBufferSource();
    src.buffer = this.buffers[name];
    src.loop   = true;
    src.connect(gain);
    src.start();

    this.sources[name]   = src;
    this.gainNodes[name] = gain;
  },

  _stopAllAmbient: function () {
    AMBIENT_SOUNDS.forEach(name => {
      if (this.sources[name]) {
        try { this.sources[name].stop(); } catch(e) {}
        delete this.sources[name];
        delete this.gainNodes[name];
      }
    });
  },

  play: function (name) {
    if (!this.ready || !this.audioCtx || !this.buffers[name]) return;
    const def  = SOUNDS[name];
    const gain = this.audioCtx.createGain();
    gain.gain.setValueAtTime(def.volume, this.audioCtx.currentTime);
    gain.connect(this.audioCtx.destination);
    const src  = this.audioCtx.createBufferSource();
    src.buffer = this.buffers[name];
    src.loop   = false;
    src.connect(gain);
    src.start();
    src.onended = () => gain.disconnect();
  },

  stopLoop: function (name, fadeDuration) {
    fadeDuration = fadeDuration || 1.5;
    if (!this.gainNodes[name]) return;
    this.gainNodes[name].gain.linearRampToValueAtTime(
      0, this.audioCtx.currentTime + fadeDuration
    );
    setTimeout(() => {
      if (this.sources[name]) {
        try { this.sources[name].stop(); } catch(e) {}
        delete this.sources[name];
        delete this.gainNodes[name];
      }
    }, fadeDuration * 1000);
  }
});
