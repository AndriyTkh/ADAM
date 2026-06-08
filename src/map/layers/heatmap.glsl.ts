// Vertex + fragment shaders for heatmap WebGL2 custom layer.
// Vertex: static quad over Kyiv bbox, mercator coords → clip via u_matrix.
// Fragment: sample R8 data texture → lookup color ramp → composite with opacity.

export const VERT = /* glsl */ `#version 300 es
precision highp float;

// MapLibre mercator→clip matrix (column-major Float32Array)
uniform mat4 u_matrix;

// Interleaved: xy = mercator position, zw = UV
in vec2 a_pos;
in vec2 a_uv;

out vec2 v_uv;

void main() {
  v_uv = a_uv;
  // MapLibre world coords are mercator [0,1] scaled by 512 * 2^zoom; u_matrix handles that.
  // We pass raw mercator [0,1] and the matrix maps them correctly.
  gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
}
`

export const FRAG = /* glsl */ `#version 300 es
precision mediump float;

uniform sampler2D u_data;       // R8 data texture (current frame)
uniform sampler2D u_data_next;  // R8 data texture (next frame, for tween)
uniform sampler2D u_ramp;       // RGBA ramp LUT (256x1)
uniform float u_mix;            // tween factor 0→1
uniform float u_opacity;        // layer opacity

in vec2 v_uv;
out vec4 fragColor;

void main() {
  float v0 = texture(u_data,      v_uv).r;
  float v1 = texture(u_data_next, v_uv).r;
  float v  = mix(v0, v1, u_mix);

  // skip fully-zero cells (no data)
  if (v == 0.0) discard;

  vec4 color = texture(u_ramp, vec2(v, 0.5));
  fragColor = vec4(color.rgb, color.a * u_opacity);
}
`
