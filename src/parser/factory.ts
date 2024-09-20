import { TikzInline, TikzPicture, TikzRoot } from './TikzRoot'
import { TikzLiteral } from './TikzLiteral'
import { TikzPath } from './TikzPath'
import { TikzColorOption, TikzNodeOption, TikzOption } from './TikzOptions'
import {
  TikzCoordinate,
  TikzCoordinateOffset,
  TikzLineOperation,
  TikzGridOperation,
  TikzCurveOperation,
  TikzToPathOperation,
  TikzNodeOperation,
  TikzNodeAliasCoordinate,
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
  tikzNodeAliasCoordinate: TikzNodeAliasCoordinate,
  tikzLineOperation: TikzLineOperation,
  tikzGridOperation: TikzGridOperation,
  tikzCurveOperation: TikzCurveOperation,
  tikzToPathOperation: TikzToPathOperation,
  tikzNodeOperation: TikzNodeOperation,
  tikzOption: TikzOption,
  tikzColorOption: TikzColorOption,
  tikzNodeOption: TikzNodeOption,
}

export const g = group_checker
