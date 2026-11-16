// The armoury: five guns and two grenades. Each def holds the numbers that make it
// feel different — damage, headshot multiplier, magazine, fire rate, reload time,
// and the spread that punishes firing on the move. main.js and combat.js own the
// ray and the damage; this module owns the defs and the view models.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 Sidearm', slot: 1, price: 0,
    damage: 26, headMult: 4, mag: 12, reserve: 36, gap: 0.16, reload: 1.4,
    spreadStill: 0.004, spreadMove: 0.02, auto: false, range: 45, kick: 0.006,
    barrel: 0.28, body: 0.055,
  },
  raptor: {
    id: 'raptor', name: 'Raptor SMG', slot: 2, price: 1500,
    damage: 22, headMult: 4, mag: 28, reserve: 84, gap: 0.075, reload: 1.7,
    spreadStill: 0.008, spreadMove: 0.03, auto: true, range: 40, kick: 0.005,
    barrel: 0.34, body: 0.07,
  },
  vk47: {
    id: 'vk47', name: 'VK-47 Rifle', slot: 3, price: 2700,
    damage: 34, headMult: 4, mag: 30, reserve: 90, gap: 0.096, reload: 1.9,
    spreadStill: 0.0022, spreadMove: 0.028, auto: true, range: 80, kick: 0.009,
    barrel: 0.42, body: 0.09,
  },
  longbow: {
    id: 'longbow', name: 'Longbow DMR', slot: 4, price: 4750,
    damage: 90, headMult: 4, mag: 5, reserve: 15, gap: 1.1, reload: 2.8,
    spreadStill: 0.0008, spreadMove: 0.05, auto: false, range: 90, kick: 0.03,
    barrel: 0.55, body: 0.08, scoped: true,
  },
  breacher: {
    id: 'breacher', name: 'Breacher Shotgun', slot: 5, price: 1200,
    damage: 12, headMult: 2, mag: 6, reserve: 24, gap: 0.8, reload: 2.4,
    spreadStill: 0.03, spreadMove: 0.045, auto: false, range: 22, kick: 0.02,
    pellets: 8, barrel: 0.45, body: 0.1,
  },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'Frag Grenade', price: 300, fuse: 1.6, radius: 6.5, maxDamage: 120 },
  smoke: { id: 'smoke', name: 'Smoke Grenade', price: 300, fuse: 1.4, radius: 4.5, duration: 18 },
};

export const ARMOR_PRICE = 650;

// One live weapon: a def plus its state. A bot and the player both hold one.
export function createWeaponState(defId) {
  const def = WEAPONS[defId];
  return {
    def,
    mag: def.mag,
    reserve: def.reserve,
    cooldown: 0,
    reloadLeft: 0,
    bloom: 0,
    flash: 0,
    kick: 0,
  };
}

export function spreadOf(state, speed) {
  const def = state.def;
  const move = Math.min(1, speed / 5.2);
  return def.spreadStill + move * def.spreadMove + state.bloom;
}

export function stepWeapon(state, dt) {
  const def = state.def;
  state.cooldown = Math.max(0, state.cooldown - dt);
  state.flash = Math.max(0, state.flash - dt);
  state.bloom = Math.max(0, state.bloom - dt * 0.055);
  state.kick += (0 - state.kick) * Math.min(1, dt * 14);
  if (state.reloadLeft > 0) {
    state.reloadLeft = Math.max(0, state.reloadLeft - dt);
    if (state.reloadLeft === 0) {
      const need = def.mag - state.mag;
      const take = Math.min(need, state.reserve);
      state.mag += take;
      state.reserve -= take;
    }
  }
}

export function weaponReady(state) {
  return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
}

export function takeRound(state) {
  if (state.mag <= 0) return false;
  state.mag -= 1;
  return true;
}

export function pullTrigger(state) {
  const def = state.def;
  state.cooldown = def.gap;
  state.flash = 0.06;
  state.kick = 0.055;
  state.bloom = Math.min(0.05, state.bloom + (def.id === 'longbow' ? 0.03 : def.id === 'breacher' ? 0.04 : 0.006));
}

export function reloadWeapon(state) {
  const def = state.def;
  if (state.reloadLeft > 0 || state.mag === def.mag || state.reserve === 0) return false;
  state.reloadLeft = def.reload;
  return true;
}

export function refillWeapon(state) {
  const def = state.def;
  state.mag = def.mag;
  state.reserve = def.reserve;
  state.cooldown = 0;
  state.reloadLeft = 0;
  state.flash = 0;
  state.kick = 0;
  state.bloom = 0;
}

// The first-person view model: a receiver, a barrel and a stock, rebuilt per weapon
// from its def, plus a muzzle flash quad and a flash light. No new geometry is made
// per frame; equip swaps the barrel length and the body width only.
export function createViewModel(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.2 });

  const model = new THREE.Group();
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.42), body);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.4), grip);
  barrel.position.set(0, 0.025, -0.38);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), grip);
  stock.position.set(0, -0.02, 0.3);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.06), accent);
  sight.position.set(0, 0.075, -0.1);
  model.add(receiver, barrel, stock, sight);
  model.position.set(0.24, -0.2, -0.42);
  camera.add(model);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.24),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);

  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  let currentDef = WEAPONS.vk47;

  return {
    equip(def) {
      currentDef = def;
      barrel.scale.z = def.barrel / 0.4;
      barrel.position.z = -0.21 - def.barrel / 2 + 0.2;
      receiver.scale.x = def.body / 0.09;
      sight.visible = def.id !== 'longbow';
    },
    step(state, dt, scoped) {
      model.position.z = -0.42 + state.kick;
      model.rotation.x = state.kick * 2.2;
      model.position.x = scoped ? 0 : 0.24;
      model.position.y = scoped ? -0.145 : -0.2;
      flash.visible = state.flash > 0;
      flash.rotation.z = state.flash * 30;
      flashLight.intensity = state.flash > 0 ? 18 : 0;
      if (state.reloadLeft > 0) {
        const def = currentDef;
        model.rotation.x = -0.55 * Math.min(1, (def.reload - state.reloadLeft) * 2);
      }
    },
  };
}

// A bot's third-person body: torso, head, legs, a gun barrel, and a team-coloured
// band. Head and torso are the hit meshes; the band is how the player reads the team.
export function createBotMesh(team) {
  const group = new THREE.Group();
  const bodyColor = team === 'ember' ? PALETTE.ember : PALETTE.slate;
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.1 });
  const bandMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(bodyColor), roughness: 0.5, metalness: 0.1, emissive: new THREE.Color(bodyColor), emissiveIntensity: 0.35 });
  const headMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.6, metalness: 0.05 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.78, 0.3), bodyMat);
  torso.position.y = 1.0;
  torso.castShadow = true;
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.12, 0.32), bandMat);
  band.position.y = 1.32;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 16, 12), headMat);
  head.position.y = 1.53;
  head.castShadow = true;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.55, 0.24), bodyMat);
  legs.position.y = 0.28;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.55), bodyMat);
  gun.position.set(0.2, 1.15, -0.25);
  group.add(torso, band, head, legs, gun);
  group.traverse((mesh) => {
    if (mesh.isMesh) mesh.receiveShadow = true;
  });
  return { group, torso, head };
}
