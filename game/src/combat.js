// Combat: the hitscan shot, damage with headshots and armour, thrown grenades and
// the bomb's plant and defuse channels. It owns no state of its own; it works on the
// game object main.js builds, so the player, the bots and the round logic all shoot
// through the same code and the same numbers.
import * as THREE from 'three';
import { WEAPONS, GRENADES, takeRound, pullTrigger, spreadOf } from './weapons.js';

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _point = new THREE.Vector3();
const _eye = new THREE.Vector3();

function eyeOf(entity) {
  const body = entity.mover.state;
  _eye.set(body.position.x, body.position.y + body.eye, body.position.z);
  return _eye;
}

function chestOf(entity) {
  const body = entity.mover.state;
  return { x: body.position.x, y: body.position.y + 1.1, z: body.position.z };
}

export function createCombat(game) {
  const { scene, world, effects, audio } = game;
  const raycaster = new THREE.Raycaster();
  const grenades = [];
  const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6, metalness: 0.4 });

  function hitMeshes(except) {
    const meshes = world.shootables.slice();
    for (const entity of game.entities) {
      if (!entity.alive || entity === except) continue;
      meshes.push(entity.hit.torso, entity.hit.head);
    }
    return meshes;
  }

  // One hitscan shot. origin and direction come from the shooter; spread is applied
  // by the caller. Returns what it hit, so the caller can score and sound it.
  function fireHitscan(shooter, origin, direction, spread) {
    const weapon = shooter.weapon;
    if (!takeRound(weapon)) return { fired: false };
    _dir.copy(direction);
    if (spread > 0) {
      _dir.x += (game.random() * 2 - 1) * spread;
      _dir.y += (game.random() * 2 - 1) * spread;
      _dir.z += (game.random() * 2 - 1) * spread;
      _dir.normalize();
    }
    pullTrigger(weapon);
    const pellets = weapon.def.pellets ?? 1;
    let hitAny = null;
    for (let p = 0; p < pellets; p += 1) {
      const dir = _dir.clone();
      if (pellets > 1) {
        dir.x += (game.random() * 2 - 1) * weapon.def.spreadStill * 2;
        dir.y += (game.random() * 2 - 1) * weapon.def.spreadStill * 2;
        dir.z += (game.random() * 2 - 1) * weapon.def.spreadStill * 2;
        dir.normalize();
      }
      raycaster.set(origin, dir);
      raycaster.far = weapon.def.range;
      const hits = raycaster.intersectObjects(hitMeshes(shooter), false);
      const hit = hits[0];
      if (!hit) continue;
      const target = hit.object.userData.entity;
      if (target) {
        const part = hit.object.userData.part;
        const killed = damageEntity(target, weapon.def.damage * (part === 'head' ? weapon.def.headMult : 1), part, shooter);
        if (!hitAny) hitAny = { hit: true, killed, headshot: part === 'head', target };
        else if (killed) hitAny.killed = true;
      } else {
        effects.spawnSpark(hit.point, hit.face ? hit.face.normal : new THREE.Vector3(0, 1, 0));
      }
      effects.spawnTracer(origin, hit.point);
    }
    if (!hitAny) {
      _point.copy(origin).addScaledVector(_dir, weapon.def.range);
      effects.spawnTracer(origin, _point);
    }
    return { fired: true, ...(hitAny ?? { hit: false }) };
  }

  function damageEntity(target, amount, part, attacker) {
    if (!target.alive) return false;
    let final = amount * (attacker?.damageScale ?? 1);
    if (target.armor > 0) {
      const absorbed = Math.min(target.armor, final * 0.5);
      target.armor -= absorbed;
      final -= absorbed;
    }
    target.hp -= final;
    target.hurtAt = game.time;
    game.events.push({ type: 'damage', target, attacker, amount: final, part });
    if (target.hp > 0) return false;
    target.hp = 0;
    target.alive = false;
    target.deathAt = game.time;
    game.events.push({ type: 'kill', target, attacker, headshot: part === 'head' });
    return true;
  }

  function throwGrenade(thrower, kind) {
    const def = GRENADES[kind];
    const body = thrower.mover.state;
    const origin = eyeOf(thrower);
    const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
    mesh.castShadow = true;
    scene.add(mesh);
    const dir = new THREE.Vector3();
    thrower.mover.state && thrower.getAimDirection(dir);
    const velocity = dir.multiplyScalar(15);
    velocity.y += 2.5;
    grenades.push({
      mesh,
      kind,
      def,
      thrower,
      fuse: def.fuse,
      position: new THREE.Vector3(origin.x, origin.y, origin.z),
      velocity,
    });
    return true;
  }

  function explodeFrag(grenade) {
    const pos = grenade.position;
    effects.spawnExplosion(pos);
    audio.explosion();
    game.events.push({ type: 'explosion', position: { x: pos.x, y: pos.y, z: pos.z } });
    for (const entity of game.entities) {
      if (!entity.alive) continue;
      const chest = chestOf(entity);
      const dx = chest.x - pos.x;
      const dy = chest.y - pos.y;
      const dz = chest.z - pos.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > grenade.def.radius) continue;
      if (!world.hasLineOfSight(pos.x, pos.y, pos.z, chest.x, chest.y, chest.z)) continue;
      const falloff = 1 - (dist / grenade.def.radius) * 0.75;
      damageEntity(entity, grenade.def.maxDamage * falloff, 'body', grenade.thrower);
    }
  }

  function stepGrenades(dt) {
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const g = grenades[i];
      g.fuse -= dt;
      g.velocity.y -= 12 * dt;
      const next = g.position.clone().addScaledVector(g.velocity, dt);
      // A grenade bounces off the world's boxes: test each axis, reflect and damp.
      for (const collider of world.colliders) {
        if (next.x > collider.min.x - 0.09 && next.x < collider.max.x + 0.09
          && next.y > collider.min.y - 0.09 && next.y < collider.max.y + 0.09
          && next.z > collider.min.z - 0.09 && next.z < collider.max.z + 0.09) {
          const px = Math.min(Math.abs(next.x - collider.min.x), Math.abs(next.x - collider.max.x));
          const py = Math.min(Math.abs(next.y - collider.min.y), Math.abs(next.y - collider.max.y));
          const pz = Math.min(Math.abs(next.z - collider.min.z), Math.abs(next.z - collider.max.z));
          if (px <= py && px <= pz) g.velocity.x *= -0.45;
          else if (py <= px && py <= pz) g.velocity.y *= -0.45;
          else g.velocity.z *= -0.45;
        }
      }
      g.position.addScaledVector(g.velocity, dt);
      if (g.position.y < 0.09) {
        g.position.y = 0.09;
        g.velocity.y = Math.abs(g.velocity.y) * 0.45;
        g.velocity.x *= 0.7;
        g.velocity.z *= 0.7;
      }
      g.mesh.position.copy(g.position);
      if (g.fuse <= 0) {
        if (g.kind === 'frag') explodeFrag(g);
        else {
          effects.spawnSmoke(g.position.x, 0, g.position.z, g.def.duration);
          game.events.push({ type: 'smoke', position: { x: g.position.x, y: 0, z: g.position.z } });
        }
        scene.remove(g.mesh);
        grenades.splice(i, 1);
      }
    }
  }

  return {
    fireHitscan,
    damageEntity,
    throwGrenade,
    stepGrenades,
    eyeOf,
    chestOf,
    spreadOf,
  };
}

// The bomb: one planted charge per round. Planting takes 3 s inside a site, defusing
// takes 5 s at the charge, and either channel breaks if the channeler moves, shoots
// or takes damage. The round logic owns the timers; this owns the channel rules.
export function createBomb() {
  return {
    state: 'idle',
    site: null,
    x: 0,
    z: 0,
    plantedAt: 0,
    fuse: 35,
    plantBy: null,
    plantProgress: 0,
    defuseBy: null,
    defuseProgress: 0,
    beepAt: 0,
  };
}
