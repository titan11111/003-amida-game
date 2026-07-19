(() => {
  'use strict';

  const LINES = 4;
  const CHAR_KEYS = ['影', '剣', '祈'];
  const CHAR_SRC = [
    'images/char1.webp',
    'images/char2.webp',
    'images/char3.webp',
  ];

  // 1面 = 基本本数。クリアするごとに横棒 +1
  const BASE_BRIDGES = 5;
  const MAX_LEVEL = 5;
  const MIN_BRIDGE_GAP = 7; // 同一縦線を共有する棒の最小間隔（%）
  // 左外→右外→中央 の順で回し、片寄りを防ぐ
  const PAIR_CYCLE = [
    [1, 2],
    [3, 4],
    [2, 3],
  ];

  function bridgeCountForLevel(level) {
    const lv = Math.max(1, Math.min(level, MAX_LEVEL));
    return BASE_BRIDGES + (lv - 1);
  }

  /** レベルに応じた横棒配置（決定的・バランス重視） */
  function generatePattern(level) {
    const count = bridgeCountForLevel(level);
    const yStart = 12;
    const yEnd = 90;
    const pattern = [];

    for (let i = 0; i < count; i++) {
      const pair = PAIR_CYCLE[i % PAIR_CYCLE.length];
      const t = count === 1 ? 0.5 : i / (count - 1);
      // 等間隔を基本に、列ごとにわずかにずらして読みやすくする
      const bias = pair[0] === 1 ? -1.5 : pair[0] === 3 ? 1.5 : 0;
      let p = yStart + (yEnd - yStart) * t + bias;
      p = Math.max(yStart, Math.min(yEnd, p));
      pattern.push({ a: pair[0], b: pair[1], p });
    }

    // 同じ縦線を共有する棒が近すぎる場合は下へ押し下げ
    pattern.sort((x, y) => x.p - y.p);
    for (let i = 1; i < pattern.length; i++) {
      const cur = pattern[i];
      for (let j = 0; j < i; j++) {
        const prev = pattern[j];
        const shares =
          cur.a === prev.a || cur.a === prev.b ||
          cur.b === prev.a || cur.b === prev.b;
        if (shares && cur.p - prev.p < MIN_BRIDGE_GAP) {
          cur.p = Math.min(yEnd, prev.p + MIN_BRIDGE_GAP);
        }
      }
    }

    // 押し下げで詰まった分を、全体が収まるよう軽く再配分
    const last = pattern[pattern.length - 1];
    if (last && last.p > yEnd) {
      const scale = (yEnd - yStart) / (last.p - yStart);
      pattern.forEach((b) => {
        b.p = yStart + (b.p - yStart) * scale;
      });
    }

    return pattern;
  }

  const el = {
    title: document.getElementById('title-screen'),
    select: document.getElementById('select-screen'),
    play: document.getElementById('play-screen'),
    result: document.getElementById('result-screen'),
    end: document.getElementById('end-screen'),
    hud: document.getElementById('hud'),
    hudLevel: document.getElementById('hud-level'),
    hudScore: document.getElementById('hud-score'),
    hudLives: document.getElementById('hud-lives'),
    startBtn: document.getElementById('start-btn'),
    muteBtn: document.getElementById('mute-btn'),
    gates: document.getElementById('start-gates'),
    canvas: document.getElementById('game-canvas'),
    frame: document.getElementById('canvas-frame'),
    scrollHint: document.getElementById('scroll-hint'),
    resultImg: document.getElementById('result-img'),
    resultDelta: document.getElementById('result-delta'),
    nextBtn: document.getElementById('next-btn'),
    retryBtn: document.getElementById('retry-btn'),
    endTitle: document.getElementById('end-title'),
    endScore: document.getElementById('end-score'),
    restartBtn: document.getElementById('restart-btn'),
    bgm: document.getElementById('bgm'),
    charCards: [...document.querySelectorAll('.char-card')],
    gateBtns: [...document.querySelectorAll('.gate-btn')],
  };

  const ctx = el.canvas.getContext('2d');

  const state = {
    phase: 'title', // title | select | choose | run | result | end
    level: 1,
    score: 0,
    lives: 3,
    char: 0,
    muted: localStorage.getItem('amida-muted') === '1',
    bridges: [],
    goals: [], // 'treasure' | 'trap'
    charX: 0,
    charY: 0,
    cameraY: 0,
    animId: 0,
    worldH: 900,
    viewW: 360,
    viewH: 520,
    dpr: 1,
    topMargin: 110,
    bottomMargin: 120,
    // 選択前の手動スクロール
    camVel: 0,
    dragging: false,
    dragLastY: 0,
    dragMoved: false,
  };

  const assets = {
    chars: [],
    treasure: new Image(),
    bomb: new Image(),
    bg: new Image(),
    se: {},
    ready: false,
  };

  // ---- Audio ----
  const sound = {
    ctx: null,
    unlocked: false,

    init() {
      if (this.unlocked) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        this.ctx = new AC();
        const buf = this.ctx.createBuffer(1, 1, 22050);
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.connect(this.ctx.destination);
        src.start(0);
      }
      this.unlocked = true;
      this.resume();
    },

    async resume() {
      if (this.ctx && this.ctx.state === 'suspended') {
        try { await this.ctx.resume(); } catch (_) { /* ignore */ }
      }
      if (!state.muted && el.bgm.paused) {
        el.bgm.volume = 0.35;
        el.bgm.play().catch(() => {});
      }
    },

    beep(freq, dur, vol = 0.08) {
      if (state.muted || !this.ctx) return;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, this.ctx.currentTime);
      g.gain.linearRampToValueAtTime(vol, this.ctx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
      o.connect(g).connect(this.ctx.destination);
      o.start();
      o.stop(this.ctx.currentTime + dur);
    },

    play(name) {
      if (state.muted) return;
      const a = assets.se[name];
      if (!a) {
        if (name === 'click') this.beep(720, 0.07, 0.05);
        else if (name === 'move') this.beep(420, 0.05, 0.03);
        else if (name === 'success') { this.beep(523, 0.12); setTimeout(() => this.beep(784, 0.18), 120); }
        else if (name === 'fail') { this.beep(220, 0.2); setTimeout(() => this.beep(160, 0.3), 160); }
        return;
      }
      try {
        a.currentTime = 0;
        a.volume = name === 'move' ? 0.25 : 0.45;
        a.play();
      } catch (_) { /* ignore */ }
    },
  };

  function vibrate(ms = 15) {
    if (navigator.vibrate) navigator.vibrate(ms);
  }

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(img);
      img.src = src;
    });
  }

  function loadAudio(src) {
    const a = new Audio(src);
    a.preload = 'auto';
    return a;
  }

  async function preload() {
    const [c1, c2, c3, treasure, bomb, bg] = await Promise.all([
      loadImage(CHAR_SRC[0]),
      loadImage(CHAR_SRC[1]),
      loadImage(CHAR_SRC[2]),
      loadImage('images/treasure.webp'),
      loadImage('images/bomb.webp'),
      loadImage('images/bg.webp'),
    ]);
    assets.chars = [c1, c2, c3];
    assets.treasure = treasure;
    assets.bomb = bomb;
    assets.bg = bg;
    assets.se = {
      click: loadAudio('sounds/click.mp3'),
      success: loadAudio('sounds/success.mp3'),
      fail: loadAudio('sounds/explosion.mp3'),
      move: loadAudio('sounds/move.m4a'),
    };
    assets.ready = true;
  }

  // ---- Layout / camera ----
  function resizeCanvas() {
    // CSS で 100% 埋めしたうえで、実描画バッファだけ合わせる
    // （inline の width/height px 指定は縮小表示の原因になるので使わない）
    const w = Math.floor(el.frame.clientWidth);
    const h = Math.floor(el.frame.clientHeight);
    if (w < 64 || h < 64) return false;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const needRebuild = state.viewW !== w || state.viewH !== h;
    state.dpr = dpr;
    state.viewW = w;
    state.viewH = h;

    const bw = Math.floor(w * dpr);
    const bh = Math.floor(h * dpr);
    if (el.canvas.width !== bw || el.canvas.height !== bh) {
      el.canvas.width = bw;
      el.canvas.height = bh;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (needRebuild && (state.phase === 'choose' || state.phase === 'run' || state.phase === 'result')) {
      // 幅が変わったので縦線位置を再計算（進行中は X だけ追従）
      if (state.phase === 'choose') {
        state.charX = state.viewW / 2;
        buildBridges();
      }
    }
    return true;
  }

  function whenFrameReady(cb, tries = 0) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (resizeCanvas()) {
          cb();
          return;
        }
        if (tries < 20) {
          setTimeout(() => whenFrameReady(cb, tries + 1), 50);
          return;
        }
        // 最終手段: 画面サイズから推定
        state.dpr = Math.min(window.devicePixelRatio || 1, 2);
        state.viewW = Math.min(480, Math.max(280, window.innerWidth - 24));
        state.viewH = Math.max(320, window.innerHeight - 180);
        el.canvas.width = Math.floor(state.viewW * state.dpr);
        el.canvas.height = Math.floor(state.viewH * state.dpr);
        ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
        cb();
      });
    });
  }

  function worldHeightForLevel(level) {
    const bridges = bridgeCountForLevel(level);
    // 棒が増えるほど縦に長くし、スクロールで見やすくする
    return Math.max(780, 480 + bridges * 72);
  }

  function lineX(i) {
    return (state.viewW / (LINES + 1)) * i;
  }

  function pathTop() {
    return state.topMargin;
  }

  function pathBottom() {
    return state.worldH - state.bottomMargin;
  }

  function pathHeight() {
    return pathBottom() - pathTop();
  }

  function maxCamera() {
    return Math.max(0, state.worldH - state.viewH);
  }

  function clampCamera() {
    const maxCam = maxCamera();
    if (state.phase === 'choose') {
      // 選択前は手動スクロール（キャラ追従しない）
      if (!state.dragging && Math.abs(state.camVel) > 0.05) {
        state.cameraY += state.camVel;
        state.camVel *= 0.92;
      } else if (!state.dragging) {
        state.camVel = 0;
      }
      state.cameraY = Math.max(0, Math.min(maxCam, state.cameraY));
      return;
    }
    // 走行中・結果はキャラ中心
    state.cameraY = Math.max(0, Math.min(maxCam, state.charY - state.viewH * 0.42));
  }

  function panCamera(dy) {
    if (state.phase !== 'choose') return;
    state.cameraY = Math.max(0, Math.min(maxCamera(), state.cameraY + dy));
    if (Math.abs(dy) > 2) {
      el.scrollHint.classList.add('hidden');
    }
  }

  function buildBridges() {
    const pattern = generatePattern(state.level);
    const top = pathTop();
    const h = pathHeight();
    state.bridges = pattern.map((b) => ({
      a: b.a,
      b: b.b,
      y: top + (h * b.p) / 100,
    }));
  }

  function buildGoals() {
    // 2 treasures + 2 traps, shuffled
    const pool = ['treasure', 'treasure', 'trap', 'trap'];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    state.goals = pool;
  }

  // ---- Drawing (impressive wooden amida) ----
  function drawWoodPole(x, y1, y2) {
    const grad = ctx.createLinearGradient(x - 8, 0, x + 8, 0);
    grad.addColorStop(0, '#2a160c');
    grad.addColorStop(0.35, '#6b4226');
    grad.addColorStop(0.55, '#8a5a32');
    grad.addColorStop(1, '#24140a');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y1);
    ctx.lineTo(x, y2);
    ctx.stroke();

    // metal bands
    ctx.fillStyle = '#8a7420';
    for (let y = y1 + 40; y < y2 - 20; y += 90) {
      ctx.fillRect(x - 9, y, 18, 5);
      ctx.fillStyle = '#d4b84a';
      ctx.fillRect(x - 9, y, 18, 1.5);
      ctx.fillStyle = '#8a7420';
    }
  }

  function drawBridge(x1, x2, y) {
    // rope outline
    ctx.strokeStyle = '#1a1008';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.stroke();

    const plankGrad = ctx.createLinearGradient(0, y - 5, 0, y + 5);
    plankGrad.addColorStop(0, '#a8743c');
    plankGrad.addColorStop(0.5, '#6b3f1e');
    plankGrad.addColorStop(1, '#3a2010');
    ctx.strokeStyle = plankGrad;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.stroke();

    // plank ticks
    ctx.strokeStyle = 'rgba(20,10,4,0.45)';
    ctx.lineWidth = 1;
    const steps = Math.max(4, Math.floor(Math.abs(x2 - x1) / 18));
    for (let i = 1; i < steps; i++) {
      const x = x1 + ((x2 - x1) * i) / steps;
      ctx.beginPath();
      ctx.moveTo(x, y - 3);
      ctx.lineTo(x, y + 3);
      ctx.stroke();
    }

    // brass rings
    [[x1, y], [x2, y]].forEach(([cx, cy]) => {
      ctx.beginPath();
      ctx.arc(cx, cy, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#2a1808';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
      const g = ctx.createRadialGradient(cx - 1, cy - 1, 1, cx, cy, 6);
      g.addColorStop(0, '#f0d060');
      g.addColorStop(1, '#8a6a18');
      ctx.fillStyle = g;
      ctx.fill();
    });
  }

  function drawStartGate(x, y, n) {
    // stone plaque
    ctx.fillStyle = '#2c2620';
    ctx.strokeStyle = '#c9a227';
    ctx.lineWidth = 2;
    roundRect(x - 28, y - 36, 56, 42, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f0d060';
    ctx.font = '700 18px Cinzel, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const labels = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ'];
    ctx.fillText(labels[n - 1], x, y - 15);
  }

  function drawGoal(x, y, type) {
    const img = type === 'treasure' ? assets.treasure : assets.bomb;
    const w = 56;
    const h = 38;
    // pedestal
    ctx.fillStyle = 'rgba(20,12,6,0.7)';
    ctx.beginPath();
    ctx.ellipse(x, y + 18, 28, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    if (img && img.complete && img.naturalWidth) {
      ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
    } else {
      ctx.fillStyle = type === 'treasure' ? '#c9a227' : '#444';
      ctx.beginPath();
      ctx.arc(x, y, 16, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawCharacter(x, y) {
    const img = assets.chars[state.char];
    const bob = Math.sin(performance.now() / 220) * 2;
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(x, y + 18, 18, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // glow ring
    ctx.beginPath();
    ctx.arc(x, y + bob, 26, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(240, 208, 96, 0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (img && img.complete && img.naturalWidth) {
      const h = 58;
      const w = (img.width / img.height) * h;
      ctx.drawImage(img, x - w / 2, y - h + 10 + bob, w, h);
    } else {
      ctx.font = '36px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(CHAR_KEYS[state.char], x, y + bob);
    }
  }

  function drawWorld() {
    const w = state.viewW;
    const h = state.viewH;
    const cam = state.cameraY;

    ctx.clearRect(0, 0, w, h);

    // parchment dungeon backdrop
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#3a2a18');
    sky.addColorStop(0.45, '#24180e');
    sky.addColorStop(1, '#120c08');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    if (assets.bg.complete && assets.bg.naturalWidth) {
      ctx.globalAlpha = 0.18;
      ctx.drawImage(assets.bg, 0, -cam * 0.15, w, h + 80);
      ctx.globalAlpha = 1;
    }

    // vignette
    const vig = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.75);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(0, -cam);

    // ornate top beam
    const beamY = pathTop() - 50;
    ctx.fillStyle = '#2a180c';
    ctx.fillRect(20, beamY, w - 40, 18);
    ctx.strokeStyle = '#c9a227';
    ctx.lineWidth = 2;
    ctx.strokeRect(20, beamY, w - 40, 18);

    // vertical poles
    for (let i = 1; i <= LINES; i++) {
      drawWoodPole(lineX(i), pathTop() - 10, pathBottom() + 10);
    }

    // bridges
    state.bridges.forEach((b) => {
      drawBridge(lineX(b.a), lineX(b.b), b.y);
    });

    // start gates
    for (let i = 1; i <= LINES; i++) {
      drawStartGate(lineX(i), pathTop() - 8, i);
    }

    // goals
    for (let i = 1; i <= LINES; i++) {
      drawGoal(lineX(i), pathBottom() + 40, state.goals[i - 1]);
    }

    // bottom stone ledge
    ctx.fillStyle = '#1e1814';
    ctx.fillRect(10, pathBottom() + 70, w - 20, 24);
    ctx.strokeStyle = '#8a7420';
    ctx.strokeRect(10, pathBottom() + 70, w - 20, 24);

    // character
    if (state.phase === 'choose' || state.phase === 'run' || state.phase === 'result') {
      drawCharacter(state.charX, state.charY);
    }

    ctx.restore();

    // frame ornaments (screen space)
    ctx.strokeStyle = 'rgba(201,162,39,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(6, 6, w - 12, h - 12);
  }

  function render() {
    if (state.phase === 'choose' || state.phase === 'run' || state.phase === 'result') {
      clampCamera();
      drawWorld();
    }
  }

  // ---- Game flow ----
  function updateHud() {
    el.hudLevel.textContent = String(state.level);
    el.hudScore.textContent = String(state.score);
    el.hudLives.textContent = '♥'.repeat(state.lives) + '♡'.repeat(Math.max(0, 3 - state.lives));
  }

  function showOnly(name) {
    const playVisible = name === 'play' || name === 'choose' || name === 'run' || name === 'result';
    el.title.classList.toggle('hidden', name !== 'title');
    el.select.classList.toggle('hidden', name !== 'select');
    el.play.classList.toggle('hidden', !playVisible);
    el.result.classList.toggle('hidden', name !== 'result');
    el.end.classList.toggle('hidden', name !== 'end');
    el.hud.classList.toggle('hidden', name === 'title' || name === 'select' || name === 'end');
  }

  function enterSelect() {
    state.phase = 'select';
    showOnly('select');
    el.charCards.forEach((c) => c.classList.remove('selected'));
  }

  function prepareStage() {
    cancelAnimationFrame(state.animId);
    state.worldH = worldHeightForLevel(state.level);
    state.phase = 'choose';
    showOnly('choose');
    el.gates.classList.remove('hidden');
    el.gateBtns.forEach((b) => { b.disabled = false; });
    updateHud();

    // display:none → flex の直後は clientHeight=0 になりがちなので、レイアウト確定を待つ
    whenFrameReady(() => {
      buildBridges();
      buildGoals();
      state.charX = state.viewW / 2;
      state.charY = pathTop() - 20;
      state.cameraY = 0;
      state.camVel = 0;
      state.dragging = false;
      el.scrollHint.classList.remove('hidden');
      startIdleLoop();
    });
  }

  function startIdleLoop() {
    cancelAnimationFrame(state.animId);
    const idle = () => {
      if (state.phase !== 'choose') return;
      render();
      state.animId = requestAnimationFrame(idle);
    };
    state.animId = requestAnimationFrame(idle);
  }

  function chooseStart(n) {
    if (state.phase !== 'choose') return;
    sound.play('click');
    vibrate(12);
    el.gateBtns.forEach((b) => { b.disabled = true; });
    el.gates.classList.add('hidden');
    el.scrollHint.classList.add('hidden');
    state.camVel = 0;
    state.dragging = false;
    state.phase = 'run';
    // 門へ歩いてから下降（RPG風）
    const targetX = lineX(n);
    const targetY = pathTop();
    const fromX = state.charX;
    const fromY = state.charY;
    const startAt = performance.now();
    const walk = (now) => {
      const t = Math.min(1, (now - startAt) / 380);
      const e = 1 - Math.pow(1 - t, 2);
      state.charX = fromX + (targetX - fromX) * e;
      state.charY = fromY + (targetY - fromY) * e;
      render();
      if (t < 1) {
        state.animId = requestAnimationFrame(walk);
      } else {
        followPath(n);
      }
    };
    state.animId = requestAnimationFrame(walk);
  }

  // ---- 選択前：指スクロールで全体を目視 ----
  function bindScoutScroll() {
    const canvas = el.canvas;

    const onDown = (clientY) => {
      if (state.phase !== 'choose') return false;
      state.dragging = true;
      state.dragLastY = clientY;
      state.dragMoved = false;
      state.camVel = 0;
      canvas.classList.add('grabbing');
      return true;
    };

    const onMove = (clientY) => {
      if (!state.dragging || state.phase !== 'choose') return;
      const dy = state.dragLastY - clientY; // 指を上へ → 下を見る
      if (Math.abs(dy) > 1) state.dragMoved = true;
      panCamera(dy);
      state.camVel = dy;
      state.dragLastY = clientY;
    };

    const onUp = () => {
      if (!state.dragging) return;
      state.dragging = false;
      canvas.classList.remove('grabbing');
      // 小さすぎる速度は止める
      if (Math.abs(state.camVel) < 1.2) state.camVel = 0;
    };

    canvas.addEventListener('pointerdown', (e) => {
      if (!onDown(e.clientY)) return;
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!state.dragging) return;
      onMove(e.clientY);
      e.preventDefault();
    });
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    canvas.addEventListener('wheel', (e) => {
      if (state.phase !== 'choose') return;
      e.preventDefault();
      panCamera(e.deltaY);
      state.camVel = 0;
    }, { passive: false });
  }

  function followPath(startLine) {
    let current = startLine;
    let y = pathTop();
    const step = 2.2;
    const sorted = [...state.bridges].sort((a, b) => a.y - b.y);
    let nextIdx = 0;
    let movingX = false;
    let xFrom = lineX(current);
    let xTo = xFrom;
    let xProgress = 0;
    let x = xFrom;

    const tick = () => {
      if (movingX) {
        xProgress += 0.08;
        if (xProgress >= 1) {
          xProgress = 1;
          movingX = false;
          x = xTo;
          sound.play('move');
        } else {
          // ease
          const t = 1 - Math.pow(1 - xProgress, 2);
          x = xFrom + (xTo - xFrom) * t;
        }
      } else {
        // check bridge
        let crossed = false;
        for (let i = nextIdx; i < sorted.length; i++) {
          const br = sorted[i];
          if (y + step >= br.y && y < br.y && (current === br.a || current === br.b)) {
            y = br.y;
            const target = current === br.a ? br.b : br.a;
            xFrom = lineX(current);
            xTo = lineX(target);
            xProgress = 0;
            movingX = true;
            current = target;
            nextIdx = i + 1;
            crossed = true;
            break;
          }
        }
        if (!crossed) {
          y += step;
          x = lineX(current);
        }
      }

      state.charX = x;
      state.charY = y;
      render();

      if (y < pathBottom()) {
        state.animId = requestAnimationFrame(tick);
      } else {
        state.charY = pathBottom();
        state.charX = lineX(current);
        render();
        finishRun(current);
      }
    };

    state.animId = requestAnimationFrame(tick);
  }

  function finishRun(goalLine) {
    const type = state.goals[goalLine - 1];
    const win = type === 'treasure';
    let delta = 0;

    if (win) {
      delta = 100 * state.level;
      state.score += delta;
      sound.play('success');
      vibrate(25);
      el.resultImg.src = 'images/treasure.webp';
      el.resultDelta.textContent = `+${delta}`;
      el.resultDelta.className = 'positive';
    } else {
      delta = -50;
      state.score = Math.max(0, state.score + delta);
      state.lives -= 1;
      sound.play('fail');
      vibrate([20, 40, 20]);
      el.resultImg.src = 'images/bomb.webp';
      el.resultDelta.textContent = `${delta}`;
      el.resultDelta.className = 'negative';
    }

    updateHud();
    state.phase = 'result';
    el.result.classList.remove('hidden');

    if (state.lives <= 0) {
      setTimeout(() => showEnd(false), 1200);
    }
  }

  function showEnd(cleared) {
    state.phase = 'end';
    cancelAnimationFrame(state.animId);
    showOnly('end');
    el.endTitle.textContent = cleared ? '勝利' : '敗北';
    el.endScore.textContent = `${state.score}`;
    if (cleared) sound.play('success');
  }

  function resetRunStats(keepChar) {
    const char = keepChar ? state.char : 0;
    const muted = state.muted;
    Object.assign(state, {
      phase: 'select',
      level: 1,
      score: 0,
      lives: 3,
      char,
      muted,
      bridges: [],
      goals: [],
      charX: 0,
      charY: 0,
      cameraY: 0,
    });
  }

  // ---- Events ----
  el.startBtn.addEventListener('click', () => {
    sound.init();
    sound.play('click');
    vibrate();
    applyMute();
    enterSelect();
  });

  el.charCards.forEach((card) => {
    card.addEventListener('click', () => {
      sound.init();
      sound.play('click');
      vibrate();
      el.charCards.forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
      state.char = Number(card.dataset.char);
      setTimeout(prepareStage, 220);
    });
  });

  el.gateBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      chooseStart(Number(btn.dataset.start));
    });
  });

  el.nextBtn.addEventListener('click', () => {
    sound.play('click');
    vibrate();
    el.result.classList.add('hidden');
    if (state.lives <= 0) {
      showEnd(false);
      return;
    }
    state.level += 1;
    if (state.level > MAX_LEVEL) {
      showEnd(true);
      return;
    }
    prepareStage();
  });

  el.retryBtn.addEventListener('click', () => {
    sound.play('click');
    vibrate();
    el.result.classList.add('hidden');
    prepareStage();
  });

  el.restartBtn.addEventListener('click', () => {
    sound.play('click');
    vibrate();
    resetRunStats(true);
    enterSelect();
  });

  function applyMute() {
    el.muteBtn.textContent = state.muted ? '🔇' : '🔊';
    if (state.muted) {
      el.bgm.pause();
    } else {
      sound.resume();
    }
    localStorage.setItem('amida-muted', state.muted ? '1' : '0');
  }

  el.muteBtn.addEventListener('click', () => {
    sound.init();
    state.muted = !state.muted;
    applyMute();
    if (!state.muted) sound.play('click');
  });

  // iOS guards
  document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('selectstart', (e) => e.preventDefault());
  document.addEventListener('dragstart', (e) => e.preventDefault());
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) e.preventDefault();
    lastTouchEnd = now;
  }, false);

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) sound.resume();
  });

  window.addEventListener('resize', () => {
    if (state.phase === 'choose' || state.phase === 'run' || state.phase === 'result') {
      if (resizeCanvas()) render();
    }
  });

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      if (state.phase === 'choose' || state.phase === 'run' || state.phase === 'result') {
        if (resizeCanvas()) render();
      }
    });
    ro.observe(el.frame);
  }

  // boot
  bindScoutScroll();
  applyMute();
  preload().then(() => {
    showOnly('title');
  });
})();
