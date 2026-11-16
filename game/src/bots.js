// The bots: five enemies and four allies who play the same round the player does.
// Each bot has a skill (reaction time, aim error, burst length), a waypoint path to
// its objective, and a small state machine: move, hold, engage, plant, defuse. They
// see through line of sight, hear gunshots, follow routes, hold positions, plant and
// defuse — and they get stuck against a box sometimes, so a stuck bot sidesteps.
import * as THREE from 'three';
import { createMover } from './mover.js';
import { createWeaponState, WEAPONS, createBotMesh, spreadOf, reloadWeapon } from './weapons.js';
import { range, pick, shuffle } from './rng.js';

const _tmpDir = new THREE.Vector3();
const _tmpOrigin = new THREE.Vector3();

const EMBER_NAMES = ['Vex', 'Mara', 'Juno', 'Kite'];
const SLATE_NAMES = ['Rook', 'Hale', 'Nyx', 'Falk', 'Odin'];
const PERCEIVE_GAP = 0.12;
const LOST_SIGHT = 1.2;

function aimYawTo(fromX, fromZ, toX, toZ) {
  return Math.atan2(-(toX - fromX), -(toZ - fromZ));
}

function turnToward(current, target, maxStep) {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  if (Math.abs(diff) <= maxStep) return target;
  return current + Math.sign(diff) * maxStep;
}

export function createBot(game, opts) {
  const { id, name, team, role, spawn } = opts;
  const mover = createMover(game.world.colliders, spawn);
  const weaponId = role === 'sniper' ? 'longbow' : role === 'smg' ? 'raptor' : 'vk47';
  const weapon = createWeaponState(weaponId);
  const mesh = createBotMesh(team);
  mesh.group.position.set(spawn.x, 0, spawn.z);
  game.scene.add(mesh.group);

  const bot = {
    id,
    name,
    team,
    role,
    isPlayer: false,
    damageScale: 0.55,
    mover,
    weapon,
    mesh: mesh.group,
    hit: { torso: mesh.torso, head: mesh.head },
    hp: 100,
    armor: 0,
    alive: true,
    deathAt: 0,
    fall: 0,
    money: 0,
    skill: {
      reaction: range(game.random, 0.5, 0.9),
      aimError: range(game.random, 0.03, 0.06),
      burst: 3 + Math.floor(game.random() * 3),
    },
    ai: {
      mode: 'move',
      path: [],
      pathIndex: 0,
      holdNode: null,
      holdUntil: 0,
      target: null,
      lastSeen: null,
      seenAt: -10,
      reactionAt: 0,
      burstLeft: 0,
      burstPauseUntil: 0,
      site: null,
      isPlanter: false,
      channelKind: null,
      stuckAt: 0,
      stuckPos: { x: spawn.x, z: spawn.z },
      sidestepUntil: 0,
      sidestepDir: 1,
      perceiveAt: game.random() * PERCEIVE_GAP,
      investigate: null,
      roamNodes: [],
      roamIndex: 0,
    },
    getAimDirection(out) {
      const body = mover.state;
      const cp = Math.cos(body.pitch);
      out.set(-Math.sin(body.yaw) * cp, Math.sin(body.pitch), -Math.cos(body.yaw) * cp);
      return out;
    },
  };
  mesh.torso.userData.entity = bot;
  mesh.torso.userData.part = 'torso';
  mesh.head.userData.entity = bot;
  mesh.head.userData.part = 'head';
  return bot;
}

export function assignRoundRoles(game, bots) {
  // Attackers pick a site for the round and split across its lanes; one of them
  // carries the bomb. Defenders split two and two across the sites with one mid.
  const site = game.random() < 0.55 ? 'A' : 'B';
  game.round.attackSite = site;
  const attackers = bots.filter((b) => b.team === 'ember' && b.alive);
  const defenders = bots.filter((b) => b.team === 'slate' && b.alive);
  const shuffledAttackers = shuffle(game.random, attackers);
  shuffledAttackers.forEach((bot, i) => {
    bot.ai.site = site;
    bot.ai.isPlanter = i === 0;
    bot.ai.mode = 'move';
    bot.ai.path = [];
    bot.ai.pathIndex = 0;
    bot.ai.target = null;
    bot.ai.channelKind = null;
    bot.ai.holdNode = null;
  });
  const shuffledDefenders = shuffle(game.random, defenders);
  shuffledDefenders.forEach((bot, i) => {
    bot.ai.site = i < 2 ? 'A' : i < 4 ? 'B' : 'mid';
    bot.ai.mode = 'move';
    bot.ai.path = [];
    bot.ai.pathIndex = 0;
    bot.ai.target = null;
    bot.ai.channelKind = null;
    bot.ai.holdNode = null;
    bot.ai.roamNodes = bot.ai.site === 'mid' ? ['midNorth', 'aRoam', 'bRoam'] : [];
    bot.ai.roamIndex = 0;
  });
}

function holdNodeFor(game, bot) {
  if (bot.team === 'slate') {
    if (bot.ai.site === 'A') return pick(game.random, ['siteAHold', 'siteA']);
    if (bot.ai.site === 'B') return pick(game.random, ['siteBHold', 'siteB']);
    return pick(game.random, ['midNorth', 'aRoam', 'bRoam']);
  }
  const site = game.round.attackSite ?? bot.ai.site ?? 'A';
  if (game.bomb.state === 'planted') return game.bomb.site === 'A' ? 'siteAHold' : 'siteBHold';
  return site === 'A' ? pick(game.random, ['siteA', 'siteAHold']) : pick(game.random, ['siteB', 'siteBHold']);
}

function pathTo(game, bot, nodeId) {
  const from = game.world.nearestNode(bot.mover.state.position.x, bot.mover.state.position.z);
  const path = game.world.findPath(from, nodeId);
  bot.ai.path = path;
  bot.ai.pathIndex = 0;
  bot.ai.pathAt = game.time;
}

function visibleEnemy(game, bot) {
  const eye = bot.mover.state;
  const ex = eye.position.x;
  const ey = eye.position.y + eye.eye;
  const ez = eye.position.z;
  let best = null;
  let bestDist = Infinity;
  for (const other of game.entities) {
    if (!other.alive || other.team === bot.team) continue;
    const o = other.mover.state;
    const dx = o.position.x - ex;
    const dy = o.position.y + 1.1 - ey;
    const dz = o.position.z - ez;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > 70 || dist >= bestDist) continue;
    if (!game.world.hasLineOfSight(ex, ey, ez, o.position.x, o.position.y + 1.1, o.position.z)) continue;
    if (game.effects.blockedBySmoke(ex, ey, ez, o.position.x, o.position.y + 1.1, o.position.z)) continue;
    best = other;
    bestDist = dist;
  }
  return best;
}

function stepBot(game, bot, dt) {
  const ai = bot.ai;
  const body = bot.mover.state;

  if (!bot.alive) {
    bot.fall = Math.min(1, bot.fall + dt / 0.4);
    bot.mesh.rotation.x = -bot.fall * 1.45;
    bot.mesh.position.y = -bot.fall * 0.08;
    return;
  }

  const now = game.time;
  const combat = game.combat;

  // Perception, staggered so not every bot raycasts on the same step.
  if (now >= ai.perceiveAt) {
    ai.perceiveAt = now + PERCEIVE_GAP;
    const seen = visibleEnemy(game, bot);
    if (seen) {
      if (ai.target !== seen) {
        ai.target = seen;
        ai.reactionAt = now + bot.skill.reaction;
      }
      ai.lastSeen = { x: seen.mover.state.position.x, y: seen.mover.state.position.y + 1.1, z: seen.mover.state.position.z };
      ai.seenAt = now;
    } else if (ai.target && now - ai.seenAt > LOST_SIGHT) {
      ai.target = null;
    }
    // Hearing: a recent gunshot nearby is worth a look.
    if (!ai.target && game.noise.length) {
      for (let i = game.noise.length - 1; i >= 0; i -= 1) {
        const n = game.noise[i];
        const d = Math.hypot(n.x - body.position.x, n.z - body.position.z);
        if (d < 28 && now - n.at < 1.5) {
          ai.investigate = { x: n.x, z: n.z, at: now };
          break;
        }
      }
    }
  }

  // Planting takes priority over fighting: a planter standing in the site
  // plants instead of trading shots, and stops shooting while the channel runs.
  // Same for a defender standing on a planted bomb: defuse first.
  if (bot.team === 'ember' && ai.isPlanter && game.bomb.state === 'idle' &&
      game.world.siteAt(body.position.x, body.position.z) === ai.site) {
    ai.channelKind = 'plant';
  } else if (bot.team === 'slate' && game.bomb.state === 'planted' &&
      Math.hypot(body.position.x - game.bomb.x, body.position.z - game.bomb.z) < 1.6) {
    ai.channelKind = 'defuse';
  }
  const input = { f: false, b: false, l: false, r: false, jump: false, crouch: false };
  const engaging = ai.target && ai.target.alive && !ai.channelKind;

  if (engaging) {
    // Face the target and fire in bursts once the reaction time has passed.
    const t = ai.target.mover.state;
    const targetYaw = aimYawTo(body.position.x, body.position.z, t.position.x, t.position.z);
    body.yaw = turnToward(body.yaw, targetYaw, dt * 7);
    const dy = (t.position.y + 1.1) - (body.position.y + body.eye);
    const dist = Math.hypot(t.position.x - body.position.x, t.position.z - body.position.z);
    body.pitch = Math.max(-1.45, Math.min(1.45, Math.atan2(dy, Math.max(0.1, dist))));
    const wantFire = now >= ai.reactionAt && now >= ai.burstPauseUntil && bot.weapon.mag > 0;
    if (wantFire && ai.burstLeft <= 0) ai.burstLeft = bot.skill.burst;
    if (wantFire && ai.burstLeft > 0 && combat) {
      const dir = bot.getAimDirection(_tmpDir);
      const err = bot.skill.aimError * (1 + dist / 40) * (bot.mover.groundSpeed() > 0.5 ? 1.6 : 1);
      const spread = spreadOf(bot.weapon, bot.mover.groundSpeed()) + err;
      _tmpOrigin.set(body.position.x, body.position.y + body.eye, body.position.z);
      const result = combat.fireHitscan(bot, _tmpOrigin, dir, spread);
      if (result.fired) {
        ai.burstLeft -= 1;
        if (ai.burstLeft <= 0) ai.burstPauseUntil = now + 0.4 + game.random() * 0.5;
        game.noise.push({ x: body.position.x, z: body.position.z, at: now });
        if (game.noise.length > 24) game.noise.shift();
      }
    }
    // Strafe a little while fighting; attackers keep pushing toward the enemy
    // (and the site behind them) instead of stalling in mid-map.
    if (bot.team === 'ember') {
      input.f = true;
      if (now % 2 < 1) input.l = true;
      else input.r = true;
    } else if (now % 2 < 1) input.l = true;
    else input.r = true;
  } else {
    // Objective movement.
    ai.channelKind = null;
    const bomb = game.bomb;
    if (bot.team === 'ember') {
      if (bomb.state === 'planted') {
        // Defend the planted site.
        if (!ai.path.length || ai.holdNode !== (bomb.site === 'A' ? 'siteAHold' : 'siteBHold')) {
          ai.holdNode = bomb.site === 'A' ? 'siteAHold' : 'siteBHold';
          pathTo(game, bot, ai.holdNode);
        }
      } else if (ai.isPlanter && game.world.siteAt(body.position.x, body.position.z) === ai.site) {
        // Plant the bomb; rounds.js advances the channel.
        ai.channelKind = 'plant';
      } else if (!ai.path.length || now - (ai.pathAt ?? 0) > 3) {
        // Re-path regularly: the bot may have pushed past waypoints while fighting.
        pathTo(game, bot, ai.site === 'A' ? 'siteA' : 'siteB');
      }
    } else {
      if (bomb.state === 'planted') {
        const node = bomb.site === 'A' ? 'siteA' : 'siteB';
        const atBomb = Math.hypot(body.position.x - bomb.x, body.position.z - bomb.z) < 1.6;
        if (atBomb) {
          ai.channelKind = 'defuse';
        } else if (!ai.path.length || ai.holdNode !== node) {
          ai.holdNode = node;
          pathTo(game, bot, node);
        }
      } else if (ai.site === 'mid') {
        if (!ai.path.length) {
          const node = ai.roamNodes[ai.roamIndex % ai.roamNodes.length];
          ai.roamIndex += 1;
          pathTo(game, bot, node);
        }
      } else if (!ai.path.length) {
        if (!ai.holdNode) {
          ai.holdNode = holdNodeFor(game, bot);
          pathTo(game, bot, ai.holdNode);
        } else if (now > ai.holdUntil) {
          ai.holdNode = holdNodeFor(game, bot);
          ai.holdUntil = now + 6 + game.random() * 6;
          pathTo(game, bot, ai.holdNode);
        }
      }
      if (ai.investigate && now - ai.investigate.at < 3) {
        const node = game.world.nearestNode(ai.investigate.x, ai.investigate.z);
        if (!ai.path.length) pathTo(game, bot, node);
      }
    }

    // Walk the path, unless we are standing still to plant or defuse.
    if (ai.channelKind) {
      // Face the site while channelling.
      const lookZ = body.position.z + (bot.team === 'ember' ? -1 : 1);
      body.yaw = turnToward(body.yaw, aimYawTo(body.position.x, body.position.z, body.position.x, lookZ), dt * 3);
    } else if (ai.path.length && ai.pathIndex < ai.path.length) {
      const nodeId = ai.path[ai.pathIndex];
      const node = game.world.nodePos(nodeId);
      const dx = node.x - body.position.x;
      const dz = node.z - body.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.6) {
        ai.pathIndex += 1;
        if (ai.pathIndex >= ai.path.length) ai.path = [];
      } else {
        const wantYaw = aimYawTo(body.position.x, body.position.z, node.x, node.z);
        body.yaw = turnToward(body.yaw, wantYaw, dt * 6);
        const turned = Math.abs(body.yaw - wantYaw);
        if (turned < 0.7) input.f = true;
        // Stuck recovery: barely moving while trying to walk means a box is in the
        // way; sidestep for a moment, then carry on.
        const moved = Math.hypot(body.position.x - ai.stuckPos.x, body.position.z - ai.stuckPos.z);
        if (now - ai.stuckAt > 0.8) {
          if (moved < 0.15 && now > ai.sidestepUntil) {
            ai.sidestepUntil = now + 0.7;
            ai.sidestepDir = game.random() < 0.5 ? -1 : 1;
          }
          ai.stuckAt = now;
          ai.stuckPos = { x: body.position.x, z: body.position.z };
        }
        if (now < ai.sidestepUntil) {
          if (ai.sidestepDir < 0) input.l = true;
          else input.r = true;
        }
      }
    } else if (ai.holdNode) {
      // Holding: face the direction the enemy approaches from.
      const lookZ = bot.team === 'slate' ? body.position.z - 10 : body.position.z + 10;
      body.yaw = turnToward(body.yaw, aimYawTo(body.position.x, body.position.z, body.position.x, lookZ), dt * 3);
      if (game.random() < 0.002) input.crouch = true;
    }
  }

  // Reload when the magazine runs dry.
  if (bot.weapon.mag === 0 && bot.weapon.reserve > 0 && bot.weapon.reloadLeft === 0) {
    reloadWeapon(bot.weapon);
  }

  bot.mover.step(dt, input);
  bot.mesh.position.set(body.position.x, body.position.y, body.position.z);
  bot.mesh.rotation.y = body.yaw;
  // A crouching bot reads as crouching.
  bot.mesh.scale.y = body.crouching ? 0.72 : 1;
}

export function stepBots(game, bots, dt) {
  for (const bot of bots) stepBot(game, bot, dt);
}
