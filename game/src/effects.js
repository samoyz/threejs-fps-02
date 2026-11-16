// Transient effects, pooled so the hot loop never allocates: tracer lines, impact
// sparks, smoke clouds and the bomb explosion. Each effect is a small object taken
// from a fixed pool, animated, and returned when its life runs out.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACER_POOL = 24;
const SPARK_POOL = 16;
const SMOKE_POOL = 8;

export function createEffects(scene) {
  const tracers = [];
  for (let i = 0; i < TRACER_POOL; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({
      color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0,
    }));
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }

  const sparks = [];
  for (let i = 0; i < SPARK_POOL; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({
      color: new THREE.Color(PALETTE.accent), size: 0.09, transparent: true, opacity: 0,
    }));
    points.frustumCulled = false;
    scene.add(points);
    sparks.push({ points, life: 0, velocity: new THREE.Vector3() });
  }

  const smokes = [];
  for (let i = 0; i < SMOKE_POOL; i += 1) {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(PALETTE.muted), transparent: true, opacity: 0, depthWrite: false,
    });
    const puffs = [];
    for (let j = 0; j < 7; j += 1) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mat);
      puff.position.set((j % 3 - 1) * 1.4, 0.6 + (j % 2) * 0.9, Math.floor(j / 3) * 1.2 - 0.6);
      puff.scale.setScalar(0.8 + (j % 3) * 0.35);
      group.add(puff);
      puffs.push(puff);
    }
    group.visible = false;
    scene.add(group);
    smokes.push({ group, mat, life: 0, duration: 0, x: 0, y: 0, z: 0 });
  }

  const explosionLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 22);
  scene.add(explosionLight);
  let explosionLife = 0;

  function spawnTracer(from, to) {
    const tracer = tracers.find((t) => t.life <= 0) ?? tracers[0];
    const pos = tracer.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    tracer.line.material.opacity = 0.9;
    tracer.life = 0.07;
  }

  function spawnSpark(point, normal) {
    const spark = sparks.find((s) => s.life <= 0) ?? sparks[0];
    const pos = spark.points.geometry.attributes.position;
    pos.setXYZ(0, point.x, point.y, point.z);
    pos.needsUpdate = true;
    spark.velocity.copy(normal).multiplyScalar(2.2);
    spark.velocity.y += 1.2;
    spark.points.material.opacity = 1;
    spark.life = 0.35;
  }

  function spawnSmoke(x, y, z, duration) {
    const smoke = smokes.find((s) => s.life <= 0) ?? smokes[0];
    smoke.x = x;
    smoke.y = y;
    smoke.z = z;
    smoke.duration = duration;
    smoke.life = duration;
    smoke.group.position.set(x, y, z);
    smoke.group.visible = true;
    return smoke;
  }

  function spawnExplosion(point) {
    explosionLight.position.set(point.x, point.y + 1, point.z);
    explosionLight.intensity = 60;
    explosionLife = 0.35;
  }

  // A smoke cloud blocks sight: a line of sight that crosses a live cloud fails.
  // The test samples the segment; a cloud is a sphere of radius 3 around its centre.
  function blockedBySmoke(ax, ay, az, bx, by, bz) {
    for (const smoke of smokes) {
      if (smoke.life <= 0) continue;
      const cx = smoke.x;
      const cy = smoke.y + 1;
      const cz = smoke.z;
      const dx = bx - ax;
      const dy = by - ay;
      const dz = bz - az;
      const lenSq = dx * dx + dy * dy + dz * dz;
      if (lenSq < 0.01) continue;
      let t = ((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const px = ax + dx * t - cx;
      const py = ay + dy * t - cy;
      const pz = az + dz * t - cz;
      if (px * px + py * py + pz * pz < 9) return true;
    }
    return false;
  }

  function step(dt) {
    for (const tracer of tracers) {
      if (tracer.life <= 0) continue;
      tracer.life -= dt;
      if (tracer.life <= 0) tracer.line.material.opacity = 0;
    }
    for (const spark of sparks) {
      if (spark.life <= 0) continue;
      spark.life -= dt;
      const pos = spark.points.geometry.attributes.position;
      pos.setXYZ(0, pos.getX(0) + spark.velocity.x * dt, pos.getY(0) + spark.velocity.y * dt, pos.getZ(0) + spark.velocity.z * dt);
      pos.needsUpdate = true;
      spark.velocity.y -= 6 * dt;
      spark.points.material.opacity = Math.max(0, spark.life / 0.35);
    }
    for (const smoke of smokes) {
      if (smoke.life <= 0) continue;
      smoke.life -= dt;
      const fade = Math.min(1, smoke.life / 2);
      smoke.mat.opacity = 0.42 * Math.min(1, (smoke.duration - smoke.life) * 2) * fade;
      smoke.group.rotation.y += dt * 0.15;
      if (smoke.life <= 0) smoke.group.visible = false;
    }
    if (explosionLife > 0) {
      explosionLife -= dt;
      explosionLight.intensity = Math.max(0, explosionLife / 0.35) * 60;
    }
  }

  return {
    spawnTracer,
    spawnSpark,
    spawnSmoke,
    spawnExplosion,
    blockedBySmoke,
    step,
  };
}
