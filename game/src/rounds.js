// The match: freeze, live, round end, match end. Two teams, short rounds won by
// eliminating the other team or by the bomb, money between rounds to buy weapons.
// First to 5 rounds takes the match. This module owns the timers, the scores, the
// economy and the bomb channels; the bots and the player only raise their intent.
import { createBomb } from './combat.js';

const FREEZE_SECONDS = 12;
const ROUND_SECONDS = 100;
const WIN_ROUNDS = 5;
const MAX_ROUNDS = 9;
const KILL_REWARD = 300;
const WIN_REWARD = 3250;
const LOSS_REWARD = 1900;
const LOSS_STREAK_BONUS = 500;
const PLANT_REWARD = 300;

export function createRounds() {
  return {
    phase: 'menu',
    round: 1,
    score: { ember: 0, slate: 0 },
    timer: 0,
    attackSite: 'A',
    lossStreak: { ember: 0, slate: 0 },
    roundWinner: null,
    roundReason: '',
    matchWinner: null,
  };
}

function aliveCount(entities, team) {
  return entities.filter((e) => e.alive && e.team === team).length;
}

export function createMatch(game) {
  const rounds = game.round;
  rounds.phase = 'freeze';
  rounds.round = 1;
  rounds.score = { ember: 0, slate: 0 };
  rounds.timer = FREEZE_SECONDS;
  rounds.lossStreak = { ember: 0, slate: 0 };
  rounds.roundWinner = null;
  rounds.roundReason = '';
  rounds.matchWinner = null;
  game.bomb = createBomb();
  game.player.money = 800;
  game.player.keptWeapons = null;
  game.events.push({ type: 'matchStart' });
}

export function startRound(game) {
  const rounds = game.round;
  rounds.phase = 'freeze';
  rounds.timer = FREEZE_SECONDS;
  rounds.roundWinner = null;
  rounds.roundReason = '';
  game.bomb = createBomb();
  // Respawn everyone at their spawn, full health, role weapons.
  for (const entity of game.entities) {
    const spawn = entity.team === 'ember'
      ? game.spawns.ember[entity.spawnIndex % game.spawns.ember.length]
      : game.spawns.slate[entity.spawnIndex % game.spawns.slate.length];
    entity.mover.teleport(spawn.x, spawn.z, spawn.yaw);
    entity.hp = 100;
    entity.armor = entity.isPlayer ? (entity.keptArmor ? 50 : 0) : 0;
    entity.alive = true;
    entity.fall = 0;
    if (entity.mesh) {
      entity.mesh.rotation.x = 0;
      entity.mesh.position.y = 0;
      entity.mesh.scale.y = 1;
    }
    if (entity.isPlayer) {
      // A survivor keeps what they bought; the fallen start over with a pistol.
      const keep = entity.keptWeapons;
      entity.loadout.weapons = keep ? keep.slice() : ['p9'];
      entity.loadout.grenades = { frag: 0, smoke: 0 };
      entity.equip(entity.loadout.weapons[entity.loadout.weapons.length - 1]);
    } else {
      entity.weapon = entity.roleWeapon();
    }
    entity.ai && Object.assign(entity.ai, { mode: 'move', path: [], pathIndex: 0, target: null, channelKind: null, holdNode: null });
  }
  game.assignRoles();
  game.events.push({ type: 'roundStart', round: rounds.round });
}

function endRound(game, winner, reason) {
  const rounds = game.round;
  if (rounds.phase !== 'live') return;
  rounds.phase = 'roundEnd';
  rounds.timer = 3.5;
  rounds.roundWinner = winner;
  rounds.roundReason = reason;
  rounds.score[winner] += 1;
  const loser = winner === 'ember' ? 'slate' : 'ember';
  rounds.lossStreak[winner] = 0;
  rounds.lossStreak[loser] += 1;
  // Economy: the winner is paid, the loser is paid less, more after a losing streak.
  const player = game.player;
  if (player.team === winner) player.money += WIN_REWARD;
  else player.money += Math.min(2900, LOSS_REWARD + (rounds.lossStreak[loser] - 1) * LOSS_STREAK_BONUS);
  // A survivor keeps their weapons into the next round.
  player.keptWeapons = player.alive ? player.loadout.weapons.slice() : null;
  player.keptArmor = player.alive && player.armor > 0;
  game.events.push({ type: 'roundEnd', winner, reason, score: { ...rounds.score } });
}

// A channel is a plant or a defuse in progress. It advances only while one
// channeler stands still at the right place; moving, shooting or taking a hit
// breaks it. Progress lives on the bomb so the HUD can read it.
function stepChannels(game, dt) {
  const bomb = game.bomb;
  const now = game.time;

  function findChanneler(kind) {
    for (const entity of game.entities) {
      if (!entity.alive) continue;
      const intent = entity.isPlayer ? entity.channelKind : entity.ai?.channelKind;
      if (intent !== kind) continue;
      return entity;
    }
    return null;
  }

  function channelValid(entity, kind) {
    if (!entity) return false;
    const body = entity.mover.state;
    const speed = entity.mover.groundSpeed();
    if (speed > 0.4) return false;
    if (entity.hurtAt && entity.hurtAt > (kind === 'plant' ? bomb.plantStartedAt : bomb.defuseStartedAt)) return false;
    if (kind === 'plant') {
      return bomb.state === 'idle' && game.world.siteAt(body.position.x, body.position.z) !== null;
    }
    return bomb.state === 'planted'
      && Math.hypot(body.position.x - bomb.x, body.position.z - bomb.z) < 1.8;
  }

  // Planting.
  if (bomb.state === 'idle') {
    const planter = findChanneler('plant');
    if (planter && channelValid(planter, 'plant')) {
      if (bomb.plantBy !== planter) {
        bomb.plantBy = planter;
        bomb.plantProgress = 0;
        bomb.plantStartedAt = now;
        bomb.plantX = planter.mover.state.position.x;
        bomb.plantZ = planter.mover.state.position.z;
      }
      const moved = Math.hypot(planter.mover.state.position.x - bomb.plantX, planter.mover.state.position.z - bomb.plantZ);
      if (moved > 0.6) {
        bomb.plantBy = null;
        bomb.plantProgress = 0;
      } else {
        bomb.plantProgress += dt / 3;
        if (bomb.plantProgress >= 1) {
          bomb.state = 'planted';
          bomb.site = game.world.siteAt(planter.mover.state.position.x, planter.mover.state.position.z);
          bomb.x = planter.mover.state.position.x;
          bomb.z = planter.mover.state.position.z;
          bomb.plantedAt = now;
          bomb.fuse = 35;
          bomb.plantBy = null;
          bomb.plantProgress = 0;
          if (planter.isPlayer) planter.money += PLANT_REWARD;
          game.events.push({ type: 'bombPlanted', site: bomb.site });
        }
      }
    } else {
      bomb.plantBy = null;
      bomb.plantProgress = 0;
    }
  }

  // Defusing.
  if (bomb.state === 'planted') {
    const defuser = findChanneler('defuse');
    if (defuser && channelValid(defuser, 'defuse')) {
      if (bomb.defuseBy !== defuser) {
        bomb.defuseBy = defuser;
        bomb.defuseProgress = 0;
        bomb.defuseStartedAt = now;
        bomb.defuseX = defuser.mover.state.position.x;
        bomb.defuseZ = defuser.mover.state.position.z;
      }
      const moved = Math.hypot(defuser.mover.state.position.x - bomb.defuseX, defuser.mover.state.position.z - bomb.defuseZ);
      if (moved > 0.6) {
        bomb.defuseBy = null;
        bomb.defuseProgress = 0;
      } else {
        bomb.defuseProgress += dt / 5;
        if (bomb.defuseProgress >= 1) {
          bomb.state = 'defused';
          bomb.defuseBy = null;
          bomb.defuseProgress = 0;
          endRound(game, 'slate', 'Bomb defused');
        }
      }
    } else {
      bomb.defuseBy = null;
      bomb.defuseProgress = 0;
    }
  }
}

export function stepRounds(game, dt) {
  const rounds = game.round;
  if (rounds.phase === 'menu' || rounds.phase === 'matchEnd') return;

  if (rounds.phase === 'freeze') {
    rounds.timer -= dt;
    if (rounds.timer <= 0) {
      rounds.phase = 'live';
      rounds.timer = ROUND_SECONDS;
      game.events.push({ type: 'liveStart' });
    }
    return;
  }

  if (rounds.phase === 'roundEnd') {
    rounds.timer -= dt;
    if (rounds.timer <= 0) {
      if (rounds.score.ember >= WIN_ROUNDS || rounds.score.slate >= WIN_ROUNDS || rounds.round >= MAX_ROUNDS) {
        rounds.phase = 'matchEnd';
        rounds.matchWinner = rounds.score.ember > rounds.score.slate ? 'ember' : 'slate';
        game.events.push({ type: 'matchEnd', winner: rounds.matchWinner, score: { ...rounds.score } });
      } else {
        rounds.round += 1;
        startRound(game);
      }
    }
    return;
  }

  // Live phase.
  rounds.timer -= dt;
  // If the bomb carrier fell, the next living attacker takes the bomb.
  if (game.bomb.state === 'idle') {
    const planter = game.bots.find((b) => b.team === 'ember' && b.ai.isPlanter && b.alive);
    if (!planter) {
      const next = game.bots.find((b) => b.team === 'ember' && b.alive);
      if (next) {
        for (const b of game.bots) b.ai.isPlanter = false;
        next.ai.isPlanter = true;
      }
    }
  }
  stepChannels(game, dt);

  if (game.bomb.state === 'planted') {
    game.bomb.fuse -= dt;
    const interval = game.bomb.fuse > 20 ? 1 : game.bomb.fuse > 10 ? 0.5 : 0.25;
    if (game.time - game.bomb.beepAt >= interval) {
      game.bomb.beepAt = game.time;
      game.events.push({ type: 'bombBeep', final: game.bomb.fuse <= 5 });
    }
    if (game.bomb.fuse <= 0) {
      game.bomb.state = 'exploded';
      game.events.push({ type: 'bombExploded', x: game.bomb.x, z: game.bomb.z });
      endRound(game, 'ember', 'Bomb detonated');
      return;
    }
  }

  const emberAlive = aliveCount(game.entities, 'ember');
  const slateAlive = aliveCount(game.entities, 'slate');
  if (emberAlive === 0) {
    endRound(game, 'slate', game.bomb.state === 'planted' ? 'Team eliminated' : 'Team eliminated');
    return;
  }
  if (slateAlive === 0) {
    endRound(game, 'ember', 'Team eliminated');
    return;
  }
  if (rounds.timer <= 0 && game.bomb.state !== 'planted') {
    endRound(game, 'slate', 'Time expired');
  }
}
