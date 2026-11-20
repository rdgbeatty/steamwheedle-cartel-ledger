function variant(item) {
  const bonuses = [...(item.bonus_lists ?? [])].sort((a, b) => a - b);
  const modifiers = [...(item.modifiers ?? [])].map(({ type, value }) => [type, value]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const context = item.context || 0;
  return bonuses.length || modifiers.length || context ? JSON.stringify([context, bonuses, modifiers]) : '';
}

export function normalizeAuction(row) {
  if (!Number.isSafeInteger(row.item?.id) || row.item.id < 1) throw new Error('An auction has an invalid item ID.');
  if (!Number.isSafeInteger(row.id) || row.id < 1 || !Number.isSafeInteger(row.quantity) || row.quantity < 1) throw new Error('A tracked auction has an invalid ID or quantity.');
  const unitPrice = row.unit_price ?? (row.buyout === undefined || row.buyout === 0 ? null : row.buyout / row.quantity);
  if ((row.unit_price !== undefined && (!Number.isSafeInteger(row.unit_price) || row.unit_price <= 0)) ||
    (row.buyout !== undefined && (!Number.isSafeInteger(row.buyout) || row.buyout < 0)) ||
    (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice <= 0))) throw new Error('A tracked auction has an invalid price.');
  const totalBuyout = unitPrice === null ? null : row.unit_price === undefined ? row.buyout : row.unit_price * row.quantity;
  if (totalBuyout !== null && !Number.isSafeInteger(totalBuyout)) throw new Error('A tracked auction total exceeded safe numeric precision.');
  return { id: row.id, itemId: row.item.id, variant: variant(row.item), quantity: row.quantity, unitPrice, totalBuyout };
}
