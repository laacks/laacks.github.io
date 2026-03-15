// =============================================================
// character.js
// Player movement, collision, jumping and gravity for WebXR.
//
// Usage: add player-move to the rig entity in your scene.
//
// <a-entity id="rig" position="0 0 10" player-move>
//   <a-camera look-controls wasd-controls="enabled:false" position="0 1.6 0"></a-camera>
//   <a-entity id="lc" oculus-touch-controls="hand:left;  model:true"></a-entity>
//   <a-entity id="rc" oculus-touch-controls="hand:right; model:true"></a-entity>
// </a-entity>
//
// Schema defaults:
//   speed         2.5  m/s movement speed
//   turnSpeed     60   degrees/sec snap turn
//   stepHeight    0.31 m  (~12 inches) max passive step-up
//   jumpHeight    0.61 m  (~24 inches) max jump height
//   gravity       9.8  m/s²
//   debug         true show collision ray and HUD (set false for release)
// =============================================================

AFRAME.registerComponent('player-move', {
  schema: {
    speed:      { default: 2.5  },
    turnSpeed:  { default: 60   },
    stepHeight: { default: 0.31 },
    jumpHeight: { default: 0.61 },
    gravity:    { default: 9.8  },
    debug:      { default: true }
  },

  init: function () {
    this.vel      = 0;
    this.grounded = true;
    this.prevA    = false;
    this.meshes   = [];

    // All THREE objects null until first tick
    this.downRay  = null;
    this.fwdRay   = null;
    this.fwdDir   = null;
    this.downOrig = null;
    this.fwdOrig  = null;
    this.DOWN     = null;

    // Debug objects
    this.debugLine = null;
    this.hudText   = null;

    this.el.sceneEl.addEventListener('loaded', () => {
      setTimeout(() => {
        // Cache all scene meshes for raycasting
        this.el.sceneEl.object3D.traverse(o => {
          if (o.isMesh) this.meshes.push(o);
        });

        if (this.data.debug) {
          // Visible ray line
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position',
            new THREE.BufferAttribute(new Float32Array(6), 3));
          const mat = new THREE.LineBasicMaterial({ color: 0x00ff00 });
          this.debugLine = new THREE.LineSegments(geo, mat);
          this.el.sceneEl.object3D.add(this.debugLine);

          // HUD text attached to camera
          this.hudText = document.createElement('a-text');
          this.hudText.setAttribute('position', '0.12 0.05 -0.5');
          this.hudText.setAttribute('align', 'left');
          this.hudText.setAttribute('width', '0.35');
          this.hudText.setAttribute('color', '#00ff00');
          this.hudText.setAttribute('value', 'RAY: ready');
          const cam = this.el.querySelector('[camera]');
          if (cam) cam.appendChild(this.hudText);
        }
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

    // Single ray from head height, angled steeply (75°) downward
    // in the direction of movement. Lands ~0.5m ahead at foot level.
    // hit.y tells us obstacle height — block if above stepHeight.
    this.fwdDir.set(wx, -3.73, wz).normalize();
    this.fwdOrig.set(pos.x, pos.y + 1.85, pos.z);
    this.fwdRay.set(this.fwdOrig, this.fwdDir);
    this.fwdRay.near = 0;
    this.fwdRay.far  = 1.95;
    const hits = this.fwdRay.intersectObjects(this.meshes, false);

    if (this.data.debug) {
      const rayEnd = hits.length > 0
        ? hits[0].point
        : new THREE.Vector3().copy(this.fwdOrig).addScaledVector(this.fwdDir, 1.95);

      if (this.debugLine) {
        const pa = this.debugLine.geometry.attributes.position.array;
        pa[0] = this.fwdOrig.x; pa[1] = this.fwdOrig.y; pa[2] = this.fwdOrig.z;
        pa[3] = rayEnd.x;       pa[4] = rayEnd.y;       pa[5] = rayEnd.z;
        this.debugLine.geometry.attributes.position.needsUpdate = true;
        this.debugLine.material.color.setHex(
          hits.length === 0 ? 0x00ff00
          : hits[0].point.y > pos.y + this.data.stepHeight ? 0xff0000
          : 0xffff00
        );
      }

      if (this.hudText) {
        if (hits.length === 0) {
          this.hudText.setAttribute('value', 'RAY: no hit');
          this.hudText.setAttribute('color', '#00ff00');
        } else {
          const hy     = hits[0].point.y.toFixed(2);
          const dist   = hits[0].distance.toFixed(2);
          const blocks = hits[0].point.y > pos.y + this.data.stepHeight;
          this.hudText.setAttribute('value', `HIT dist:${dist}\ny:${hy} blk:${blocks}`);
          this.hudText.setAttribute('color', blocks ? '#ff4444' : '#ffff00');
        }
      }
    }

    if (hits.length === 0) return false;
    return hits[0].point.y > pos.y + this.data.stepHeight;
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

    const sec = dt / 1000;
    const rig = this.el.object3D;
    const pos = rig.position;

    // Read XR input
    let mx = 0, mz = 0, turn = 0, jumpBtn = false;
    const session = this.el.sceneEl.xrSession;
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
        } else if (src.handedness === 'right') {
          if (ax.length > 2 && Math.abs(ax[2]) > 0.15) turn += ax[2];
          if (bt && bt[4] && bt[4].pressed) jumpBtn = true;
        }
      }
    }

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
