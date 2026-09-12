/**
 * Imperative tooltip for canvas charts. The tooltip follows the pointer and, in live
 * mode, its values change every frame as data scrolls underneath, so it is updated from
 * the render loop with textContent (never innerHTML) and reused DOM nodes.
 */

export type KeyShape = 'line' | 'rect' | 'none';

interface Row {
  root: HTMLDivElement;
  key: HTMLSpanElement;
  value: HTMLSpanElement;
  label: HTMLSpanElement;
  text: [string, string, string];
}

export class TooltipController {
  private readonly header: HTMLDivElement;
  private readonly rows: Row[] = [];
  private visibleRows = 0;
  private shown = false;
  private headerText = '';
  private lastTransform = '';

  constructor(private readonly root: HTMLDivElement) {
    root.replaceChildren();
    this.header = document.createElement('div');
    this.header.className = 'tooltip-header';
    root.appendChild(this.header);
  }

  setHeader(text: string): void {
    if (text !== this.headerText) {
      this.header.textContent = text;
      this.headerText = text;
    }
  }

  setRow(index: number, value: string, label: string, color: string, shape: KeyShape): void {
    let row = this.rows[index];
    if (!row) {
      const root = document.createElement('div');
      root.className = 'tooltip-row';
      const key = document.createElement('span');
      const valueEl = document.createElement('span');
      valueEl.className = 'tooltip-value';
      const labelEl = document.createElement('span');
      labelEl.className = 'tooltip-label';
      root.append(key, valueEl, labelEl);
      this.root.appendChild(root);
      row = { root, key, value: valueEl, label: labelEl, text: ['', '', ''] };
      this.rows[index] = row;
    }
    if (row.text[0] !== value) {
      row.value.textContent = value;
      row.text[0] = value;
    }
    if (row.text[1] !== label) {
      row.label.textContent = label;
      row.text[1] = label;
    }
    const keyClass = `tooltip-key tooltip-key-${shape}`;
    if (row.text[2] !== color + keyClass) {
      row.key.className = keyClass;
      row.key.style.background = shape === 'none' ? 'transparent' : color;
      row.text[2] = color + keyClass;
    }
    if (index >= this.visibleRows) row.root.hidden = false;
  }

  setRowCount(count: number): void {
    for (let i = count; i < this.rows.length; i++) this.rows[i].root.hidden = true;
    for (let i = 0; i < Math.min(count, this.rows.length); i++) this.rows[i].root.hidden = false;
    this.visibleRows = count;
  }

  /** Position near (x, y) inside a container of the given size, flipping at the edges. */
  show(x: number, y: number, containerWidth: number, containerHeight: number): void {
    const w = this.root.offsetWidth || 180;
    const h = this.root.offsetHeight || 80;
    let left = x + 14;
    if (left + w > containerWidth - 4) left = x - w - 14;
    left = Math.max(4, left);
    let top = y - h / 2;
    top = Math.max(4, Math.min(containerHeight - h - 4, top));
    const transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    if (transform !== this.lastTransform) {
      this.root.style.transform = transform;
      this.lastTransform = transform;
    }
    if (!this.shown) {
      this.root.dataset.visible = 'true';
      this.shown = true;
    }
  }

  hide(): void {
    if (this.shown) {
      this.root.dataset.visible = 'false';
      this.shown = false;
    }
  }
}
