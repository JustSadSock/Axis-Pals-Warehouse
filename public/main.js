import { levels } from './levels.js';
import { applyPlayerMove, createInitialState, isLevelCompleted } from './gameLogic.js';
import { setHandlers, createRoom, joinRoom, sendPlayerInput, ensureSocket } from './net.js';

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const tileSize = 48;
let currentState = null;
let currentLevelIndex = 0;
let mode = 'local';
let playerId = 1;
let shake = 0;

const sounds = {
  step: () => playTone(280, 0.04),
  push: () => playTone(180, 0.07),
  deny: () => playTone(90, 0.1),
  win: () => playTone(420, 0.25),
};

function playTone(freq, duration) {
  if (!window.AudioContext) return;
  const ctxAudio = new AudioContext();
  const osc = ctxAudio.createOscillator();
  const gain = ctxAudio.createGain();
  osc.frequency.value = freq;
  gain.gain.value = 0.07;
  osc.connect(gain).connect(ctxAudio.destination);
  osc.start();
  gain.gain.exponentialRampToValueAtTime(0.0001, ctxAudio.currentTime + duration);
  osc.stop(ctxAudio.currentTime + duration);
}

function setModeCaption(text) {
  document.getElementById('mode-caption').textContent = text;
}

function setStatus(text) {
  document.getElementById('connection-status').textContent = text;
}

function setOnlineStatus(text) {
  document.getElementById('online-status').textContent = text;
}

function updateLevelTitle() {
  const level = levels[currentLevelIndex];
  document.getElementById('level-title').textContent = `${mode === 'local' ? 'Локальный режим' : 'Онлайн режим'} · ${level.name}`;
}

function drawGrid(state) {
  const offsetX = (canvas.width - state.width * tileSize) / 2;
  const offsetY = (canvas.height - state.height * tileSize) / 2;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  if (shake > 0) {
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    shake *= 0.9;
  }

  for (let y = 0; y < state.height; y += 1) {
    for (let x = 0; x < state.width; x += 1) {
      const tile = state.tiles[y][x];
      const px = offsetX + x * tileSize;
      const py = offsetY + y * tileSize;
      ctx.fillStyle = tile === 1 ? '#2d2b32' : '#e8e2d9';
      ctx.fillRect(px, py, tileSize, tileSize);
      if (tile === 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.1)';
        ctx.fillRect(px, py + tileSize - 8, tileSize, 8);
      }
    }
  }

  // goals
  ctx.strokeStyle = '#a4d26b';
  ctx.lineWidth = 3;
  state.goals.forEach((g) => {
    const px = offsetX + g.x * tileSize;
    const py = offsetY + g.y * tileSize;
    ctx.strokeRect(px + 6, py + 6, tileSize - 12, tileSize - 12);
  });

  // boxes
  state.boxes.forEach((b) => {
    const px = offsetX + b.x * tileSize;
    const py = offsetY + b.y * tileSize;
    ctx.fillStyle = '#f5d7b2';
    ctx.strokeStyle = '#d0af86';
    ctx.lineWidth = 2;
    ctx.fillRect(px + 4, py + 4, tileSize - 8, tileSize - 8);
    ctx.strokeRect(px + 4, py + 4, tileSize - 8, tileSize - 8);
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    ctx.fillRect(px + 4, py + tileSize - 14, tileSize - 8, 10);
  });

  // players
  const drawArrow = (x, y, dir) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    if (dir === 'left') { ctx.moveTo(-6, 0); ctx.lineTo(6, -6); ctx.lineTo(6, 6); }
    if (dir === 'right') { ctx.moveTo(6, 0); ctx.lineTo(-6, -6); ctx.lineTo(-6, 6); }
    if (dir === 'up') { ctx.moveTo(0, -6); ctx.lineTo(-6, 6); ctx.lineTo(6, 6); }
    if (dir === 'down') { ctx.moveTo(0, 6); ctx.lineTo(-6, -6); ctx.lineTo(6, -6); }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  const renderBot = (bot, color, arrows) => {
    const px = offsetX + bot.x * tileSize;
    const py = offsetY + bot.y * tileSize;
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 3;
    ctx.save();
    ctx.translate(px + tileSize / 2, py + tileSize / 2);
    ctx.shadowColor = 'rgba(0,0,0,0.15)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.roundRect(-16, -16, 32, 32, 8);
    ctx.fill();
    ctx.stroke();

    // eyes
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(-6, -4, 4, 0, Math.PI * 2);
    ctx.arc(6, -4, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2d2b32';
    ctx.beginPath();
    ctx.arc(-6, -4, 2, 0, Math.PI * 2);
    ctx.arc(6, -4, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    arrows.forEach((a, idx) => {
      const offset = idx === 0 ? -8 : 8;
      if (a === 'left') drawArrow(-10, offset, 'left');
      if (a === 'right') drawArrow(10, offset, 'right');
      if (a === 'up') drawArrow(offset, -10, 'up');
      if (a === 'down') drawArrow(offset, 10, 'down');
    });

    ctx.restore();
  };

  renderBot(state.players[1], '#ff7f66', ['left', 'right']);
  renderBot(state.players[2], '#5bc0be', ['up', 'down']);

  ctx.restore();
}

function resetLocal() {
  currentState = createInitialState(levels[currentLevelIndex], currentLevelIndex);
  updateLevelTitle();
  drawGrid(currentState);
}

function handleLocalMove(direction, controllingPlayer) {
  const before = currentState;
  const { state: next, moved } = applyPlayerMove(before, controllingPlayer, direction);
  if (!moved) {
    shake = 3;
    sounds.deny();
  } else {
    const boxMoved = next.boxes.some((b, idx) => b.x !== before.boxes[idx]?.x || b.y !== before.boxes[idx]?.y);
    currentState = next;
    boxMoved ? sounds.push() : sounds.step();
    if (isLevelCompleted(currentState)) {
      sounds.win();
      currentLevelIndex = (currentLevelIndex + 1) % levels.length;
      currentState = createInitialState(levels[currentLevelIndex], currentLevelIndex);
      updateLevelTitle();
    }
  }
  drawGrid(currentState);
}

function setupControls() {
  document.addEventListener('keydown', (e) => {
    if (mode !== 'local') {
      const dir = mapKeyToDirection(e.key);
      if (dir) {
        sendPlayerInput(dir);
        e.preventDefault();
      }
      return;
    }

    const dir = mapKeyToDirection(e.key);
    if (!dir) return;
    const controllingPlayer = ['w', 'a', 's', 'd'].includes(e.key.toLowerCase()) ? 1 : 2;
    handleLocalMove(dir, controllingPlayer);
    e.preventDefault();
  });
}

function mapKeyToDirection(key) {
  const k = key.toLowerCase();
  if (k === 'w' || key === 'ArrowUp') return 'up';
  if (k === 's' || key === 'ArrowDown') return 'down';
  if (k === 'a' || key === 'ArrowLeft') return 'left';
  if (k === 'd' || key === 'ArrowRight') return 'right';
  return null;
}

function setupUI() {
  const localBtn = document.getElementById('local-play');
  const onlineBtn = document.getElementById('online-play');
  const restartBtn = document.getElementById('restart-level');
  const createBtn = document.getElementById('create-room');
  const joinBtn = document.getElementById('join-room');
  const roomInput = document.getElementById('room-id-input');

  localBtn.addEventListener('click', () => {
    mode = 'local';
    document.getElementById('local-panel').classList.remove('hidden');
    document.getElementById('online-panel').classList.add('hidden');
    currentLevelIndex = 0;
    resetLocal();
    setModeCaption('Локальная игра: Игрок 1 (WASD), Игрок 2 (стрелки)');
    setStatus('Оффлайн режим');
  });

  onlineBtn.addEventListener('click', () => {
    mode = 'online';
    document.getElementById('local-panel').classList.add('hidden');
    document.getElementById('online-panel').classList.remove('hidden');
    setModeCaption('Онлайн: выполняйте ход только в свой ход, сервер — источник истины.');
    ensureSocket();
  });

  restartBtn.addEventListener('click', resetLocal);

  createBtn.addEventListener('click', () => {
    setOnlineStatus('Создаём комнату...');
    createRoom();
  });

  joinBtn.addEventListener('click', () => {
    const roomId = roomInput.value.trim().toUpperCase();
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
  drawGrid(currentState);
  updateLevelTitle();
  if (payload.completed) {
    setOnlineStatus('Уровень пройден! Ждём новый.');
  }
}

setHandlers({
  onStatus: (status) => {
    if (status === 'connected') setStatus('Онлайн: соединение установлено');
    if (status === 'disconnected') setStatus('Соединение потеряно');
  },
  onRoomCreated: ({ roomId, playerId: pid }) => {
    playerId = pid;
    setOnlineStatus(`Комната создана: ${roomId}. Ожидаем второго игрока...`);
  },
  onRoomJoined: ({ roomId, playerId: pid }) => {
    playerId = pid;
    setOnlineStatus(`Подключены к комнате ${roomId} как Игрок ${pid}.`);
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
  resetLocal();
  setupControls();
  setupUI();
  setModeCaption('Локальная игра: Игрок 1 (WASD), Игрок 2 (стрелки)');
  updateLevelTitle();
}

init();
