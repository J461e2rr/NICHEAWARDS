const stage = document.querySelector('main');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const starts = [[.03,.27],[.8,.12],[.68,.71],[.73,.48],[.25,.18],[.06,.74],[.36,.41],[.10,.17],[.84,.27],[.44,.47],[.18,.56],[.13,.78],[.77,.88],[.65,.6],[.17,.83]];
const shards = [...stage.querySelectorAll('.shard')].map((element, i) => {
  const angle = i * 2.4 + .9;
  return {
    element, index: i, start: starts[i], phase: angle, lower: i >= 7,
    x: 0, y: 0, vx: 21 * Math.cos(angle), vy: 17 * Math.sin(angle),
    rotation: Number(element.dataset.angle), spin: 0, drag: null,
  };
});

function draw(shard) {
  shard.element.style.transform =
    `translate3d(${shard.x}px,${shard.y}px,0) rotate(${shard.rotation}deg)`;
}

function resize() {
  const heroHeight = stage.querySelector('.hero').clientHeight;
  const nominations = stage.querySelector('.nominations');
  for (const shard of shards) {
    const { offsetWidth: w, offsetHeight: h } = shard.element;
    const maxX = stage.clientWidth - w;
    const maxY = stage.clientHeight - h;
    shard.left = -.36 * w;
    shard.right = maxX + .36 * w;
    shard.top = -.3 * h;
    shard.bottom = maxY + .3 * h;
    shard.x = clamp(shard.ready ? shard.x : maxX * shard.start[0], shard.left, shard.right);
    shard.y = clamp(shard.ready ? shard.y : shard.lower ? (shard.index >= 13 ? nominations.offsetTop + nominations.offsetHeight + (maxY - nominations.offsetTop - nominations.offsetHeight) * shard.start[1] : heroHeight + (nominations.offsetHeight - h) * shard.start[1]) : (heroHeight - h) * shard.start[1], shard.top, shard.bottom);
    shard.ready = true;
    draw(shard);
  }
}

let previous = 0;
let elapsed = 0;
let frame;
function animate(time) {
  const dt = previous ? Math.min((time - previous) / 1000, .036) : 0;
  previous = time;
  elapsed += dt;
  const friction = Math.exp(-.34 * dt);
  for (const s of shards) {
    if (s.drag) continue;
    const heading = s.phase + .62 * Math.sin(elapsed * .19 + s.phase);
    s.vx = s.vx * friction + 25 * Math.cos(heading) * (1 - friction);
    s.vy = s.vy * friction + 20 * Math.sin(heading) * (1 - friction);
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    if (s.x < s.left || s.x > s.right) {
      s.x = clamp(s.x, s.left, s.right);
      s.vx *= -.8;
      s.phase = Math.PI - s.phase;
    }
    if (s.y < s.top || s.y > s.bottom) {
      s.y = clamp(s.y, s.top, s.bottom);
      s.vy *= -.8;
      s.phase = -s.phase;
    }
    s.spin *= Math.exp(-.58 * dt);
    s.rotation += (s.spin + 4 * Math.sin(elapsed * .55 + s.phase)) * dt;
    draw(s);
  }
  frame = requestAnimationFrame(animate);
}

for (const s of shards) {
  const el = s.element;
  el.addEventListener('pointerdown', event => {
    if (event.button !== 0 || s.drag) return;
    el.setPointerCapture(event.pointerId);
    s.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp };
    s.vx = s.vy = s.spin = 0;
  });
  el.addEventListener('pointermove', event => {
    const drag = s.drag;
    if (drag?.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    const dt = Math.max((event.timeStamp - drag.time) / 1000, .008);
    s.vx = clamp(s.vx * .45 + .55 * dx / dt, -1900, 1900);
    s.vy = clamp(s.vy * .45 + .55 * dy / dt, -1900, 1900);
    s.x = clamp(s.x + dx, s.left, s.right);
    s.y = clamp(s.y + dy, s.top, s.bottom);
    s.drag = { id: drag.id, x: event.clientX, y: event.clientY, time: event.timeStamp };
    draw(s);
  });
  function release(event) {
    if (s.drag?.id !== event.pointerId) return;
    const moving = event.type === 'pointerup' && event.timeStamp - s.drag.time < 120;
    if (!moving) s.vx = s.vy = 0;
    s.spin = clamp((s.vx - s.vy) * .08, -135, 135);
    s.drag = null;
  }
  for (const event of ['pointerup','pointercancel','lostpointercapture']) {
    el.addEventListener(event, release);
  }
}

function updateMotion() {
  cancelAnimationFrame(frame);
  previous = 0;
  if (!motion.matches) frame = requestAnimationFrame(animate);
}

new ResizeObserver(resize).observe(stage);
motion.addEventListener('change', updateMotion);
resize();
updateMotion();


