// =============================================================
// interactables.js
// Self-contained interactable objects for WebXR scenes.
//
// Current objects:
//   sword-in-stone  — short one-handed sword embedded in a stone.
//                     Right trigger within grabDist picks it up.
//                     Sword stops on objects when swung.
//                     Releasing trigger drops it — falls to ground.
//
// Usage in scene HTML:
//   <a-entity sword-in-stone="position: 0 0.9 -7.5"></a-entity>
// =============================================================

AFRAME.registerComponent('sword-in-stone', {
  schema: {
    position: { type: 'vec3', default: { x: 0, y: 0.9, z: -7.5 } },
    grabDist:  { default: 0.6 },
    gravity:   { default: 9.8 }
  },

  // Sword dimensions (2.5 ft = 0.76m total)
  // Blade:  0.52m long, 0.03m wide, 0.01m thick, pointed tip
  // Guard:  0.22m wide
  // Handle: 0.15m (short one-handed)
  // Pommel: small sphere

  init: function () {
    this.held        = false;
    this.triggerDown = false;
    this.controller  = null;
    this.swordEl     = null;
    this.dropped     = false;   // true when falling after release
    this.dropVel     = 0;       // vertical velocity during drop
    this.meshes      = [];

    // Raycasters — created lazily on first tick
    this.downRay     = null;
    this.tipRay      = null;
    this.tipDir      = null;
    this.tipOrig     = null;
    this.DOWN        = null;

    // Position this entity at the altar
    this.el.object3D.position.set(
      this.data.position.x,
      this.data.position.y,
      this.data.position.z
    );

    // ---- Stone block ----
    const stone = document.createElement('a-box');
    stone.setAttribute('width',   '0.55');
    stone.setAttribute('height',  '0.55');
    stone.setAttribute('depth',   '0.55');
    stone.setAttribute('color',   '#888070');
    stone.setAttribute('material','roughness: 1');
    this.el.appendChild(stone);

    // ---- Sword entity (world-space object, child of scene root) ----
    // We attach it to the scene so we can move it freely in world space
    const sword = document.createElement('a-entity');
    sword.setAttribute('position', `${this.data.position.x} ${this.data.position.y + 0.85} ${this.data.position.z}`);
    this.swordEl = sword;

    // Blade body (box, narrow and thin)
    const blade = document.createElement('a-box');
    blade.setAttribute('position', '0 0.22 0');  // offset up from guard
    blade.setAttribute('width',    '0.03');       // half as wide
    blade.setAttribute('height',   '0.42');       // main blade length
    blade.setAttribute('depth',    '0.01');       // half as thick
    blade.setAttribute('color',    '#d0d8e0');
    blade.setAttribute('material',
      'roughness: 0.1; metalness: 0.9; emissive: #aabbcc; emissiveIntensity: 0.3');
    blade.setAttribute('animation',
      'property: material.emissiveIntensity; from: 0.3; to: 0.9; ' +
      'dur: 1500; dir: alternate; loop: true; easing: easeInOutSine');
    sword.appendChild(blade);

    // Blade tip (cone for pointed end)
    const tip = document.createElement('a-cone');
    tip.setAttribute('position',      '0 0.49 0'); // sits on top of blade
    tip.setAttribute('radius-bottom', '0.015');
    tip.setAttribute('radius-top',    '0');
    tip.setAttribute('height',        '0.1');
    tip.setAttribute('color',         '#d0d8e0');
    tip.setAttribute('material',
      'roughness: 0.1; metalness: 0.9; emissive: #aabbcc; emissiveIntensity: 0.3');
    sword.appendChild(tip);

    // Crossguard
    const guard = document.createElement('a-box');
    guard.setAttribute('position', '0 0 0');
    guard.setAttribute('width',    '0.22');
    guard.setAttribute('height',   '0.04');
    guard.setAttribute('depth',    '0.04');
    guard.setAttribute('color',    '#c8a030');
    guard.setAttribute('material', 'roughness: 0.3; metalness: 0.8');
    sword.appendChild(guard);

    // Handle (short one-handed grip)
    const handle = document.createElement('a-cylinder');
    handle.setAttribute('position', '0 -0.10 0');
    handle.setAttribute('radius',   '0.025');
    handle.setAttribute('height',   '0.15');
    handle.setAttribute('color',    '#6a3a18');
    handle.setAttribute('material', 'roughness: 0.9');
    sword.appendChild(handle);

    // Pommel
    const pommel = document.createElement('a-sphere');
    pommel.setAttribute('position', '0 -0.195 0');
    pommel.setAttribute('radius',   '0.04');
    pommel.setAttribute('color',    '#c8a030');
    pommel.setAttribute('material', 'roughness: 0.3; metalness: 0.8');
    sword.appendChild(pommel);

    // Altar glow light
    const light = document.createElement('a-light');
    light.setAttribute('type',      'point');
    light.setAttribute('color',     '#ffdd88');
    light.setAttribute('intensity', '0.6');
    light.setAttribute('distance',  '5');
    light.setAttribute('position',  `${this.data.position.x} ${this.data.position.y + 1.5} ${this.data.position.z}`);
    light.setAttribute('animation',
      'property: intensity; from: 0.4; to: 0.9; ' +
      'dur: 2500; dir: alternate; loop: true; easing: easeInOutSine');

    this.el.sceneEl.addEventListener('loaded', () => {
      // Attach sword to scene root so it moves freely in world space
      this.el.sceneEl.appendChild(sword);
      this.el.sceneEl.appendChild(light);

      setTimeout(() => {
        this.controller = document.querySelector('#rc');
        // Cache meshes for collision and drop raycasting
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

    // Lazy-init raycasters
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

    const swordPos = this.swordEl.object3D.position;
    const cp       = new THREE.Vector3();
    const sp       = new THREE.Vector3();
    this.controller.object3D.getWorldPosition(cp);
    this.swordEl.object3D.getWorldPosition(sp);

    if (!this.held && !this.dropped) {
      // Idle in stone — grab on trigger press if close enough
      if (trig && !this.triggerDown && sp.distanceTo(cp) < this.data.grabDist) {
        this.held    = true;
        this.dropped = false;
        const blade = this.swordEl.querySelector('a-box');
        if (blade) blade.removeAttribute('animation');
      }
    } else if (this.held) {
      // ---- HELD: follow controller with collision stop ----
      const cr = new THREE.Quaternion();
      this.controller.object3D.getWorldQuaternion(cr);

      // Get desired sword world position = controller position
      const desiredPos = cp.clone();

      // Get sword tip direction (blade points along controller -Z after offset)
      // The tip is ~0.59m along the blade axis from the handle
      const bladeAxis = new THREE.Vector3(0, 1, 0)
        .applyQuaternion(cr)
        .applyQuaternion(
          new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
        );

      // Cast ray from controller toward blade tip to detect collision
      this.tipOrig.copy(cp);
      this.tipDir.copy(bladeAxis).normalize();
      this.tipRay.set(this.tipOrig, this.tipDir);
      this.tipRay.near = 0;
      this.tipRay.far  = 0.65; // blade length

      const tipHits = this.tipRay.intersectObjects(this.meshes, false);
      // If blade tip hits something, stop sword just before the surface
      if (tipHits.length > 0) {
        const stopDist = Math.max(0, tipHits[0].distance - 0.05);
        desiredPos.addScaledVector(this.tipDir, stopDist - 0.65);
      }

      // Apply position and rotation
      swordPos.copy(desiredPos);
      const offset = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(-Math.PI / 2, 0, 0)
      );
      cr.multiply(offset);
      this.swordEl.object3D.quaternion.copy(cr);

      // Drop on trigger release
      if (!trig && this.triggerDown) {
        this.held    = false;
        this.dropped = true;
        this.dropVel = 0; // start fall from rest
      }

    } else if (this.dropped) {
      // ---- DROPPED: fall with gravity until hitting a surface ----
      this.dropVel -= this.data.gravity * sec;
      swordPos.y += this.dropVel * sec;

      // Raycast downward from sword to find landing surface
      this.downRay.set(
        new THREE.Vector3(swordPos.x, swordPos.y + 0.5, swordPos.z),
        this.DOWN
      );
      const downHits = this.downRay.intersectObjects(this.meshes, false);
      if (downHits.length > 0) {
        const surfaceY = downHits[0].point.y;
        if (swordPos.y <= surfaceY + 0.05) {
          // Landed — lay flat on surface
          swordPos.y   = surfaceY + 0.05;
          this.dropVel = 0;
          this.dropped = false;
          // Rotate sword to lie flat
          this.swordEl.object3D.rotation.set(Math.PI / 2, 0, 0);
        }
      }

      // Re-grab while falling — trigger press when close enough
      if (trig && !this.triggerDown && sp.distanceTo(cp) < this.data.grabDist) {
        this.held    = true;
        this.dropped = false;
        this.dropVel = 0;
      }
    }

    this.triggerDown = trig;
  }
});
