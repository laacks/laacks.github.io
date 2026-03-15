// =============================================================
// character.js
// Player movement, collision, jumping and gravity for WebXR.
//
// Controls:
//   Left stick       move
//   Right stick X    snap turn
//   A button         jump
//   Y button         toggle inventory panel
//
// Emits scene events:
//   'inventory-toggle'   when Y is pressed
//   'hip-zone-enter'     when right controller enters hip zone
//   'hip-zone-exit'      when right controller leaves hip zone
// =============================================================

AFRAME.registerComponent('player-move', {
  schema: {
    speed:      { default: 2.5  },
    turnSpeed:  { default: 60   },
    stepHeight: { default: 0.31 },
    jumpHeight: { default: 0.61 },
    gravity:    { default: 9.8  }
  },

  init: function () {
    this.vel         = 0;
    this.grounded    = true;
    this.prevA       = false;  // A button edge detect (jump)
    this.prevY       = false;  // Y button edge detect (inventory)
    this.inHipZone   = false;  // is right controller near hip?
    this.meshes      = [];

    // THREE objects — lazy init on first tick
    this.downRay  = null;
    this.fwdRay   = null;
    this.fwdDir   = null;
    this.downOrig = null;
    this.fwdOrig  = null;
    this.DOWN     = null;

    this.el.sceneEl.addEventListener('loaded', () => {
      setTimeout(() => {
        // Cache scene meshes for raycasting.
        // Exclude the sword (moves dynamically) and the rig/controllers
        // so the player doesn't collide with their own body or held items.
        const excluded = new Set();
        ['#sword', '#rc', '#lc'].forEach(sel => {
          const el = document.querySelector(sel);
          if (el) el.object3D.traverse(o => { if (o.isMesh) excluded.add(o); });
        });
        this.el.sceneEl.object3D.traverse(o => {
          if (o.isMesh && !excluded.has(o)) this.meshes.push(o);
        });
      }, 500);
    });
  },

  groundAt: function (x, z, fromY) {
    if (!this.downRay) return null;
    this.downOrig.set(x, fromY, z);
    this.downRay.set(this.downOrig, this.DOWN);
    const hits = this.downRay.intersectObjects(this.meshes, false);
    for (const h of hits) {
      if (h.point.y < fromY - 0.01) return h.point.y;
    }
    return null;
  },

  blocked: function (pos, wx, wz) {
    if (!this.fwdRay) return false;
    this.fwdDir.set(wx, -3.73, wz).normalize();
    this.fwdOrig.set(pos.x, pos.y + 1.85, pos.z);
    this.fwdRay.set(this.fwdOrig, this.fwdDir);
    this.fwdRay.near = 0;
    this.fwdRay.far  = 1.95;
    const hits = this.fwdRay.intersectObjects(this.meshes, false);
    if (hits.length === 0) return false;
    return hits[0].point.y > pos.y + this.data.stepHeight;
  },

  // Check if right controller is in hip scabbard zone.
  // Hip zone = roughly 0.3m to the right and 0.8-1.0m below head height,
  // within 0.25m radius. This approximates where a scabbard would sit.
  checkHipZone: function (session, rigPos) {
    if (!session) return false;
    for (const src of session.inputSources) {
      if (src.handedness !== 'right') continue;
      const rc = document.querySelector('#rc');
      if (!rc) continue;
      const cp = new THREE.Vector3();
      rc.object3D.getWorldPosition(cp);

      // Hip zone center in world space:
      // right side of body = rig X + 0.3m in rig-right direction
      // height = rig Y + ~0.9m (waist level for 6ft1 character)
      const hipX = rigPos.x + Math.sin(this.el.object3D.rotation.y + Math.PI / 2) * 0.3;
      const hipY = rigPos.y + 0.9;
      const hipZ = rigPos.z + Math.cos(this.el.object3D.rotation.y + Math.PI / 2) * 0.3;

      const dist = Math.sqrt(
        Math.pow(cp.x - hipX, 2) +
        Math.pow(cp.y - hipY, 2) +
        Math.pow(cp.z - hipZ, 2)
      );
      return dist < 0.25;
    }
    return false;
  },

  tick: function (t, dt) {
    if (!dt) return;

    // Lazy-init THREE objects on first tick
    if (!this.downRay) {
      this.downRay  = new THREE.Raycaster();
      this.fwdRay   = new THREE.Raycaster();
      this.fwdDir   = new THREE.Vector3();
      this.downOrig = new THREE.Vector3();
      this.fwdOrig  = new THREE.Vector3();
      this.DOWN     = new THREE.Vector3(0, -1, 0);
      return;
    }

    const sec     = dt / 1000;
    const rig     = this.el.object3D;
    const pos     = rig.position;
    const session = this.el.sceneEl.xrSession;

    // Read XR input
    let mx = 0, mz = 0, turn = 0;
    let jumpBtn = false, yBtn = false;

    if (session) {
      for (const src of session.inputSources) {
        if (!src.gamepad) continue;
        const ax = src.gamepad.axes;
        const bt = src.gamepad.buttons;
        if (src.handedness === 'left') {
          if (ax.length > 3) {
            if (Math.abs(ax[2]) > 0.15) mx += ax[2];
            if (Math.abs(ax[3]) > 0.15) mz += ax[3];
          }
          // Y button = left controller button index 5
          if (bt && bt[5] && bt[5].pressed) yBtn = true;
        } else if (src.handedness === 'right') {
          if (ax.length > 2 && Math.abs(ax[2]) > 0.15) turn += ax[2];
          // A button = right controller button index 4
          if (bt && bt[4] && bt[4].pressed) jumpBtn = true;
        }
      }
    }

    // Y button — toggle inventory (edge trigger)
    if (yBtn && !this.prevY) {
      this.el.sceneEl.emit('inventory-toggle');
    }
    this.prevY = yBtn;

    // Hip zone detection — emit events for scabbard snapping
    const nowInHip = this.checkHipZone(session, pos);
    if (nowInHip && !this.inHipZone) {
      this.el.sceneEl.emit('hip-zone-enter');
    } else if (!nowInHip && this.inHipZone) {
      this.el.sceneEl.emit('hip-zone-exit');
    }
    this.inHipZone = nowInHip;

    // Snap turn
    if (turn !== 0) {
      rig.rotation.y -= turn *
        THREE.MathUtils.degToRad(this.data.turnSpeed) * sec;
    }

    // Movement direction = rig yaw + camera yaw
    const cam    = this.el.querySelector('[camera]');
    const camYaw = cam ? cam.object3D.rotation.y : 0;
    const yaw    = rig.rotation.y + camYaw;
    const cos    = Math.cos(yaw), sin = Math.sin(yaw);
    const wx     =  mx * cos + mz * sin;
    const wz     = -mx * sin + mz * cos;

    // Horizontal movement with collision
    if (wx !== 0 || wz !== 0) {
      const spd = this.data.speed * sec;
      if (!this.blocked(pos, wx, wz)) {
        pos.x += wx * spd;
        pos.z += wz * spd;
      } else {
        if (!this.blocked(pos, wx, 0))  pos.x += wx * spd;
        if (!this.blocked(pos, 0,  wz)) pos.z += wz * spd;
      }
    }

    // Jump
    if (jumpBtn && !this.prevA && this.grounded) {
      this.vel = Math.sqrt(2 * this.data.gravity * this.data.jumpHeight);
      this.grounded = false;
    }
    this.prevA = jumpBtn;

    // Gravity / terrain following
    const ground = this.groundAt(pos.x, pos.z, pos.y + 5);
    if (!this.grounded) {
      this.vel -= this.data.gravity * sec;
      pos.y += this.vel * sec;
      if (ground !== null && pos.y <= ground) {
        pos.y = ground;
        this.vel = 0;
        this.grounded = true;
      }
    } else {
      if (ground !== null) {
        const diff = ground - pos.y;
        if (diff > 0 && diff <= this.data.stepHeight) {
          pos.y += diff * 0.2;
        } else if (diff < 0) {
          pos.y += diff * 0.2;
        }
      }
    }
  }
});
