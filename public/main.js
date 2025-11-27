import { levels } from './levels.js';
import { applyPlayerMove, createInitialState, isLevelCompleted } from './gameLogic.js';
import { setHandlers, createRoom, joinRoom, sendPlayerInput, ensureSocket } from './net.js';
import { generateRandomLevel } from './levelGenerator.js';
import { isLevelSolvable } from './solver.js';

const canvas = document.getElementById('game-canvas');
const canvasFrame = document.getElementById('canvas-frame');
const ctx = canvas.getContext('2d');
const tileSize = 48;
let colors = getColors();
let mode = 'local';
let scene = 'menu';
let currentLevelIndex = 0;
let currentState = null;
let animation = null;
let shake = 0;
let levelWon = false;
let introShown = false;
let activeFlash = null;
let endlessLevel = null;
let endlessStep = 1;
let endlessDifficulty = { width: 9, height: 7, goalCount: 2, wallDensity: 0.06 };
let difficulty = 'easy';
let movesUsed = 0;
let movesLimit = null;
const levelStatsCache = new Map();
let hasStartedOnce = false;
const defaultSettings = { soundOn: true, screenShake: true, showHints: true };
let settings = { ...defaultSettings };

const hud = document.getElementById('hud');
const levelCounter = document.getElementById('level-counter');
const levelTitle = document.getElementById('level-title');
const modeCaption = document.getElementById('mode-caption');
const connectionStatus = document.getElementById('connection-status');
const onlinePanel = document.getElementById('online-panel');
const localPanel = document.getElementById('local-panel');
const startScreen = document.getElementById('start-screen');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayText = document.getElementById('overlay-text');
const overlayButton = document.getElementById('overlay-button');
const overlaySecondary = document.getElementById('overlay-secondary');
const toast = document.getElementById('toast');
const onlineStatus = document.getElementById('online-status');
const levelList = document.getElementById('level-list');
const floatingLevel = document.getElementById('floating-level');
const floatingControls = document.getElementById('floating-controls');
const floatingDifficulty = document.getElementById('floating-difficulty');
const restartHint = document.getElementById('restart-hint');
const endlessButton = document.getElementById('endless-play');
const moveLimitLabel = document.getElementById('move-limit');
const difficultyChips = document.querySelectorAll('[data-difficulty]');
const campaignControls = document.getElementById('campaign-controls');
const endlessControls = document.getElementById('endless-controls');
const endlessProgress = document.getElementById('endless-progress');
const rerollEndless = document.getElementById('reroll-endless');
const menuButton = document.getElementById('menu-button');
const menuButtonTop = document.getElementById('menu-button-top');
const closeMenuButton = document.getElementById('close-menu');
const resumeGameButton = document.getElementById('resume-game');
const touchControls = document.getElementById('touch-controls');
const toggleSound = document.getElementById('toggle-sound');
const toggleShake = document.getElementById('toggle-shake');
const toggleHints = document.getElementById('toggle-hints');
const moveMeter = document.getElementById('move-meter');
const moveMeterFill = document.getElementById('move-meter-fill');
const moveRatingLabel = document.getElementById('move-rating-label');
const moveMeterScale = document.getElementById('move-meter-scale');
const moveMarkers = {
  perfect: document.getElementById('mark-perfect'),
  excellent: document.getElementById('mark-excellent'),
  good: document.getElementById('mark-good'),
  normal: document.getElementById('mark-normal'),
};

const sounds = {
  step: () => playTone(280, 0.08),
  deny: () => playTone(90, 0.1),
  win: () => playTone(420, 0.35),
};

function playTone(freq, duration) {
  if (!window.AudioContext || !settings.soundOn) return;
  const ctxAudio = new AudioContext();
  const osc = ctxAudio.createOscillator();
  const gain = ctxAudio.createGain();
  osc.frequency.value = freq;
  gain.gain.value = 0.08;
  osc.connect(gain).connect(ctxAudio.destination);
  osc.start();
  gain.gain.exponentialRampToValueAtTime(0.0001, ctxAudio.currentTime + duration);
  osc.stop(ctxAudio.currentTime + duration);
}

function getColors() {
  const styles = getComputedStyle(document.documentElement);
  return {
    floor: styles.getPropertyValue('--floor')?.trim() || '#e8e2d9',
    wall: styles.getPropertyValue('--wall')?.trim() || '#2d2b32',
    goal: styles.getPropertyValue('--goal-ring')?.trim() || '#a4d26b',
    robot1: styles.getPropertyValue('--robot1')?.trim() || '#5bc0be',
    robot2: styles.getPropertyValue('--robot2')?.trim() || '#ff7f66',
  };
}

function getActiveLevel() {
  if (mode === 'endless' && endlessLevel) return endlessLevel;
  return levels[currentLevelIndex];
}

function resizeCanvas(state) {
  canvas.width = state.width * tileSize + 32;
  canvas.height = state.height * tileSize + 32;
  fitCanvasToViewport();
}

function setModeCaption(text) {
  modeCaption.textContent = text;
}

function setStatus(text) {
  connectionStatus.textContent = text;
}

function setOnlineStatus(text) {
  onlineStatus.textContent = text;
}

function updateLevelTitle() {
  const level = getActiveLevel();
  const captionPrefix = mode === 'online' ? 'Онлайн режим' : mode === 'endless' ? 'Бесконечный режим' : 'Локальный режим';
  levelTitle.textContent = `${captionPrefix} · ${level?.name || '—'}`;
  if (mode === 'endless') {
    levelCounter.textContent = `Волна ${endlessStep}`;
  } else {
    levelCounter.textContent = `Уровень ${currentLevelIndex + 1} / ${levels.length}`;
  }
  floatingLevel.textContent = level ? level.name : '';
}

function fitCanvasToViewport() {
  if (!canvasFrame) return;
  const controlsHeight = touchControls && !touchControls.classList.contains('hidden') ? touchControls.offsetHeight + 12 : 0;
  const hudHeight = hud && !hud.classList.contains('hidden') ? hud.offsetHeight : 0;
  const topAllowance = (document.querySelector('.nav-bar')?.offsetHeight || 0) + (document.querySelector('.hero')?.offsetHeight || 0);
  const availableWidth = Math.min(window.innerWidth - 24, 1160);
  const availableHeight = window.innerHeight - topAllowance - hudHeight - controlsHeight - 32;
  const heightForScale = Math.max(140, availableHeight);
  const scale = Math.min(1, availableWidth / canvas.width, heightForScale / canvas.height);
  canvasFrame.style.setProperty('--canvas-scale', scale.toString());
  canvasFrame.style.height = `${canvas.height * scale}px`;
}

function getLevelStats(level) {
  if (!level) return null;
  if (levelStatsCache.has(level.name)) return levelStatsCache.get(level.name);
  const stats = isLevelSolvable(level);
  levelStatsCache.set(level.name, stats);
  return stats;
}

function updateMoveLabels() {
  const label = difficulty === 'easy' ? 'Easy (топ-20)' : difficulty === 'medium' ? 'Medium (топ-5)' : 'Hard (топ-2)';
  const cap = movesLimit ?? '—';
  moveLimitLabel.textContent = `Лимит ходов · ${label}: ${movesLimit ? `${movesUsed}/${cap}` : '∞'}`;
  floatingDifficulty.textContent = `${label} — лимит: ${movesLimit ?? '∞'}`;
  difficultyChips.forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.difficulty === difficulty);
  });
  updateMoveMeter();
}

function togglePanels() {
  const isOnline = mode === 'online';
  const isEndless = mode === 'endless';
  const isLocalish = mode === 'local' || mode === 'endless';
  localPanel.classList.toggle('hidden', !isLocalish);
  onlinePanel.classList.toggle('hidden', !isOnline);
  hud.classList.toggle('hidden', isOnline);
  floatingControls.classList.toggle('hidden', isOnline);
  restartHint.classList.toggle('hidden', isOnline);
  moveLimitLabel.classList.toggle('hidden', isOnline);
  if (campaignControls) campaignControls.classList.toggle('hidden', isEndless);
  if (endlessControls) endlessControls.classList.toggle('hidden', !isEndless);
  fitCanvasToViewport();
}

function loadSettings() {
  try {
    if (typeof localStorage === 'undefined') return { ...defaultSettings };
    const raw = localStorage.getItem('axis-pals-settings');
    if (!raw) return { ...defaultSettings };
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('Не удалось загрузить настройки', e);
    return { ...defaultSettings };
  }
}

function saveSettings() {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('axis-pals-settings', JSON.stringify(settings));
  } catch (e) {
    // ignore
  }
}

function applySettings() {
  document.body.classList.toggle('hints-off', !settings.showHints);
  if (toggleSound) toggleSound.checked = settings.soundOn;
  if (toggleShake) toggleShake.checked = settings.screenShake;
  if (toggleHints) toggleHints.checked = settings.showHints;
}

function updateEndlessProgress() {
  if (!endlessProgress) return;
  const densityPercent = Math.round(endlessDifficulty.wallDensity * 100);
  endlessProgress.textContent = `Волна ${endlessStep} · Поле ${endlessDifficulty.width}×${endlessDifficulty.height}, стен до ${densityPercent}%`;
}

function deriveBenchmarks(stats) {
  const solutions = stats?.solutions;
  const limits = stats?.moveLimits;
  const pickFromSolutions = (rank) => {
    if (!solutions || !solutions.length) return null;
    const idx = Math.min(rank, solutions.length - 1);
    return solutions[idx];
  };
  const perfect = pickFromSolutions(0) ?? limits?.hard ?? limits?.medium ?? limits?.easy ?? null;
  const excellent = pickFromSolutions(4) ?? limits?.medium ?? limits?.hard ?? null;
  const good = pickFromSolutions(19) ?? limits?.easy ?? limits?.medium ?? null;
  const normal = pickFromSolutions(49) ?? solutions?.[solutions.length - 1] ?? limits?.easy ?? null;
  const longest = solutions?.[solutions.length - 1] ?? normal ?? good ?? excellent ?? perfect ?? movesLimit ?? 10;
  const buffer = Math.max(2, Math.ceil(longest * 0.1));
  return { perfect, excellent, good, normal, upper: longest + buffer };
}

function getMoveRating(moves, benchmarks) {
  const { perfect, excellent, good, normal } = benchmarks;
  if (perfect && moves <= perfect) return { tier: 'perfect', label: 'Идеально' };
  if (excellent && moves <= excellent) return { tier: 'excellent', label: 'Отлично' };
  if (good && moves <= good) return { tier: 'good', label: 'Хорошо' };
  if (normal && moves <= normal) return { tier: 'normal', label: 'Нормально' };
  return { tier: 'bad', label: 'Плохо' };
}

function positionMarkers(benchmarks, maxValue) {
  Object.entries(moveMarkers).forEach(([key, element]) => {
    const value = benchmarks[key];
    if (!element) return;
    if (!value || !maxValue) {
      element.classList.add('hidden');
      return;
    }
    const pct = Math.min(100, (value / maxValue) * 100);
    element.style.left = `${pct}%`;
    element.classList.remove('hidden');
  });
}

function updateMoveMeter() {
  if (!moveMeterFill || !moveRatingLabel || !moveMeterScale || !moveMeter) return;
  const stats = getLevelStats(getActiveLevel());
  const benchmarks = deriveBenchmarks(stats);
  const maxValue = Math.max(
    benchmarks.upper ?? 0,
    movesLimit ?? 0,
    movesUsed,
    benchmarks.normal ?? 0,
    benchmarks.good ?? 0,
    benchmarks.excellent ?? 0,
    benchmarks.perfect ?? 0,
    8,
  );
  const rating = getMoveRating(movesUsed, benchmarks);
  moveMeter.dataset.tier = rating.tier;
  moveRatingLabel.textContent = rating.label;
  moveMeterFill.style.width = `${Math.min(100, (movesUsed / maxValue) * 100)}%`;
  moveMeterScale.textContent = `Идеально ≤ ${benchmarks.perfect ?? '—'} · Отлично ≤ ${benchmarks.excellent ?? '—'} · Хорошо ≤ ${benchmarks.good ?? '—'} · Нормально ≤ ${benchmarks.normal ?? '—'}`;
  positionMarkers(benchmarks, maxValue);
}

function openMainMenu() {
  startScreen.classList.remove('hidden');
  scene = 'menu';
}

function closeMainMenu() {
  startScreen.classList.add('hidden');
  scene = mode;
  hasStartedOnce = true;
}

function setDifficultyLevel(level) {
  if (!['easy', 'medium', 'hard'].includes(level)) return;
  difficulty = level;
  movesUsed = 0;
  const stats = getLevelStats(getActiveLevel());
  movesLimit = stats?.moveLimits ? stats.moveLimits[difficulty] : null;
  updateMoveLabels();
}

function drawBase(state) {
  const offsetX = (canvas.width - state.width * tileSize) / 2;
  const offsetY = (canvas.height - state.height * tileSize) / 2;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  if (shake > 0) {
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    shake *= 0.85;
  }

  for (let y = 0; y < state.height; y += 1) {
    for (let x = 0; x < state.width; x += 1) {
      const tile = state.tiles[y][x];
      const px = offsetX + x * tileSize;
      const py = offsetY + y * tileSize;
      ctx.fillStyle = colors.floor;
      ctx.fillRect(px, py, tileSize, tileSize);
      ctx.strokeStyle = 'rgba(0,0,0,0.05)';
      ctx.strokeRect(px, py, tileSize, tileSize);
      if (tile === 1) {
        ctx.fillStyle = colors.wall;
        ctx.fillRect(px, py, tileSize, tileSize);
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.fillRect(px, py + tileSize - 6, tileSize, 6);
      }
    }
  }

  state.goals.forEach((g) => {
    const px = offsetX + g.x * tileSize;
    const py = offsetY + g.y * tileSize;
    const tint = g.playerId === 1 ? colors.robot1 : g.playerId === 2 ? colors.robot2 : colors.goal;
    ctx.strokeStyle = tint;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(px + 8, py + 8, tileSize - 16, tileSize - 16, 10);
    ctx.stroke();
    ctx.fillStyle = `${tint}30`;
    ctx.fillRect(px + 10, py + 10, tileSize - 20, tileSize - 20);
  });

  return { offsetX, offsetY };
}

function interpolate(start, end, t) {
  return start + (end - start) * t;
}

function drawPlayers(state, offset, animProgress = 1) {
  const from = animation?.from;

  const drawBot = (id, color, arrows) => {
    const bot = state.players[id];
    let x = bot.x;
    let y = bot.y;
    if (animation && from) {
      const start = from.players[id];
      x = interpolate(start.x, bot.x, animProgress);
      y = interpolate(start.y, bot.y, animProgress);
    }
    const px = offset.offsetX + x * tileSize;
    const py = offset.offsetY + y * tileSize;
    ctx.save();
    ctx.translate(px + tileSize / 2, py + tileSize / 2);
    ctx.shadowColor = 'rgba(0,0,0,0.2)';
    ctx.shadowBlur = 8;

    const flashActive = activeFlash && activeFlash.playerId === id && performance.now() < activeFlash.until;
    if (flashActive) {
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.arc(0, 0, tileSize / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(-tileSize / 2 + 6, -tileSize / 2 + 6, tileSize - 12, tileSize - 12, 12);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(-8, -4, 4, 0, Math.PI * 2);
    ctx.arc(8, -4, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2d2b32';
    ctx.beginPath();
    ctx.arc(-8, -4, 2, 0, Math.PI * 2);
    ctx.arc(8, -4, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    const drawArrow = (dx, dy, dir) => {
      ctx.save();
      ctx.translate(dx, dy);
      ctx.beginPath();
      if (dir === 'left') { ctx.moveTo(-6, 0); ctx.lineTo(6, -6); ctx.lineTo(6, 6); }
      if (dir === 'right') { ctx.moveTo(6, 0); ctx.lineTo(-6, -6); ctx.lineTo(-6, 6); }
      if (dir === 'up') { ctx.moveTo(0, -6); ctx.lineTo(-6, 6); ctx.lineTo(6, 6); }
      if (dir === 'down') { ctx.moveTo(0, 6); ctx.lineTo(-6, -6); ctx.lineTo(6, -6); }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    arrows.forEach((a, idx) => {
      const offsetArrow = idx === 0 ? -10 : 10;
      if (a === 'left') drawArrow(-12, offsetArrow, 'left');
      if (a === 'right') drawArrow(12, offsetArrow, 'right');
      if (a === 'up') drawArrow(offsetArrow, -12, 'up');
      if (a === 'down') drawArrow(offsetArrow, 12, 'down');
    });

    ctx.restore();
  };

  drawBot(1, colors.robot1, ['left', 'right']);
  drawBot(2, colors.robot2, ['up', 'down']);

  ctx.restore();
}

function renderFrame(timestamp) {
  if (animation) {
    const progress = Math.min((timestamp - animation.start) / animation.duration, 1);
    const offset = drawBase(animation.to);
    drawPlayers(animation.to, offset, progress);
    if (progress >= 1) {
      currentState = animation.to;
      animation = null;
    }
  } else if (currentState) {
    const offset = drawBase(currentState);
    drawPlayers(currentState, offset, 1);
  }
  requestAnimationFrame(renderFrame);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 1500);
}

function showOverlay(title, text, options = {}) {
  const { buttonLabel = 'Продолжить', onClose = null, secondaryLabel = null, onSecondary = null } = options;
  overlayTitle.textContent = title;
  overlayText.innerHTML = text;
  overlayButton.textContent = buttonLabel;
  if (secondaryLabel) {
    overlaySecondary.textContent = secondaryLabel;
    overlaySecondary.classList.remove('hidden');
    overlaySecondary.onclick = () => {
      overlay.classList.remove('visible');
      overlay.classList.add('hidden');
      if (onSecondary) onSecondary();
    };
  } else {
    overlaySecondary.classList.add('hidden');
  }
  overlay.classList.remove('hidden');
  overlay.classList.add('visible');
  overlayButton.onclick = () => {
    overlay.classList.remove('visible');
    overlay.classList.add('hidden');
    if (onClose) onClose();
  };
}

function resetLocal() {
  levelWon = false;
  const level = getActiveLevel();
  if (!level) return;
  currentState = createInitialState(level, currentLevelIndex);
  activeFlash = null;
  movesUsed = 0;
  const stats = getLevelStats(level);
  movesLimit = stats?.moveLimits ? stats.moveLimits[difficulty] : null;
  resizeCanvas(currentState);
  updateLevelTitle();
  updateMoveLabels();
}

function startLocalGame() {
  mode = 'local';
  scene = 'local';
  closeMainMenu();
  togglePanels();
  connectionStatus.textContent = 'Оффлайн режим';
  modeCaption.textContent = 'Локальная игра: горизонтальный и вертикальный пал движутся вместе';
  currentLevelIndex = 0;
  movesUsed = 0;
  resetLocal();
  updateEndlessProgress();
  if (!introShown) {
    introShown = true;
    showOverlay('Вместе за клавиатурой', 'Сядьте вдвоём за клавиатуру.<br>Игрок 1 — только W/S (двигает обоих по вертикали).<br>Игрок 2 — только стрелки ← → (двигает обоих по горизонтали).<br>Каждая команда двигает оба квадратика. Если одному мешает стена, второй продолжает идти. Совместите каждого со своей цветной целью.', {
      buttonLabel: 'Понятно',
    });
  }
}

function startOnline() {
  mode = 'online';
  scene = 'online';
  closeMainMenu();
  togglePanels();
  modeCaption.textContent = 'Онлайн: подключитесь к комнате и двигайтесь по очереди';
  ensureSocket();
}

function generateNextEndlessLevel() {
  const attempt = endlessStep;
  const levelDef = generateRandomLevel({
    width: endlessDifficulty.width,
    height: endlessDifficulty.height,
    goalCount: endlessDifficulty.goalCount,
    wallDensity: endlessDifficulty.wallDensity,
    attempt,
    label: 'Endless',
  });
  if (!levelDef.moveLimits) {
    const stats = getLevelStats(levelDef);
    levelDef.moveLimits = stats?.moveLimits;
    levelDef.solutions = stats?.solutions;
  }
  endlessLevel = levelDef;
  updateEndlessProgress();
}

function startEndless() {
  mode = 'endless';
  scene = 'endless';
  closeMainMenu();
  togglePanels();
  endlessStep = 1;
  endlessDifficulty = { width: 9, height: 7, goalCount: 2, wallDensity: 0.06 };
  generateNextEndlessLevel();
  resetLocal();
  updateEndlessProgress();
  modeCaption.textContent = 'Бесконечный локальный режим: сложность растёт с каждым этапом';
}

function handleLevelCompletion() {
  levelWon = true;
  sounds.win();
  const stats = getLevelStats(getActiveLevel());
  const limits = stats?.moveLimits || {};
  const rating = getMoveRating(movesUsed, deriveBenchmarks(stats));
  const summary = `Вы сделали ${movesUsed} ходов.<br>Лимиты: Easy ≤ ${limits.easy ?? '∞'}, Medium ≤ ${limits.medium ?? '∞'}, Hard ≤ ${limits.hard ?? '∞'}.<br>Качество: ${rating.label}.`;
  if (mode === 'endless') {
    showOverlay('Уровень пройден', `${summary}<br>Следующая волна будет сложнее.`, {
      buttonLabel: 'Дальше',
      onClose: () => {
        endlessStep += 1;
        endlessDifficulty = {
          width: Math.min(14, endlessDifficulty.width + (endlessStep % 2 === 0 ? 1 : 0)),
          height: Math.min(12, endlessDifficulty.height + (endlessStep % 3 === 0 ? 1 : 0)),
          goalCount: 2,
          wallDensity: Math.min(0.18, endlessDifficulty.wallDensity + 0.01),
        };
        generateNextEndlessLevel();
        resetLocal();
        updateEndlessProgress();
      },
      secondaryLabel: 'Заново',
      onSecondary: () => resetLocal(),
    });
  } else {
    showOverlay('Уровень пройден', `${summary}<br>Выберите сложность и попробуйте улучшить результат.`, {
      buttonLabel: 'Следующий уровень',
      onClose: () => {
        currentLevelIndex = (currentLevelIndex + 1) % levels.length;
        resetLocal();
      },
      secondaryLabel: 'Заново',
      onSecondary: () => resetLocal(),
    });
  }
}

function handleDirectionalInput(direction, controllingPlayerHint = null) {
  if (mode === 'online') {
    sendPlayerInput(direction);
    return;
  }
  handleLocalMove(direction, controllingPlayerHint);
}

function handleLocalMove(direction, controllingPlayerHint = null) {
  if (!currentState || animation || levelWon) return;
  const controllingPlayer = controllingPlayerHint || (direction === 'left' || direction === 'right' ? 2 : 1);
  const before = currentState;
  const { state: next, moved, reason } = applyPlayerMove(before, controllingPlayer, direction);

  if (!moved) {
    shake = settings.screenShake ? 3 : 0;
    sounds.deny();
    if (reason === 'axis_blocked') {
      if (controllingPlayer === 1) showToast('Игрок 1 отвечает только за вертикаль (W/S)');
      if (controllingPlayer === 2) showToast('Игрок 2 отвечает только за горизонталь (← →)');
    }
    return;
  }

  animation = {
    from: before,
    to: next,
    playerId: controllingPlayer,
    start: performance.now(),
    duration: 140,
  };

  activeFlash = { playerId: controllingPlayer, until: performance.now() + 200 };
  sounds.step();

  movesUsed += 1;
  updateMoveLabels();

  if (movesLimit && movesUsed > movesLimit) {
    showOverlay('Ходы закончились', 'Попробуйте снова или снизьте сложность.', {
      buttonLabel: 'Перезапустить',
      onClose: () => resetLocal(),
    });
    return;
  }

  if (isLevelCompleted(next)) {
    setTimeout(() => handleLevelCompletion(), 160);
  }
}

function mapKeyToDirection(event) {
  const key = event.key || '';
  const code = event.code || '';
  const k = key.toLowerCase();
  if (code === 'ArrowLeft' || key === 'ArrowLeft') return { direction: 'left', player: 2 };
  if (code === 'ArrowRight' || key === 'ArrowRight') return { direction: 'right', player: 2 };
  if (code === 'KeyW' || k === 'w') return { direction: 'up', player: 1 };
  if (code === 'KeyS' || k === 's') return { direction: 'down', player: 1 };
  return null;
}

function setupControls() {
  document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.key.toLowerCase() === 'r' && mode !== 'online') {
      resetLocal();
      return;
    }

    const mapped = mapKeyToDirection(e);
    if (!mapped) return;
    const { direction, player } = mapped;
    handleDirectionalInput(direction, player);
    e.preventDefault();
  });
}

function setupTouchControls() {
  if (!touchControls) return;
  const buttons = touchControls.querySelectorAll('[data-direction]');
  buttons.forEach((btn) => {
    btn.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const dir = btn.dataset.direction;
      const playerHint = btn.dataset.player ? Number(btn.dataset.player) : null;
      handleDirectionalInput(dir, playerHint);
    });
  });

  window.addEventListener(
    'touchstart',
    () => {
      document.body.classList.add('touch-active');
      fitCanvasToViewport();
    },
    { once: true },
  );
}

function setupUI() {
  document.getElementById('local-play').addEventListener('click', startLocalGame);
  document.getElementById('online-play').addEventListener('click', startOnline);
  endlessButton.addEventListener('click', startEndless);
  document.getElementById('restart-level').addEventListener('click', resetLocal);
  if (menuButton) menuButton.addEventListener('click', openMainMenu);
  if (menuButtonTop) menuButtonTop.addEventListener('click', openMainMenu);
  if (closeMenuButton) {
    closeMenuButton.addEventListener('click', () => {
      if (!hasStartedOnce) {
        startLocalGame();
      } else {
        closeMainMenu();
      }
    });
  }
  if (resumeGameButton) {
    resumeGameButton.addEventListener('click', () => {
      if (!hasStartedOnce) {
        startLocalGame();
      } else {
        closeMainMenu();
      }
    });
  }
  if (rerollEndless) {
    rerollEndless.addEventListener('click', () => {
      if (mode !== 'endless') startEndless();
      generateNextEndlessLevel();
      resetLocal();
      updateEndlessProgress();
    });
  }
  if (toggleSound) {
    toggleSound.addEventListener('change', () => {
      settings.soundOn = toggleSound.checked;
      saveSettings();
    });
  }
  if (toggleShake) {
    toggleShake.addEventListener('change', () => {
      settings.screenShake = toggleShake.checked;
      saveSettings();
    });
  }
  if (toggleHints) {
    toggleHints.addEventListener('change', () => {
      settings.showHints = toggleHints.checked;
      applySettings();
      saveSettings();
    });
  }
  difficultyChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      setDifficultyLevel(chip.dataset.difficulty);
      resetLocal();
    });
  });
  document.getElementById('create-room').addEventListener('click', () => {
    setOnlineStatus('Создаём комнату...');
    createRoom();
  });
  document.getElementById('join-room').addEventListener('click', () => {
    const roomId = document.getElementById('room-id-input').value.trim().toUpperCase();
    if (!roomId) {
      setOnlineStatus('Введите Room ID');
      return;
    }
    setOnlineStatus(`Пытаемся подключиться к ${roomId}...`);
    joinRoom(roomId);
  });
}

function buildLevelList() {
  if (!levelList) return;
  levelList.innerHTML = '';
  levels.forEach((lvl, idx) => {
    const btn = document.createElement('button');
    btn.className = 'ghost level-button';
    btn.textContent = `${idx + 1}. ${lvl.name}`;
    btn.addEventListener('click', () => {
      if (scene !== 'local') {
        startLocalGame();
      }
      currentLevelIndex = idx;
      resetLocal();
    });
    levelList.appendChild(btn);
  });
}

function applyRemoteState(payload) {
  currentLevelIndex = payload.levelIndex || 0;
  currentState = payload.state;
  levelWon = payload.completed;
  resizeCanvas(currentState);
  updateLevelTitle();
}

function logSolvability() {
  levels.forEach((lvl, idx) => {
    const result = getLevelStats(lvl);
    // eslint-disable-next-line no-console
    console.info(`Level ${idx + 1} (${lvl.name}): solvable=${result.solvable}${result.minSteps !== undefined ? `, minSteps=${result.minSteps}` : ''}${result.moveLimits ? `, limits=${JSON.stringify(result.moveLimits)}` : ''}`);
  });
}

setHandlers({
  onStatus: (status) => {
    if (status === 'connected') setStatus('Онлайн: соединение установлено');
    if (status === 'disconnected') setStatus('Соединение потеряно');
  },
  onRoomCreated: ({ roomId, playerId: pid }) => {
    setOnlineStatus(`Комната создана: ${roomId}. Ожидаем второго игрока...`);
    modeCaption.textContent = `Вы игрок ${pid}. Делитесь Room ID со вторым.`;
  },
  onRoomJoined: ({ roomId, playerId: pid }) => {
    setOnlineStatus(`Подключены к комнате ${roomId} как Игрок ${pid}.`);
    modeCaption.textContent = `Вы игрок ${pid}. Подсказки на экране.`;
  },
  onRoomError: ({ message }) => {
    setOnlineStatus(`Ошибка: ${message}`);
  },
  onStateUpdate: (payload) => {
    applyRemoteState(payload);
  },
  onError: () => setOnlineStatus('Ошибка соединения'),
});

function init() {
  colors = getColors();
  settings = loadSettings();
  applySettings();
  setupControls();
  setupTouchControls();
  setupUI();
  buildLevelList();
  updateLevelTitle();
  updateMoveLabels();
  setModeCaption('Выберите режим: локальный/бесконечный — сразу старт, онлайн — через комнату. На телефоне доступны стрелки на экране.');
  setTimeout(() => logSolvability(), 10);
  requestAnimationFrame(renderFrame);
  fitCanvasToViewport();
  window.addEventListener('resize', fitCanvasToViewport);
  window.addEventListener('orientationchange', fitCanvasToViewport);
}

init();
