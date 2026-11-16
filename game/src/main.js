// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's
// rate. ?shot=start|play|buy|end with &seed=N sets up a deterministic frame for a
// capture, renders it twice, then freezes it and sets window.__shotReady.
// ?autotest=1 plays the match with the player driven by the bot AI and logs every
// round to window.__testLog, so a headless run can prove the rounds work.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import { createWorld } from './world.js';
import { createMover } from './mover.js';
import { createInput } from './input.js';
import { createWeaponState, createViewModel, reloadWeapon, weaponReady, stepWeapon, spreadOf, WEAPONS, GRENADES, ARMOR_PRICE } from './weapons.js';
import { createBot, assignRoundRoles, stepBots } from './bots.js';
import { createCombat, createBomb } from './combat.js';
import { createRounds, createMatch, startRound, stepRounds } from './rounds.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createEffects } from './effects.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const autotest = params.get('autotest') === '1';
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

const random = mulberry32(autotest ? seed : (Date.now() % 2147483647));

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const effects = createEffects(scene);
const audio = createAudio();
const hud = createHud();
const input = createInput(renderer.domElement, onLockChange);

const game = {
  scene,
  camera,
  world,
  effects,
  audio,
  random,
  time: 0,
  events: [],
  noise: [],
  entities: [],
  bots: [],
  player: null,
  combat: null,
  round: createRounds(),
  bomb: createBomb(),
  spawns: {
    ember: [
      { x: -4, z: 13, yaw: 0 }, { x: -1.5, z: 13.5, yaw: 0 }, { x: 1.5, z: 13.5, yaw: 0 },
      { x: 4, z: 13, yaw: 0 }, { x: 0, z: 14.5, yaw: 0 },
    ],
    slate: [
      { x: -4, z: -13, yaw: Math.PI }, { x: -1.5, z: -13.5, yaw: Math.PI }, { x: 1.5, z: -13.5, yaw: Math.PI },
      { x: 4, z: -13, yaw: Math.PI }, { x: 0, z: -14.5, yaw: Math.PI },
    ],
  },
  assignRoles() { assignRoundRoles(game, game.bots); },
};

game.combat = createCombat(game);

// The player: a mover, a loadout, a view model, and two transparent hit meshes so
// the bots' raycasts can hit them. The camera is the player's eyes.
const playerMover = createMover(world.colliders, game.spawns.ember[0]);
const viewModel = createViewModel(camera);
const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
const playerTorsoMesh = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.78, 0.3), hitMat);
const playerHeadMesh = new THREE.Mesh(new THREE.SphereGeometry(0.155, 16, 12), hitMat);
scene.add(playerTorsoMesh, playerHeadMesh);

const player = {
  id: 'you',
  name: 'You',
  team: 'ember',
  isPlayer: true,
  damageScale: 1,
  mover: playerMover,
  weapon: createWeaponState('p9'),
  loadout: { weapons: ['p9'], states: { p9: null }, grenades: { frag: 0, smoke: 0 } },
  money: 800,
  keptWeapons: null,
  keptArmor: false,
  hp: 100,
  armor: 0,
  alive: true,
  deathAt: 0,
  fall: 0,
  hurtAt: -10,
  channelKind: null,
  spawnIndex: 0,
  mesh: null,
  hit: { torso: playerTorsoMesh, head: playerHeadMesh },
  ai: null,
  getAimDirection(out) {
    camera.getWorldDirection(out);
    return out;
  },
  equip(defId) {
    if (!this.loadout.states[defId]) this.loadout.states[defId] = createWeaponState(defId);
    this.weapon = this.loadout.states[defId];
    viewModel.equip(WEAPONS[defId]);
  },
};
player.loadout.states.p9 = player.weapon;
playerTorsoMesh.userData.entity = player;
playerTorsoMesh.userData.part = 'torso';
playerHeadMesh.userData.entity = player;
playerHeadMesh.userData.part = 'head';
game.player = player;

// Four allies and five enemies. Allies share the player's spawn; enemies theirs.
const EMBER_NAMES = ['Vex', 'Mara', 'Juno', 'Kite'];
const SLATE_NAMES = ['Rook', 'Hale', 'Nyx', 'Falk', 'Odin'];
const bots = [];
EMBER_NAMES.forEach((name, i) => {
  const role = i === 2 ? 'sniper' : i === 1 ? 'smg' : 'rifle';
  const bot = createBot(game, { id: `ember-${i}`, name, team: 'ember', role, spawn: game.spawns.ember[i + 1] });
  bot.spawnIndex = i + 1;
  bot.roleWeapon = () => createWeaponState(role === 'sniper' ? 'longbow' : role === 'smg' ? 'raptor' : 'vk47');
  bots.push(bot);
});
SLATE_NAMES.forEach((name, i) => {
  const role = i === 0 ? 'sniper' : i === 1 ? 'smg' : 'rifle';
  const bot = createBot(game, { id: `slate-${i}`, name, team: 'slate', role, spawn: game.spawns.slate[i] });
  bot.spawnIndex = i;
  bot.roleWeapon = () => createWeaponState(role === 'sniper' ? 'longbow' : role === 'smg' ? 'raptor' : 'vk47');
  bots.push(bot);
});
game.bots = bots;
game.entities = [player, ...bots];

const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _target = new THREE.Vector3();

let started = false;
let frozen = false;
let buyOpen = false;
let wasFiring = false;
let wasScoped = false;
let lastTime = performance.now();
let accumulator = 0;
let testLog = [];
let testRoundsLogged = 0;
let minimapAt = -1;

hud.setAmmo(player.weapon.mag, player.weapon.reserve, player.weapon.def.name);
hud.setHealth(player.hp, player.armor);
hud.setMoney(player.money);
hud.setScore(0, 0);
hud.buildBuyMenu(onBuy);
hud.onBuyClose(closeBuyMenu);

function onLockChange(locked) {
  if (shot || autotest) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    audio.unlock();
  } else if (game.round.phase !== 'menu' && game.round.phase !== 'roundEnd' && game.round.phase !== 'matchEnd' && !buyOpen) {
    hud.showOverlay(started ? 'paused' : 'start');
  }
}

hud.onPlay(() => {
  if (shot) return;
  if (game.round.phase === 'menu') {
    createMatch(game);
    startRound(game);
    input.requestLock();
  } else if (game.round.phase === 'roundEnd') {
    advanceRound();
    input.requestLock();
  } else if (game.round.phase === 'matchEnd') {
    createMatch(game);
    startRound(game);
    input.requestLock();
  } else {
    input.requestLock();
  }
});

function advanceRound() {
  const rounds = game.round;
  if (rounds.phase !== 'roundEnd') return;
  if (rounds.score.ember >= 5 || rounds.score.slate >= 5 || rounds.round >= 9) {
    rounds.phase = 'matchEnd';
    rounds.matchWinner = rounds.score.ember > rounds.score.slate ? 'ember' : 'slate';
    game.events.push({ type: 'matchEnd', winner: rounds.matchWinner, score: { ...rounds.score } });
  } else {
    rounds.round += 1;
    startRound(game);
  }
}

function onBuy(id) {
  const p = player;
  if (game.round.phase !== 'freeze') {
    audio.denied();
    return;
  }
  if (WEAPONS[id]) {
    const def = WEAPONS[id];
    if (p.loadout.weapons.includes(id)) {
      p.equip(id);
      hud.markBought(id, true);
      audio.buy();
      return;
    }
    if (p.money < def.price) {
      audio.denied();
      return;
    }
    p.money -= def.price;
    p.loadout.weapons.push(id);
    p.equip(id);
    hud.markBought(id, true);
    hud.setMoney(p.money);
    audio.buy();
    return;
  }
  if (GRENADES[id]) {
    const def = GRENADES[id];
    if (p.money < def.price || p.loadout.grenades[id] >= 2) {
      audio.denied();
      return;
    }
    p.money -= def.price;
    p.loadout.grenades[id] += 1;
    hud.setMoney(p.money);
    audio.buy();
    return;
  }
  if (id === 'armor') {
    if (p.money < ARMOR_PRICE || p.armor >= 50) {
      audio.denied();
      return;
    }
    p.money -= ARMOR_PRICE;
    p.armor = 50;
    hud.setMoney(p.money);
    hud.setHealth(p.hp, p.armor);
    audio.buy();
  }
}

function openBuyMenu() {
  if (game.round.phase !== 'freeze' || buyOpen) return;
  buyOpen = true;
  hud.showBuyMenu();
  if (document.pointerLockElement) document.exitPointerLock();
}

function closeBuyMenu() {
  if (!buyOpen) return;
  buyOpen = false;
  hud.hideBuyMenu();
  if (game.round.phase === 'freeze' || game.round.phase === 'live') input.requestLock();
}

function syncCamera() {
  const body = player.mover.state;
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  playerTorsoMesh.position.set(body.position.x, body.position.y + 1.0, body.position.z);
  playerHeadMesh.position.set(body.position.x, body.position.y + 1.53, body.position.z);
}

function aimAt(point) {
  const body = player.mover.state;
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function playerShoot(extraSpread = 0) {
  const weapon = player.weapon;
  if (!weaponReady(weapon)) {
    if (weapon.mag === 0 && weapon.reloadLeft === 0) audio.dryFire();
    return;
  }
  camera.getWorldDirection(_dir);
  const speed = player.mover.groundSpeed();
  let spread = spreadOf(weapon, speed) + extraSpread;
  if (input.state.scoped && weapon.def.scoped) spread *= 0.5;
  _origin.copy(camera.position);
  const result = game.combat.fireHitscan(player, _origin, _dir, spread);
  if (result.fired) {
    player.mover.recoil(weapon.def.kick + random() * 0.003, (random() * 2 - 1) * 0.003);
    audio.shot(weapon.def.id);
    game.noise.push({ x: player.mover.state.position.x, z: player.mover.state.position.z, at: game.time });
    if (game.noise.length > 24) game.noise.shift();
    hud.setAmmo(weapon.mag, weapon.reserve, weapon.def.name);
  }
}

function throwPlayerGrenade(kind) {
  if (player.loadout.grenades[kind] <= 0) {
    audio.denied();
    return;
  }
  player.loadout.grenades[kind] -= 1;
  game.combat.throwGrenade(player, kind);
}

// In autotest the player is driven by the same ideas as a bot: walk the assigned
// site's route, face the nearest visible enemy, fire in bursts.
const autoDriver = {
  path: [],
  pathIndex: 0,
  burstLeft: 0,
  burstPauseUntil: 0,
  perceiveAt: 0,
  target: null,
  seenAt: -10,
};

function drivePlayerBot(dt) {
  const body = player.mover.state;
  const now = game.time;
  // Buy a rifle in freeze time once the money is there.
  if (game.round.phase === 'freeze' && player.money >= 2700 && !player.loadout.weapons.includes('vk47')) {
    onBuy('vk47');
  }
  // Plant the charge when standing in a site and nobody else is planting.
  const siteHere = world.siteAt(body.position.x, body.position.z);
  const someonePlanting = game.bots.some((b) => b.alive && b.team === 'ember' && b.ai.channelKind === 'plant');
  if (game.round.phase === 'live' && game.bomb.state === 'idle' && siteHere && !someonePlanting) {
    player.channelKind = 'plant';
    if (player.weapon.mag === 0 && player.weapon.reserve > 0) reloadWeapon(player.weapon);
    player.mover.step(dt, { f: false, b: false, l: false, r: false, jump: false, crouch: false });
    return;
  }
  player.channelKind = null;
  if (now >= autoDriver.perceiveAt) {
    autoDriver.perceiveAt = now + 0.15;
    let best = null;
    let bestDist = Infinity;
    for (const other of game.entities) {
      if (!other.alive || other.team === player.team) continue;
      const o = other.mover.state;
      const dist = Math.hypot(o.position.x - body.position.x, o.position.z - body.position.z);
      if (dist > 70 || dist >= bestDist) continue;
      if (!world.hasLineOfSight(body.position.x, body.position.y + body.eye, body.position.z, o.position.x, o.position.y + 1.1, o.position.z)) continue;
      best = other;
      bestDist = dist;
    }
    autoDriver.target = best;
    if (best) autoDriver.seenAt = now;
  }
  const input = { f: false, b: false, l: false, r: false, jump: false, crouch: false };
  const target = autoDriver.target && autoDriver.target.alive ? autoDriver.target : null;
  if (target) {
    const t = target.mover.state;
    const wantYaw = Math.atan2(-(t.position.x - body.position.x), -(t.position.z - body.position.z));
    let diff = wantYaw - body.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    body.yaw += Math.max(-dt * 6, Math.min(dt * 6, diff));
    const dy = (t.position.y + 1.1) - (body.position.y + body.eye);
    const dist = Math.hypot(t.position.x - body.position.x, t.position.z - body.position.z);
    body.pitch = Math.atan2(dy, Math.max(0.1, dist));
    if (autoDriver.burstLeft <= 0 && now >= autoDriver.burstPauseUntil) autoDriver.burstLeft = 3 + Math.floor(random() * 3);
    if (autoDriver.burstLeft > 0 && weaponReady(player.weapon)) {
      playerShoot(0.025);
      autoDriver.burstLeft -= 1;
      if (autoDriver.burstLeft <= 0) autoDriver.burstPauseUntil = now + 0.8 + random() * 0.6;
    }
  } else {
    if (!autoDriver.path.length) {
      const site = game.round.attackSite ?? 'A';
      const from = world.nearestNode(body.position.x, body.position.z);
      autoDriver.path = world.findPath(from, site === 'A' ? 'siteA' : 'siteB');
      autoDriver.pathIndex = 0;
    }
    if (autoDriver.pathIndex < autoDriver.path.length) {
      const node = world.nodePos(autoDriver.path[autoDriver.pathIndex]);
      const dx = node.x - body.position.x;
      const dz = node.z - body.position.z;
      if (Math.hypot(dx, dz) < 0.6) {
        autoDriver.pathIndex += 1;
        if (autoDriver.pathIndex >= autoDriver.path.length) autoDriver.path = [];
      } else {
        const wantYaw = Math.atan2(-dx, -dz);
        let diff = wantYaw - body.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        body.yaw += Math.max(-dt * 6, Math.min(dt * 6, diff));
        if (Math.abs(diff) < 0.7) input.f = true;
      }
    }
  }
  if (player.weapon.mag === 0 && player.weapon.reserve > 0) reloadWeapon(player.weapon);
  player.mover.step(dt, input);
}

function step(dt) {
  game.time += dt;
  const phase = game.round.phase;

  // Player movement and actions.
  if (player.alive && (phase === 'freeze' || phase === 'live')) {
    if (autotest) {
      drivePlayerBot(dt);
    } else {
      const look = input.takeLook();
      player.mover.look(look.x, look.y);
      const keys = input.state.keys;
      const moveInput = {
        f: keys.has('KeyW'), b: keys.has('KeyS'),
        l: keys.has('KeyA'), r: keys.has('KeyD'),
        jump: keys.has('Space'),
        crouch: keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC'),
      };
      player.mover.step(dt, moveInput);
      if (phase === 'live') {
        const firing = input.state.firing;
        const semi = !player.weapon.def.auto;
        if (firing && (!semi || !wasFiring)) playerShoot();
        wasFiring = firing;
        if (input.wasPressed('KeyR')) {
          if (reloadWeapon(player.weapon)) audio.reload();
        }
        if (input.wasPressed('KeyG')) throwPlayerGrenade('frag');
        if (input.wasPressed('KeyH')) throwPlayerGrenade('smoke');
        for (let slot = 1; slot <= 5; slot += 1) {
          if (input.wasPressed(`Digit${slot}`)) {
            const id = player.loadout.weapons.find((w) => WEAPONS[w].slot === slot);
            if (id) {
              player.equip(id);
              hud.setAmmo(player.weapon.mag, player.weapon.reserve, player.weapon.def.name);
            }
          }
        }
      }
      if (input.wasPressed('KeyB')) {
        if (buyOpen) closeBuyMenu();
        else openBuyMenu();
      }
      if (input.wasPressed('KeyM')) audio.toggleMute();
      // Plant / defuse: hold E while standing in the right place.
      const body = player.mover.state;
      if (keys.has('KeyE') && phase === 'live') {
        if (game.bomb.state === 'idle' && world.siteAt(body.position.x, body.position.z)) player.channelKind = 'plant';
        else if (game.bomb.state === 'planted' && Math.hypot(body.position.x - game.bomb.x, body.position.z - game.bomb.z) < 1.8) player.channelKind = 'defuse';
        else player.channelKind = null;
      } else {
        player.channelKind = null;
      }
      // Scope: right mouse with the DMR narrows the field of view and the spread.
      const scoped = input.state.scoped && player.weapon.def.scoped && phase === 'live';
      if (scoped !== wasScoped) {
        wasScoped = scoped;
        camera.fov = scoped ? 30 : 74;
        camera.updateProjectionMatrix();
        hud.setScoped(scoped);
      }
    }
  }

  // Weapons, grenades, bots, rounds, effects.
  for (const entity of game.entities) stepWeapon(entity.weapon, dt);
  game.combat.stepGrenades(dt);
  if (phase === 'live') stepBots(game, bots, dt);
  stepRounds(game, dt);
  effects.step(dt);
  viewModel.step(player.weapon, dt, wasScoped);

  drainEvents();
}

function drainEvents() {
  for (const event of game.events) {
    switch (event.type) {
      case 'damage': {
        if (event.target === player) {
          hud.damageFlash();
          audio.hurt();
        }
        if (event.attacker === player) {
          hud.hitMarker(false);
          if (event.part === 'head') audio.headshot();
          else audio.hit();
        }
        break;
      }
      case 'kill': {
        const text = `${event.attacker.name} ⌖ ${event.target.name}`;
        hud.feed(text, event.attacker.team);
        if (event.attacker === player) {
          player.money += 300;
          hud.setMoney(player.money);
          hud.hitMarker(true, 220);
          audio.kill();
        }
        if (event.target === player) {
          hud.showBanner('You are down', 'Your team fights on — next round you are back in.');
          if (document.pointerLockElement) document.exitPointerLock();
        }
        break;
      }
      case 'roundStart':
        hud.showBanner(`Round ${event.round}`, game.round.attackSite === 'A' ? 'Attack Site A' : 'Attack Site B');
        break;
      case 'liveStart':
        hud.showBanner('Go', player.team === 'ember' ? 'Plant the charge at the site' : 'Defend the sites');
        break;
      case 'roundEnd': {
        const won = event.winner === player.team;
        if (won) audio.roundWin();
        else audio.roundLose();
        hud.showOverlay('roundEnd', { winner: event.winner, reason: event.reason, score: event.score });
        if (document.pointerLockElement) document.exitPointerLock();
        if (autotest) {
          testLog.push({ round: game.round.round, winner: event.winner, reason: event.reason, score: { ...event.score }, time: game.time });
          testRoundsLogged += 1;
        }
        break;
      }
      case 'matchEnd': {
        hud.showOverlay('matchEnd', { winner: event.winner, score: event.score });
        if (document.pointerLockElement) document.exitPointerLock();
        if (autotest) testLog.push({ match: true, winner: event.winner, score: { ...event.score }, time: game.time });
        break;
      }
      case 'bombPlanted':
        hud.showBanner('Charge planted', `Site ${event.site} — 35 seconds to detonation`);
        audio.plantBeep(true);
        break;
      case 'bombBeep':
        audio.plantBeep(event.final);
        break;
      case 'bombExploded':
        effects.spawnExplosion(_target.set(event.x, 0.5, event.z));
        audio.explosion();
        break;
      default:
        break;
    }
  }
  game.events.length = 0;
}

function syncHud() {
  const rounds = game.round;
  hud.setHealth(player.hp, player.armor);
  hud.setAmmo(player.weapon.mag, player.weapon.reserve, player.weapon.def.name);
  hud.setMoney(player.money);
  hud.setTimer(rounds.timer, rounds.phase);
  hud.setScore(rounds.score.ember, rounds.score.slate);
  const emberAlive = game.entities.filter((e) => e.alive && e.team === 'ember').length;
  const slateAlive = game.entities.filter((e) => e.alive && e.team === 'slate').length;
  hud.setAlive(emberAlive, slateAlive);
  hud.setBomb(game.bomb.state, game.bomb.fuse, game.bomb.plantProgress, game.bomb.defuseProgress);
  const spreadPx = 6 + spreadOf(player.weapon, player.mover.groundSpeed()) * 900;
  hud.setCrosshairGap(spreadPx);
  const body = player.mover.state;
  if (game.bomb.state === 'idle' && world.siteAt(body.position.x, body.position.z) && rounds.phase === 'live') {
    hud.setHint(player.team === 'ember' ? 'Hold E to plant the charge' : '');
  } else if (game.bomb.state === 'planted' && Math.hypot(body.position.x - game.bomb.x, body.position.z - game.bomb.z) < 1.8 && rounds.phase === 'live') {
    hud.setHint(player.team === 'slate' ? 'Hold E to defuse' : 'Charge live — defend it');
  } else if (rounds.phase === 'freeze') {
    hud.setHint('Press B to buy weapons and grenades');
  } else if (rounds.phase === 'live' && player.team === 'ember' && game.bomb.state === 'idle') {
    hud.setHint(`Push Site ${game.round.attackSite} — plant the charge`);
  } else {
    hud.setHint('');
  }
  if (game.time - minimapAt > 0.25) {
    minimapAt = game.time;
    hud.drawMinimap(game.entities, game.bomb, player);
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const stepsPerFrame = autotest ? 10 : 1;
    accumulator += dt * (autotest ? 10 : 1);
    let steps = 0;
    const maxSteps = autotest ? 40 : 5;
    while (accumulator >= FIXED_STEP && steps < maxSteps) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
      void stepsPerFrame;
    }
    if (accumulator > FIXED_STEP * maxSteps) accumulator = 0;
    syncCamera();
    syncHud();
  }
  renderer.render(scene, camera);
  if (autotest) {
    window.__game = game;
    window.__gameTime = game.time;
    window.__gamePhase = game.round.phase;
    window.__gameRound = game.round.round;
    window.__bombState = game.bomb.state;
    window.__bombSite = game.bomb.site;
  }
  if (autotest && (testRoundsLogged >= 3 || game.time > 900)) {
    window.__testLog = testLog;
    window.__testDone = true;
    frozen = true;
  }
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBuyMenu();
  createMatch(game);
  startRound(game);
  // A full loadout for the capture: the rifle, a frag and armour. Set after the
  // round starts, because starting a round resets the loadout.
  player.loadout.weapons = ['p9', 'vk47'];
  player.loadout.states.vk47 = createWeaponState('vk47');
  player.equip('vk47');
  player.loadout.grenades = { frag: 1, smoke: 0 };
  player.armor = 50;
  player.money = 3250;
  const body = player.mover.state;

  if (name === 'start') {
    body.position.set(0.6, 0, 8.6);
    settle(20);
    aimAt(new THREE.Vector3(0, 1.5, -6));
    hud.showOverlay('start');
  } else if (name === 'buy') {
    body.position.set(0, 0, 12);
    settle(20);
    aimAt(new THREE.Vector3(0, 1.2, -8));
    hud.showBuyMenu();
    hud.markBought('vk47', true);
  } else if (name === 'play') {
    // Let the round run, then put an enemy in the player's sights and fire once.
    game.round.phase = 'live';
    game.round.timer = 82;
    settle(360);
    // The round may have ended while it ran; put it back to live for the frame.
    game.round.phase = 'live';
    game.round.timer = 82;
    hud.hideOverlay();
    const enemy = bots.find((b) => b.team === 'slate' && b.alive) ?? bots[4];
    enemy.mover.teleport(3, -1, Math.PI);
    enemy.hp = 100;
    body.position.set(0, 0, 6);
    settle(12);
    aimAt(new THREE.Vector3(enemy.mover.state.position.x, enemy.mover.state.position.y + 1.1, enemy.mover.state.position.z));
    camera.getWorldDirection(_dir);
    _origin.copy(camera.position);
    game.combat.fireHitscan(player, _origin, _dir, 0);
    hud.hitMarker(false, 4000);
    settle(6);
  } else {
    // end: a round just won, the charge burning at Site A behind the banner.
    game.round.phase = 'roundEnd';
    game.round.score = { ember: 1, slate: 0 };
    game.bomb.state = 'planted';
    game.bomb.site = 'A';
    game.bomb.x = -15.5;
    game.bomb.z = -9.5;
    game.bomb.fuse = 21;
    body.position.set(-6, 0, -2);
    settle(20);
    aimAt(new THREE.Vector3(-15.5, 1, -9.5));
    hud.showOverlay('roundEnd', { winner: 'ember', reason: 'Bomb detonated', score: { ember: 1, slate: 0 } });
  }
  hud.setHealth(player.hp, player.armor);
  hud.setAmmo(player.weapon.mag, player.weapon.reserve, player.weapon.def.name);
  hud.setMoney(player.money);
  hud.setScore(game.round.score.ember, game.round.score.slate);
  hud.setTimer(game.round.timer, game.round.phase);
  hud.drawMinimap(game.entities, game.bomb, player);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
if (shot) runShot(shot);
else if (autotest) {
  createMatch(game);
  startRound(game);
  window.__testLog = testLog;
  requestAnimationFrame(frame);
} else {
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
