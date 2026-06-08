// Kyiv geographic constants + mercator helpers for shader vertex transform

// [west, south, east, north] — matches backend config.py ADAM_BBOX
export const KYIV_BBOX: [number, number, number, number] = [30.2, 50.2, 30.9, 50.6]

export const KYIV_CENTER: [number, number] = [30.55, 50.4]
export const KYIV_ZOOM = 11
export const KYIV_MIN_ZOOM = 9
export const KYIV_MAX_ZOOM = 16

// Web Mercator [0,1] projection
export function mercatorX(lng: number): number {
  return (lng + 180) / 360
}

export function mercatorY(lat: number): number {
  const sinLat = Math.sin((lat * Math.PI) / 180)
  return (1 - Math.log((1 + sinLat) / (1 - sinLat)) / (2 * Math.PI)) / 2
}

// Returns [x0,y0, x1,y0, x0,y1, x1,y1] mercator corners for the Kyiv bbox
// Used to build the heatmap quad vertex buffer
export function bboxMercatorQuad(
  bbox: [number, number, number, number] = KYIV_BBOX,
): Float32Array {
  const [west, south, east, north] = bbox
  return new Float32Array([
    mercatorX(west), mercatorY(north), // TL — UV (0,0)
    mercatorX(east), mercatorY(north), // TR — UV (1,0)
    mercatorX(west), mercatorY(south), // BL — UV (0,1)
    mercatorX(east), mercatorY(south), // BR — UV (1,1)
  ])
}
