// FE-3/FE-5/FE-13: WebGL2 custom layer — single-bucket + range playback, loading states.
// Single mode: fetches /v1/grid/{pollutant}/{t}.bin per bucket change.
// Range mode: streams /v1/grid/{pollutant}/range chunks → decodeWorker → PlaybackEngine.

import { useEffect, useRef, useState } from 'react'
import type { CustomLayerInterface } from 'maplibre-gl'
import { useMap } from '../MapView'
import { useUiStore, selectCurrentT } from '../../store/uiStore'
import { usePollutants } from '../../api/queries'
import { apiFetchBin } from '../../api/client'
import { decodeGrid } from '../../api/binaryHeader'
import { KYIV_BBOX, bboxMercatorQuad } from '../../lib/geo'
import { addMinutes, nowBucket } from '../../lib/time'
import { getRampLUT } from '../../lib/scales'
import { DoubleBuffer } from '../playback/buffer'
import { PlaybackEngine } from '../playback/engine'
import { fetchRange } from '../../api/range'
import { VERT, FRAG } from './heatmap.glsl'

const LAYER_ID = 'adam-heatmap'
const GRID_W = 256
const GRID_H = 256
const OPACITY = 0.75

function compileShader(gl: WebGL2RenderingContext, type: GLenum, src: string): WebGLShader {
  const s = gl.createShader(type)!
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s) ?? 'shader compile failed')
  }
  return s
}

function linkProgram(gl: WebGL2RenderingContext, vert: string, frag: string): WebGLProgram {
  const prog = gl.createProgram()!
  gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER, vert))
  gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, frag))
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(prog) ?? 'program link failed')
  }
  return prog
}

function createRampTexture(gl: WebGL2RenderingContext, lut: Uint8Array): WebGLTexture {
  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return tex
}

// Insert into the prefetch cache, evicting oldest entries past the cap.
const SINGLE_CACHE_CAP = 120
function cachePut(cache: Map<string, Uint8Array>, key: string, grid: Uint8Array) {
  cache.set(key, grid)
  while (cache.size > SINGLE_CACHE_CAP) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

function buildTIndex(from: string, to: string, step: number): string[] {
  const result: string[] = []
  let cur = new Date(from).getTime()
  const end = new Date(to).getTime()
  while (cur <= end) {
    result.push(new Date(cur).toISOString().replace(/\.\d{3}Z$/, 'Z'))
    cur += step * 60_000
  }
  return result
}

export function HeatmapLayer() {
  const map = useMap()
  const pollutant = useUiStore(s => s.pollutant)
  const timeState = useUiStore(s => s.timeState)
  const currentT = useUiStore(selectCurrentT)
  const singlePlaying = useUiStore(s => s.singlePlaying)
  const setTimeState = useUiStore(s => s.setTimeState)
  const setBufferState = useUiStore(s => s.setBufferState)
  const { data: pollutants } = usePollutants()

  const mixRef = useRef(0)
  const glRef = useRef<WebGL2RenderingContext | null>(null)
  const dbRef = useRef<DoubleBuffer | null>(null)
  const rampRef = useRef<WebGLTexture | null>(null)
  const programRef = useRef<WebGLProgram | null>(null)
  const vaoRef = useRef<WebGLVertexArrayObject | null>(null)
  const engineRef = useRef<PlaybackEngine | null>(null)
  const timeStateRef = useRef(timeState)
  const prevPlayingRef = useRef<boolean | null>(null)
  const prevCurrentTRef = useRef<string>('')
  // Decoded-grid cache for single-mode prefetch (keyed by `${pollutant}/${t}`)
  const singleCacheRef = useRef<Map<string, Uint8Array>>(new Map())

  const [error, setError] = useState<string | null>(null)
  const [singleLoading, setSingleLoading] = useState(false)

  // Keep timeState ref current for use inside engine callbacks
  timeStateRef.current = timeState

  const activeScale = pollutants?.find(p => p.key === pollutant)?.scale ?? pollutant

  // ── WebGL setup ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!map) return

    const canvas = map.getCanvas()
    const gl = canvas.getContext('webgl2')
    if (!gl) {
      setError('WebGL2 not available — heatmap disabled.')
      console.error('[HeatmapLayer] WebGL2 not available')
      return
    }
    glRef.current = gl

    const db = new DoubleBuffer(gl, GRID_W, GRID_H)
    dbRef.current = db

    let prog: WebGLProgram
    let vao: WebGLVertexArrayObject
    let rampTex: WebGLTexture

    try {
      prog = linkProgram(gl, VERT, FRAG)
      programRef.current = prog

      const quad = bboxMercatorQuad(KYIV_BBOX)
      const uvs = new Float32Array([0, 0,  1, 0,  0, 1,  1, 1])
      const interleaved = new Float32Array(4 * 4)
      for (let i = 0; i < 4; i++) {
        interleaved[i * 4 + 0] = quad[i * 2 + 0]
        interleaved[i * 4 + 1] = quad[i * 2 + 1]
        interleaved[i * 4 + 2] = uvs[i * 2 + 0]
        interleaved[i * 4 + 3] = uvs[i * 2 + 1]
      }

      vao = gl.createVertexArray()!
      vaoRef.current = vao
      gl.bindVertexArray(vao)

      const buf = gl.createBuffer()!
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.bufferData(gl.ARRAY_BUFFER, interleaved, gl.STATIC_DRAW)

      const stride = 4 * 4
      const aPos = gl.getAttribLocation(prog, 'a_pos')
      const aUv = gl.getAttribLocation(prog, 'a_uv')
      gl.enableVertexAttribArray(aPos)
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, 0)
      gl.enableVertexAttribArray(aUv)
      gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, stride, 8)
      gl.bindVertexArray(null)

      rampTex = createRampTexture(gl, getRampLUT(activeScale))
      rampRef.current = rampTex
    } catch (e) {
      setError(String(e))
      return
    }

    const layer: CustomLayerInterface = {
      id: LAYER_ID,
      type: 'custom',
      renderingMode: '2d',
      onAdd() {},
      render(_gl, args) {
        const gl = glRef.current
        const db = dbRef.current
        const prog = programRef.current
        const vao = vaoRef.current
        const ramp = rampRef.current
        if (!gl || !db || !prog || !vao || !ramp) return

        // maplibre v5: render() second arg is CustomRenderMethodInput, not a raw matrix.
        // The view-projection matrix lives in defaultProjectionData.mainMatrix.
        const matrix = args.defaultProjectionData.mainMatrix

        gl.useProgram(prog)
        gl.bindVertexArray(vao)
        gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'u_matrix'), false, Float32Array.from(matrix))
        gl.uniform1f(gl.getUniformLocation(prog, 'u_mix'), mixRef.current)
        gl.uniform1f(gl.getUniformLocation(prog, 'u_opacity'), OPACITY)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, db.current)
        gl.uniform1i(gl.getUniformLocation(prog, 'u_data'), 0)
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, db.next)
        gl.uniform1i(gl.getUniformLocation(prog, 'u_data_next'), 1)
        gl.activeTexture(gl.TEXTURE2)
        gl.bindTexture(gl.TEXTURE_2D, ramp)
        gl.uniform1i(gl.getUniformLocation(prog, 'u_ramp'), 2)
        gl.enable(gl.BLEND)
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        gl.disable(gl.BLEND)
        gl.bindVertexArray(null)
      },
      onRemove() {
        dbRef.current?.destroy()
        dbRef.current = null
      },
    }

    map.addLayer(layer)

    const onRestore = () => dbRef.current?.restore()
    canvas.addEventListener('webglcontextrestored', onRestore)

    return () => {
      canvas.removeEventListener('webglcontextrestored', onRestore)
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID)
      dbRef.current?.destroy()
      dbRef.current = null
    }
  }, [map]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Ramp texture hot-swap on pollutant change ─────────────────────────────

  useEffect(() => {
    const gl = glRef.current
    if (!gl) return
    const lut = getRampLUT(activeScale)
    if (rampRef.current) {
      gl.bindTexture(gl.TEXTURE_2D, rampRef.current)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, lut)
    }
    map?.triggerRepaint()
  }, [activeScale, map])

  // ── Single-bucket fetch (single mode only) ────────────────────────────────

  useEffect(() => {
    if (!map || !glRef.current || !dbRef.current) return
    if (timeState.mode !== 'single') return

    const key = `${pollutant}/${currentT}`

    // Prefetched? Swap instantly, no loading state.
    const cached = singleCacheRef.current.get(key)
    if (cached) {
      dbRef.current.advance(cached)
      mixRef.current = 0
      map.triggerRepaint()
      setSingleLoading(false)
      return
    }

    setSingleLoading(true)
    const controller = new AbortController()

    apiFetchBin(`/v1/grid/${pollutant}/${encodeURIComponent(currentT)}.bin`, controller.signal)
      .then(buf => {
        if (!buf || !glRef.current || !dbRef.current) return
        const { grid } = decodeGrid(buf)
        cachePut(singleCacheRef.current, key, grid)
        dbRef.current.advance(grid)
        mixRef.current = 0
        map.triggerRepaint()
        setSingleLoading(false)
      })
      .catch(e => {
        if ((e as Error).name !== 'AbortError') {
          console.warn('[HeatmapLayer] fetch error', e)
          setSingleLoading(false)
        }
      })

    return () => controller.abort()
  }, [map, pollutant, currentT, timeState.mode])

  // ── Prefetch next single-mode bucket while playing ────────────────────────
  // Decode-ahead one step so the play loop's advance is an instant texture swap.
  // Skip if the next bucket is the live/future bucket (no switch into live).
  const singleStep = timeState.mode === 'single' ? timeState.step : 0
  useEffect(() => {
    if (timeState.mode !== 'single' || !singlePlaying) return
    const next = addMinutes(currentT, singleStep)
    if (next >= nowBucket()) return
    const key = `${pollutant}/${next}`
    if (singleCacheRef.current.has(key)) return

    const controller = new AbortController()
    apiFetchBin(`/v1/grid/${pollutant}/${encodeURIComponent(next)}.bin`, controller.signal)
      .then(buf => {
        if (!buf) return
        const { grid } = decodeGrid(buf)
        cachePut(singleCacheRef.current, key, grid)
      })
      .catch(() => { /* prefetch best-effort */ })

    return () => controller.abort()
  }, [pollutant, currentT, singlePlaying, singleStep, timeState.mode])

  // ── Range playback: fetch → decode → engine ───────────────────────────────

  const rangeFrom = timeState.mode === 'range' ? timeState.from : ''
  const rangeTo   = timeState.mode === 'range' ? timeState.to   : ''
  const rangeStep = timeState.mode === 'range' ? timeState.step : 0

  useEffect(() => {
    if (!map || !dbRef.current || timeState.mode !== 'range') return

    const from  = rangeFrom
    const to    = rangeTo
    const step  = rangeStep
    const tIdx  = buildTIndex(from, to, step)
    const db    = dbRef.current

    // Reset play-tracking refs so previous mode's state doesn't bleed through
    prevPlayingRef.current = null
    prevCurrentTRef.current = ''

    engineRef.current?.destroy()
    engineRef.current = null
    setBufferState({ loaded: 0, total: tIdx.length })

    const engine = new PlaybackEngine(map, db, {
      onFrameChange(t, mixFactor) {
        mixRef.current = mixFactor
        map.triggerRepaint()
        const ts = timeStateRef.current
        if (ts.mode === 'range' && t !== prevCurrentTRef.current) {
          prevCurrentTRef.current = t
          setTimeState({ ...ts, currentT: t })
        }
      },
      onBufferProgress(loaded, total) {
        setBufferState({ loaded, total })
      },
      onEnd() {
        const ts = timeStateRef.current
        if (ts.mode === 'range') {
          setTimeState({ ...ts, playing: false })
          prevPlayingRef.current = false
        }
      },
    })
    engine.load(tIdx, new Map())
    engineRef.current = engine

    const abort = new AbortController()
    const worker = new Worker(
      new URL('../../api/decodeWorker.ts', import.meta.url),
      { type: 'module' },
    )
    let msgId = 0

    worker.onmessage = (e) => {
      const msg = e.data
      if (msg.type === 'decoded') {
        ;(msg.frames as ArrayBuffer[]).forEach((frameBuf, i: number) => {
          engine.addFrame(msg.tIndex[i] as string, new Uint8Array(frameBuf))
        })
      } else if (msg.type === 'error') {
        console.warn('[HeatmapLayer] worker decode error', msg.error)
      }
    }

    fetchRange(pollutant, from, to, step, (buf) => {
      worker.postMessage({ type: 'decode', id: ++msgId, buf }, { transfer: [buf] })
    }, abort.signal).catch(e => {
      if ((e as Error).name !== 'AbortError') console.warn('[HeatmapLayer] range fetch', e)
    })

    return () => {
      abort.abort()
      worker.terminate()
      engine.destroy()
      engineRef.current = null
      setBufferState(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, pollutant, timeState.mode, rangeFrom, rangeTo, rangeStep])

  // ── Play / pause / seek control ───────────────────────────────────────────

  useEffect(() => {
    const engine = engineRef.current
    if (!engine || timeState.mode !== 'range') return

    const { playing, currentT: ct } = timeState

    if (playing !== prevPlayingRef.current) {
      prevPlayingRef.current = playing
      if (playing) {
        engine.play(ct)
      } else {
        engine.pause()
      }
    } else if (!playing && ct !== prevCurrentTRef.current) {
      // User scrubbed while paused
      prevCurrentTRef.current = ct
      engine.seek(ct)
    }
  }, [timeState])

  // ── Speed sync ────────────────────────────────────────────────────────────

  const rangeSpeed = timeState.mode === 'range' ? timeState.speed : 1
  useEffect(() => {
    if (timeState.mode === 'range') engineRef.current?.setSpeed(rangeSpeed)
  }, [rangeSpeed, timeState.mode])

  // ── Render ────────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div style={{
        position: 'absolute', bottom: 60, left: '50%', transform: 'translateX(-50%)',
        background: '#c00', color: '#fff', padding: '8px 16px', borderRadius: 4, fontSize: 13,
      }}>
        {error}
      </div>
    )
  }

  if (singleLoading && timeState.mode === 'single' && timeState.t !== 'live') {
    return (
      <div style={{
        position: 'absolute', bottom: 60, left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(20,20,20,0.8)', color: '#888', padding: '6px 14px',
        borderRadius: 4, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span>
        Loading grid…
      </div>
    )
  }

  return null
}
