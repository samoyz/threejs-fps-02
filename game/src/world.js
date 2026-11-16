// The map: Foundry Yard, an original dusk industrial yard. Two bombsites (A west,
// B east), three lanes between the spawns, and cover placed so every lane stays
// walkable. Plain box geometry only, no models and no textures. It also owns the
// waypoint graph the bots walk and the line-of-sight test they see through.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoints: id -> [x, z]. Edges are pairs of ids; a bot walks the shortest path
// between them, so an edge must be a straight walk with no box in the way.
const NODES = {
  emberSpawn: [0, 13],
  emberWest: [-6, 12],
  emberEast: [6, 12],
  southMid: [0, 8.5],
  westJunction: [-11, 8],
  eastJunction: [11, 8],
  midDoorSouth: [0, 6],
  midSouth: [0, 3.5],
  midWest: [-3, 0],
  midEast: [3, 0],
  midNorth: [0, -3.5],
  midDoorNorth: [0, -6],
  midNorthHold: [0, -9],
  westLane: [-11, 2],
  eastLane: [11, 2],
  westLaneNorth: [-11, -3],
  eastLaneNorth: [11, -3],
  siteAEntry: [-11, -6],
  siteBEntry: [11, -6],
  siteA: [-15.5, -9.5],
  siteB: [15.5, -9.5],
  siteAHold: [-15, -14],
  siteBHold: [15, -14],
  slateSpawn: [0, -13],
  slateWest: [-6, -12],
  slateEast: [6, -12],
  aRoam: [-4, -9],
  bRoam: [4, -9],
};

const EDGES = [
  ['emberSpawn', 'emberWest'], ['emberSpawn', 'emberEast'], ['emberSpawn', 'southMid'],
  ['emberWest', 'westJunction'], ['emberEast', 'eastJunction'],
  ['southMid', 'midDoorSouth'], ['southMid', 'westJunction'], ['southMid', 'eastJunction'],
  ['westJunction', 'westLane'], ['eastJunction', 'eastLane'],
  ['midDoorSouth', 'midSouth'],
  ['midSouth', 'midWest'], ['midSouth', 'midEast'],
  ['midWest', 'midNorth'], ['midEast', 'midNorth'],
  ['midWest', 'westLaneNorth'], ['midEast', 'eastLaneNorth'],
  ['midNorth', 'midDoorNorth'], ['midNorth', 'aRoam'], ['midNorth', 'bRoam'],
  ['midDoorNorth', 'midNorthHold'],
  ['midNorthHold', 'slateSpawn'], ['midNorthHold', 'aRoam'], ['midNorthHold', 'bRoam'],
  ['westLane', 'westLaneNorth'], ['eastLane', 'eastLaneNorth'],
  ['westLaneNorth', 'siteAEntry'], ['eastLaneNorth', 'siteBEntry'],
  ['siteAEntry', 'siteA'], ['siteBEntry', 'siteB'],
  ['siteA', 'siteAHold'], ['siteB', 'siteBHold'],
  ['slateSpawn', 'slateWest'], ['slateSpawn', 'slateEast'],
  ['slateWest', 'siteAHold'], ['slateWest', 'aRoam'],
  ['slateEast', 'siteBHold'], ['slateEast', 'bRoam'],
  ['aRoam', 'siteAEntry'], ['bRoam', 'siteBEntry'],
];

export const SITES = {
  A: { x: -15.5, z: -9.5, radius: 4.2 },
  B: { x: 15.5, z: -9.5, radius: 4.2 },
};

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.03,
    });
  }
  const siteMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.accent),
    roughness: 0.4,
    metalness: 0.1,
    emissive: new THREE.Color(PALETTE.accent),
    emissiveIntensity: 0.55,
  });

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Floor and perimeter, 40 x 32 m, walls 5 m high.
  box(40.4, 0.4, 32.4, 0, -0.2, 0, 'canvas');
  box(0.4, 5, 32.4, -20.2, 2.5, 0, 'surface');
  box(0.4, 5, 32.4, 20.2, 2.5, 0, 'surface');
  box(40.4, 5, 0.4, 0, 2.5, -16.2, 'surface');
  box(40.4, 5, 0.4, 0, 2.5, 16.2, 'surface');

  // Mid chokes: two doorways, one south and one north of the hall.
  box(5, 2.2, 0.6, -3.5, 1.1, 6, 'hairline');
  box(5, 2.2, 0.6, 3.5, 1.1, 6, 'hairline');
  box(5, 2.2, 0.6, -3.5, 1.1, -6, 'hairline');
  box(5, 2.2, 0.6, 3.5, 1.1, -6, 'hairline');
  // Central pillar in the hall.
  box(2, 3.4, 2, 0, 1.7, 0, 'surface');
  // Mid crates, off the walk lines.
  box(1.4, 0.9, 1.4, -4, 0.45, 2.5, 'hairline');
  box(1.4, 0.9, 1.4, 4, 0.45, -2.5, 'hairline');

  // West lane: a container on the outer edge, crates on the inner edge, a low wall
  // guarding the site entry. East lane mirrors it.
  box(1.2, 2.4, 4.5, -14.5, 1.2, 2, 'surface');
  box(1.4, 1.1, 1.4, -9, 0.55, 3.5, 'hairline');
  box(1.1, 0.8, 1.1, -8, 0.4, -3, 'hairline');
  box(2.4, 1.1, 0.6, -10.5, 0.55, -7.5, 'surface');
  box(1.2, 2.4, 4.5, 14.5, 1.2, 2, 'surface');
  box(1.4, 1.1, 1.4, 9, 0.55, 3.5, 'hairline');
  box(1.1, 0.8, 1.1, 8, 0.4, -3, 'hairline');
  box(2.4, 1.1, 0.6, 10.5, 0.55, -7.5, 'surface');

  // Site A: a tall container along the west wall, two crates inside the zone.
  box(1.2, 2.4, 4.8, -17.5, 1.2, -12.5, 'surface');
  box(1.6, 1.1, 1.6, -13, 0.55, -10, 'hairline');
  box(1.1, 0.8, 1.1, -15, 0.4, -6.5, 'hairline');
  // Site B mirrors it.
  box(1.2, 2.4, 4.8, 17.5, 1.2, -12.5, 'surface');
  box(1.6, 1.1, 1.6, 13, 0.55, -10, 'hairline');
  box(1.1, 0.8, 1.1, 15, 0.4, -6.5, 'hairline');

  // Spawn cover, off the centre line so the spawn-to-mid walk is clear.
  box(1.4, 0.9, 1.4, -4, 0.45, 11, 'hairline');
  box(1.4, 0.9, 1.4, 4, 0.45, 11, 'hairline');
  box(1.4, 0.9, 1.4, -3, 0.45, -11, 'hairline');
  box(1.4, 0.9, 1.4, 3, 0.45, -11, 'hairline');

  // Bombsite markers: a glowing ring on the ground and a light beam, so a site
  // reads from across the yard. They are not colliders.
  const siteMarkers = {};
  for (const [key, site] of Object.entries(SITES)) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.radius - 0.35, site.radius, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.02, site.z);
    group.add(ring);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 6, 8, 1, true),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
    );
    beam.position.set(site.x, 3, site.z);
    group.add(beam);
    siteMarkers[key] = { ring, beam };
  }

  // Light: a low amber sun from the south-west, a cool fill, and a sky gradient.
  const sky = new THREE.HemisphereLight(new THREE.Color(PALETTE.surface), new THREE.Color(PALETTE.canvas), 1.15);
  scene.add(sky);
  const key = new THREE.DirectionalLight(new THREE.Color(PALETTE.accent), 2.0);
  key.position.set(-9, 16, 12);
  key.target.position.set(0, 0, -2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -24;
  key.shadow.camera.right = 24;
  key.shadow.camera.top = 24;
  key.shadow.camera.bottom = -24;
  key.shadow.camera.far = 60;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.slate), 0.5);
  fill.position.set(10, 10, -12);
  scene.add(fill);

  // Waypoint graph: adjacency lists, then BFS shortest paths.
  const adjacency = {};
  for (const id of Object.keys(NODES)) adjacency[id] = [];
  for (const [a, b] of EDGES) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }

  function findPath(fromId, toId) {
    if (fromId === toId) return [fromId];
    const prev = { [fromId]: null };
    const queue = [fromId];
    while (queue.length) {
      const current = queue.shift();
      for (const next of adjacency[current] ?? []) {
        if (prev[next] !== undefined) continue;
        prev[next] = current;
        if (next === toId) {
          const path = [toId];
          let step = toId;
          while (prev[step] !== null) {
            step = prev[step];
            path.unshift(step);
          }
          return path;
        }
        queue.push(next);
      }
    }
    return [fromId];
  }

  function nearestNode(x, z) {
    let best = null;
    let bestDist = Infinity;
    for (const [id, [nx, nz]] of Object.entries(NODES)) {
      const d = (nx - x) * (nx - x) + (nz - z) * (nz - z);
      if (d < bestDist) {
        bestDist = d;
        best = id;
      }
    }
    return best;
  }

  const raycaster = new THREE.Raycaster();
  raycaster.far = 90;
  const losFrom = new THREE.Vector3();
  const losDir = new THREE.Vector3();

  function hasLineOfSight(ax, ay, az, bx, by, bz) {
    losFrom.set(ax, ay, az);
    losDir.set(bx - ax, by - ay, bz - az);
    const dist = losDir.length();
    if (dist < 0.01) return true;
    losDir.multiplyScalar(1 / dist);
    raycaster.set(losFrom, losDir);
    raycaster.far = dist;
    return raycaster.intersectObjects(shootables, false).length === 0;
  }

  return {
    colliders,
    shootables,
    group,
    siteMarkers,
    nodePos(id) {
      const [x, z] = NODES[id];
      return { x, z };
    },
    nearestNode,
    findPath,
    hasLineOfSight,
    siteAt(x, z) {
      for (const [key, site] of Object.entries(SITES)) {
        const dx = x - site.x;
        const dz = z - site.z;
        if (dx * dx + dz * dz <= site.radius * site.radius) return key;
      }
      return null;
    },
  };
}
