import { TikzCoordinate } from '../parser/TikzPathOperations'
import { TikzCoordinateOffset } from '../parser/TikzPathOperations'
// describe the absolute svg coordinate in px
export interface AbsoluteCoordinate {
  x: number
  y: number
}

export interface BoundingBox {
  lowerLeft: AbsoluteCoordinate
  upperRight: AbsoluteCoordinate
}

export interface GeometryInterface {
  computeBoundingBox(): BoundingBox | undefined
}

export function assembleBoundingBox(glist: GeometryInterface[]): BoundingBox | undefined {
  if (!glist) return
  let box: BoundingBox | undefined = undefined
  glist.forEach((part: GeometryInterface) => {
    let partBox = part.computeBoundingBox()
    if (box === undefined) {
      box = partBox
    } else if (partBox !== undefined) {
      box = {
        lowerLeft: {
          x: Math.min(box.lowerLeft.x, partBox.lowerLeft.x),
          y: Math.min(box.lowerLeft.y, partBox.lowerLeft.y),
        },
        upperRight: {
          x: Math.max(box.upperRight.x, partBox.upperRight.x),
          y: Math.max(box.upperRight.y, partBox.upperRight.y),
        },
      }
    }
  })
  console.log(JSON.stringify(box))
  return box
}
interface ParameterInterface {
  cm2px: number
  ex2px: number
  em2px: number
  mathJaxBaseShift: number
  mathJaxContainerWidth: number
  loosenessPrefactor: number
}

export const utils_constants: ParameterInterface = {
  cm2px: 52,
  ex2px: 8,
  em2px: 16,
  loosenessPrefactor: 0.54,
  mathJaxBaseShift: 4,
  mathJaxContainerWidth: 600,
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
        x: utils_constants.cm2px * offsets[0]._offset + baseC.x,
        y: -utils_constants.cm2px * offsets[1]._offset + baseC.y,
      }
    } else {
      throw console.error('Unknow coordinate system encountered')
    }
  } else if (offsets.length === 3) {
    throw console.error('3D coordiniate is currently not supported')
  }
  return undefined
}

export function toAbsoluteOffset(offset: TikzCoordinateOffset): number {
  if (offset._unit === undefined || offset._unit === 'cm') {
    return offset._offset * utils_constants.cm2px
  }
  return NaN
}

export function parseJaxLength(length?: string): number {
  if (!length) return NaN
  return parseFloat(length.replace(/ex/, '')) * utils_constants.ex2px
}
