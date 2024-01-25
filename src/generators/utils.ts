import { TikzCoordinate } from '../parser/TikzPathOperations'

export interface AbsoluteCoordinate {
  x: number
  y: number
}

export function toAbsoluteCoordinate(
  coordinate: TikzCoordinate,
  baseC: AbsoluteCoordinate,
): AbsoluteCoordinate | undefined {
  let offsets = coordinate.offsets()
  if (offsets.length === 2) {
    // 2D coordinate input
    if (coordinate._cs_type === 'canvas') {
      return {
        x: 10 * offsets[0]._offset + baseC.x,
        y: -10 * offsets[1]._offset + baseC.y,
      }
    } else {
      throw console.error('Unknow coordinate system encountered')
    }
  } else if (offsets.length === 3) {
    throw console.error('3D coordiniate is currently not supported')
  }
  return undefined
}
