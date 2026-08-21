/* ============================================================
   ChromeZavr — игровой движок (общий для PROD и DEV)
   Подключается после разметки. Требует на странице:
   #game-placeholder (контейнер), элементы состояния загрузки.

   ЭПОХИ: движок читает файлы эпох из assets/epochs/<id>.js
   (каждый определяет window.ChromeZavrEpochs.push({...})).
   Формат файла эпохи — см. docs/EPOCH_FILES.md.
   Новые ассеты пока не созданы: эпохи задают только названия,
   палитру и список противников.
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
    SPEED_GAIN: 6,          // прирост скорости за очко
    SCORE_PER_EPOCH: 150    // очков на одну эпоху
  };

  var G = {
    running: false, over: false,
    godMode: false,
    speedMul: 1,            // множитель скорости (DEV)
    y: 0, vy: 0, onGround: true,
    obstacles: [], tSpawn: 0,
    score: 0, speed: CFG.BASE_SPEED,
    epochIndex: 0,          // текущая эпоха
    epochFlash: 0,          // таймер вспышки при смене эпохи
    lastTs: 0, rafId: null
  };

  var canvas, ctx;

  // --- Реестр эпох ---
  // Дефолтная эпоха используется, если файлы эпох не подключены.
  var DEFAULT_EPOCH = {
    id: 'default',
    name: 'Базовая эпоха',
    timeLabel: 'сейчас',
    heroName: 'Герой',
    enemies: ['Препятствие'],
    palette: { bg: '#fff', ground: '#ccc', player: '#2563eb', enemy: '#dc2626' }
  };

  function epochs() {
    if (window.ChromeZavrEpochs && window.ChromeZavrEpochs.length) {
      return window.ChromeZavrEpochs;
    }
    return [DEFAULT_EPOCH];
  }

  function currentEpoch() {
    var list = epochs();
    return list[Math.min(G.epochIndex, list.length - 1)];
  }

  // --- Нелинейный счётчик времени: интерполяция между эпохами ---
  // Каждая эпоха имеет время "назад от сейчас" в годах. Между соседними
  // эпохами время интерполируется по логарифмической шкале — так движение
  // в прошлое ощущается плавным и «эпохальным».
  function yearsAgoAt(index) {
    var e = epochs()[index];
    return e.yearsAgo || 0;
  }

  function formatYears(y) {
    if (y < 1000) return Math.round(y) + ' лет назад';
    if (y < 1e6) return (y / 1000).toFixed(1) + ' тыс. лет назад';
    if (y < 1e9) return (y / 1e6).toFixed(2) + ' млн лет назад';
    return (y / 1e9).toFixed(2) + ' млрд лет назад';
  }

  function currentTimeLabel() {
    var list = epochs();
    var i = Math.min(G.epochIndex, list.length - 1);
    var t0 = yearsAgoAt(i);
    var t1 = i + 1 < list.length ? yearsAgoAt(i + 1) : t0;
    // прогресс внутри эпохи по очкам
    var p = Math.min(1, (G.score - i * CFG.SCORE_PER_EPOCH) / CFG.SCORE_PER_EPOCH);
    // логарифмическая интерполяция (нелинейное время)
    var v;
    if (t1 > t0 && t0 >= 0) {
      v = Math.exp(Math.log(t0 + 1) + p * (Math.log(t1 + 1) - Math.log(t0 + 1))) - 1;
    } else {
      v = t0 + p * (t1 - t0);
    }
    return formatYears(v);
  }

  function initGame() {
    if (canvas) { resetGame(); G.running = true; G.lastTs = performance.now(); G.rafId = requestAnimationFrame(loop); return; }
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
    G.epochIndex = 0; G.epochFlash = 0;
    G.over = false;
  }

  function jump() {
    if (!G.running || G.over) { if (G.over) resetGame(); return; }
    if (G.onGround) {
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

    // смена эпохи по очкам
    var newIdx = Math.min(Math.floor(G.score / CFG.SCORE_PER_EPOCH), epochs().length - 1);
    if (newIdx !== G.epochIndex) {
      G.epochIndex = newIdx;
      G.epochFlash = 2; // секунды показа плашки «новая эпоха»
      G.obstacles.length = 0; // очистить препятствия прежней эпохи
    }
    if (G.epochFlash > 0) G.epochFlash -= dt;

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
    var ep = currentEpoch();
    var pal = ep.palette || DEFAULT_EPOCH.palette;

    ctx.clearRect(0, 0, CFG.W, CFG.H);

    // фон эпохи
    ctx.fillStyle = pal.bg || '#fff';
    ctx.fillRect(0, 0, CFG.W, CFG.H);

    // земля
    ctx.fillStyle = pal.ground || '#ccc';
    ctx.fillRect(0, CFG.GROUND_Y, CFG.W, 2);

    // игрок
    ctx.fillStyle = G.godMode ? '#f59e0b' : (pal.player || '#2563eb');
    ctx.fillRect(CFG.PLAYER_X, G.y, CFG.PLAYER_W, CFG.PLAYER_H);

    // === имя персонажа ПОД персонажем ===
    ctx.fillStyle = '#333';
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(ep.heroName, CFG.PLAYER_X + CFG.PLAYER_W / 2,
      Math.min(CFG.H - 4, CFG.GROUND_Y + 14));

    // препятствия
    ctx.fillStyle = pal.enemy || '#dc2626';
    for (var i = 0; i < G.obstacles.length; i++) {
      var o = G.obstacles[i];
      ctx.fillRect(o.x, CFG.GROUND_Y - o.h, o.w, o.h);
    }

    // === название эпохи СВЕРХУ ===
    ctx.fillStyle = '#333';
    ctx.font = 'bold 14px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(ep.name, CFG.W / 2, 18);

    // === нелинейный счётчик времени (под названием эпохи) ===
    ctx.fillStyle = '#666';
    ctx.font = '11px system-ui';
    ctx.fillText('⏳ ' + currentTimeLabel(), CFG.W / 2, 32);

    // === счёт справа сверху ===
    ctx.fillStyle = '#333';
    ctx.font = 'bold 13px system-ui';
    ctx.textAlign = 'right';
    ctx.fillText('Очки: ' + Math.floor(G.score), CFG.W - 12, 18);

    // === список противников СПРАВА СНИЗУ ===
    ctx.textAlign = 'right';
    ctx.font = '10px system-ui';
    ctx.fillStyle = '#888';
    var enemies = ep.enemies || [];
    for (var j = 0; j < enemies.length; j++) {
      ctx.fillText('• ' + enemies[j], CFG.W - 12, CFG.H - 10 - (enemies.length - 1 - j) * 12);
    }

    // плашка смены эпохи
    if (G.epochFlash > 0) {
      ctx.fillStyle = 'rgba(37,99,235,0.85)';
      ctx.fillRect(CFG.W / 2 - 110, CFG.H / 2 - 30, 220, 44);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 15px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('Новая эпоха: ' + ep.name, CFG.W / 2, CFG.H / 2 - 10);
      ctx.font = '11px system-ui';
      ctx.fillText(formatYears(yearsAgoAt(G.epochIndex)) + ' назад', CFG.W / 2, CFG.H / 2 + 6);
    }

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
    currentEpoch: currentEpoch,
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
      toggleGodMode: function () { G.godMode = !G.godMode; return G.godMode; },
      setGodMode: function (v) { G.godMode = !!v; },
      setSpeedMultiplier: function (m) { G.speedMul = Math.max(0.25, m); },
      getSpeedMultiplier: function () { return G.speedMul; },
      skipLoading: function () {
        if (typeof window.__czFinishLoadingNow === 'function') {
          window.__czFinishLoadingNow();
        }
      },
      restart: function () { resetGame(); },
      // Прыгнуть в конкретную эпоху по индексу (для теста)
      setEpoch: function (i) {
        G.epochIndex = Math.max(0, Math.min(i, epochs().length - 1));
        G.obstacles.length = 0;
        G.epochFlash = 2;
      },
      state: G, config: CFG
    };
    window.ChromeZavrGame._dev = dev;
    console.log('[ChromeZavr] Dev features enabled:', Object.keys(dev));
    return dev;
  };
})();
