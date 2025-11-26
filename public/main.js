import { levels } from './levels.js';
import { applyPlayerMove, createInitialState, isLevelCompleted } from './gameLogic.js';
import { setHandlers, createRoom, joinRoom, sendPlayerInput, ensureSocket } from './net.js';
import { generateRandomLevel } from './levelGenerator.js';
import { isLevelSolvable } from './solver.js';

const canvas = document.getElementById('game-canvas');
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
const toast = document.getElementById('toast');
const onlineStatus = document.getElementById('online-status');
const levelList = document.getElementById('level-list');
const floatingLevel = document.getElementById('floating-level');
const floatingControls = document.getElementById('floating-controls');
const restartHint = document.getElementById('restart-hint');
const endlessButton = document.getElementById('endless-play');

const sounds = {
  step: () => playTone(280, 0.08),
  deny: () => playTone(90, 0.1),
  win: () => playTone(420, 0.35),
};

function playTone(freq, duration) {
  if (!window.AudioContext) return;
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
    ctx.strokeStyle = colors.goal;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(px + 8, py + 8, tileSize - 16, tileSize - 16, 10);
    ctx.stroke();
    ctx.fillStyle = 'rgba(164,210,107,0.12)';
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

function showOverlay(title, text, buttonLabel = 'Продолжить', onClose = null) {
  overlayTitle.textContent = title;
  overlayText.innerHTML = text;
  overlayButton.textContent = buttonLabel;
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
  resizeCanvas(currentState);
  updateLevelTitle();
}

function startLocalGame() {
  mode = 'local';
  scene = 'local';
  startScreen.classList.add('hidden');
  localPanel.classList.remove('hidden');
  onlinePanel.classList.add('hidden');
  hud.classList.remove('hidden');
  floatingControls.classList.remove('hidden');
  restartHint.classList.remove('hidden');
  connectionStatus.textContent = 'Оффлайн режим';
  modeCaption.textContent = 'Локальная игра: горизонтальный и вертикальный пал движутся вместе';
  currentLevelIndex = 0;
  resetLocal();
  if (!introShown) {
    introShown = true;
    showOverlay(
      'Вместе за клавиатурой',
      'Сядьте вдвоём за клавиатуру.<br>Игрок 1 — управляет влево/вправо (WASD или ← →).<br>Игрок 2 — управляет вверх/вниз (стрелки или W/S).<br>Каждая команда двигает оба квадратика. Если одному мешает стена, второй продолжает идти. Совместите оба на цели.',
      'Понятно',
    );
  }
}

function startOnline() {
  mode = 'online';
  scene = 'online';
  startScreen.classList.add('hidden');
  localPanel.classList.add('hidden');
  onlinePanel.classList.remove('hidden');
  hud.classList.add('hidden');
  floatingControls.classList.add('hidden');
  restartHint.classList.add('hidden');
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
  endlessLevel = levelDef;
}

function startEndless() {
  mode = 'endless';
  scene = 'endless';
  startScreen.classList.add('hidden');
  localPanel.classList.remove('hidden');
  onlinePanel.classList.add('hidden');
  hud.classList.remove('hidden');
  floatingControls.classList.remove('hidden');
  restartHint.classList.remove('hidden');
  endlessStep = 1;
  endlessDifficulty = { width: 9, height: 7, goalCount: 2, wallDensity: 0.06 };
  generateNextEndlessLevel();
  resetLocal();
  modeCaption.textContent = 'Бесконечный локальный режим: сложность растёт с каждым этапом';
}

function handleLevelCompletion() {
  levelWon = true;
  sounds.win();
  if (mode === 'endless') {
    showOverlay('Уровень пройден', 'Дальше чуть сложнее. Готовы?', 'Дальше', () => {
      endlessStep += 1;
      endlessDifficulty = {
        width: Math.min(14, endlessDifficulty.width + (endlessStep % 2 === 0 ? 1 : 0)),
        height: Math.min(12, endlessDifficulty.height + (endlessStep % 3 === 0 ? 1 : 0)),
        goalCount: 2,
        wallDensity: Math.min(0.18, endlessDifficulty.wallDensity + 0.01),
      };
      generateNextEndlessLevel();
      resetLocal();
    });
  } else {
    showOverlay('Уровень пройден', 'Отличная координация! Готовы к следующему?', 'Следующий уровень', () => {
      currentLevelIndex = (currentLevelIndex + 1) % levels.length;
      resetLocal();
    });
  }
}

function handleLocalMove(direction) {
  if (!currentState || animation || levelWon) return;
  const controllingPlayer = direction === 'left' || direction === 'right' ? 1 : 2;
  const before = currentState;
  const { state: next, moved, reason } = applyPlayerMove(before, controllingPlayer, direction);

  if (!moved) {
    shake = 3;
    sounds.deny();
    if (reason === 'axis_blocked') {
      if (controllingPlayer === 1) showToast('Игрок 1 отвечает только за влево/вправо');
      if (controllingPlayer === 2) showToast('Игрок 2 отвечает только за вверх/вниз');
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

  if (isLevelCompleted(next)) {
    setTimeout(() => handleLevelCompletion(), 160);
  }
}

function mapKeyToDirection(event) {
  const key = event.key || '';
  const code = event.code || '';
  const k = key.toLowerCase();
  if (code === 'KeyW' || k === 'w' || key === 'ArrowUp') return 'up';
  if (code === 'KeyS' || k === 's' || key === 'ArrowDown') return 'down';
  if (code === 'KeyA' || k === 'a' || key === 'ArrowLeft') return 'left';
  if (code === 'KeyD' || k === 'd' || key === 'ArrowRight') return 'right';
  return null;
}

function setupControls() {
  document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (mode === 'online') {
      const dirOnline = mapKeyToDirection(e);
      if (dirOnline) {
        sendPlayerInput(dirOnline);
        e.preventDefault();
      }
      return;
    }

    if (e.key.toLowerCase() === 'r') {
      resetLocal();
      return;
    }

    const dir = mapKeyToDirection(e);
    if (!dir) return;
    handleLocalMove(dir);
    e.preventDefault();
  });
}

function setupUI() {
  document.getElementById('local-play').addEventListener('click', startLocalGame);
  document.getElementById('online-play').addEventListener('click', startOnline);
  endlessButton.addEventListener('click', startEndless);
  document.getElementById('restart-level').addEventListener('click', resetLocal);
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
    const result = isLevelSolvable(lvl);
    // eslint-disable-next-line no-console
    console.info(`Level ${idx + 1} (${lvl.name}): solvable=${result.solvable}${result.minSteps !== undefined ? `, minSteps=${result.minSteps}` : ''}`);
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
  setupControls();
  setupUI();
  buildLevelList();
  updateLevelTitle();
  setModeCaption('Выберите режим: локальный/бесконечный — сразу старт, онлайн — через комнату.');
  setTimeout(() => logSolvability(), 10);
  requestAnimationFrame(renderFrame);
}

init();
