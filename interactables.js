// =============================================================
// interactables.js
// Self-contained interactable objects for WebXR scenes.
//
// Components:
//   sword-in-stone  — short one-handed sword in a stone block.
//                     Right trigger grabs, release drops with gravity.
//                     Blade stops on collision while swinging.
// =============================================================

AFRAME.registerComponent('sword-in-stone', {
  schema: {
    position: { type: 'vec3', default: { x: 0, y: 0.9, z: -7.5 } },
    grabDist:  { default: 0.6 },
    gravity:   { default: 9.8 }
  },

  // Sword layout (Y axis = blade direction, guard at 0, tip at top):
  //
  //   +0.54  tip (flat diamond point)
  //   +0.24 to +0.44  blade body
  //    0.00  crossguard
  //   -0.08 to -0.16  handle
  //   -0.20  pommel
  //
  // Total length ~0.74m (about 2.5 ft)

  init: function () {
    this.held        = false;
    this.triggerDown = false;
    this.controller  = null;
    this.swordEl     = null;
    this.dropped     = false;
    this.dropVel     = 0;
    this.meshes      = [];
    this.downRay     = null;
    this.tipRay      = null;
    this.tipDir      = null;
    this.tipOrig     = null;
    this.DOWN        = null;

    // Position altar entity
    this.el.object3D.position.set(
      this.data.position.x,
      this.data.position.y,
      this.data.position.z
    );

    // ---- Stone block ----
    const stone = document.createElement('a-box');
    stone.setAttribute('width',    '0.55');
    stone.setAttribute('height',   '0.55');
    stone.setAttribute('depth',    '0.55');
    stone.setAttribute('color',    '#888070');
    stone.setAttribute('material', 'roughness: 1');
    this.el.appendChild(stone);

    // ---- Sword entity (attached to scene root for free movement) ----
    const sword = document.createElement('a-entity');
    const sp = this.data.position;
    sword.object3D.position.set(sp.x, sp.y + 0.85, sp.z);
    this.swordEl = sword;

    // -- Blade body --
    // Narrow flat box: 0.03 wide, 0.20 tall, 0.008 thick
    const blade = document.createElement('a-box');
    blade.setAttribute('position', '0 0.34 0');
    blade.setAttribute('width',    '0.03');
    blade.setAttribute('height',   '0.20');
    blade.setAttribute('depth',    '0.008');
    blade.setAttribute('color',    '#d0d8e0');
    blade.setAttribute('material',
      'roughness: 0.1; metalness: 0.9; emissive: #aabbcc; emissiveIntensity: 0.3');
    blade.setAttribute('animation',
      'property: material.emissiveIntensity; from: 0.3; to: 0.9; ' +
      'dur: 1500; dir: alternate; loop: true; easing: easeInOutSine');
    sword.appendChild(blade);

    // -- Flat diamond tip --
    // A thin box rotated 45° on Y to make a diamond cross-section,
    // tapered by scaling — gives a flat pointed tip matching the blade.
    const tipHolder = document.createElement('a-entity');
    tipHolder.setAttribute('position', '0 0.49 0');
    tipHolder.setAttribute('rotation', '0 45 0'); // diamond cross-section

    const tipBox = document.createElement('a-box');
    tipBox.setAttribute('position', '0 0.05 0');
    tipBox.setAttribute('width',    '0.022');  // slightly narrower than blade
    tipBox.setAttribute('height',   '0.10');   // taper length
    tipBox.setAttribute('depth',    '0.022');
    tipBox.setAttribute('color',    '#d0d8e0');
    tipBox.setAttribute('material',
      'roughness: 0.1; metalness: 0.9; emissive: #aabbcc; emissiveIntensity: 0.3');
    // Scale Y to create taper — wide at bottom, nearly zero at top
    tipBox.object3D.scale.set(1, 1, 1);
    tipHolder.appendChild(tipBox);
    sword.appendChild(tipHolder);

    // -- Crossguard --
    // Thin flat bar matching blade thickness
    const guard = document.createElement('a-box');
    guard.setAttribute('position', '0 0.02 0');
    guard.setAttribute('width',    '0.16');   // narrower than before
    guard.setAttribute('height',   '0.025');
    guard.setAttribute('depth',    '0.025');
    guard.setAttribute('color',    '#c8a030');
    guard.setAttribute('material', 'roughness: 0.3; metalness: 0.8');
    sword.appendChild(guard);

    // -- Handle --
    // Short one-handed grip, thin to match blade scale
    const handle = document.createElement('a-cylinder');
    handle.setAttribute('position', '0 -0.09 0');
    handle.setAttribute('radius',   '0.018');
    handle.setAttribute('height',   '0.14');
    handle.setAttribute('color',    '#6a3a18');
    handle.setAttribute('material', 'roughness: 0.9');
    sword.appendChild(handle);

    // -- Pommel --
    const pommel = document.createElement('a-sphere');
    pommel.setAttribute('position', '0 -0.175 0');
    pommel.setAttribute('radius',   '0.028');
    pommel.setAttribute('color',    '#c8a030');
    pommel.setAttribute('material', 'roughness: 0.3; metalness: 0.8');
    sword.appendChild(pommel);

    // Altar glow light
    const light = document.createElement('a-light');
    light.setAttribute('type',      'point');
    light.setAttribute('color',     '#ffdd88');
    light.setAttribute('intensity', '0.6');
    light.setAttribute('distance',  '5');
    light.setAttribute('animation',
      'property: intensity; from: 0.4; to: 0.9; ' +
      'dur: 2500; dir: alternate; loop: true; easing: easeInOutSine');

    this.el.sceneEl.addEventListener('loaded', () => {
      this.el.sceneEl.appendChild(sword);
      light.setAttribute('position',
        `${sp.x} ${sp.y + 1.5} ${sp.z}`);
      this.el.sceneEl.appendChild(light);

      setTimeout(() => {
        this.controller = document.querySelector('#rc');
        this.el.sceneEl.object3D.traverse(o => {
          if (o.isMesh) this.meshes.push(o);
        });
      }, 600);
    });
  },

  tick: function (t, dt) {
    if (!this.controller || !this.swordEl) return;
    if (!dt) return;
    const sec = dt / 1000;

    // Lazy-init THREE objects
    if (!this.downRay) {
      this.downRay = new THREE.Raycaster();
      this.tipRay  = new THREE.Raycaster();
      this.tipDir  = new THREE.Vector3();
      this.tipOrig = new THREE.Vector3();
      this.DOWN    = new THREE.Vector3(0, -1, 0);
      return;
    }

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

    const sPos = this.swordEl.object3D.position;
    const cp   = new THREE.Vector3();
    const sp   = new THREE.Vector3();
    this.controller.object3D.getWorldPosition(cp);
    this.swordEl.object3D.getWorldPosition(sp);

    if (!this.held && !this.dropped) {
      // ---- IDLE in stone ----
      if (trig && !this.triggerDown && sp.distanceTo(cp) < this.data.grabDist) {
        this.held = true;
        const blade = this.swordEl.querySelector('a-box');
        if (blade) blade.removeAttribute('animation');
      }

    } else if (this.held) {
      // ---- HELD: follow controller with tip collision ----
      const cr = new THREE.Quaternion();
      this.controller.object3D.getWorldQuaternion(cr);

      // Blade tip direction in world space
      // Blade points along local +Y, rotated by controller quat + -90° X offset
      const offset = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(-Math.PI / 2, 0, 0)
      );
      const swordQuat = cr.clone().multiply(offset);
      const bladeAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(swordQuat);

      // Cast from controller toward tip
      this.tipOrig.copy(cp);
      this.tipDir.copy(bladeAxis).normalize();
      this.tipRay.set(this.tipOrig, this.tipDir);
      this.tipRay.near = 0;
      this.tipRay.far  = 0.60;

      const tipHits = this.tipRay.intersectObjects(this.meshes, false);
      let desiredPos = cp.clone();
      if (tipHits.length > 0) {
        // Stop sword so tip just touches surface
        const pushBack = tipHits[0].distance - 0.60;
        desiredPos.addScaledVector(bladeAxis, pushBack);
      }

      sPos.copy(desiredPos);
      this.swordEl.object3D.quaternion.copy(swordQuat);

      // Release — begin gravity drop
      if (!trig && this.triggerDown) {
        this.held    = false;
        this.dropped = true;
        this.dropVel = 0;
        // Keep current world position and rotation — no snap
      }

    } else if (this.dropped) {
      // ---- DROPPED: fall with gravity ----
      this.dropVel -= this.data.gravity * sec;
      sPos.y += this.dropVel * sec;

      // Find ground below
      const orig = new THREE.Vector3(sPos.x, sPos.y + 1.0, sPos.z);
      this.downRay.set(orig, this.DOWN);
      const hits = this.downRay.intersectObjects(this.meshes, false);

      if (hits.length > 0) {
        const surfaceY = hits[0].point.y;
        if (sPos.y <= surfaceY + 0.02) {
          sPos.y       = surfaceY + 0.02;
          this.dropVel = 0;
          this.dropped = false;
          // Smoothly lay sword flat on landing
          this.swordEl.object3D.rotation.set(Math.PI / 2, 0,
            this.swordEl.object3D.rotation.y);
          // Restore glow
          const blade = this.swordEl.querySelector('a-box');
          if (blade) blade.setAttribute('animation',
            'property: material.emissiveIntensity; from: 0.3; to: 0.9; ' +
            'dur: 1500; dir: alternate; loop: true; easing: easeInOutSine');
        }
      }

      // Re-grab mid-fall
      if (trig && !this.triggerDown && sp.distanceTo(cp) < this.data.grabDist) {
        this.held    = true;
        this.dropped = false;
        this.dropVel = 0;
        const blade = this.swordEl.querySelector('a-box');
        if (blade) blade.removeAttribute('animation');
      }
    }

    this.triggerDown = trig;
  }
});
