import express from 'express';
import { createServer } from 'http';
import path from 'path';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { levels } from '../public/levels.js';
import { createInitialState, applyPlayerMove, isLevelCompleted } from '../public/gameLogic.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '../public')));

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

const rooms = new Map();
const socketRoom = new Map();
const socketPlayerId = new Map();

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 5; i += 1) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function createRoom() {
  let id;
  do {
    id = generateRoomId();
  } while (rooms.has(id));

  const state = createInitialState(levels[0], 0);
  rooms.set(id, {
    levelIndex: 0,
    state,
    sockets: new Map(),
  });
  return id;
}

function broadcastState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const payload = {
    type: 'state_update',
    payload: {
      roomId,
      levelIndex: room.levelIndex,
      state: room.state,
      completed: isLevelCompleted(room.state),
    },
  };
  const message = JSON.stringify(payload);
  for (const ws of room.sockets.keys()) {
    if (ws.readyState === ws.OPEN) {
      ws.send(message);
    }
  }
}

function addPlayerToRoom(roomId, ws) {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };
  if (room.sockets.size >= 2) return { error: 'Room full' };

  const playerId = room.sockets.size === 0 ? 1 : 2;
  room.sockets.set(ws, playerId);
  socketRoom.set(ws, roomId);
  socketPlayerId.set(ws, playerId);

  return { playerId };
}

function resetRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const levelIndex = room.levelIndex;
  room.state = createInitialState(levels[levelIndex], levelIndex);
}

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch (err) {
      return;
    }

    const { type, payload } = message;

    if (type === 'create_room') {
      const roomId = createRoom();
      const { playerId } = addPlayerToRoom(roomId, ws);
      ws.send(JSON.stringify({ type: 'room_created', payload: { roomId, playerId } }));
      broadcastState(roomId);
      return;
    }

    if (type === 'join_room') {
      const { roomId } = payload || {};
      const room = rooms.get(roomId);
      if (!room) {
        ws.send(JSON.stringify({ type: 'room_error', payload: { message: 'Room not found' } }));
        return;
      }
      const result = addPlayerToRoom(roomId, ws);
      if (result.error) {
        ws.send(JSON.stringify({ type: 'room_error', payload: { message: result.error } }));
        return;
      }
      ws.send(JSON.stringify({ type: 'room_joined', payload: { roomId, playerId: result.playerId } }));
      broadcastState(roomId);
      return;
    }

    if (type === 'player_input') {
      const dir = payload?.direction;
      const roomId = socketRoom.get(ws);
      const playerId = socketPlayerId.get(ws);
      const room = rooms.get(roomId);
      if (!room || !playerId || !dir) return;

      const { state: newState } = applyPlayerMove(room.state, playerId, dir);
      room.state = newState;

      if (isLevelCompleted(room.state)) {
        room.levelIndex = (room.levelIndex + 1) % levels.length;
        room.state = createInitialState(levels[room.levelIndex], room.levelIndex);
      }

      broadcastState(roomId);
    }
  });

  ws.on('close', () => {
    const roomId = socketRoom.get(ws);
    const room = rooms.get(roomId);
    if (room) {
      room.sockets.delete(ws);
      socketPlayerId.delete(ws);
      socketRoom.delete(ws);
      if (room.sockets.size === 0) {
        rooms.delete(roomId);
      } else {
        resetRoom(roomId);
        broadcastState(roomId);
      }
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Axis Pals server running on http://localhost:${PORT}`);
});
