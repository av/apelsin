export const RIND_GMAX = 1.2;

export const RIND_GLSL = `
uniform samplerCube uRindN;
uniform samplerCube uRindC;
const float RIND_GMAX = ${RIND_GMAX.toFixed(3)};
void rindFootprint(SurfaceInput si, vec3 Nm, float rl, out vec3 dx, out vec3 dy) {
  vec3 Vr = normalize(transpose(si.restToWorld) * si.V);
  float NoV = clamp(dot(Nm, Vr), 0.08, 1.0);
  vec3 ta = Vr - Nm * dot(Nm, Vr);
  ta = dot(ta, ta) > 1e-8 ? normalize(ta) : normalize(cross(Nm, abs(Nm.y) < 0.9 ? vec3(0, 1, 0) : vec3(1, 0, 0)));
  vec3 tb = cross(Nm, ta);
  float px = max(si.pixel, 1e-6) * 0.7 / rl;
  dx = ta * px / sqrt(NoV);
  dy = tb * px;
}
Surface rindSurface(SurfaceInput si) {
  vec3 p = si.rest;
  float rl = max(length(p), 1e-5);
  vec3 d = p / rl;
  vec3 Nm = normalize(si.restNormal);
  vec3 dx, dy;
  rindFootprint(si, Nm, rl, dx, dy);
  vec4 n = textureGrad(uRindN, d, dx, dy);
  vec4 c = textureGrad(uRindC, d, dx, dy);
  vec3 g = (n.xyz * 2.0 - 1.0) * RIND_GMAX;
  float var = max(n.w * RIND_GMAX * RIND_GMAX - dot(g, g), 0.0);
  vec3 albedo = c.rgb;
  float rough = c.a;
  float relief = envelopeRelief(p);
  float wall = relief > 0.0003 ? 1.0 - smoothstep(0.35, 0.75, dot(Nm, d)) : 0.0;
  if (wall > 0.0) {
    float h = (rl - shapeAt(d).x) * 1000.0;
    float psi = atan(d.z, d.x);
    float stria = vnoise(vec3(psi * 18.0, h * 1.5, 3.0)) * 0.6 + vnoise(vec3(psi * 60.0, h * 6.0, 7.0)) * 0.4;
    vec3 side = mix(vec3(0.07, 0.08, 0.012), vec3(0.16, 0.16, 0.04), stria);
    side = mix(side, vec3(0.2, 0.19, 0.06), smoothstep(0.6, 1.0, h / max(relief * 1000.0, 0.1)) * 0.5);
    albedo = mix(albedo, side, wall);
    rough = mix(rough, 0.6, wall);
    g = mix(g, vec3(0), wall);
    var = mix(var, 0.0, wall);
  }
  Surface s = defaultSurface(vec3(0, 1, 0));
  s.N = normalize(si.restToWorld * perturb(Nm, g, 1.0));
  float r4 = rough * rough * rough * rough;
  s.albedo = clamp(albedo, 0.0, 1.0);
  s.roughness = sqrt(sqrt(r4 + var));
  s.f0 = vec3(0.015);
  float calyx = smoothstep(0.00004, 0.0001, relief);
  float wax = (1.0 - smoothstep(0.5, 0.7, rough)) * (1.0 - calyx);
  float cr = 0.1 + 0.12 * smoothstep(0.45, 0.65, rough);
  s.clearcoat = wax;
  s.clearcoatRoughness = sqrt(sqrt(cr * cr * cr * cr + var * 0.8));
  s.cavity = 1.0 - 0.1 * smoothstep(0.48, 0.62, rough) * (1.0 - calyx);
  s.sssProfile = 1.0;
  s.sssWidth = 0.45;
  s.sssColor = albedo * vec3(0.35, 0.16, 0.04) * (1.0 - calyx);
  s.transmission = albedo * vec3(0.05, 0.015, 0.0) * (1.0 - calyx);
  return s;
}
`;
