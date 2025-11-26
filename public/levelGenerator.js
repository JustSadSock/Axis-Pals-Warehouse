import { isLevelSolvable } from './solver.js';

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function createEmptyGrid(width, height) {
  const grid = [];
  for (let y = 0; y < height; y += 1) {
    const row = [];
    for (let x = 0; x < width; x += 1) {
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        row.push('#');
      } else {
        row.push(' ');
      }
    }
    grid.push(row);
  }
  return grid;
}

function pickFree(grid, taken) {
  const height = grid.length;
  const width = grid[0].length;
  const free = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      if (grid[y][x] === ' ' && !taken.some((p) => p.x === x && p.y === y)) {
        free.push({ x, y });
      }
    }
  }
  if (free.length === 0) return null;
  return free[randomInt(0, free.length - 1)];
}

function placeRandomWalls(grid, density) {
  const height = grid.length;
  const width = grid[0].length;
  const count = Math.floor((width * height) * density);
  for (let i = 0; i < count; i += 1) {
    const x = randomInt(1, width - 2);
    const y = randomInt(1, height - 2);
    grid[y][x] = '#';
  }
}

function gridToStrings(grid) {
  return grid.map((row) => row.join(''));
}

function generateRandomLevel(config = {}) {
  const {
    width = 10,
    height = 8,
    boxCount = 2,
    wallDensity = 0.08,
    attempt = 1,
    label = 'Случайный склад',
    maxAttempts = 30,
  } = config;

  for (let tries = 0; tries < maxAttempts; tries += 1) {
    const grid = createEmptyGrid(width, height);
    placeRandomWalls(grid, wallDensity);

    const goals = [];

    for (let i = 0; i < boxCount; i += 1) {
      const goal = pickFree(grid, [...goals]);
      if (!goal) break;
      grid[goal.y][goal.x] = '.';
      goals.push(goal);
    }

    const boxes = [];
    for (let i = 0; i < boxCount; i += 1) {
      const pos = pickFree(grid, [...goals, ...boxes]);
      if (!pos) break;
      boxes.push(pos);
    }

    const player1 = pickFree(grid, [...goals, ...boxes]);
    const player2 = pickFree(grid, [...goals, ...boxes, player1 ? [player1] : []].flat());

    if (!player1 || !player2 || boxes.length !== boxCount || goals.length !== boxCount) {
      continue;
    }

    const level = {
      name: `${label} #${attempt + tries}`,
      width,
      height,
      map: gridToStrings(grid),
      player1,
      player2,
      boxes,
    };

    const solvable = isLevelSolvable(level);
    if (solvable.solvable) {
      return level;
    }
  }

  return {
    name: `${label} (fallback)` ,
    width,
    height,
    map: [
      '#'.repeat(width),
      '#'.padEnd(width - 1, ' ') + '#',
      '#'.padEnd(width - 1, ' ') + '#',
      '#'.padEnd(width - 1, ' ') + '#',
      '#'.repeat(width),
    ].slice(0, height),
    player1: { x: 1, y: 1 },
    player2: { x: Math.min(width - 2, 2), y: Math.min(height - 2, 2) },
    boxes: [{ x: Math.min(width - 3, 2), y: Math.min(height - 3, 2) }],
  };
}

export { generateRandomLevel };
