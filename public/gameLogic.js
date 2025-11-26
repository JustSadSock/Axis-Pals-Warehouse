const TILE_EMPTY = 0;
const TILE_WALL = 1;
const TILE_GOAL = 2;

const DIRS = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

function cloneState(state) {
  return {
    levelIndex: state.levelIndex,
    width: state.width,
    height: state.height,
    tiles: state.tiles.map((row) => [...row]),
    goals: state.goals.map((g) => ({ ...g })),
    boxes: state.boxes.map((b) => ({ ...b })),
    players: {
      1: { ...state.players[1] },
      2: { ...state.players[2] },
    },
  };
}

function isWall(state, x, y) {
  if (x < 0 || y < 0 || x >= state.width || y >= state.height) return true;
  return state.tiles[y][x] === TILE_WALL;
}

function boxAt(state, x, y) {
  return state.boxes.find((b) => b.x === x && b.y === y);
}

function isGoal(state, x, y) {
  return state.goals.some((g) => g.x === x && g.y === y);
}

function applyPlayerMove(state, playerId, direction) {
  const dir = DIRS[direction];
  if (!dir) return { state, moved: false };
  const nextState = cloneState(state);
  const player = nextState.players[playerId];
  if (!player) return { state, moved: false };

  const targetX = player.x + dir.dx;
  const targetY = player.y + dir.dy;

  if (isWall(nextState, targetX, targetY)) {
    return { state: nextState, moved: false };
  }

  const box = boxAt(nextState, targetX, targetY);
  if (box) {
    const isHorizontal = direction === 'left' || direction === 'right';
    const isVertical = direction === 'up' || direction === 'down';
    if ((playerId === 1 && isVertical) || (playerId === 2 && isHorizontal)) {
      return { state: nextState, moved: false };
    }

    const beyondX = box.x + dir.dx;
    const beyondY = box.y + dir.dy;
    if (isWall(nextState, beyondX, beyondY) || boxAt(nextState, beyondX, beyondY)) {
      return { state: nextState, moved: false };
    }

    box.x = beyondX;
    box.y = beyondY;
  }

  player.x = targetX;
  player.y = targetY;

  return { state: nextState, moved: true };
}

function isLevelCompleted(state) {
  return state.boxes.every((box) => isGoal(state, box.x, box.y));
}

function parseLevel(level, levelIndex = 0) {
  const tiles = [];
  const goals = [];
  const boxes = level.boxes.map((b) => ({ ...b }));
  const players = {
    1: { ...level.player1 },
    2: { ...level.player2 },
  };

  for (let y = 0; y < level.height; y += 1) {
    const row = [];
    for (let x = 0; x < level.width; x += 1) {
      const symbol = level.map[y][x];
      if (symbol === '#') {
        row.push(TILE_WALL);
      } else if (symbol === '.') {
        row.push(TILE_GOAL);
        goals.push({ x, y });
      } else {
        row.push(TILE_EMPTY);
        if (symbol === 'o') goals.push({ x, y });
      }
    }
    tiles.push(row);
  }

  return {
    levelIndex,
    width: level.width,
    height: level.height,
    tiles,
    goals,
    boxes,
    players,
  };
}

function createInitialState(level, levelIndex = 0) {
  return parseLevel(level, levelIndex);
}

export { TILE_EMPTY, TILE_WALL, TILE_GOAL, DIRS, applyPlayerMove, isLevelCompleted, createInitialState, parseLevel };
