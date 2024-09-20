import { TikzOption } from '../parser/TikzOptions'
import { BoundingBox } from './utils'

export interface ElementInterface {
  render(): HTMLElement[]
}

export interface OptionableElementInterface extends ElementInterface {
  applyOption(option: TikzOption): void
}
