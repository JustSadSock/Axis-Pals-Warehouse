import { isLevelSolvable } from './solver.js';

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function createEmptyGrid(width, height) {
  const grid = [];
  for (let y = 0; y < height; y += 1) {
    const row = [];
    for (let x = 0; x < width; x += 1) {
      row.push(x === 0 || y === 0 || x === width - 1 || y === height - 1 ? '#' : ' ');
    }
    grid.push(row);
  }
  return grid;
}

function pickFree(grid, taken = []) {
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
  const count = Math.floor(width * height * density);
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
    goalCount = 2,
    wallDensity = 0.08,
    attempt = 1,
    label = 'Случайный склад',
    maxAttempts = 30,
  } = config;

  for (let tries = 0; tries < maxAttempts; tries += 1) {
    const grid = createEmptyGrid(width, height);
    placeRandomWalls(grid, wallDensity);

    const goals = [];
    for (let i = 0; i < goalCount; i += 1) {
      const goal = pickFree(grid, goals);
      if (!goal) break;
      grid[goal.y][goal.x] = '.';
      goals.push(goal);
    }
    if (goals.length !== goalCount) continue;

    const player1 = pickFree(grid, goals);
    const player2 = pickFree(grid, [...goals, player1].filter(Boolean));

    if (!player1 || !player2) continue;

    const level = {
      name: `${label} #${attempt + tries}`,
      width,
      height,
      map: gridToStrings(grid),
      player1,
      player2,
    };

    const solvable = isLevelSolvable(level);
    if (solvable.solvable) {
      return level;
    }
  }

  const fallbackGrid = createEmptyGrid(width, height);
  if (width > 2 && height > 2) {
    fallbackGrid[1][1] = '.';
    fallbackGrid[height - 2][width - 2] = '.';
  }

  return {
    name: `${label} (fallback)`,
    width,
    height,
    map: gridToStrings(fallbackGrid),
    player1: { x: 1, y: 1 },
    player2: { x: Math.min(width - 2, 2), y: Math.min(height - 2, 2) },
  };
}

export { generateRandomLevel };
