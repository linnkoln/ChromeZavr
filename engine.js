/* ============================================================
   ChromeZavr — игровой движок (общий для PROD и DEV)
   Подключается после разметки. Требует на странице:
   #game-placeholder (контейнер), элементы состояния загрузки.
   ============================================================ */

(function () {
  'use strict';

  // --- Конфигурация игры ---
  var CFG = {
    W: 480, H: 240,
    GROUND_Y: 200,          // уровень земли
    GRAVITY: 2200,          // px/s^2
    JUMP_V: -780,           // начальная скорость прыжка
    PLAYER_X: 60,
    PLAYER_W: 34, PLAYER_H: 44,
    OBSTACLE_MIN_GAP: 0.9,  // сек между препятствиями (мин)
    OBSTACLE_MAX_GAP: 1.8,
    BASE_SPEED: 260,        // px/s
    SPEED_GAIN: 6           // прирост скорости за очко
  };

  var G = {
    running: false, over: false,
    godMode: false,
    speedMul: 1,            // множитель скорости (DEV)
    y: 0, vy: 0, onGround: true,
    obstacles: [], tSpawn: 0,
    score: 0, speed: CFG.BASE_SPEED,
    lastTs: 0, rafId: null
  };

  var canvas, ctx;

  function initGame() {
    if (canvas) return; // уже инициализирована
    var host = document.getElementById('game-placeholder');
    host.innerHTML = '';
    host.style.border = '2px solid #2563eb';
    host.style.background = '#fff';
    host.style.display = 'flex';
    host.style.alignItems = 'flex-end';

    canvas = document.createElement('canvas');
    canvas.width = CFG.W; canvas.height = CFG.H;
    canvas.style.width = '100%'; canvas.style.height = 'auto';
    host.appendChild(canvas);
    ctx = canvas.getContext('2d');

    resetGame();
    G.running = true;
    G.lastTs = performance.now();
    G.rafId = requestAnimationFrame(loop);
  }

  function resetGame() {
    G.y = CFG.GROUND_Y - CFG.PLAYER_H;
    G.vy = 0; G.onGround = true;
    G.obstacles = []; G.tSpawn = 0.8;
    G.score = 0; G.speed = CFG.BASE_SPEED;
    G.over = false;
  }

  function jump() {
    if (!G.running || G.over) { if (G.over) resetGame(); return; }
    if (G.onGround) {
      G.vy = CFG.JUMP_V / G.speedMul > 0 ? CFG.JUMP_V : CFG.JUMP_V;
      G.vy = CFG.JUMP_V;
      G.onGround = false;
    }
  }

  function loop(ts) {
    if (!G.running) return;
    var dt = Math.min(0.05, (ts - G.lastTs) / 1000);
    G.lastTs = ts;
    update(dt * G.speedMul);
    draw();
    G.rafId = requestAnimationFrame(loop);
  }

  function update(dt) {
    if (G.over) return;
    G.speed = CFG.BASE_SPEED + G.score * CFG.SPEED_GAIN;

    // физика игрока
    G.vy += CFG.GRAVITY * dt;
    G.y += G.vy * dt;
    if (G.y >= CFG.GROUND_Y - CFG.PLAYER_H) {
      G.y = CFG.GROUND_Y - CFG.PLAYER_H; G.vy = 0; G.onGround = true;
    }

    // спавн препятствий
    G.tSpawn -= dt;
    if (G.tSpawn <= 0) {
      var h = 24 + Math.random() * 26;
      G.obstacles.push({ x: CFG.W + 20, w: 16 + Math.random() * 14, h: h });
      G.tSpawn = CFG.OBSTACLE_MIN_GAP + Math.random() *
        (CFG.OBSTACLE_MAX_GAP - CFG.OBSTACLE_MIN_GAP);
    }

    // движение и коллизии
    for (var i = G.obstacles.length - 1; i >= 0; i--) {
      var o = G.obstacles[i];
      o.x -= G.speed * dt;
      if (o.x < -40) { G.obstacles.splice(i, 1); continue; }
      if (!G.godMode &&
          CFG.PLAYER_X < o.x + o.w &&
          CFG.PLAYER_X + CFG.PLAYER_W > o.x &&
          G.y + CFG.PLAYER_H > CFG.GROUND_Y - o.h) {
        gameOver();
        return;
      }
    }

    G.score += dt * 10; // очки идут со временем
  }

  function gameOver() {
    G.over = true;
  }

  function draw() {
    ctx.clearRect(0, 0, CFG.W, CFG.H);

    // земля
    ctx.fillStyle = '#ccc';
    ctx.fillRect(0, CFG.GROUND_Y, CFG.W, 2);

    // игрок
    ctx.fillStyle = G.godMode ? '#f59e0b' : '#2563eb';
    ctx.fillRect(CFG.PLAYER_X, G.y, CFG.PLAYER_W, CFG.PLAYER_H);

    // препятствия
    ctx.fillStyle = '#dc2626';
    for (var i = 0; i < G.obstacles.length; i++) {
      var o = G.obstacles[i];
      ctx.fillRect(o.x, CFG.GROUND_Y - o.h, o.w, o.h);
    }

    // счёт
    ctx.fillStyle = '#333';
    ctx.font = 'bold 16px system-ui';
    ctx.textAlign = 'right';
    ctx.fillText('Очки: ' + Math.floor(G.score), CFG.W - 12, 24);

    if (G.over) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, CFG.W, CFG.H);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.font = 'bold 22px system-ui';
      ctx.fillText('Игра окончена', CFG.W / 2, CFG.H / 2 - 10);
      ctx.font = '14px system-ui';
      ctx.fillText('Пробел или клик — заново', CFG.W / 2, CFG.H / 2 + 16);
    }
  }

  // --- Публичный API ---
  window.ChromeZavrGame = {
    start: initGame,
    jump: jump,
    isOver: function () { return G.over; },
    // === DEV API (по умолчанию недоступно в PROD) ===
    _dev: null // заполняется enableDevFeatures()
  };

  // ============================================================
  // ФУНКЦИИ РАЗРАБОТЧИКА.
  // В PROD по умолчанию ВЫКЛЮЧЕНЫ. Активируются вызовом
  // enableDevFeatures() — это делает index-dev.html при загрузке.
  // ============================================================
  window.enableDevFeatures = function () {
    if (window.ChromeZavrGame._dev) return window.ChromeZavrGame._dev;

    var dev = {
      // GodMode: игрок неуязвим
      toggleGodMode: function () { G.godMode = !G.godMode; return G.godMode; },
      setGodMode: function (v) { G.godMode = !!v; },
      // Множитель скорости игры (2 = вдвое быстрее)
      setSpeedMultiplier: function (m) { G.speedMul = Math.max(0.25, m); },
      getSpeedMultiplier: function () { return G.speedMul; },
      // Пропустить ожидание загрузки мгновенно
      skipLoading: function () {
        if (typeof window.__czFinishLoadingNow === 'function') {
          window.__czFinishLoadingNow();
        }
      },
      // Сброс игры
      restart: function () { resetGame(); },
      // Доступ к внутреннему состоянию (для отладки)
      state: G, config: CFG
    };
    window.ChromeZavrGame._dev = dev;
    console.log('[ChromeZavr] Dev features enabled:', Object.keys(dev));
    return dev;
  };
})();
