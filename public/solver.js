import { applyPlayerMove, createInitialState, isLevelCompleted } from './gameLogic.js';

const MAX_STATES = 250000;
const MAX_DEPTH = 220;
const DIRECTIONS = ['up', 'down', 'left', 'right'];

function canonicalKey(state) {
  const p1 = state.players[1];
  const p2 = state.players[2];
  return `p1:${p1.x},${p1.y};p2:${p2.x},${p2.y}`;
}

function collectSolutions(level, maxSolutions = 50) {
  const startState = createInitialState(level);
  const visited = new Set();
  const queue = [{ state: startState, steps: 0 }];
  visited.add(canonicalKey(startState));
  let explored = 0;
  const solutions = [];

  while (queue.length > 0) {
    const { state, steps } = queue.shift();
    explored += 1;
    if (explored > MAX_STATES || steps > MAX_DEPTH) break;

    if (isLevelCompleted(state)) {
      solutions.push(steps);
      if (solutions.length >= maxSolutions) break;
      continue; // still look for alternative paths at same or greater depth
    }

    for (const playerId of [1, 2]) {
      for (const dir of DIRECTIONS) {
        const { state: nextState, moved } = applyPlayerMove(state, playerId, dir);
        if (!moved) continue;
        const key = canonicalKey(nextState);
        if (visited.has(key)) continue;
        visited.add(key);
        queue.push({ state: nextState, steps: steps + 1 });
      }
    }
  }

  solutions.sort((a, b) => a - b);
  return solutions;
}

function deriveMoveLimits(solutions) {
  if (!solutions || solutions.length === 0) {
    return { easy: null, medium: null, hard: null };
  }
  const longest = solutions[solutions.length - 1];
  const pick = (rank, pad) => {
    if (solutions.length > rank) return solutions[rank];
    return longest + pad;
  };
  return {
    easy: pick(19, 6),
    medium: pick(4, 4),
    hard: pick(1, 2),
  };
}

function isLevelSolvable(level) {
  const solutions = collectSolutions(level, 50);
  return {
    solvable: solutions.length > 0,
    minSteps: solutions[0],
    solutions,
    moveLimits: deriveMoveLimits(solutions),
  };
}

export { isLevelSolvable, collectSolutions, deriveMoveLimits };
