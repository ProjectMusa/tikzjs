import {
  TikzInline,
  TikzPicture,
  TikzRoot,
  TikzLiteral,
  TikzPath,
  TikzOption,
  TikzGridOperation,
  TikzLineOperation,
  TikzCoordinate,
  TikzCoordinateOffset,
  TikzCurveOperation,
  TikzToPathOperation,
  TikzNodeOperation,
} from './TikzRoot'

import { group_checker } from './Parser'

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
