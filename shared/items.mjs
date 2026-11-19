export const ALL_ITEMS_SCOPE = 'all-items';
const classes = { 0: 'Consumable', 1: 'Container', 2: 'Weapon', 4: 'Armor', 5: 'Reagent', 6: 'Projectile', 7: 'Trade Goods', 9: 'Recipe', 11: 'Quiver', 12: 'Quest', 13: 'Key', 15: 'Miscellaneous', 18: 'WoW Token' };
const tradeSubclasses = { 0: 'Trade Goods', 1: 'Parts', 2: 'Explosives', 3: 'Devices', 4: 'Jewelcrafting', 5: 'Cloth', 6: 'Leather', 7: 'Metal & Stone', 8: 'Cooking', 9: 'Herbs', 10: 'Elemental', 11: 'Other Trade Goods', 12: 'Enchanting', 13: 'Materials', 14: 'Armor Enchantment', 15: 'Weapon Enchantment' };

export function localized(value) { return typeof value === 'string' ? value : typeof value?.en_US === 'string' ? value.en_US : ''; }

export function itemMetadata(data) {
  const id = data?.id;
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Forever item search returned an invalid item ID.');
  const name = localized(data.name), classId = data.item_class?.id, subclassId = data.item_subclass?.id;
  const hasClass = Number.isSafeInteger(classId) && classId >= 0;
  const hasSubclass = Number.isSafeInteger(subclassId) && subclassId >= 0;
  const itemClass = hasClass ? localized(data.item_class.name) || classes[classId] || `Class #${classId}` : 'Unknown';
  const subcategory = hasSubclass ? localized(data.item_subclass.name) || (classId === 7 ? tradeSubclasses[subclassId] : '') || `Subclass #${subclassId}` : '';
  // Preserve useful gathering filters while including every other trade-goods
  // subclass and every item class. These labels never restrict collection.
  const category = classId === 7 ? subclassId === 9 ? 'Herbs' : subclassId === 7 && /\bore$/i.test(name) ? 'Ores' : subcategory || itemClass : itemClass;
  return { id, name: name || `Item #${id}`, category, itemClass, subcategory,
    classId: hasClass ? classId : null, subclassId: hasSubclass ? subclassId : null,
    metadataMissing: !name || !hasClass || !hasSubclass, metadataSource: 'catalog' };
}

export function unknownItem(id) { return { ...itemMetadata({ id }), metadataSource: 'auction' }; }

export function matchesItemQuery(row, query = '') {
  return `${row.name} ${row.id} ${row.category} ${row.itemClass ?? ''} ${row.subcategory ?? ''}`.toLowerCase().includes(query.trim().toLowerCase());
}

export function pageRows(rows, requested = 1, size = 100) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.max(1, Math.min(pages, requested));
  const start = (page - 1) * size;
  return { rows: rows.slice(start, start + size), page, pages, total: rows.length, start: rows.length ? start + 1 : 0, end: Math.min(start + size, rows.length) };
}
