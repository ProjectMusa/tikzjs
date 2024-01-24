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
} from './TikzRoot'

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
  tikzOption: TikzOption,
}
