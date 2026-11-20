const houses = [
  [110, 'Alliance', '#1558a5'],
  [113, 'Horde', '#ac382d'],
  [116, 'Neutral', '#45722c']
];
const HOUR = 3600000;
const form = document.querySelector('form'),
  canvas = document.querySelector('canvas'),
  status = document.querySelector('#status');
let sequence = 0;
const utc = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
function money(c) {
  if (c == null) return '—';
  const g = Math.floor(c / 10000),
    s = Math.floor(c / 100) % 100,
    copper = Number((c % 100).toFixed(2));
  return [g ? g + 'g' : '', s ? s + 's' : '', copper || (!g && !s) ? copper + 'c' : '']
    .filter(Boolean)
    .join(' ');
}
function draw(points, from, to) {
  const ctx = canvas.getContext('2d'),
    w = canvas.width,
    h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.font = '15px system-ui';
  const max = points.reduce((v, p) => Math.max(v, p.price ?? 0), 1),
    left = 78,
    end = w - 18,
    bottom = h - 35;
  for (let n = 0; n <= 4; n++) {
    const y = bottom - (n * (bottom - 15)) / 4;
    ctx.fillStyle = '#e0e3e2';
    ctx.fillRect(left, y, end - left, 1);
    ctx.fillStyle = '#263238';
    ctx.fillText(money((max * n) / 4), 2, y);
  }
  ctx.fillText(utc(from * HOUR), left, h - 9);
  ctx.textAlign = 'right';
  ctx.fillText(utc(to * HOUR), end, h - 9);
  ctx.textAlign = 'left';
  for (const [house, , color] of houses) {
    const priced = points.filter((point) => point.house === house && point.price !== null);
    const x = (hour) => left + ((hour - from) * (end - left)) / Math.max(1, to - from);
    const y = (price) => bottom - (price * (bottom - 15)) / max;
    ctx.strokeStyle = ctx.fillStyle = color;
    for (const interpolate of [true, false]) {
      ctx.setLineDash(interpolate ? [6, 5] : []);
      ctx.globalAlpha = interpolate ? 0.65 : 1;
      ctx.beginPath();
      for (let i = 1; i < priced.length; i++) {
        const before = priced[i - 1], after = priced[i];
        if ((after.hour > before.hour + 1) !== interpolate) continue;
        ctx.moveTo(x(before.hour), y(before.price));
        ctx.lineTo(x(after.hour), y(after.price));
      }
      ctx.stroke();
    }
    for (const { hour, price } of priced)
      ctx.fillRect(x(hour) - 1.5, y(price) - 1.5, 3, 3);
  }
}
async function load(event) {
  event?.preventDefault();
  const id = ++sequence;
  const { item, variant, days } = Object.fromEntries(new FormData(form)),
    to = Math.floor(Date.now() / HOUR),
    from = to - Number(days) * 24 + 1;
  canvas.hidden = true;
  document.querySelector('tbody').replaceChildren();
  status.textContent = 'Loading prices…';
  async function get(path) {
    const res = await fetch(path);
    if (!res.ok) throw Error('Could not load history (HTTP ' + res.status + ').');
    return res.json();
  }
  try {
    const states = await get('/api/status');
    const points = [];
    for (let start = from; start <= to; start += 168) {
      const result = await get(
        '/api/history?' + new URLSearchParams({ item, variant, from: start, to: Math.min(to, start + 167) })
      );
      if (id !== sequence) return;
      points.push(...result.points);
    }
    const priced = points.filter((p) => p.price !== null);
    status.textContent = priced.length
      ? 'Hourly observations · ' + new Set(priced.map((p) => p.hour)).size + ' priced hours in this window'
      : 'No priced observations for this item in this window.';
    canvas.hidden = !priced.length;
    if (priced.length) draw(points, from, to);
    for (const [house, name, color] of houses) {
      const latest = points.filter((p) => p.house === house).at(-1),
        state = states.houses.find((s) => s.house === house),
        tr = document.createElement('tr');
      for (const val of [
        name,
        money(latest?.price),
        latest?.stock ?? '—',
        latest ? utc(latest.source) : '—',
        state ? utc(state.checked) + ' · ' + state.status : '—'
      ]) {
        const td = document.createElement('td');
        td.textContent = val;
        tr.append(td);
      }
      tr.firstChild.style.color = color;
      document.querySelector('tbody').append(tr);
    }
  } catch (error) {
    if (id === sequence) status.textContent = error.message;
  }
}
const initial = new URLSearchParams(location.search);
if (/^[1-9]\d{0,9}$/.test(initial.get('item'))) form.elements.item.value = initial.get('item');
form.elements.variant.value = (initial.get('variant') || '').slice(0, 2048);
if (['1', '7', '30', '90'].includes(initial.get('days'))) form.elements.days.value = initial.get('days');
form.addEventListener('submit', load);
load();
