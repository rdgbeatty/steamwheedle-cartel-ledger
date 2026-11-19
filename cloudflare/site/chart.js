const $ = (selector) => document.querySelector(selector);
const markets = ['Alliance 110', 'Horde 113', 'Neutral 116'];
const colors = ['#1558a5', '#ac382d', '#45722c'];
const format = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const timestamp = (hour) => new Date(hour * 3_600_000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
let sequence = 0;

function draw(points, first, last) {
  const ctx = $('#chart').getContext('2d'),
    w = ctx.canvas.width,
    h = ctx.canvas.height;
  const left = 62,
    right = w - 12,
    top = 14,
    bottom = h - 32;
  ctx.clearRect(0, 0, w, h);
  let max = 1;
  for (const point of points)
    for (const q of point.quotes) if (q.price !== null) max = Math.max(max, q.price);
  ctx.font = '15px system-ui';
  for (let tick = 0; tick <= 4; tick++) {
    const y = bottom - (tick * (bottom - top)) / 4;
    ctx.fillStyle = '#364349';
    ctx.fillText(format.format((tick * max) / 4), 2, y + 4);
    ctx.fillStyle = '#dde1e2';
    ctx.fillRect(left, y, right - left, 1);
  }
  ctx.fillStyle = '#364349';
  ctx.fillText(timestamp(first), left, h - 8);
  ctx.textAlign = 'right';
  ctx.fillText(timestamp(last), right, h - 8);
  ctx.textAlign = 'left';
  for (let i = 0; i < 3; i++) {
    let previous = null;
    ctx.beginPath();
    ctx.strokeStyle = colors[i];
    ctx.fillStyle = colors[i];
    for (const point of points) {
      const price = point.quotes[i].price;
      if (price === null) {
        previous = null;
        continue;
      }
      const x = left + ((point.hour - first) * (right - left)) / Math.max(1, last - first);
      const y = bottom - (price * (bottom - top)) / max;
      if (previous === point.hour - 1) ctx.lineTo(x, y);
      else {
        ctx.moveTo(x, y);
        ctx.fillRect(x - 1, y - 1, 2, 2);
      }
      previous = point.hour;
    }
    ctx.stroke();
  }
}

async function load(event) {
  event?.preventDefault();
  const id = ++sequence;
  $('#results').hidden = true;
  $('#status').textContent = 'Loading history…';
  const query = new URLSearchParams(
    Object.fromEntries(['item', 'variant', 'days'].map((k) => [k, $('#' + k).value]))
  );
  try {
    const response = await fetch('/api/history?' + query);
    if (!response.ok) throw new Error('History unavailable (HTTP ' + response.status + ').');
    const chart = await response.json();
    if (id !== sequence) return;
    if (!chart.points.length) {
      $('#status').textContent = 'No samples in this window. Run the staging pilot to publish a fixture.';
      return;
    }
    const latest = chart.points.at(-1);
    $('#status').textContent = chart.points.length + ' sampled hours · latest ' + timestamp(latest.hour);
    draw(chart.points, chart.first, chart.last);
    $('tbody').replaceChildren(
      ...latest.quotes.map((quote, i) => {
        const tr = document.createElement('tr');
        for (const value of [
          markets[i],
          quote.price === null ? '—' : format.format(quote.price),
          quote.stock === null ? '—' : format.format(quote.stock),
          quote.state
        ]) {
          const td = document.createElement('td');
          td.textContent = value;
          tr.append(td);
        }
        tr.firstChild.style.color = colors[i];
        return tr;
      })
    );
    $('#results').hidden = false;
  } catch (error) {
    if (id === sequence) $('#status').textContent = error.message;
  }
}
$('form').addEventListener('submit', load);
load();
