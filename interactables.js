// =============================================================
// interactables.js
// Self-contained interactable objects for WebXR scenes.
//
// Components:
//   sword-in-stone  — loads Sword606.glb from models/ folder.
//                     Right trigger grabs, release drops with gravity.
//                     Blade stops on collision while swinging.
// =============================================================

AFRAME.registerComponent('sword-in-stone', {
  schema: {
    position: { type: 'vec3', default: { x: 0, y: 0.9, z: -7.5 } },
    grabDist:  { default: 0.6 },
    gravity:   { default: 9.8 },
    // Adjust these once you see the model in VR
    // Scale: start at 1, tune up/down to match ~0.76m sword length
    scale:     { default: 1.0 },
    // Rotation offset to orient blade pointing up (+Y) when held
    // Common values: '0 0 0', '90 0 0', '-90 0 0', '0 90 0'
    // Tune this if sword points wrong direction when grabbed
    rotOffset: { default: '0 0 0' }
  },

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

    // ---- Sword (GLB model, attached to scene root) ----
    const sword = document.createElement('a-gltf-model');
    const sp = this.data.position;
    sword.setAttribute('src',      'models/Sword606.glb');
    sword.setAttribute('position', `${sp.x} ${sp.y + 0.85} ${sp.z}`);
    sword.setAttribute('scale',    `${this.data.scale} ${this.data.scale} ${this.data.scale}`);
    sword.setAttribute('rotation', '-90 0 0');

    // Fix transparency and duplicate mesh issues common in Sketchfab GLB exports
    sword.addEventListener('model-loaded', () => {
      const model = sword.getObject3D('mesh');
      if (!model) return;
      model.traverse(node => {
        if (node.isMesh) {
          // Force opaque rendering
          if (Array.isArray(node.material)) {
            node.material.forEach(m => {
              m.transparent = false;
              m.opacity     = 1;
              m.depthWrite  = true;
              m.needsUpdate = true;
            });
          } else if (node.material) {
            node.material.transparent = false;
            node.material.opacity     = 1;
            node.material.depthWrite  = true;
            node.material.needsUpdate = true;
          }
        }
      });
    });

    // Pulse glow animation
    sword.setAttribute('animation__pulse',
      'property: object3D.scale; ' +
      `from: ${this.data.scale} ${this.data.scale} ${this.data.scale}; ` +
      `to: ${this.data.scale * 1.04} ${this.data.scale * 1.04} ${this.data.scale * 1.04}; ` +
      'dur: 1500; dir: alternate; loop: true; easing: easeInOutSine');

    this.swordEl = sword;

    // Altar glow light
    const light = document.createElement('a-light');
    light.setAttribute('type',      'point');
    light.setAttribute('color',     '#ffdd88');
    light.setAttribute('intensity', '0.6');
    light.setAttribute('distance',  '5');
    light.setAttribute('position',  `${sp.x} ${sp.y + 1.5} ${sp.z}`);
    light.setAttribute('animation',
      'property: intensity; from: 0.4; to: 0.9; ' +
      'dur: 2500; dir: alternate; loop: true; easing: easeInOutSine');

    this.el.sceneEl.addEventListener('loaded', () => {
      this.el.sceneEl.appendChild(sword);
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
        this.swordEl.removeAttribute('animation__pulse');
      }

    } else if (this.held) {
      // ---- HELD: follow controller with tip collision ----
      const cr = new THREE.Quaternion();
      this.controller.object3D.getWorldQuaternion(cr);

      // Apply -90° X rotation so blade points forward along controller
      const offset = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(THREE.MathUtils.degToRad(-90), 0, 0)
      );
      const swordQuat = cr.clone().multiply(offset);

      // Blade tip direction (along -Z after -90° X rotation = forward)
      const bladeAxis = new THREE.Vector3(0, 0, -1).applyQuaternion(swordQuat);

      // Collision: stop tip before hitting objects
      this.tipOrig.copy(cp);
      this.tipDir.copy(bladeAxis).normalize();
      this.tipRay.set(this.tipOrig, this.tipDir);
      this.tipRay.near = 0;
      this.tipRay.far  = 0.65;
      const tipHits = this.tipRay.intersectObjects(this.meshes, false);

      let desiredPos = cp.clone();
      if (tipHits.length > 0) {
        const pushBack = tipHits[0].distance - 0.65;
        desiredPos.addScaledVector(bladeAxis, pushBack);
      }

      sPos.copy(desiredPos);
      this.swordEl.object3D.quaternion.copy(swordQuat);

      // Release — begin gravity drop from current position/rotation
      if (!trig && this.triggerDown) {
        this.held    = false;
        this.dropped = true;
        this.dropVel = 0;
      }

    } else if (this.dropped) {
      // ---- DROPPED: fall with gravity ----
      this.dropVel -= this.data.gravity * sec;
      sPos.y += this.dropVel * sec;

      // Find surface below
      const orig = new THREE.Vector3(sPos.x, sPos.y + 1.0, sPos.z);
      this.downRay.set(orig, this.DOWN);
      const hits = this.downRay.intersectObjects(this.meshes, false);

      if (hits.length > 0) {
        const surfaceY = hits[0].point.y;
        if (sPos.y <= surfaceY + 0.02) {
          sPos.y       = surfaceY + 0.02;
          this.dropVel = 0;
          this.dropped = false;
          // Lay flat on landing — preserve horizontal rotation
          this.swordEl.object3D.rotation.set(
            Math.PI / 2, this.swordEl.object3D.rotation.y, 0
          );
          // Restore pulse glow
          const sc = this.data.scale;
          this.swordEl.setAttribute('animation__pulse',
            `property: object3D.scale; from: ${sc} ${sc} ${sc}; ` +
            `to: ${sc*1.04} ${sc*1.04} ${sc*1.04}; ` +
            'dur: 1500; dir: alternate; loop: true; easing: easeInOutSine');
        }
      }

      // Re-grab mid-fall
      if (trig && !this.triggerDown && sp.distanceTo(cp) < this.data.grabDist) {
        this.held    = true;
        this.dropped = false;
        this.dropVel = 0;
        this.swordEl.removeAttribute('animation__pulse');
      }
    }

    this.triggerDown = trig;
  }
});
