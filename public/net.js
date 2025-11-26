let socket = null;
let handlers = {};
let connected = false;

function getWsUrl() {
  const isSecure = window.location.protocol === 'https:';
  const scheme = isSecure ? 'wss://' : 'ws://';
  return `${scheme}${window.location.host}/ws`;
}

function setHandlers(newHandlers) {
  handlers = newHandlers;
}

function ensureSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return socket;
  }
  socket = new WebSocket(getWsUrl());

  socket.addEventListener('open', () => {
    connected = true;
    handlers.onStatus?.('connected');
  });

  socket.addEventListener('close', () => {
    connected = false;
    handlers.onStatus?.('disconnected');
  });

  socket.addEventListener('error', (err) => {
    handlers.onError?.(err);
  });

  socket.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      return;
    }

    const { type, payload } = msg;
    if (type === 'room_created') {
      handlers.onRoomCreated?.(payload);
    }
    if (type === 'room_joined') {
      handlers.onRoomJoined?.(payload);
    }
    if (type === 'room_error') {
      handlers.onRoomError?.(payload);
    }
    if (type === 'state_update') {
      handlers.onStateUpdate?.(payload);
    }
  });

  return socket;
}

function sendMessage(msg) {
  const ws = ensureSocket();
  const data = JSON.stringify(msg);
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(data);
  } else {
    ws.addEventListener('open', () => ws.send(data), { once: true });
  }
}

function createRoom() {
  sendMessage({ type: 'create_room' });
}

function joinRoom(roomId) {
  sendMessage({ type: 'join_room', payload: { roomId } });
}

function sendPlayerInput(direction) {
  if (!connected) return;
  sendMessage({ type: 'player_input', payload: { direction } });
}

export { setHandlers, createRoom, joinRoom, sendPlayerInput, ensureSocket };
