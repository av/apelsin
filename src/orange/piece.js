import { mesh as glMesh } from '../gl.js';
import { mat4, quat, v3 } from '../math.js';
import { ATTRIBS } from '../shaders/materials.js';
import { STRIDE, analyseMesh, raycastMesh } from './mesh.js';
import { displaceCaps } from './relief.js';

let nextId = 1;

export function createPiece(gl, geometry, pose = {}) {
  const info = analyseMesh(geometry);
  const piece = {
    id: nextId++, geometry, com: info.com, volume: info.volume, radius: info.radius, caps: info.caps,
    gpu: glMesh(gl, { data: displaceCaps(geometry), stride: STRIDE, attribs: [[ATTRIBS.aPos, 3], [ATTRIBS.aNormal, 3], [ATTRIBS.aCap, 1]], count: geometry.count }),
    position: pose.position ? pose.position.slice() : info.com.slice(),
    rotation: pose.rotation ? pose.rotation.slice() : quat.identity(),
    model: mat4.create(), prevModel: mat4.create(), body: null, squash: 0, hasPrev: false,
  };
  updateModel(piece);
  piece.prevModel.set(piece.model);
  return piece;
}

export function updateModel(piece) {
  if (piece.hasPrev) piece.prevModel.set(piece.model);
  const m = mat4.fromRT(mat4.create(), piece.rotation, piece.position);
  const s = piece.squash;
  if (s > 0) {
    const sq = new Float32Array([1 + s * 0.5, 0, 0, 0, 0, 1 - s, 0, 0, 0, 0, 1 + s * 0.5, 0, 0, 0, 0, 1]);
    const t = mat4.fromRT(mat4.create(), [0, 0, 0, 1], piece.position);
    const ti = mat4.fromRT(mat4.create(), [0, 0, 0, 1], v3.scale(piece.position, -1));
    mat4.mul(m, t, mat4.mul(mat4.create(), sq, mat4.mul(mat4.create(), ti, m)));
  }
  const toCom = mat4.fromRT(mat4.create(), [0, 0, 0, 1], v3.scale(piece.com, -1));
  mat4.mul(piece.model, m, toCom);
  piece.hasPrev = true;
}

export function worldToRest(piece, p) {
  return v3.add(quat.rotate(quat.conj(piece.rotation), v3.sub(p, piece.position)), piece.com);
}

export function restToWorld(piece, p) {
  return v3.add(quat.rotate(piece.rotation, v3.sub(p, piece.com)), piece.position);
}

export function restDirToWorld(piece, d) { return quat.rotate(piece.rotation, d); }
export function worldDirToRest(piece, d) { return quat.rotate(quat.conj(piece.rotation), d); }

export function pieceCentre(piece) { return piece.position.slice(); }

export function raycastPiece(piece, origin, dir) {
  const o = worldToRest(piece, origin), d = worldDirToRest(piece, dir);
  const oc = v3.sub(o, piece.com);
  const b = v3.dot(oc, d), c = v3.dot(oc, oc) - piece.radius * piece.radius;
  if (b * b - c < 0) return null;
  const hit = raycastMesh(piece.geometry, o, d);
  if (!hit) return null;
  const rest = v3.add(o, v3.scale(d, hit.t));
  return { t: hit.t, rest, world: restToWorld(piece, rest), cap: hit.cap, normal: restDirToWorld(piece, hit.normal) };
}

export function drawable(piece) {
  return { material: 'orange', mesh: piece.gpu, model: piece.model, prevModel: piece.prevModel, castShadow: true, centre: piece.position, radius: piece.radius, piece };
}

export function disposePiece(piece) { piece.gpu.dispose(); }
