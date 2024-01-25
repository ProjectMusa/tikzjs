import { TikzInline, TikzPicture, TikzRoot } from './TikzRoot'
import { TikzLiteral } from './TikzLiteral'
import { TikzPath } from './TikzPath'
import { TikzOption } from './TikzOptions'
import {
  TikzCoordinate,
  TikzCoordinateOffset,
  TikzLineOperation,
  TikzGridOperation,
  TikzCurveOperation,
  TikzToPathOperation,
  TikzNodeOperation,
} from './TikzPathOperations'
import { group_checker } from './group_checker'

export const factory = {
  tikzRoot: TikzRoot,
  tikzInline: TikzInline,
  tikzPicture: TikzPicture,
  tikzLiteral: TikzLiteral,
  tikzPath: TikzPath,
  tikzCoordinate: TikzCoordinate,
  tikzCoordinateOffset: TikzCoordinateOffset,
  tikzLineOperation: TikzLineOperation,
  tikzGridOperation: TikzGridOperation,
  tikzCurveOperation: TikzCurveOperation,
  tikzToPathOperation: TikzToPathOperation,
  tikzNodeOperation: TikzNodeOperation,
  tikzOption: TikzOption,
}

export const g = group_checker
