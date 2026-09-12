const SVG_NS = 'http://www.w3.org/2000/svg';

export type AxisOrientation = 'bottom' | 'left';

/**
 * Crisp, accessible SVG axis labels updated imperatively from the render loop.
 *
 * Tick labels move every frame while the chart scrolls. Re-rendering them through React
 * at 60 fps would reconcile a subtree per frame per chart; instead React renders the
 * empty <g> once and this class keeps a pool of <text> nodes, touching an attribute
 * only when its value actually changed.
 */
export class SvgAxis {
  private readonly nodes: SVGTextElement[] = [];
  private readonly positions: number[] = [];
  private readonly labels: string[] = [];
  private readonly hidden: boolean[] = [];
  private cross = Number.NaN;

  constructor(
    private readonly group: SVGGElement,
    private readonly orientation: AxisOrientation,
  ) {}

  /**
   * @param positions pixel position along the axis for each tick
   * @param cross     y of the label baseline (bottom) or x of the label end (left)
   * @param bounds    [min, max] pixel extent labels may occupy along the axis
   */
  update(positions: ArrayLike<number>, labels: readonly string[], count: number, cross: number, bounds: [number, number]): void {
    const crossChanged = cross !== this.cross;
    this.cross = cross;
    for (let i = 0; i < count; i++) {
      let node = this.nodes[i];
      if (!node) {
        node = document.createElementNS(SVG_NS, 'text');
        node.setAttribute('class', 'axis-label');
        if (this.orientation === 'bottom') {
          node.setAttribute('text-anchor', 'middle');
          node.setAttribute('dominant-baseline', 'hanging');
        } else {
          node.setAttribute('text-anchor', 'end');
          node.setAttribute('dominant-baseline', 'middle');
        }
        this.group.appendChild(node);
        this.nodes[i] = node;
        this.positions[i] = Number.NaN;
        this.labels[i] = '';
        this.hidden[i] = false;
      }

      const label = labels[i] ?? '';
      const pos = Math.round(positions[i] * 2) / 2;
      const halfExtent = this.orientation === 'bottom' ? label.length * 3.3 : 7;
      const outside = pos - halfExtent < bounds[0] || pos + halfExtent > bounds[1];

      if (outside !== this.hidden[i]) {
        if (outside) node.setAttribute('display', 'none');
        else node.removeAttribute('display');
        this.hidden[i] = outside;
      }
      if (outside) continue;

      if (pos !== this.positions[i] || crossChanged) {
        if (this.orientation === 'bottom') {
          node.setAttribute('x', String(pos));
          node.setAttribute('y', String(cross));
        } else {
          node.setAttribute('x', String(cross));
          node.setAttribute('y', String(pos));
        }
        this.positions[i] = pos;
      }
      if (label !== this.labels[i]) {
        node.textContent = label;
        this.labels[i] = label;
      }
    }
    for (let i = count; i < this.nodes.length; i++) {
      if (!this.hidden[i]) {
        this.nodes[i].setAttribute('display', 'none');
        this.hidden[i] = true;
      }
    }
  }
}
