(function() {
  'use strict';

  // Canvas setup
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');

  // HUD elements
  const hudTime = document.getElementById('hud-time');
  const hudCoins = document.getElementById('hud-coins');
  const hudLevel = document.getElementById('hud-level');
  const overlay = document.getElementById('overlay');
  const btnPlay = document.getElementById('btn-play');
  const btnRestart = document.getElementById('btn-restart');
  const btnMute = document.getElementById('btn-mute');

  // Touch inputs
  const touchLeft = document.getElementById('touch-left');
  const touchRight = document.getElementById('touch-right');
  const touchJump = document.getElementById('touch-jump');

  // State
  const GAME_WIDTH = 960;
  const GAME_HEIGHT = 540;
  const GRAVITY = 2000;
  const MOVE_ACCEL = 2200;
  const MAX_RUN_SPEED = 360;
  const AIR_CONTROL = 0.8;
  const FRICTION = 1800;
  const JUMP_VELOCITY = 750;
  const BOUNCE_VELOCITY = 1100;

  const COLORS = {
    bgTop: '#0e1730',
    bgBottom: '#0a1227',
    platform: '#243a71',
    platformEdge: '#3a5ea8',
    player: '#ffd166',
    playerEdge: '#ffb703',
    coin: '#ffe082',
    coinEdge: '#ffca28',
    pad: '#67e8f9',
    padEdge: '#06b6d4',
    goal: '#34d399',
    goalEdge: '#059669',
    text: '#eaf0ff'
  };

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function rectsOverlap(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }

  class Entity {
    constructor(x, y, w, h) { this.x = x; this.y = y; this.w = w; this.h = h; }
    get rect() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
    draw() {}
  }

  class Platform extends Entity {
    draw() {
      ctx.fillStyle = COLORS.platform;
      ctx.fillRect(this.x, this.y, this.w, this.h);
      ctx.fillStyle = COLORS.platformEdge;
      ctx.fillRect(this.x, this.y, this.w, 6);
    }
  }

  class BouncePad extends Entity {
    draw() {
      ctx.fillStyle = COLORS.pad;
      ctx.fillRect(this.x, this.y, this.w, this.h);
      // chevrons
      ctx.fillStyle = COLORS.padEdge;
      for (let i = 0; i < this.w; i += 16) {
        ctx.beginPath();
        ctx.moveTo(this.x + i + 4, this.y + this.h - 4);
        ctx.lineTo(this.x + i + 12, this.y + this.h - 4);
        ctx.lineTo(this.x + i + 8, this.y + 4);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  class Coin extends Entity {
    constructor(x, y) { super(x, y, 18, 18); this.t = Math.random() * Math.PI * 2; this.collected = false; }
    update(dt) { this.t += dt * 6; }
    draw() {
      if (this.collected) return;
      const cx = this.x + this.w/2, cy = this.y + this.h/2 + Math.sin(this.t) * 3;
      const r = 9 + Math.sin(this.t * 2) * 0.8;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI*2);
      ctx.fillStyle = COLORS.coin;
      ctx.fill();
      ctx.strokeStyle = COLORS.coinEdge;
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  class Goal extends Entity {
    draw() {
      ctx.fillStyle = COLORS.goal;
      ctx.fillRect(this.x, this.y, this.w, this.h);
      ctx.fillStyle = COLORS.goalEdge;
      ctx.fillRect(this.x, this.y, this.w, 6);
    }
  }

  class Player extends Entity {
    constructor(x, y) {
      super(x, y, 28, 36);
      this.vx = 0; this.vy = 0;
      this.onGround = false;
      this.facing = 1;
      this.coyoteTime = 0;
      this.jumpBuffer = 0;
      this.invuln = 0;
    }
    update(dt, input, level) {
      const targetAccel = input.left === input.right ? 0 : (input.left ? -MOVE_ACCEL : MOVE_ACCEL);
      const accel = this.onGround ? targetAccel : targetAccel * AIR_CONTROL;
      this.vx += accel * dt;
      const maxSpeed = MAX_RUN_SPEED;
      this.vx = clamp(this.vx, -maxSpeed, maxSpeed);

      if (this.onGround && targetAccel === 0) {
        const sign = Math.sign(this.vx);
        const mag = Math.max(0, Math.abs(this.vx) - FRICTION * dt);
        this.vx = mag * sign;
      }

      // jump buffering and coyote time
      this.coyoteTime -= dt;
      this.jumpBuffer -= dt;
      if (input.jumpPressed) this.jumpBuffer = 0.15;
      if (this.jumpBuffer > 0 && (this.onGround || this.coyoteTime > 0)) {
        this.vy = -JUMP_VELOCITY;
        this.onGround = false;
        this.coyoteTime = 0;
        this.jumpBuffer = 0;
      }

      // gravity
      this.vy += GRAVITY * dt;
      if (this.vy > 2000) this.vy = 2000;

      // integrate
      this.x += this.vx * dt;
      this.resolveCollisions(level.platforms, true);
      this.y += this.vy * dt;
      this.onGround = this.resolveCollisions(level.platforms, false);
      if (this.onGround) this.coyoteTime = 0.1;

      // bounce pads
      for (const pad of level.pads) {
        if (rectsOverlap(this.rect, pad.rect)) {
          // Only trigger if falling onto the pad
          const wasAbove = (this.y + this.h) - this.vy * dt <= pad.y;
          if (wasAbove && this.vy > 0) {
            this.y = pad.y - this.h;
            this.vy = -BOUNCE_VELOCITY;
            this.onGround = false;
            this.coyoteTime = 0;
          }
        }
      }

      // coins
      for (const coin of level.coins) {
        if (!coin.collected && rectsOverlap(this.rect, coin.rect)) {
          coin.collected = true;
          level.collectedCoins++;
        }
      }

      // goal
      if (rectsOverlap(this.rect, level.goal.rect)) {
        if (level.collectedCoins === level.coins.length) {
          level.win();
        }
      }

      // world bounds
      if (this.y > GAME_HEIGHT + 400) {
        level.lose();
      }

      // facing
      if (this.vx > 20) this.facing = 1; else if (this.vx < -20) this.facing = -1;
    }

    resolveCollisions(platforms, horizontal) {
      let grounded = false;
      for (const p of platforms) {
        if (!rectsOverlap(this.rect, p)) continue;
        if (horizontal) {
          if (this.vx > 0) this.x = p.x - this.w; else if (this.vx < 0) this.x = p.x + p.w;
          this.vx = 0;
        } else {
          if (this.vy > 0) { this.y = p.y - this.h; this.vy = 0; grounded = true; }
          else if (this.vy < 0) { this.y = p.y + p.h; this.vy = 0; }
        }
      }
      return grounded;
    }

    draw() {
      // body
      ctx.fillStyle = COLORS.player;
      ctx.fillRect(this.x, this.y, this.w, this.h);
      // ear/edge
      ctx.fillStyle = COLORS.playerEdge;
      ctx.fillRect(this.x, this.y, this.w, 4);
      // eyes
      const eyeY = this.y + 12;
      const eyeX = this.x + (this.facing === 1 ? this.w - 10 : 6);
      ctx.fillStyle = '#172554';
      ctx.fillRect(eyeX, eyeY, 4, 4);
    }
  }

  class Level {
    constructor(data) {
      this.platforms = data.platforms.map(r => new Platform(r.x, r.y, r.w, r.h));
      this.pads = data.pads.map(r => new BouncePad(r.x, r.y, r.w, r.h));
      this.coins = data.coins.map(c => new Coin(c.x, c.y));
      this.goal = new Goal(data.goal.x, data.goal.y, data.goal.w, data.goal.h);
      this.spawn = { x: data.spawn.x, y: data.spawn.y };
      this.timeLimit = data.timeLimit;
      this.timeLeft = data.timeLimit;
      this.collectedCoins = 0;
      this.state = 'ready'; // ready, playing, win, lose
    }
    start() {
      this.timeLeft = this.timeLimit;
      this.state = 'playing';
      player.x = this.spawn.x; player.y = this.spawn.y; player.vx = 0; player.vy = 0; player.onGround = false; player.coyoteTime = 0;
      for (const c of this.coins) { c.collected = false; }
      this.collectedCoins = 0;
    }
    update(dt) {
      if (this.state !== 'playing') return;
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) { this.timeLeft = 0; this.lose(); }
      for (const c of this.coins) c.update(dt);
    }
    drawBackground() {
      const g = ctx.createLinearGradient(0, 0, 0, GAME_HEIGHT);
      g.addColorStop(0, '#0b1430');
      g.addColorStop(1, '#0a1024');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
      // decorative grid
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      for (let x = 0; x < GAME_WIDTH; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, GAME_HEIGHT); ctx.stroke(); }
      for (let y = 0; y < GAME_HEIGHT; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(GAME_WIDTH, y); ctx.stroke(); }
    }
    drawWorld() {
      for (const p of this.platforms) p.draw();
      for (const pad of this.pads) pad.draw();
      this.goal.draw();
      for (const c of this.coins) c.draw();
      player.draw();
    }
    win() { if (this.state === 'playing') { this.state = 'win'; showOverlay('You Win!', 'Collected all coins and reached the goal!', 'Play Again', () => this.start()); } }
    lose() { if (this.state === 'playing') { this.state = 'lose'; showOverlay('Time Up!', 'Try again and be faster.', 'Retry', () => this.start()); } }
  }

  // Input
  const input = { left: false, right: false, jump: false, jumpPressed: false };
  function setKey(code, pressed) {
    if (code === 'ArrowLeft' || code === 'KeyA') input.left = pressed;
    if (code === 'ArrowRight' || code === 'KeyD') input.right = pressed;
    if (code === 'ArrowUp' || code === 'KeyW' || code === 'Space') { if (pressed && !input.jump) input.jumpPressed = true; input.jump = pressed; }
  }
  window.addEventListener('keydown', (e) => { setKey(e.code, true); });
  window.addEventListener('keyup', (e) => { setKey(e.code, false); });

  // Touch controls
  function bindTouch(el, on, off) {
    const start = (ev) => { ev.preventDefault(); on(); };
    const end = (ev) => { ev.preventDefault(); off(); };
    el.addEventListener('touchstart', start, { passive: false });
    el.addEventListener('touchend', end, { passive: false });
    el.addEventListener('touchcancel', end, { passive: false });
    el.addEventListener('mousedown', start);
    window.addEventListener('mouseup', end);
  }
  bindTouch(touchLeft, () => input.left = true, () => input.left = false);
  bindTouch(touchRight, () => input.right = true, () => input.right = false);
  bindTouch(touchJump, () => { if (!input.jump) input.jumpPressed = true; input.jump = true; }, () => input.jump = false);

  // Overlay helpers
  function showOverlay(title, subtitle, cta, onClick) {
    overlay.innerHTML = `
      <div class="panel">
        <h1>${title}</h1>
        <p class="subtitle">${subtitle}</p>
        <button class="btn primary" id="overlay-cta">${cta}</button>
      </div>`;
    overlay.classList.add('show');
    const ctaBtn = document.getElementById('overlay-cta');
    ctaBtn.addEventListener('click', () => { overlay.classList.remove('show'); onClick && onClick(); });
  }

  btnPlay.addEventListener('click', () => { overlay.classList.remove('show'); level.start(); });
  btnRestart.addEventListener('click', () => level.start());

  let muted = false;
  btnMute.addEventListener('click', () => { muted = !muted; btnMute.textContent = muted ? '??' : '??'; });

  // Simple blip sounds (optional, muted by default toggled via btn)
  function blip(freq = 880, duration = 0.06) {
    if (muted) return;
    try {
      const a = new (window.AudioContext || window.webkitAudioContext)();
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = 'square';
      o.frequency.value = freq;
      o.connect(g);
      g.connect(a.destination);
      g.gain.setValueAtTime(0.02, a.currentTime);
      g.gain.exponentialRampToValueAtTime(0.00001, a.currentTime + duration);
      o.start(); o.stop(a.currentTime + duration);
    } catch {}
  }

  // Level data
  const levelData = {
    timeLimit: 60,
    spawn: { x: 60, y: 380 },
    goal: { x: 860, y: 160, w: 36, h: 28 },
    platforms: [
      { x: 0, y: 500, w: 960, h: 40 },
      { x: 180, y: 440, w: 120, h: 20 },
      { x: 360, y: 390, w: 120, h: 20 },
      { x: 540, y: 340, w: 120, h: 20 },
      { x: 720, y: 290, w: 160, h: 20 },
      { x: 320, y: 260, w: 100, h: 18 },
      { x: 120, y: 330, w: 100, h: 18 },
      { x: 60,  y: 420, w: 80,  h: 16 },
      { x: 860 - 60, y: 220, w: 120, h: 16 },
    ],
    pads: [
      { x: 220, y: 480, w: 40, h: 20 },
      { x: 400, y: 430, w: 40, h: 20 },
      { x: 640, y: 320, w: 42, h: 20 },
      { x: 760, y: 270, w: 42, h: 20 },
    ],
    coins: [
      { x: 200, y: 400 },
      { x: 380, y: 350 },
      { x: 560, y: 300 },
      { x: 740, y: 250 },
      { x: 340, y: 220 },
      { x: 100, y: 290 },
    ]
  };

  // Init
  const player = new Player(levelData.spawn.x, levelData.spawn.y);
  const level = new Level(levelData);

  // Fit canvas to container size while keeping aspect
  function fitCanvas() {
    const root = document.getElementById('game-root');
    const rect = root.getBoundingClientRect();
    const targetW = Math.min(rect.width * 0.96, 1280);
    const targetH = targetW * (GAME_HEIGHT / GAME_WIDTH);
    canvas.style.width = `${targetW|0}px`;
    canvas.style.height = `${targetH|0}px`;
  }
  window.addEventListener('resize', fitCanvas);
  fitCanvas();

  // Main loop
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;

    level.update(dt);
    if (level.state === 'playing') {
      player.update(dt, input, level);
      if (input.jumpPressed) { blip(880, 0.05); }
      input.jumpPressed = false;
    }

    // draw
    level.drawBackground();
    level.drawWorld();

    // HUD
    hudTime.textContent = `? ${level.timeLeft.toFixed(1)}`;
    hudCoins.textContent = `?? ${level.collectedCoins} / ${level.coins.length}`;

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // Start overlay awaits click
})();
