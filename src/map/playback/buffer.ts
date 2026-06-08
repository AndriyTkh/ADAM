// Double-buffer: 2 persistent WebGL2 R8 textures (current + next).
// Caller updates them via texSubImage2D; never allocates new textures per frame.

export class DoubleBuffer {
  private readonly gl: WebGL2RenderingContext
  readonly width: number
  readonly height: number
  readonly texA: WebGLTexture
  readonly texB: WebGLTexture
  private which = 0 // 0 = A is current, B is next; 1 = B is current, A is next

  constructor(gl: WebGL2RenderingContext, width: number, height: number) {
    this.gl = gl
    this.width = width
    this.height = height
    this.texA = this.createTex()
    this.texB = this.createTex()
  }

  private createTex(): WebGLTexture {
    const { gl, width, height } = this
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return tex
  }

  get current(): WebGLTexture {
    return this.which === 0 ? this.texA : this.texB
  }

  get next(): WebGLTexture {
    return this.which === 0 ? this.texB : this.texA
  }

  // Upload new grid into the "next" slot, then swap so it becomes "current"
  advance(grid: Uint8Array) {
    const { gl, width, height } = this
    gl.bindTexture(gl.TEXTURE_2D, this.next)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RED, gl.UNSIGNED_BYTE, grid)
    this.which ^= 1
  }

  // Upload into next without swapping (for pre-loading the tween target)
  uploadNext(grid: Uint8Array) {
    const { gl, width, height } = this
    gl.bindTexture(gl.TEXTURE_2D, this.next)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RED, gl.UNSIGNED_BYTE, grid)
  }

  destroy() {
    this.gl.deleteTexture(this.texA)
    this.gl.deleteTexture(this.texB)
  }

  // Re-create texture storage after context loss
  restore() {
    const { gl, width, height } = this
    gl.bindTexture(gl.TEXTURE_2D, this.texA)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, null)
    gl.bindTexture(gl.TEXTURE_2D, this.texB)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, null)
  }
}
