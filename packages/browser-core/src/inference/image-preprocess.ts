export type LetterboxLayout = Readonly<{
  width: number
  height: number
  x: number
  y: number
}>

export function calculateLetterboxLayout(sourceWidth: number, sourceHeight: number, targetSize: number): LetterboxLayout {
  const scale = Math.min(targetSize / sourceHeight, targetSize / sourceWidth)
  const height = Math.max(1, Math.trunc(sourceHeight * scale))
  const width = Math.max(1, Math.trunc(sourceWidth * scale))
  return {
    width,
    height,
    x: Math.trunc((targetSize - width) / 2),
    y: Math.trunc((targetSize - height) / 2),
  }
}

export function copyRgbaToChwFloat32(rgba: Uint8ClampedArray, output: Float32Array, plane: number): void {
  for (let index = 0, offset = 0; index < plane; index += 1, offset += 4) {
    output[index] = (rgba[offset] ?? 0) / 255
    output[plane + index] = (rgba[offset + 1] ?? 0) / 255
    output[plane * 2 + index] = (rgba[offset + 2] ?? 0) / 255
  }
}
