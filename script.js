const BIOMES = [
  { name: 'meadow',  sky1: '#5c94fc', sky2: '#b0cdff', groundA: '#9e5a2c', groundB: '#24c852' },
  { name: 'desert',  sky1: '#ffb35c', sky2: '#ffe1b0', groundA: '#c98a3a', groundB: '#e0b04a' },
  { name: 'dusk',    sky1: '#3b3d6b', sky2: '#8562a8', groundA: '#5a3a5c', groundB: '#c2588a' },
  { name: 'night',   sky1: '#0c1230', sky2: '#1c2660', groundA: '#2c2c44', groundB: '#4a4a78' },
];
const BIOME_SPAN = 3600;

const state = {
  score: 0,
  coins: 0,
  lives: 3,
  maxLives: 5,
  active: false,
  paused: false,
  muted: false,
  invincibleUntil: 0,
  starUntil: 0,
  combo: 0,
  bestCombo: 0,
  lastGroundedAt: 0,
  jumpBufferedAt: -9999,
  speedMul: 1,
  distance: 0,
  currentBiome: -1,
  player: { x: 50, y: 200, w: 26, h: 32, vx: 5.0, vy: 0, grounded: false, element: null },
  cameraX: 0,
  solids: [],
  coinsList: [],
  enemies: [],
  powerups: [],
  particles: [],
  lastGenX: 0,
  chunkIndex: 0,
  keys: {},
  loopId: null,
  hiScore: parseInt(localStorage.getItem('super_mario_hi_score')) || 0,
  audioCtx: null,
  lastX: null,
  stationarySince: null,
};

const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

/* inp */
window.onkeydown = (e) => {
  if (['Space', 'ArrowUp', 'KeyW'].includes(e.code)) e.preventDefault();
  if (!state.keys[e.code]) {
    if (['Space', 'ArrowUp', 'KeyW'].includes(e.code)) state.jumpBufferedAt = performance.now();
  }
  state.keys[e.code] = true;
  if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
};
window.onkeyup = (e) => state.keys[e.code] = false;

document.getElementById('jump-btn').addEventListener('touchstart', (e) => {
  e.preventDefault();
  state.jumpBufferedAt = performance.now();
  state.keys['Space'] = true;
}, { passive: false });
document.getElementById('jump-btn').addEventListener('touchend', (e) => {
  e.preventDefault();
  state.keys['Space'] = false;
}, { passive: false });

document.getElementById('sound-btn').onclick = () => {
  state.muted = !state.muted;
  document.getElementById('sound-btn').textContent = state.muted ? '✕' : '♪';
};
document.getElementById('pause-btn').onclick = togglePause;
document.getElementById('resume-btn').onclick = togglePause;

function togglePause() {
  if (!state.active) return;
  state.paused = !state.paused;
  document.getElementById('pause-screen').classList.toggle('hidden', !state.paused);
  document.getElementById('pause-screen').classList.toggle('active', state.paused);
  if (!state.paused) {
    state.stationarySince = null;
    cancelAnimationFrame(state.loopId);
    state.loopId = requestAnimationFrame(() => loop());
  }
}

/* audio */
function ensureAudio() {
  if (!state.audioCtx) {
    try { state.audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { state.audioCtx = null; }
  }
}
function beep(freq, dur, type = 'square', vol = 0.08, delay = 0) {
  if (state.muted || !state.audioCtx) return;
  const ctx = state.audioCtx;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur);
}
const sfx = {
  jump: () => beep(520, 0.12, 'square', 0.07),
  coin: () => { beep(880, 0.09, 'square', 0.06); beep(1320, 0.12, 'square', 0.05, 0.05); },
  stomp: () => beep(180, 0.14, 'triangle', 0.09),
  hit: () => beep(120, 0.3, 'sawtooth', 0.09),
  powerup: () => { [520, 660, 780, 1040].forEach((f, i) => beep(f, 0.1, 'square', 0.06, i * 0.06)); },
  die: () => { beep(300, 0.15, 'sawtooth', 0.09); beep(180, 0.25, 'sawtooth', 0.08, 0.15); },
  block: () => beep(700, 0.06, 'square', 0.06),
};

/* layout */
const resize = () => {
  const scale = Math.min(window.innerWidth / 820, window.innerHeight / 420);
  document.documentElement.style.setProperty('--scale', scale);
};

/* bgrd */
function buildBackgroundArt() {
  const back = document.getElementById('layer-back');
  back.innerHTML = '';
  const isNight = false;
  for (let i = 0; i < 10; i++) {
    const hill = document.createElement('div');
    hill.className = 'hill';
    const w = 160 + Math.random() * 140;
    hill.style.width = w + 'px';
    hill.style.height = (40 + Math.random() * 50) + 'px';
    hill.style.left = (i * 340 + Math.random() * 80) + 'px';
    back.appendChild(hill);
  }
  for (let i = 0; i < 8; i++) {
    const cloud = document.createElement('div');
    cloud.className = 'cloud';
    cloud.style.width = (40 + Math.random() * 30) + 'px';
    cloud.style.height = (16 + Math.random() * 10) + 'px';
    cloud.style.left = (i * 420 + Math.random() * 160) + 'px';
    cloud.style.top = (20 + Math.random() * 90) + 'px';
    back.appendChild(cloud);
  }
}

function applyBiome(idx) {
  if (idx === state.currentBiome) return;
  state.currentBiome = idx;
  const b = BIOMES[idx % BIOMES.length];
  const root = document.documentElement.style;
  root.setProperty('--sky-top', b.sky1);
  root.setProperty('--sky-bottom', b.sky2);
  root.setProperty('--ground-a', b.groundA);
  root.setProperty('--ground-b', b.groundB);
}

/* hud */
const updateHUD = () => {
  const displayHi = Math.max(state.score, state.hiScore);
  document.getElementById('score-val').textContent = state.score;
  document.getElementById('coins-val').textContent = state.coins;
  document.getElementById('hi-score-val').textContent = displayHi;

  const row = document.getElementById('lives-row');
  row.innerHTML = '';
  for (let i = 0; i < state.maxLives; i++) {
    const d = document.createElement('div');
    d.className = 'life-icon' + (i < state.lives ? '' : ' lost');
    row.appendChild(d);
  }
  const combo = document.getElementById('combo-display');
  if (state.combo > 1) {
    combo.textContent = `COMBO x${state.combo}`;
    combo.classList.add('show');
  } else {
    combo.classList.remove('show');
  }
};

const showScreen = (id, act) => {
  const el = document.getElementById(id);
  el.classList.toggle('hidden', !act);
  el.classList.toggle('active', act);
};

/* life cycle */
const start = () => {
  ensureAudio();
  if (document.activeElement) document.activeElement.blur();
  state.active = true;
  state.paused = false;
  state.score = 0;
  state.coins = 0;
  state.lives = 3;
  state.combo = 0;
  state.bestCombo = 0;
  state.speedMul = 1;
  state.distance = 0;
  state.currentBiome = -1;
  state.invincibleUntil = 0;
  state.starUntil = 0;
  applyBiome(0);
  updateHUD();
  document.getElementById('hud').classList.remove('hidden');
  document.getElementById('sound-btn').classList.remove('hidden');
  document.getElementById('pause-btn').classList.remove('hidden');
  if (isTouch) document.getElementById('touch-controls').classList.add('show');
  ['start-screen', 'game-over-screen', 'pause-screen'].forEach(s => showScreen(s, false));
  buildBackgroundArt();
  respawn();
  cancelAnimationFrame(state.loopId);
  state.loopId = requestAnimationFrame(() => loop());
};

const respawn = () => {
  document.getElementById('game-world').innerHTML = '';
  state.solids = [];
  state.coinsList = [];
  state.enemies = [];
  state.powerups = [];
  state.particles = [];
  state.player.element = spawn('player', 50, 200, state.player.w, state.player.h);
  state.player.x = 50;
  state.player.y = 200;
  state.player.vy = 0;
  state.player.vx = 5.0;
  state.player.grounded = false;
  state.lastGenX = 0;
  state.chunkIndex = 0;
  state.lastX = null;
  state.stationarySince = null;

  for (let i = 0; i < 3; i++) {
    generateChunk(state.lastGenX, state.lastGenX + 480);
    state.lastGenX += 480;
  }

  state.cameraX = 0;
  document.getElementById('game-world').style.transform = `translateX(0px)`;
};

const spawn = (type, x, y, w, h, cls = []) => {
  const el = document.createElement('div');
  el.className = `entity ${type} ` + cls.join(' ');
  Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
  document.getElementById('game-world').appendChild(el);
  return el;
};

function spawnParticles(x, y, color, count = 8, opts = {}) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * (opts.speed || 3);
    const size = opts.size || (3 + Math.random() * 3);
    const el = document.createElement('div');
    el.className = 'particle';
    Object.assign(el.style, {
      left: `${x}px`, top: `${y}px`, width: `${size}px`, height: `${size}px`, background: color,
    });
    document.getElementById('game-world').appendChild(el);
    state.particles.push({
      x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - (opts.upward ? 2 : 0),
      life: 1, decay: 0.03 + Math.random() * 0.02, element: el,
    });
  }
}

/* wodrl gen */
const generateChunk = (startX, endX) => {
  const heights = [220, 252, 284, 316, 348];
  const chunkY = heights[Math.floor(Math.random() * heights.length)];
  const hasGap = startX > 200 && Math.random() > 0.5;
  const gapStart = 4 + Math.floor(Math.random() * 3);
  const gapEnd = gapStart + Math.min(4, 2 + Math.floor(state.chunkIndex / 6)); // gaps widen slightly over time, capped

  for (let i = 0; i < 15; i++) {
    if (hasGap && i >= gapStart && i < gapEnd) continue;
    const x = startX + i * 32;
    const h = 400 - chunkY;
    state.solids.push({
      x, y: chunkY, w: 32, h, element: spawn('tile', x, chunkY, 32, h, ['ground']), type: 'ground'
    });
  }

  const seed = Math.sin(startX);
  const rewardRoll = Math.random();

  if (seed > 0.4) {
    const bx = startX + 96;
    const giveStar = state.chunkIndex > 0 && state.chunkIndex % 9 === 0;
    const giveMushroom = !giveStar && rewardRoll > 0.72;
    [0, 32, 64].forEach((ox, i) => {
      let type = i === 1 ? 'question' : 'brick';
      if (i === 1 && giveStar) type = 'star-block';
      const el = spawn('tile', bx + ox, chunkY - 100, 32, 32, [type]);
      if (type === 'question') el.textContent = '?';
      if (type === 'star-block') el.textContent = '!';
      state.solids.push({
        x: bx + ox, y: chunkY - 100, w: 32, h: 32, element: el, type,
        reward: (type === 'question' || type === 'star-block'),
        rewardKind: giveStar ? 'star' : (giveMushroom ? 'mushroom' : 'coin'),
      });
    });
  } else if (seed < -0.4) {
    [64, 96, 128].forEach(ox => state.coinsList.push({
      x: startX + ox, y: chunkY - 140, w: 16, h: 16, element: spawn('coin', startX + ox, chunkY - 140, 16, 16)
    }));
  }

  // enemies
  if (!hasGap && state.chunkIndex > 2 && Math.random() > 0.45) {
    const margin = 40;
    const ex = startX + margin + Math.random() * (480 - margin * 2 - 24);
    const enemy = {
      x: ex, y: chunkY - 24, w: 24, h: 24,
      vx: (Math.random() > 0.5 ? 1 : -1) * (0.9 + Math.random() * 0.6),
      minX: startX + margin, maxX: startX + 480 - margin - 24,
      element: spawn('enemy', ex, chunkY - 24, 24, 24), dead: false,
    };
    state.enemies.push(enemy);
  }

  state.chunkIndex++;
};

/* main */
const loop = () => {
  if (!state.active || state.paused) return;
  update();
  state.loopId = requestAnimationFrame(() => loop());
};

const update = () => {
  const now = performance.now();
  state.distance = state.player.x;

  // biome progression
  const biomeIdx = Math.floor(state.distance / BIOME_SPAN);
  applyBiome(biomeIdx);

  // difficulty ramp
  state.speedMul = Math.min(1.6, 1 + state.distance / 18000);
  const starActive = now < state.starUntil;
  const effVx = state.player.vx * state.speedMul * (starActive ? 1.35 : 1);

  state.player.x += effVx;
  checkCollisions('x');

  const wantsJump = state.keys['ArrowUp'] || state.keys['KeyW'] || state.keys['Space'];
  const bufferedRecently = now - state.jumpBufferedAt < 130;
  const coyoteOk = now - state.lastGroundedAt < 90;

  if ((wantsJump || bufferedRecently) && (state.player.grounded || coyoteOk)) {
    state.player.vy = -8.7;
    state.player.grounded = false;
    state.jumpBufferedAt = -9999;
    sfx.jump();
    spawnParticles(state.player.x + state.player.w / 2, state.player.y + state.player.h, '#ffffffaa', 4, { size: 3, speed: 1 });
  }
  // variable jump
  if (!wantsJump && state.player.vy < -3) state.player.vy = -3;

  state.player.vy = Math.min(state.player.vy + 0.22, 6.5);
  state.player.y += state.player.vy;
  const wasGrounded = state.player.grounded;
  state.player.grounded = false;
  checkCollisions('y');

  if (state.player.grounded && !wasGrounded) {
    // landed
    state.combo = 0;
  }
  if (state.player.grounded) state.lastGroundedAt = now;

  // anti-farm: if the player is stuck in place (e.g. wedged against a wall)
  // for more than 3 seconds, score is still ticking up for free — kill them.
  if (state.lastX === null) state.lastX = state.player.x;
  if (Math.abs(state.player.x - state.lastX) < 0.05) {
    if (state.stationarySince === null) state.stationarySince = now;
    else if (now - state.stationarySince > 3000) {
      die(false, 'stationary');
      return;
    }
  } else {
    state.stationarySince = null;
  }
  state.lastX = state.player.x;

  // visual state
  const p = state.player.element;
  p.style.left = `${state.player.x}px`;
  p.style.top = `${state.player.y}px`;
  p.classList.toggle('star', starActive);
  p.classList.toggle('hurt', now < state.invincibleUntil && !starActive);

  state.score += 1;
  updateHUD();

  state.cameraX = state.player.x - 100;
  document.getElementById('game-world').style.transform = `translateX(-${state.cameraX}px)`;
  document.getElementById('layer-back').style.transform = `translateX(-${state.cameraX * 0.35}px)`;
  document.getElementById('layer-sun').style.transform = `translateX(${state.cameraX * 0.05}px)`;

  if (state.player.y > 420) { loseLife(true); }

  if (state.player.x + 800 > state.lastGenX) {
    generateChunk(state.lastGenX, state.lastGenX + 480);
    state.lastGenX += 480;
    cleanup();
  }

  updateEnemies(now, starActive);
  updateCoinsAndPowerups(now);
  updateParticles();
};

const checkCollisions = (dir) => {
  state.solids.forEach(s => {
    if (rectCollide(state.player, s)) {
      if (dir === 'x') {
        state.player.x = state.player.vx > 0 ? s.x - state.player.w : s.x + s.w;
      } else {
        if (state.player.vy > 0) {
          state.player.y = s.y - state.player.h;
          state.player.vy = 0;
          state.player.grounded = true;
        }
        if (state.player.vy < 0) {
          state.player.y = s.y + s.h;
          state.player.vy = 0;
          if (s.reward) {
            s.reward = false;
            s.element.className = 'entity tile empty-block';
            s.element.textContent = '';
            sfx.block();
            spawnParticles(s.x + 16, s.y + 16, '#f8b800', 6, { size: 4 });
            if (s.rewardKind === 'mushroom') {
              spawnPowerup('mushroom', s.x + 4, s.y - 28);
            } else if (s.rewardKind === 'star') {
              spawnPowerup('star-item', s.x + 4, s.y - 28);
            } else {
              state.score += 200;
              state.coins++;
            }
            updateHUD();
          }
        }
      }
    }
  });
};

function spawnPowerup(type, x, y) {
  state.powerups.push({
    type, x, y, w: 24, h: 24, vy: -2.2, settled: false,
    element: spawn('powerup', x, y, 24, 24, [type]),
  });
}

const rectCollide = (r1, r2) => r1.x < r2.x + r2.w && r1.x + r1.w > r2.x && r1.y < r2.y + r2.h && r1.y + r1.h > r2.y;

function loseLife(fell) {
  if (!state.active) return;
  const now = performance.now();
  if (!fell && now < state.invincibleUntil) return;
  sfx.hit();
  document.getElementById('game-container').classList.remove('shake');
  void document.getElementById('game-container').offsetWidth;
  document.getElementById('game-container').classList.add('shake');

  // die, you idiot
  if (fell) { die(true); return; }

  state.lives -= 1;
  updateHUD();
  if (state.lives <= 0) {
    die(false);
  } else {
    state.invincibleUntil = now + 1600;
    state.player.vy = -5; // small knockback
  }
}

const die = (fell, reason) => {
  state.active = false;
  sfx.die();
  const isNewHi = state.score > state.hiScore;
  if (isNewHi) {
    state.hiScore = state.score;
    localStorage.setItem('super_mario_hi_score', state.hiScore);
  }
  document.getElementById('game-over-line').textContent = reason === 'stationary'
    ? "nice try, but it wont work"
    : (fell ? "You fell! Skill issue." : "A goomba got you. Rude.");
  document.getElementById('new-hi-badge').classList.toggle('hidden', !isNewHi);
  document.getElementById('final-score').textContent = state.score;
  document.getElementById('final-coins').textContent = state.coins;
  document.getElementById('final-combo').textContent = state.bestCombo;
  document.getElementById('high-score').textContent = state.hiScore;
  if (typeof refreshStartHiScore === 'function') refreshStartHiScore();
  updateHUD();
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('sound-btn').classList.add('hidden');
  document.getElementById('pause-btn').classList.add('hidden');
  document.getElementById('touch-controls').classList.remove('show');
  showScreen('game-over-screen', true);
};

const cleanup = () => {
  const limit = state.cameraX - 200;
  state.solids = state.solids.filter(s => s.x + s.w >= limit || (s.element.remove(), false));
  state.coinsList = state.coinsList.filter(c => c.x + c.w >= limit || (c.element.remove(), false));
  state.enemies = state.enemies.filter(e => e.x + e.w >= limit || (e.element.remove(), false));
  state.powerups = state.powerups.filter(pu => pu.x + pu.w >= limit || (pu.element.remove(), false));
};

function updateEnemies(now, starActive) {
  state.enemies.forEach(e => {
    if (e.dead) return;
    e.x += e.vx;
    if (e.x < e.minX || e.x + e.w > e.maxX) e.vx *= -1;
    e.element.style.left = `${e.x}px`;

    if (rectCollide(state.player, e)) {
      if (starActive) {
        killEnemy(e, false);
      } else if (state.player.vy > 0 && state.player.y + state.player.h - e.y < 14) {
        killEnemy(e, true);
      } else if (now >= state.invincibleUntil) {
        loseLife(false);
      }
    }
  });
}

function killEnemy(e, bounce) {
  e.dead = true;
  e.element.classList.add('squish');
  setTimeout(() => e.element.remove(), 200);
  sfx.stomp();
  spawnParticles(e.x + e.w / 2, e.y, '#5a3410', 6, { size: 3 });
  if (bounce) {
    state.player.vy = -6;
    state.combo += 1;
    state.bestCombo = Math.max(state.bestCombo, state.combo);
  }
  const points = 100 * Math.max(1, state.combo);
  state.score += points;
  updateHUD();
}

function updateCoinsAndPowerups(now) {
  state.coinsList.forEach((c, i) => {
    if (rectCollide(state.player, c)) {
      c.element.remove();
      state.coinsList.splice(i, 1);
      state.score += 100;
      state.coins++;
      sfx.coin();
      spawnParticles(c.x + 8, c.y + 8, '#ffd000', 5, { size: 3, upward: true });
      updateHUD();
    }
  });

  state.powerups.forEach((pu, i) => {
    if (!pu.settled) {
      pu.vy = Math.min(pu.vy + 0.15, 3);
      pu.y += pu.vy;
      let landed = false;
      state.solids.forEach(s => {
        if (rectCollide(pu, s) && pu.vy > 0) {
          pu.y = s.y - pu.h;
          pu.vy = 0;
          landed = true;
        }
      });
      if (landed) pu.settled = true;
      pu.element.style.top = `${pu.y}px`;
    }
    if (rectCollide(state.player, pu)) {
      pu.element.remove();
      state.powerups.splice(i, 1);
      if (pu.type === 'mushroom') {
        state.lives = Math.min(state.maxLives, state.lives + 1);
        state.score += 300;
      } else {
        state.starUntil = now + 6000;
        state.score += 300;
      }
      sfx.powerup();
      spawnParticles(pu.x + 12, pu.y + 12, '#ffffff', 10, { size: 4, speed: 4 });
      updateHUD();
    }
  });
}

function updateParticles() {
  state.particles.forEach((pt, i) => {
    pt.x += pt.vx;
    pt.y += pt.vy;
    pt.vy += 0.08;
    pt.life -= pt.decay;
    pt.element.style.left = `${pt.x}px`;
    pt.element.style.top = `${pt.y}px`;
    pt.element.style.opacity = Math.max(0, pt.life);
    if (pt.life <= 0) {
      pt.element.remove();
      state.particles.splice(i, 1);
    }
  });
}

/* bind */
document.getElementById('start-btn').onclick = start;
document.getElementById('restart-btn').onclick = start;

const startHiScoreEl = document.getElementById('start-hi-score-val');
const refreshStartHiScore = () => { startHiScoreEl.textContent = state.hiScore; };
refreshStartHiScore();

document.getElementById('reset-hi-btn').onclick = () => {
  if (!confirm('Reset your high score to 0? This can\'t be undone.')) return;
  state.hiScore = 0;
  localStorage.removeItem('super_mario_hi_score');
  refreshStartHiScore();
};

window.onresize = resize;
window.onload = resize;
resize();
