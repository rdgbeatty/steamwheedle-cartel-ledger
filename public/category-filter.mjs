// Each page keeps its own selection. A null selection follows all categories,
// including categories discovered in a later snapshot; an empty set means none.
export class CategoryFilter {
  constructor(container, summary, onChange) {
    this.container = container; this.summary = summary; this.onChange = onChange;
    this.selected = null; this.categories = []; this.source = null;
  }
  setRows(rows) {
    if (this.source === rows) return;
    this.source = rows;
    this.categories = [...new Set(rows.map((row) => row.category))].sort((a, b) => a.localeCompare(b));
    this.draw();
  }
  matches(row) { return this.selected === null || this.selected.has(row.category); }
  draw() {
    const make = (tag, text) => { const element = document.createElement(tag); if (text) element.textContent = text; return element; };
    const actions = make('div'); actions.className = 'category-actions';
    for (const [action, label] of [['all', 'All'], ['none', 'None']]) {
      const button = make('button', label); button.type = 'button'; button.dataset.action = action;
      button.addEventListener('click', () => { this.selected = action === 'all' ? null : new Set(); this.draw(); this.onChange(); });
      actions.append(button);
    }
    const grid = make('div'); grid.className = 'category-options';
    for (const category of this.categories) {
      const label = make('label'); label.className = 'checkbox';
      const input = make('input'); input.type = 'checkbox'; input.dataset.category = category;
      input.checked = this.selected === null || this.selected.has(category);
      input.addEventListener('change', () => {
        if (this.selected === null) this.selected = new Set(this.categories);
        if (input.checked) this.selected.add(category); else this.selected.delete(category);
        this.updateSummary(); this.onChange();
      });
      label.append(input, document.createTextNode(category)); grid.append(label);
    }
    this.container.replaceChildren(actions, grid); this.updateSummary();
  }
  updateSummary() {
    const selected = this.categories.filter((category) => this.selected === null || this.selected.has(category));
    this.summary.textContent = `Categories · ${this.selected === null ? 'All' : !selected.length ? 'None' : selected.length === 1 ? selected[0] : `${selected.length} selected`}`;
  }
}
