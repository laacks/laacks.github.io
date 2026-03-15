// =============================================================
// interactables.js
// Self-contained interactable objects for WebXR scenes.
// Each component includes its own 3D geometry and behavior.
//
// Current objects:
//   sword-in-stone  — glowing sword embedded in a stone block.
//                     Right trigger within grabDist picks it up.
//                     Releasing trigger returns it home.
//
// To add the sword to a scene:
//   <a-entity sword-in-stone="position: 0 1.65 -7.5"></a-entity>
//
// Future objects can be added here following the same pattern.
// =============================================================

// -------------------------------------------------------------
// SWORD IN STONE
// A glowing sword embedded in a stone block.
// Self-contained: builds its own geometry on init.
// -------------------------------------------------------------
AFRAME.registerComponent('sword-in-stone', {
  schema: {
    position: { type: 'vec3', default: { x: 0, y: 0.9, z: -7.5 } },
    grabDist:  { default: 0.6 }
  },

  init: function () {
    this.held        = false;
    this.triggerDown = false;
    this.controller  = null;
    this.swordEl     = null;
    this.homePos     = null;
    this.homeRot     = null;

    // Position this entity
    this.el.object3D.position.set(
      this.data.position.x,
      this.data.position.y,
      this.data.position.z
    );

    // Build stone block
    const stone = document.createElement('a-box');
    stone.setAttribute('position', '0 0 0');
    stone.setAttribute('width',  '0.7');
    stone.setAttribute('height', '0.65');
    stone.setAttribute('depth',  '0.7');
    stone.setAttribute('color',  '#888070');
    stone.setAttribute('material', 'roughness: 1');
    this.el.appendChild(stone);

    // Build sword entity (sits above stone)
    const sword = document.createElement('a-entity');
    sword.setAttribute('position', '0 0.95 0');
    this.el.appendChild(sword);
    this.swordEl = sword;

    // Blade
    const blade = document.createElement('a-box');
    blade.setAttribute('position', '0 0.5 0');
    blade.setAttribute('width',  '0.06');
    blade.setAttribute('height', '1.2');
    blade.setAttribute('depth',  '0.02');
    blade.setAttribute('color',  '#d0d8e0');
    blade.setAttribute('material',
      'roughness: 0.1; metalness: 0.9; emissive: #aabbcc; emissiveIntensity: 0.3');
    blade.setAttribute('animation',
      'property: material.emissiveIntensity; from: 0.3; to: 0.9; ' +
      'dur: 1500; dir: alternate; loop: true; easing: easeInOutSine');
    sword.appendChild(blade);

    // Crossguard
    const guard = document.createElement('a-box');
    guard.setAttribute('position', '0 0 0');
    guard.setAttribute('width',  '0.35');
    guard.setAttribute('height', '0.05');
    guard.setAttribute('depth',  '0.05');
    guard.setAttribute('color',  '#c8a030');
    guard.setAttribute('material', 'roughness: 0.3; metalness: 0.8');
    sword.appendChild(guard);

    // Handle
    const handle = document.createElement('a-cylinder');
    handle.setAttribute('position', '0 -0.22 0');
    handle.setAttribute('radius', '0.03');
    handle.setAttribute('height', '0.4');
    handle.setAttribute('color',  '#6a3a18');
    handle.setAttribute('material', 'roughness: 0.9');
    sword.appendChild(handle);

    // Pommel
    const pommel = document.createElement('a-sphere');
    pommel.setAttribute('position', '0 -0.44 0');
    pommel.setAttribute('radius', '0.055');
    pommel.setAttribute('color',  '#c8a030');
    pommel.setAttribute('material', 'roughness: 0.3; metalness: 0.8');
    sword.appendChild(pommel);

    // Altar glow light
    const light = document.createElement('a-light');
    light.setAttribute('type',      'point');
    light.setAttribute('color',     '#ffdd88');
    light.setAttribute('intensity', '0.6');
    light.setAttribute('distance',  '5');
    light.setAttribute('position',  '0 1.5 0');
    light.setAttribute('animation',
      'property: intensity; from: 0.4; to: 0.9; ' +
      'dur: 2500; dir: alternate; loop: true; easing: easeInOutSine');
    this.el.appendChild(light);

    // Find right controller after scene loads
    this.el.sceneEl.addEventListener('loaded', () => {
      setTimeout(() => {
        this.controller = document.querySelector('#rc');
        this.homePos    = this.swordEl.object3D.position.clone();
        this.homeRot    = this.swordEl.object3D.rotation.clone();
      }, 600);
    });
  },

  tick: function () {
    if (!this.controller || !this.swordEl || !this.homePos) return;

    // Read right trigger
    let trig = false;
    const session = this.el.sceneEl.xrSession;
    if (session) {
      for (const src of session.inputSources) {
        if (src.handedness === 'right' && src.gamepad) {
          const b = src.gamepad.buttons[0];
          if (b && b.value > 0.5) trig = true;
        }
      }
    }

    const sp = new THREE.Vector3();
    const cp = new THREE.Vector3();
    this.swordEl.object3D.getWorldPosition(sp);
    this.controller.object3D.getWorldPosition(cp);

    if (!this.held) {
      // Grab on trigger press if close enough
      if (trig && !this.triggerDown && sp.distanceTo(cp) < this.data.grabDist) {
        this.held = true;
        // Stop glow pulse while held
        const blade = this.swordEl.querySelector('a-box');
        if (blade) blade.removeAttribute('animation');
      }
    } else {
      // Follow controller
      const cr = new THREE.Quaternion();
      this.controller.object3D.getWorldQuaternion(cr);

      const parent = this.swordEl.object3D.parent;
      const lp = cp.clone();
      parent.worldToLocal(lp);
      this.swordEl.object3D.position.copy(lp);

      // Align blade with controller forward (-Z → Y via -90° X rotation)
      const pq = new THREE.Quaternion();
      parent.getWorldQuaternion(pq);
      pq.invert();
      const lq = pq.multiply(cr);
      lq.multiply(new THREE.Quaternion().setFromEuler(
        new THREE.Euler(-Math.PI / 2, 0, 0)
      ));
      this.swordEl.object3D.quaternion.copy(lq);

      // Drop on trigger release — return home
      if (!trig && this.triggerDown) {
        this.held = false;
        this.swordEl.object3D.position.copy(this.homePos);
        this.swordEl.object3D.rotation.copy(this.homeRot);
        // Restore glow pulse
        const blade = this.swordEl.querySelector('a-box');
        if (blade) blade.setAttribute('animation',
          'property: material.emissiveIntensity; from: 0.3; to: 0.9; ' +
          'dur: 1500; dir: alternate; loop: true; easing: easeInOutSine');
      }
    }
    this.triggerDown = trig;
  }
});
