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

function isGoal(state, x, y) {
  return state.goals.some((g) => g.x === x && g.y === y);
}

function applyPlayerMove(state, controllingPlayer, direction) {
  const dir = DIRS[direction];
  if (!dir) return { state, moved: false, reason: 'invalid' };

  const isHorizontal = direction === 'left' || direction === 'right';
  const isVertical = direction === 'up' || direction === 'down';

  if (controllingPlayer === 1 && isHorizontal) {
    return { state, moved: false, reason: 'axis_blocked' };
  }
  if (controllingPlayer === 2 && isVertical) {
    return { state, moved: false, reason: 'axis_blocked' };
  }

  const nextState = cloneState(state);
  let moved = false;

  [1, 2].forEach((pid) => {
    const p = nextState.players[pid];
    const targetX = p.x + dir.dx;
    const targetY = p.y + dir.dy;
    if (!isWall(nextState, targetX, targetY)) {
      p.x = targetX;
      p.y = targetY;
      moved = true;
    }
  });

  return { state: nextState, moved, movedPlayers: moved ? [1, 2] : [] };
}

function isLevelCompleted(state) {
  const goal1 = state.goals.find((g) => g.playerId === 1);
  const goal2 = state.goals.find((g) => g.playerId === 2);
  const p1 = state.players[1];
  const p2 = state.players[2];
  const p1Ok = goal1 ? p1.x === goal1.x && p1.y === goal1.y : true;
  const p2Ok = goal2 ? p2.x === goal2.x && p2.y === goal2.y : true;
  return p1Ok && p2Ok;
}

function parseLevel(level, levelIndex = 0) {
  const tiles = [];
  const goals = [];
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
      } else if (symbol === '.' || symbol === '1' || symbol === '2') {
        row.push(TILE_GOAL);
        const playerId = symbol === '1' ? 1 : symbol === '2' ? 2 : null;
        goals.push({ x, y, playerId });
      } else {
        row.push(TILE_EMPTY);
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
    players,
  };
}

function createInitialState(level, levelIndex = 0) {
  return parseLevel(level, levelIndex);
}

export { TILE_EMPTY, TILE_WALL, TILE_GOAL, DIRS, applyPlayerMove, isLevelCompleted, createInitialState, parseLevel };
