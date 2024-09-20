import { Context } from '../Context'
import { ElementInterface } from '../Element'

// MarkerElemets are definition of markers to be generated in <defs> elements in svg
export class TikzMarkerElement implements ElementInterface {
  _ctx?: Context
  _uid?: string
  constructor(ctx?: Context) {
    this._ctx = ctx
  }
  render(): HTMLElement[] {
    return []
  }
}

class TikzArrowMarkerElement extends TikzMarkerElement {
  _uid = 'arrow'
  render(): HTMLElement[] {
    let marker = document.createElement('marker')
    marker.setAttribute('id', this._uid)
    marker.setAttribute('viewBox', '0 0 10 10')
    marker.setAttribute('refX', '9')
    marker.setAttribute('refY', '5')
    marker.setAttribute('markerWidth', '6')
    marker.setAttribute('markerHeight', '6')
    marker.setAttribute('stroke', 'context-stroke')
    marker.setAttribute('fill', 'context-stroke')
    marker.setAttribute('orient', 'auto')

    let path = document.createElement('path')
    path.setAttribute('d', 'M 0 0 L 10 5 L 0 10 L 5 5 z')
    path.setAttribute('stroke-linejoin', 'miter')
    marker.append(path)
    return [marker]
  }
}

class TikzReversedArrowMarkerElement extends TikzMarkerElement {
  _uid = 'revesed_arrow'
  render(): HTMLElement[] {
    let marker = document.createElement('marker')
    marker.setAttribute('id', this._uid)
    marker.setAttribute('viewBox', '0 0 10 10')
    marker.setAttribute('refX', '1')
    marker.setAttribute('refY', '5')
    marker.setAttribute('markerWidth', '6')
    marker.setAttribute('markerHeight', '6')
    marker.setAttribute('stroke', 'context-stroke')
    marker.setAttribute('fill', 'context-stroke')
    marker.setAttribute('orient', 'auto')
    let path = document.createElement('path')
    path.setAttribute('d', 'M 10 10 L 0 5 L 10 0 L 5 5 z')
    path.setAttribute('stroke-linejoin', 'miter')
    marker.append(path)
    return [marker]
  }
}

const defaultArrowMarker = new TikzArrowMarkerElement()
const defaultReversedArrowMarker = new TikzReversedArrowMarkerElement()

export { defaultArrowMarker, defaultReversedArrowMarker }
