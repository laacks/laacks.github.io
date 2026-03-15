// =============================================================
// sounds.js
// Ambient and triggered audio for WebXR scenes.
//
// Components:
//   scene-audio   — attach to any entity (usually a-scene or
//                   a dedicated audio entity). Manages ambient
//                   loops and one-shot sound effects.
//
// Usage in scene HTML:
//   <a-entity scene-audio></a-entity>
//
// Sounds are triggered by custom events dispatched on the scene:
//   scene.emit('play-sound', { name: 'sword-pickup' })
//   scene.emit('play-sound', { name: 'footstep' })
//
// To add a new sound:
//   1. Add an entry to the SOUNDS map below with a URL
//   2. Dispatch 'play-sound' with the name from your component
// =============================================================

// -------------------------------------------------------------
// Sound library — add URLs here as sounds become available.
// Using royalty-free sources (freesound.org, mixkit.co etc.)
// Set loop:true for ambient tracks, loop:false for one-shots.
// volume: 0.0 - 1.0
// -------------------------------------------------------------
const SOUNDS = {
  // Ambient loops
  'wind':          { url: 'https://cdn.freesound.org/previews/514/514853_5121236-lq.mp3',  loop: true,  volume: 0.25 },
  'birds':         { url: 'https://cdn.freesound.org/previews/264/264594_4921277-lq.mp3',  loop: true,  volume: 0.18 },
  'leaves':        { url: 'https://cdn.freesound.org/previews/362/362477_6629901-lq.mp3',  loop: true,  volume: 0.12 },

  // One-shots
  'sword-pickup':  { url: 'https://cdn.freesound.org/previews/568/568695_7588446-lq.mp3',  loop: false, volume: 0.7  },
  'sword-drop':    { url: 'https://cdn.freesound.org/previews/411/411090_5121236-lq.mp3',  loop: false, volume: 0.5  },
  'sword-hit':     { url: 'https://cdn.freesound.org/previews/320/320181_2563379-lq.mp3',  loop: false, volume: 0.6  },
  'footstep':      { url: 'https://cdn.freesound.org/previews/336/336598_4939433-lq.mp3',  loop: false, volume: 0.4  },
  'jump':          { url: 'https://cdn.freesound.org/previews/399/399091_4939433-lq.mp3',  loop: false, volume: 0.45 },
  'land':          { url: 'https://cdn.freesound.org/previews/336/336598_4939433-lq.mp3',  loop: false, volume: 0.5  },
};

// Ambient sounds to start automatically on scene load
const AMBIENT_SOUNDS = ['wind', 'birds', 'leaves'];

// -------------------------------------------------------------
// SCENE-AUDIO COMPONENT
// -------------------------------------------------------------
AFRAME.registerComponent('scene-audio', {
  init: function () {
    this.audioCtx    = null;
    this.buffers     = {};   // name → AudioBuffer
    this.sources     = {};   // name → AudioBufferSourceNode (loops)
    this.gainNodes   = {};   // name → GainNode
    this.ready       = false;

    // WebXR requires audio context to be created/resumed after
    // a user gesture. We start everything on enter-vr.
    this.el.sceneEl.addEventListener('enter-vr', () => {
      this._startAudio();
    });

    // Resume if context was suspended (browser autoplay policy)
    this.el.sceneEl.addEventListener('loaded', () => {
      // Pre-load all sound buffers in the background
      // so they're ready when VR starts
      this._preload();
    });

    // Listen for one-shot play requests
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

  // Pre-fetch and decode all audio files
  _preload: function () {
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    const names = Object.keys(SOUNDS);
    names.forEach(name => {
      const def = SOUNDS[name];
      fetch(def.url)
        .then(r => {
          if (!r.ok) throw new Error(`Failed to load sound: ${def.url}`);
          return r.arrayBuffer();
        })
        .then(buf => this.audioCtx.decodeAudioData(buf))
        .then(decoded => {
          this.buffers[name] = decoded;
        })
        .catch(err => {
          console.warn(`[sounds.js] Could not load "${name}":`, err.message);
        });
    });
  },

  // Start ambient loops — called on enter-vr
  _startAudio: function () {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      this._preload();
    }

    // Resume suspended context (required on some browsers)
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    this.ready = true;

    // Start ambient loops after a short delay to let buffers load
    setTimeout(() => {
      AMBIENT_SOUNDS.forEach(name => this._startLoop(name));
    }, 1500);
  },

  // Start a looping ambient sound
  _startLoop: function (name) {
    if (!this.buffers[name]) return; // not loaded yet
    if (this.sources[name]) return;  // already playing

    const def    = SOUNDS[name];
    const gain   = this.audioCtx.createGain();
    gain.gain.setValueAtTime(0, this.audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(
      def.volume, this.audioCtx.currentTime + 3.0 // fade in over 3s
    );
    gain.connect(this.audioCtx.destination);

    const src    = this.audioCtx.createBufferSource();
    src.buffer   = this.buffers[name];
    src.loop     = true;
    src.connect(gain);
    src.start();

    this.sources[name]   = src;
    this.gainNodes[name] = gain;
  },

  // Stop all ambient loops
  _stopAllAmbient: function () {
    AMBIENT_SOUNDS.forEach(name => {
      if (this.sources[name]) {
        try { this.sources[name].stop(); } catch(e) {}
        delete this.sources[name];
      }
    });
  },

  // Play a one-shot sound effect
  play: function (name) {
    if (!this.ready || !this.audioCtx) return;
    if (!this.buffers[name]) {
      console.warn(`[sounds.js] Sound "${name}" not loaded yet`);
      return;
    }

    const def  = SOUNDS[name];
    const gain = this.audioCtx.createGain();
    gain.gain.setValueAtTime(def.volume, this.audioCtx.currentTime);
    gain.connect(this.audioCtx.destination);

    const src  = this.audioCtx.createBufferSource();
    src.buffer = this.buffers[name];
    src.loop   = false;
    src.connect(gain);
    src.start();
    // Clean up after playback
    src.onended = () => { gain.disconnect(); };
  },

  // Fade out and stop a loop (useful for transitions)
  stopLoop: function (name, fadeDuration) {
    fadeDuration = fadeDuration || 1.5;
    if (!this.gainNodes[name]) return;
    const gain = this.gainNodes[name];
    gain.gain.linearRampToValueAtTime(0,
      this.audioCtx.currentTime + fadeDuration);
    setTimeout(() => {
      if (this.sources[name]) {
        try { this.sources[name].stop(); } catch(e) {}
        delete this.sources[name];
        delete this.gainNodes[name];
      }
    }, fadeDuration * 1000);
  }
});
