// =============================================================
// inventory.js
// VR inventory and character sheet panel.
//
// Usage: add vr-inventory to any entity in your scene.
//   <a-entity vr-inventory></a-entity>
//
// Opens when 'inventory-toggle' event is emitted (Y button).
// Updates when 'inventory-update' event is emitted.
//
// Panel layout (appears 1.2m in front of player at eye height):
//   LEFT    — character stats sheet
//   CENTER  — character silhouette
//   RIGHT   — inventory items
// =============================================================

AFRAME.registerComponent('vr-inventory', {

  // Character data — edit these defaults or update via inventory-update events
  schema: {
    name:     { default: 'Adventurer'    },
    hp:       { default: 100             },
    maxHp:    { default: 100             },
    level:    { default: 1               },
    xp:       { default: 0               },
    xpNext:   { default: 1000            },
    strength: { default: 10              },
    agility:  { default: 10              },
    location: { default: 'Elven Ruins'   },
    gold:     { default: 0               }
  },

  init: function () {
    this.visible   = false;
    this.panelEl   = null;
    this.cam       = null;
    this.inventory = {
      sword: 'on-altar'  // sword state: on-altar, held, sheathed, dropped, on-ground
    };

    this.el.sceneEl.addEventListener('loaded', () => {
      this.cam = document.querySelector('[camera]');
      this._buildPanel();
    });

    this.el.sceneEl.addEventListener('inventory-toggle', () => {
      this.visible ? this._hide() : this._show();
    });

    this.el.sceneEl.addEventListener('inventory-update', (e) => {
      if (e.detail) {
        this.inventory[e.detail.item] = e.detail.state;
        if (this.visible) this._refresh();
      }
    });
  },

  _buildPanel: function () {
    // Root panel entity — positions itself in front of camera on show
    const panel = document.createElement('a-entity');
    panel.setAttribute('visible', 'false');
    this.el.sceneEl.appendChild(panel);
    this.panelEl = panel;

    // Panel background
    const bg = document.createElement('a-plane');
    bg.setAttribute('width',    '1.4');
    bg.setAttribute('height',   '0.9');
    bg.setAttribute('color',    '#1a1a2e');
    bg.setAttribute('material', 'opacity: 0.92; transparent: true; side: double');
    panel.appendChild(bg);

    // Border
    const border = document.createElement('a-plane');
    border.setAttribute('width',    '1.42');
    border.setAttribute('height',   '0.92');
    border.setAttribute('color',    '#c8a030');
    border.setAttribute('material', 'opacity: 0.6; transparent: true');
    border.setAttribute('position', '0 0 -0.001');
    panel.appendChild(border);

    // Title bar
    const title = document.createElement('a-plane');
    title.setAttribute('width',    '1.4');
    title.setAttribute('height',   '0.08');
    title.setAttribute('color',    '#c8a030');
    title.setAttribute('position', '0 0.41 0.001');
    panel.appendChild(title);

    const titleText = document.createElement('a-text');
    titleText.setAttribute('value',    'CHARACTER');
    titleText.setAttribute('position', '0 0.41 0.002');
    titleText.setAttribute('align',    'center');
    titleText.setAttribute('color',    '#1a1a2e');
    titleText.setAttribute('width',    '1.2');
    panel.appendChild(titleText);

    // Divider lines
    const div1 = document.createElement('a-plane');
    div1.setAttribute('width',    '0.005');
    div1.setAttribute('height',   '0.82');
    div1.setAttribute('color',    '#c8a030');
    div1.setAttribute('material', 'opacity: 0.4; transparent: true');
    div1.setAttribute('position', '-0.35 -0.02 0.001');
    panel.appendChild(div1);

    const div2 = document.createElement('a-plane');
    div2.setAttribute('width',    '0.005');
    div2.setAttribute('height',   '0.82');
    div2.setAttribute('color',    '#c8a030');
    div2.setAttribute('material', 'opacity: 0.4; transparent: true');
    div2.setAttribute('position', '0.35 -0.02 0.001');
    panel.appendChild(div2);

    // Section labels
    this._addText(panel, 'STATS',     '-0.7  0.33 0.002', 'center', '#c8a030', '0.3');
    this._addText(panel, 'CHARACTER', '0     0.33 0.002', 'center', '#c8a030', '0.3');
    this._addText(panel, 'INVENTORY', '0.7   0.33 0.002', 'center', '#c8a030', '0.3');

    // Character silhouette (center) — simple geometric figure
    this._buildSilhouette(panel);

    // Stats and inventory text — stored as refs for refresh
    this.statsTextEl = document.createElement('a-text');
    this.statsTextEl.setAttribute('position', '-0.67 0.18 0.002');
    this.statsTextEl.setAttribute('align',    'left');
    this.statsTextEl.setAttribute('color',    '#e0d8c0');
    this.statsTextEl.setAttribute('width',    '0.55');
    this.statsTextEl.setAttribute('line-height', '60');
    panel.appendChild(this.statsTextEl);

    this.invTextEl = document.createElement('a-text');
    this.invTextEl.setAttribute('position', '0.38 0.18 0.002');
    this.invTextEl.setAttribute('align',    'left');
    this.invTextEl.setAttribute('color',    '#e0d8c0');
    this.invTextEl.setAttribute('width',    '0.55');
    this.invTextEl.setAttribute('line-height', '60');
    panel.appendChild(this.invTextEl);

    // Close hint
    this._addText(panel, 'Press Y to close', '0 -0.42 0.002', 'center', '#666688', '0.6');

    this._refresh();
  },

  _addText: function (parent, value, position, align, color, width) {
    const t = document.createElement('a-text');
    t.setAttribute('value',    value);
    t.setAttribute('position', position);
    t.setAttribute('align',    align   || 'left');
    t.setAttribute('color',    color   || '#ffffff');
    t.setAttribute('width',    width   || '1');
    parent.appendChild(t);
    return t;
  },

  _buildSilhouette: function (parent) {
    const g = '#8ab4d0'; // silhouette color

    // Head
    const head = document.createElement('a-circle');
    head.setAttribute('radius',   '0.045');
    head.setAttribute('color',    g);
    head.setAttribute('position', '0 0.18 0.002');
    head.setAttribute('material', 'opacity: 0.7; transparent: true; side: double');
    parent.appendChild(head);

    // Torso
    const torso = document.createElement('a-plane');
    torso.setAttribute('width',    '0.09');
    torso.setAttribute('height',   '0.14');
    torso.setAttribute('color',    g);
    torso.setAttribute('position', '0 0.07 0.002');
    torso.setAttribute('material', 'opacity: 0.7; transparent: true');
    parent.appendChild(torso);

    // Left arm
    const lArm = document.createElement('a-plane');
    lArm.setAttribute('width',    '0.03');
    lArm.setAttribute('height',   '0.12');
    lArm.setAttribute('color',    g);
    lArm.setAttribute('position', '-0.065 0.06 0.002');
    lArm.setAttribute('rotation', '0 0 15');
    lArm.setAttribute('material', 'opacity: 0.7; transparent: true');
    parent.appendChild(lArm);

    // Right arm
    const rArm = document.createElement('a-plane');
    rArm.setAttribute('width',    '0.03');
    rArm.setAttribute('height',   '0.12');
    rArm.setAttribute('color',    g);
    rArm.setAttribute('position', '0.065 0.06 0.002');
    rArm.setAttribute('rotation', '0 0 -15');
    rArm.setAttribute('material', 'opacity: 0.7; transparent: true');
    parent.appendChild(rArm);

    // Left leg
    const lLeg = document.createElement('a-plane');
    lLeg.setAttribute('width',    '0.04');
    lLeg.setAttribute('height',   '0.14');
    lLeg.setAttribute('color',    g);
    lLeg.setAttribute('position', '-0.03 -0.07 0.002');
    lLeg.setAttribute('rotation', '0 0 5');
    lLeg.setAttribute('material', 'opacity: 0.7; transparent: true');
    parent.appendChild(lLeg);

    // Right leg
    const rLeg = document.createElement('a-plane');
    rLeg.setAttribute('width',    '0.04');
    rLeg.setAttribute('height',   '0.14');
    rLeg.setAttribute('color',    g);
    rLeg.setAttribute('position', '0.03 -0.07 0.002');
    rLeg.setAttribute('rotation', '0 0 -5');
    rLeg.setAttribute('material', 'opacity: 0.7; transparent: true');
    parent.appendChild(rLeg);

    // Sword indicator on hip (shown when sheathed)
    this.hipSwordEl = document.createElement('a-plane');
    this.hipSwordEl.setAttribute('width',    '0.008');
    this.hipSwordEl.setAttribute('height',   '0.10');
    this.hipSwordEl.setAttribute('color',    '#d0d8e0');
    this.hipSwordEl.setAttribute('position', '0.08 0.02 0.003');
    this.hipSwordEl.setAttribute('rotation', '0 0 20');
    this.hipSwordEl.setAttribute('material', 'opacity: 0; transparent: true');
    parent.appendChild(this.hipSwordEl);
  },

  _refresh: function () {
    const d = this.data;
    const hpBar  = '█'.repeat(Math.round(d.hp / d.maxHp * 10));
    const xpPct  = Math.round(d.xp / d.xpNext * 100);

    // Stats text
    this.statsTextEl.setAttribute('value',
      `${d.name}\n` +
      `\n` +
      `HP:  ${d.hp} / ${d.maxHp}\n` +
      `     ${hpBar}\n` +
      `\n` +
      `LVL: ${d.level}\n` +
      `XP:  ${d.xp} / ${d.xpNext}  (${xpPct}%)\n` +
      `\n` +
      `STR: ${d.strength}\n` +
      `AGI: ${d.agility}\n` +
      `\n` +
      `LOC: ${d.location}\n` +
      `GOLD: ${d.gold}`
    );

    // Inventory text
    const swordState = {
      'on-altar':  '⚔ Sword       [altar]',
      'held':      '⚔ Sword       [held]',
      'sheathed':  '⚔ Sword       [hip]',
      'dropped':   '⚔ Sword       [ground]',
      'on-ground': '⚔ Sword       [ground]'
    };
    this.invTextEl.setAttribute('value',
      `WEAPONS\n` +
      `${swordState[this.inventory.sword] || '⚔ Sword'}\n` +
      `\n` +
      `ARMOR\n` +
      `  none\n` +
      `\n` +
      `ITEMS\n` +
      `  none`
    );

    // Show sword on silhouette when sheathed
    if (this.hipSwordEl) {
      this.hipSwordEl.setAttribute('material',
        `opacity: ${this.inventory.sword === 'sheathed' ? 0.8 : 0}; transparent: true`);
    }
  },

  _show: function () {
    if (!this.panelEl || !this.cam) return;
    this.visible = true;

    // Position panel 1.2m in front of camera, at eye height
    const camObj  = this.cam.object3D;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camObj.getWorldQuaternion(new THREE.Quaternion()));
    forward.y = 0;
    forward.normalize();

    const camWorld = new THREE.Vector3();
    camObj.getWorldPosition(camWorld);

    this.panelEl.object3D.position.set(
      camWorld.x + forward.x * 1.2,
      camWorld.y,  // eye height
      camWorld.z + forward.z * 1.2
    );

    // Face the player
    this.panelEl.object3D.lookAt(camWorld);

    this._refresh();
    this.panelEl.setAttribute('visible', 'true');
  },

  _hide: function () {
    this.visible = false;
    if (this.panelEl) this.panelEl.setAttribute('visible', 'false');
  }
});
