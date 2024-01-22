import {
  TikzInline,
  TikzPicture,
  TikzRoot,
  TikzLiteral,
  TikzPath,
  TikzPathOperation,
  TikzOption,
  TikzLineOperation,
  TikzCoordinate,
  TikzCoordinateOffset,
} from './TikzRoot'

export const factory = {
  tikzRoot: TikzRoot,
  tikzInline: TikzInline,
  tikzPicture: TikzPicture,
  tikzLiteral: TikzLiteral,
  tikzPath: TikzPath,
  tikzCoordinate: TikzCoordinate,
  tikzCoordinateOffset: TikzCoordinateOffset,
  tikzPathOperation: TikzPathOperation,
  tikzLineOperation: TikzLineOperation,
  tikzOption: TikzOption,
}
