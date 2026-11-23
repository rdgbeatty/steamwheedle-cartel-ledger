import { HISTORY_BATCH_HOURS, US_PVP } from '../shared/market.mjs';
import { compactNumber, splitCopper } from './format.mjs';

const HOUR_MS = 3_600_000;
const MARKETS = [
  { house: US_PVP.houses.alliance, label: 'Alliance', faction: 'alliance', color: '#7ab8f5' },
  { house: US_PVP.houses.horde, label: 'Horde', faction: 'horde', color: '#f39c91' },
  { house: US_PVP.houses.neutral, label: 'Neutral', faction: 'neutral', color: '#b9d483' }
];
const timeLabel = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', timeZoneName: 'short' });
const axisTime = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric' });
const stockFormat = new Intl.NumberFormat();

function priceLabel(value) {
  const [gold, silver, copper] = splitCopper(value);
  return [gold && gold + 'g', silver && silver + 's', copper && copper + 'c'].filter(Boolean).join(' ') || '0c';
}

function axisPrice(value) {
  if (value >= 10_000) return compactNumber(value / 10_000) + 'g';
  if (value >= 100) return compactNumber(value / 100) + 's';
  return compactNumber(value) + 'c';
}

// Emit segments between real buyouts only. A longer span uses a dashed path.
export function priceSegments(points) {
  const segments = [];
  let previous;
  for (const point of points) {
    if (point.price === null) continue;
    if (previous) segments.push({ start: previous, end: point, interpolated: point.hour > previous.hour + 1 });
    previous = point;
  }
  return segments;
}

function drawChart(canvas, { from, to, series, selectedHour }) {
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return;
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (!width || !height) return;
  const ratio = Math.min(globalThis.devicePixelRatio ?? 1, 2);
  const left = 56, right = width - 13, top = 15, bottom = height - 25;
  if (right <= left) return;

  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  ctx.scale(ratio, ratio);
  const x = (hour) => left + (hour - from) / (to - from) * (right - left);
  let min = Infinity, max = 0;
  for (const { points } of series) for (const { price } of points.values()) {
    if (price === null) continue;
    min = Math.min(min, price);
    max = Math.max(max, price);
  }
  const step = Math.max(max * 0.02, (max - min) * 0.08, 0.01);
  const floor = Math.max(0, min - step), ceiling = max + step;
  const y = (price) => bottom - (price - floor) / (ceiling - floor) * (bottom - top);
  ctx.font = '11px system-ui, sans-serif';
  for (let i = 0; i <= 4; i++) {
    const value = floor + (ceiling - floor) * i / 4;
    ctx.fillStyle = '#303a3d';
    ctx.fillRect(left, y(value), right - left, 1);
    ctx.fillStyle = '#a6b1af';
    ctx.fillText(axisPrice(value), 6, y(value) + 4);
  }
  ctx.fillText(axisTime.format(from * HOUR_MS), left, height - 7);
  ctx.textAlign = 'right';
  ctx.fillText(axisTime.format(to * HOUR_MS), right, height - 7);

  for (const { segments, points, color } of series) {
    ctx.strokeStyle = ctx.fillStyle = color;
    for (const interpolate of [true, false]) {
      ctx.globalAlpha = interpolate ? 0.75 : 1;
      ctx.setLineDash(interpolate ? [6, 5] : []);
      ctx.lineWidth = interpolate ? 1.5 : 2;
      ctx.beginPath();
      for (const { start, end, interpolated } of segments) {
        if (interpolated !== interpolate) continue;
        ctx.moveTo(x(start.hour), y(start.price));
        ctx.lineTo(x(end.hour), y(end.price));
      }
      ctx.stroke();
    }
    ctx.beginPath();
    for (const { price, hour } of points.values()) {
      if (price !== null) ctx.rect(x(hour) - 1.5, y(price) - 1.5, 3, 3);
    }
    ctx.fill();
  }
  ctx.fillStyle = '#d5ded48c';
  ctx.fillRect(x(selectedHour), top, 1, bottom - top);
  return { left, right };
}

function historyChunks(from, to) {
  const chunks = [];
  for (let end = to; end >= from; end -= HISTORY_BATCH_HOURS) {
    chunks.push({ from: Math.max(from, end - HISTORY_BATCH_HOURS + 1), to: end, state: 'loading', points: [] });
  }
  return chunks;
}

function prepareSeries(chunks) {
  const points = chunks.flatMap((chunk) => chunk.points).sort((a, b) => a.hour - b.hour);
  return MARKETS.map((market) => {
    const observations = new Map(points.filter(({ house }) => house === market.house).map((point) => [point.hour, point]));
    return { ...market, points: observations, segments: priceSegments(observations.values()) };
  });
}

export function historyDialog(origin) {
  const get = (id) => document.getElementById('history-' + id);
  const dialog = get('dialog'), canvas = get('chart'), slider = get('hour'), range = get('range');
  let opening, run, plot;
  let pressedBackdrop = false;

  function isOnBackdrop({ target, clientX, clientY }) {
    if (target !== dialog) return false;
    const { left, right, top, bottom } = dialog.getBoundingClientRect();
    return clientX < left || clientX > right || clientY < top || clientY > bottom;
  }

  function inspect(hour) {
    run.selectedHour = hour;
    slider.value = String(hour);
    const label = timeLabel.format(hour * HOUR_MS);
    slider.setAttribute('aria-valuetext', label);
    get('time').dateTime = new Date(hour * HOUR_MS).toISOString();
    get('time').textContent = label;
    const chunk = run.chunks.find(({ from, to }) => from <= hour && hour <= to);
    get('values').replaceChildren(...run.series.map(({ points, label: market, faction }) => {
      const row = document.createElement('tr');
      const heading = document.createElement('th'), swatch = document.createElement('span');
      heading.scope = 'row';
      swatch.className = 'history-swatch ' + faction;
      swatch.setAttribute('aria-hidden', 'true');
      heading.append(swatch, document.createTextNode(market));
      row.append(heading);
      const point = points.get(hour);
      const state = chunk.state === 'failed' ? 'Couldn’t load'
        : chunk.state === 'loading' ? 'Loading…' : 'No observation';
      for (const value of [
        point ? (point.price === null ? 'No buyout listings' : priceLabel(point.price)) : state,
        point ? stockFormat.format(point.stock) : '—',
        points.size + ' / ' + (run.to - run.from + 1)
      ]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      return row;
    }));
    if (!canvas.hidden) plot = drawChart(canvas, run);
  }

  function render() {
    run.series = prepareSeries(run.chunks);
    let latest = -Infinity;
    let priced = false;
    for (const { points } of run.series) for (const { hour, price } of points.values()) {
      latest = Math.max(latest, hour);
      priced ||= price !== null;
    }
    const failures = run.chunks.filter((chunk) => chunk.state === 'failed').length;
    const pending = run.chunks.some((chunk) => chunk.state === 'loading');
    get('retry').hidden = failures === 0 || pending;
    get('status').textContent = pending ? 'Loading price history…'
      : failures ? 'Some hours couldn’t load. You can retry those requests.'
      : priced ? 'Minimum buyout per item' : 'No buyout prices were observed in this range.';
    canvas.hidden = !priced;
    get('inspector').hidden = !Number.isFinite(latest) && pending;
    inspect(run.inspecting ? run.selectedHour : (Number.isFinite(latest) ? latest : run.to));
  }

  async function load(chunks) {
    const request = run;
    for (const chunk of chunks) chunk.state = 'loading';
    render();
    for (const chunk of chunks) {
      if (request !== run || request.controller.signal.aborted) return;
      const query = new URLSearchParams({ item: opening.row.id, variant: opening.row.variant || '', from: chunk.from, to: chunk.to });
      try {
        const response = await fetch(origin + '/api/history?' + query, { signal: request.controller.signal });
        if (!response.ok) throw new Error('History unavailable');
        const result = await response.json();
        if (!Array.isArray(result.points)) throw new Error('Invalid history response');
        chunk.points = result.points.filter(({ hour, price, stock }) => Number.isSafeInteger(hour) && hour >= chunk.from && hour <= chunk.to &&
          (price === null || (Number.isFinite(price) && price > 0)) && Number.isSafeInteger(stock) && stock >= 0);
        chunk.state = 'ready';
      } catch {
        chunk.state = 'failed';
      }
      if (request !== run || request.controller.signal.aborted) return;
      render();
    }
  }

  function selectRange() {
    run?.controller.abort();
    const to = Math.floor(Date.now() / HOUR_MS);
    const from = to - Number(range.value) * 24 + 1;
    run = { from, to, chunks: historyChunks(from, to), controller: new AbortController() };
    slider.min = String(from);
    slider.max = String(to);
    const standalone = new URL(opening.trigger.href);
    standalone.searchParams.set('days', range.value);
    get('standalone').href = standalone.href;
    return load(run.chunks);
  }

  function selectHour(hour) {
    if (!run || !Number.isSafeInteger(hour) || hour < run.from || hour > run.to) return;
    run.inspecting = true;
    if (hour !== run.selectedHour) inspect(hour);
  }

  range.addEventListener('change', selectRange);
  slider.addEventListener('input', () => selectHour(Number(slider.value)));
  canvas.addEventListener('pointerdown', (event) => {
    if (!run || !plot) return;
    const fraction = Math.max(0, Math.min(1, (event.offsetX - plot.left) / (plot.right - plot.left)));
    selectHour(Math.round(run.from + fraction * (run.to - run.from)));
  });
  if (globalThis.ResizeObserver) new ResizeObserver(() => {
    if (dialog.open && run && !canvas.hidden) plot = drawChart(canvas, run);
  }).observe(canvas);
  get('retry').addEventListener('click', () => load(run.chunks.filter((chunk) => chunk.state === 'failed')));
  get('close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('pointerdown', (event) => { pressedBackdrop = isOnBackdrop(event); });
  dialog.addEventListener('click', (event) => {
    if (pressedBackdrop && isOnBackdrop(event)) dialog.close();
    pressedBackdrop = false;
  });
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    run?.controller.abort();
    run = null;
    if (!opening) return;
    const { trigger, section } = opening;
    const replacement = trigger.isConnected === false && Array.from(section?.querySelectorAll('.item-name') ?? [])
      .find((link) => link.dataset.historyKey === trigger.dataset.historyKey);
    (replacement || trigger).focus({ preventScroll: true });
    opening = null;
  });

  return (row, trigger) => {
    opening = { row, trigger, section: trigger.closest('section') };
    get('title').textContent = row.name + ' · Price history';
    get('item').textContent = '#' + row.id + (row.variant ? ' · Item variant' : '');
    range.value = '1';
    if (!dialog.open) dialog.showModal();
    return selectRange();
  };
}
