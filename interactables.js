// =============================================================
// interactables.js
// =============================================================

AFRAME.registerComponent('sword-in-stone', {
  schema: {
    position: { type: 'vec3', default: { x: 0, y: 0.9, z: -7.5 } },
    grabDist:  { default: 0.6 },
    gravity:   { default: 9.8 },
    scale:     { default: 1.0 }
  },

  init: function () {
    this.held        = false;
    this.triggerDown = false;
    this.sheathed    = false;
    this.dropped     = false;
    this.dropVel     = 0;
    this.dropPos     = new THREE.Vector3(); // world pos at moment of drop
    this.dropRotY    = 0;                   // horizontal rotation to preserve on land
    this.controller  = null;
    this.rig         = null;
    this.swordEl     = null;
    this.meshes      = [];
    this.inHipZone   = false;

    // THREE objects — lazy init
    this.downRay  = null;
    this.tipRay   = null;
    this.tipDir   = null;
    this.tipOrig  = null;
    this.DOWN     = null;

    // Position altar entity
    this.el.object3D.position.set(
      this.data.position.x,
      this.data.position.y,
      this.data.position.z
    );

    // Stone block
    const stone = document.createElement('a-box');
    stone.setAttribute('width',    '0.55');
    stone.setAttribute('height',   '0.55');
    stone.setAttribute('depth',    '0.55');
    stone.setAttribute('color',    '#888070');
    stone.setAttribute('material', 'roughness: 1');
    this.el.appendChild(stone);

    // Sword GLB — attached directly to scene root
    // so its position/rotation are in world space
    const sc = this.data.scale;
    const sword = document.createElement('a-gltf-model');
    sword.setAttribute('id',     'sword');
    const sp = this.data.position;
    sword.setAttribute('src',      'models/Sword606.glb');
    sword.setAttribute('scale',    `${sc} ${sc} ${sc}`);

    // Start position: sticking up out of stone
    sword.object3D.position.set(sp.x, sp.y + 0.85, sp.z);
    sword.object3D.rotation.set(
      THREE.MathUtils.degToRad(-90), 0, 0
    );

    sword.setAttribute('animation__pulse',
      `property: object3D.scale; from: ${sc} ${sc} ${sc}; ` +
      `to: ${sc*1.04} ${sc*1.04} ${sc*1.04}; ` +
      'dur: 1500; dir: alternate; loop: true; easing: easeInOutSine');

    this.swordEl = sword;

    // Apply material fix when model first loads
    sword.addEventListener('model-loaded', () => {
      this._fixMaterials();
    });

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
        this.rig        = document.querySelector('#rig');

        // Build mesh list excluding the sword's own meshes
        // to prevent self-collision pushing the sword away
        const swordMeshes = new Set();
        if (this.swordEl) {
          this.swordEl.object3D.traverse(o => {
            if (o.isMesh) swordMeshes.add(o);
          });
        }
        this.el.sceneEl.object3D.traverse(o => {
          if (o.isMesh && !swordMeshes.has(o)) this.meshes.push(o);
        });
      }, 600);
    });

    this.el.sceneEl.addEventListener('hip-zone-enter', () => { this.inHipZone = true;  });
    this.el.sceneEl.addEventListener('hip-zone-exit',  () => { this.inHipZone = false; });
  },

  // Force all GLB materials opaque — must be called every grab
  // because Three.js re-processes materials when object moves
  _fixMaterials: function () {
    if (!this.swordEl) return;
    const model = this.swordEl.getObject3D('mesh');
    if (!model) return;
    model.traverse(node => {
      if (!node.isMesh) return;
      const mats = Array.isArray(node.material)
        ? node.material : [node.material];
      mats.forEach(m => {
        if (!m) return;
        m.transparent    = false;
        m.opacity        = 1;
        m.depthWrite     = true;
        m.depthTest      = true;
        m.needsUpdate    = true;
      });
    });
  },

  // Hip scabbard world position — right side of character, blade pointing down
  _hipWorldPos: function () {
    if (!this.rig) return null;
    const rp  = this.rig.object3D.position;
    const ry  = this.rig.object3D.rotation.y;
    return new THREE.Vector3(
      rp.x + Math.sin(ry + Math.PI / 2) * 0.3,
      rp.y + 0.9,
      rp.z + Math.cos(ry + Math.PI / 2) * 0.3
    );
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

    // Current world positions
    const sWorldPos = new THREE.Vector3();
    const cp        = new THREE.Vector3();
    this.swordEl.object3D.getWorldPosition(sWorldPos);
    this.controller.object3D.getWorldPosition(cp);

    // ================================================================
    // SHEATHED — follows hip
    // ================================================================
    if (this.sheathed) {
      const hipPos = this._hipWorldPos();
      if (hipPos && this.rig) {
        this.swordEl.object3D.position.copy(hipPos);
        // Point blade DOWN at hip — handle up, tip down
        // Rig Y rotation + 90° tilt so blade hangs vertically
        const ry = this.rig.object3D.rotation.y;
        this.swordEl.object3D.rotation.set(
          THREE.MathUtils.degToRad(90),  // tip points down
          ry,                             // face same direction as character
          0
        );
      }
      // Grab from scabbard
      if (trig && !this.triggerDown && sWorldPos.distanceTo(cp) < this.data.grabDist) {
        this.sheathed = false;
        this.held     = true;
        this.el.sceneEl.emit('inventory-update', { item: 'sword', state: 'held' });
      }
      this.triggerDown = trig;
      return;
    }

    // ================================================================
    // IDLE — in stone on altar
    // ================================================================
    if (!this.held && !this.dropped) {
      if (trig && !this.triggerDown && sWorldPos.distanceTo(cp) < this.data.grabDist) {
        this.held = true;
        this.swordEl.removeAttribute('animation__pulse');
        this.el.sceneEl.emit('inventory-update', { item: 'sword', state: 'held' });
        this._fixMaterials();
      }
      this.triggerDown = trig;
      return;
    }

    // ================================================================
    // HELD — follows controller
    // ================================================================
    if (this.held) {
      // Fix materials every tick while held to prevent transparency creep
      this._fixMaterials();

      const cr = new THREE.Quaternion();
      this.controller.object3D.getWorldQuaternion(cr);

      // -90° X so blade points forward along controller
      const offset     = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(THREE.MathUtils.degToRad(-90), 0, 0)
      );
      const swordQuat  = cr.clone().multiply(offset);

      // Blade forward axis
      const bladeAxis  = new THREE.Vector3(0, 0, -1).applyQuaternion(swordQuat);

      // Tip collision
      this.tipOrig.copy(cp);
      this.tipDir.copy(bladeAxis).normalize();
      this.tipRay.set(this.tipOrig, this.tipDir);
      this.tipRay.near = 0;
      this.tipRay.far  = 0.65;
      const tipHits    = this.tipRay.intersectObjects(this.meshes, false);

      // Handle offset — pull sword down into palm
      const handleOff  = new THREE.Vector3(0, -0.08, 0).applyQuaternion(swordQuat);
      const desiredPos = cp.clone().add(handleOff);

      if (tipHits.length > 0) {
        desiredPos.addScaledVector(bladeAxis, tipHits[0].distance - 0.65);
      }

      // Apply world-space position and rotation directly
      this.swordEl.object3D.position.copy(desiredPos);
      this.swordEl.object3D.quaternion.copy(swordQuat);

      // Release
      if (!trig && this.triggerDown) {
        // Capture current world position and horizontal rotation for drop
        this.dropPos.copy(desiredPos);
        this.dropRotY = swordQuat.y; // used for landing orientation

        if (this.inHipZone) {
          // Sheathe
          this.held     = false;
          this.sheathed = true;
          this.el.sceneEl.emit('inventory-update', { item: 'sword', state: 'sheathed' });
        } else {
          // Drop from current world position
          this.held    = false;
          this.dropped = true;
          this.dropVel = 0;
          // Set sword position explicitly to world drop position
          this.swordEl.object3D.position.copy(this.dropPos);
          this.el.sceneEl.emit('inventory-update', { item: 'sword', state: 'dropped' });
        }
      }

      this.triggerDown = trig;
      return;
    }

    // ================================================================
    // DROPPED — gravity fall
    // ================================================================
    if (this.dropped) {
      // Apply gravity to sword's current world Y
      this.dropVel -= this.data.gravity * sec;
      this.swordEl.object3D.position.y += this.dropVel * sec;

      const pos  = this.swordEl.object3D.position;
      const orig = new THREE.Vector3(pos.x, pos.y + 1.0, pos.z);
      this.downRay.set(orig, this.DOWN);
      const hits = this.downRay.intersectObjects(this.meshes, false);

      if (hits.length > 0 && pos.y <= hits[0].point.y + 0.02) {
        // Land — lay flat, preserve the horizontal facing direction
        pos.y        = hits[0].point.y + 0.02;
        this.dropVel = 0;
        this.dropped = false;
        // Flat on ground: 90° around X, preserve Y rotation
        const euler = new THREE.Euler().setFromQuaternion(
          this.swordEl.object3D.quaternion
        );
        this.swordEl.object3D.rotation.set(
          THREE.MathUtils.degToRad(90), euler.y, 0
        );
        // Restore pulse
        const sc = this.data.scale;
        this.swordEl.setAttribute('animation__pulse',
          `property: object3D.scale; from: ${sc} ${sc} ${sc}; ` +
          `to: ${sc*1.04} ${sc*1.04} ${sc*1.04}; ` +
          'dur: 1500; dir: alternate; loop: true; easing: easeInOutSine');
        this.el.sceneEl.emit('inventory-update', { item: 'sword', state: 'on-ground' });
      }

      // Re-grab while falling
      if (trig && !this.triggerDown &&
          this.swordEl.object3D.position.distanceTo(cp) < this.data.grabDist) {
        this.held    = true;
        this.dropped = false;
        this.dropVel = 0;
        this.swordEl.removeAttribute('animation__pulse');
        this._fixMaterials();
        this.el.sceneEl.emit('inventory-update', { item: 'sword', state: 'held' });
      }
    }

    this.triggerDown = trig;
  }
});
