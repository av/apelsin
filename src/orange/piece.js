import { mesh as glMesh, set } from '../gl.js';
import { mat4, quat, v3 } from '../math.js';
import { ATTRIBS } from '../shaders/materials.js';
import { analyseMesh, raycastMesh } from './mesh.js';
import { pieceProxy, piecePlanes, insideProxy, MAX_PLANES } from './proxy.js';

let nextId = 1;

export function createPiece(gl, geometry, pose = {}) {
  const info = analyseMesh(geometry);
  const planes = piecePlanes(geometry, info.caps);
  const proxy = pieceProxy(geometry.support, planes);
  const planeData = new Float32Array(MAX_PLANES * 4);
  planes.forEach((q, i) => planeData.set(q, i * 4));
  const piece = {
    id: nextId++, geometry, com: info.com, volume: info.volume, radius: info.radius, caps: info.caps,
    gpu: glMesh(gl, { data: proxy.data, stride: 3, attribs: [[ATTRIBS.aPos, 3]], count: proxy.count }),
    proxy, planes: planeData, planeCount: planes.length,
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
  return { material: 'orange', march: true, mesh: piece.gpu, model: piece.model, prevModel: piece.prevModel, castShadow: true, centre: piece.position, radius: piece.radius, piece };
}

export function disposePiece(piece) { piece.gpu.dispose(); }

const inverse = mat4.create();

export function bindPiece(gl, prog, d, eye, textures) {
  const piece = d.piece;
  mat4.invert(inverse, d.model);
  const rest = eye[3] > 0.5 ? mat4.transformPoint(inverse, eye) : v3.norm(mat4.transformDir(inverse, eye));
  const inside = eye[3] > 0.5 && insideProxy(piece.proxy, rest);
  gl.cullFace(inside ? gl.FRONT : gl.BACK);
  set(prog, 'uModel', d.model);
  set(prog, 'uPrevModel', d.prevModel || d.model);
  set(prog, 'uInvModel', inverse);
  set(prog, 'uEye', [rest[0], rest[1], rest[2], eye[3] > 0.5 ? (inside ? 2 : 1) : 0]);
  set(prog, 'uPlanes', piece.planes);
  set(prog, 'uPlaneCount', piece.planeCount);
  set(prog, 'uBound', [...piece.proxy.centre, piece.proxy.radius + 0.002]);
  set(prog, 'uPieceId', d.pieceId || 1);
  for (const k in textures) set(prog, k, textures[k]);
  gl.bindVertexArray(d.mesh.vao);
  gl.drawArrays(gl.TRIANGLES, 0, d.mesh.count);
}
