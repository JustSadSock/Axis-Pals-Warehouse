import { levels } from './levels.js';
import { applyPlayerMove, createInitialState, isLevelCompleted } from './gameLogic.js';
import { setHandlers, createRoom, joinRoom, sendPlayerInput, ensureSocket } from './net.js';

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const tileSize = 48;
let colors = getColors();
let mode = 'local';
let currentLevelIndex = 0;
let currentState = null;
let animation = null;
let shake = 0;
let levelWon = false;
let introShown = false;

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

const sounds = {
  step: () => playTone(280, 0.06),
  push: () => playTone(180, 0.08),
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
    box: styles.getPropertyValue('--box')?.trim() || '#f5d7b2',
    boxShadow: styles.getPropertyValue('--box-shadow')?.trim() || '#d0af86',
    robot1: styles.getPropertyValue('--robot1')?.trim() || '#5bc0be',
    robot2: styles.getPropertyValue('--robot2')?.trim() || '#ff7f66',
  };
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
  const level = levels[currentLevelIndex];
  levelTitle.textContent = `${mode === 'local' ? 'Локальный режим' : 'Онлайн режим'} · ${level.name}`;
  levelCounter.textContent = `Уровень ${currentLevelIndex + 1} / ${levels.length}`;
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

  // goals
  state.goals.forEach((g) => {
    const px = offsetX + g.x * tileSize;
    const py = offsetY + g.y * tileSize;
    ctx.strokeStyle = colors.goal;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(px + 8, py + 8, tileSize - 16, tileSize - 16, 8);
    ctx.stroke();
  });

  return { offsetX, offsetY };
}

function interpolate(start, end, t) {
  return start + (end - start) * t;
}

function drawEntities(state, offset, animProgress = 1) {
  const from = animation?.from;
  const movingPlayer = animation?.playerId;
  const movedBoxIndex = animation?.movedBoxIndex;

  const drawBox = (box, idx) => {
    let x = box.x;
    let y = box.y;
    if (animation && idx === movedBoxIndex && from) {
      const start = from.boxes[idx];
      x = interpolate(start.x, box.x, animProgress);
      y = interpolate(start.y, box.y, animProgress);
    }
    const px = offset.offsetX + x * tileSize;
    const py = offset.offsetY + y * tileSize;
    ctx.fillStyle = colors.box;
    ctx.strokeStyle = colors.boxShadow;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(px + 6, py + 6, tileSize - 12, tileSize - 12, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(px + 6, py + tileSize - 12, tileSize - 12, 8);
    if (isLevelCompleted(state) && state.goals.some((g) => g.x === Math.round(x) && g.y === Math.round(y))) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 10, py + 10, tileSize - 20, tileSize - 20);
    }
  };

  state.boxes.forEach(drawBox);

  const drawBot = (bot, color, arrows, id) => {
    let x = bot.x;
    let y = bot.y;
    if (animation && movingPlayer === id && from) {
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
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(-tileSize / 2 + 6, -tileSize / 2 + 6, tileSize - 12, tileSize - 12, 12);
    ctx.fill();
    ctx.stroke();

    // eyes
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

  drawBot(state.players[1], colors.robot1, ['left', 'right'], 1);
  drawBot(state.players[2], colors.robot2, ['up', 'down'], 2);

  ctx.restore();
}

function renderFrame(timestamp) {
  if (animation) {
    const progress = Math.min((timestamp - animation.start) / animation.duration, 1);
    const offset = drawBase(animation.to);
    drawEntities(animation.to, offset, progress);
    if (progress >= 1) {
      currentState = animation.to;
      animation = null;
    }
  } else if (currentState) {
    const offset = drawBase(currentState);
    drawEntities(currentState, offset, 1);
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
  currentState = createInitialState(levels[currentLevelIndex], currentLevelIndex);
  resizeCanvas(currentState);
  updateLevelTitle();
}

function startLocalGame() {
  mode = 'local';
  startScreen.classList.add('hidden');
  localPanel.classList.remove('hidden');
  onlinePanel.classList.add('hidden');
  hud.classList.remove('hidden');
  connectionStatus.textContent = 'Оффлайн режим';
  modeCaption.textContent = 'Локальная игра: Игрок 1 (WASD), Игрок 2 (стрелки)';
  currentLevelIndex = 0;
  resetLocal();
  if (!introShown) {
    introShown = true;
    showOverlay(
      'Вместе за клавиатурой',
      'Сядьте вдвоём за клавиатуру.<br>Игрок 1 — слева (WASD), толкает коробки только влево/вправо.<br>Игрок 2 — справа (стрелки), толкает только вверх/вниз. Решайте вместе.',
      'Понятно',
    );
  }
}

function startOnline() {
  mode = 'online';
  startScreen.classList.add('hidden');
  localPanel.classList.add('hidden');
  onlinePanel.classList.remove('hidden');
  hud.classList.add('hidden');
  modeCaption.textContent = 'Онлайн: подключитесь к комнате и двигайтесь по очереди';
  ensureSocket();
}

function handleLevelCompletion() {
  levelWon = true;
  sounds.win();
  showOverlay('Уровень пройден', 'Отличная координация! Готовы к следующему?', 'Следующий уровень', () => {
    currentLevelIndex = (currentLevelIndex + 1) % levels.length;
    resetLocal();
  });
}

function handleLocalMove(direction, controllingPlayer) {
  if (!currentState || animation || levelWon) return;
  const before = currentState;
  const { state: next, moved, reason, movedBoxIndex } = applyPlayerMove(before, controllingPlayer, direction);

  if (!moved) {
    shake = 3;
    sounds.deny();
    if (reason === 'axis_blocked') {
      if (controllingPlayer === 1) showToast('Робот 1 толкает только влево/вправо');
      if (controllingPlayer === 2) showToast('Робот 2 толкает только вверх/вниз');
    }
    return;
  }

  const playerMovedBox = movedBoxIndex !== null && movedBoxIndex !== undefined;
  animation = {
    from: before,
    to: next,
    playerId: controllingPlayer,
    movedBoxIndex: playerMovedBox ? movedBoxIndex : null,
    start: performance.now(),
    duration: 140,
  };

  const boxMoved = playerMovedBox;
  boxMoved ? sounds.push() : sounds.step();

  if (isLevelCompleted(next)) {
    setTimeout(() => handleLevelCompletion(), 160);
  }
}

function mapKeyToDirection(key) {
  const k = key.toLowerCase();
  if (k === 'w' || key === 'ArrowUp') return 'up';
  if (k === 's' || key === 'ArrowDown') return 'down';
  if (k === 'a' || key === 'ArrowLeft') return 'left';
  if (k === 'd' || key === 'ArrowRight') return 'right';
  return null;
}

function setupControls() {
  document.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (mode !== 'local') {
      const dirOnline = mapKeyToDirection(e.key);
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

    const dir = mapKeyToDirection(e.key);
    if (!dir) return;
    const controllingPlayer = ['w', 'a', 's', 'd'].includes(e.key.toLowerCase()) ? 1 : 2;
    handleLocalMove(dir, controllingPlayer);
    e.preventDefault();
  });
}

function setupUI() {
  document.getElementById('local-play').addEventListener('click', startLocalGame);
  document.getElementById('online-play').addEventListener('click', startOnline);
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

function applyRemoteState(payload) {
  currentLevelIndex = payload.levelIndex || 0;
  currentState = payload.state;
  levelWon = payload.completed;
  resizeCanvas(currentState);
  updateLevelTitle();
}

setHandlers({
  onStatus: (status) => {
    if (status === 'connected') setStatus('Онлайн: соединение установлено');
    if (status === 'disconnected') setStatus('Соединение потеряно');
  },
  onRoomCreated: ({ roomId, playerId: pid }) => {
    setOnlineStatus(`Комната создана: ${roomId}. Ожидаем второго игрока...`);
    modeCaption.textContent = `Вы игрок ${pid}. Поделитесь Room ID со вторым палом.`;
  },
  onRoomJoined: ({ roomId, playerId: pid }) => {
    setOnlineStatus(`Подключены к комнате ${roomId} как Игрок ${pid}.`);
    modeCaption.textContent = `Вы игрок ${pid}. Двигайтесь по очереди.`;
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
  updateLevelTitle();
  setModeCaption('Выберите режим: локальный — сразу старт, онлайн — через комнату.');
  requestAnimationFrame(renderFrame);
}

init();
