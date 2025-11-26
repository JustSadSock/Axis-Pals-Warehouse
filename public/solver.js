import { applyPlayerMove, createInitialState, isLevelCompleted } from './gameLogic.js';

const MAX_STATES = 200000;
const MAX_DEPTH = 200;
const DIRECTIONS = ['up', 'down', 'left', 'right'];

function canonicalKey(state) {
  const p1 = state.players[1];
  const p2 = state.players[2];
  return `p1:${p1.x},${p1.y};p2:${p2.x},${p2.y}`;
}

function isLevelSolvable(level) {
  const startState = createInitialState(level);
  const visited = new Set();
  const queue = [{ state: startState, steps: 0 }];
  visited.add(canonicalKey(startState));
  let explored = 0;

  while (queue.length > 0) {
    const { state, steps } = queue.shift();
    explored += 1;
    if (explored > MAX_STATES || steps > MAX_DEPTH) {
      return { solvable: false };
    }

    if (isLevelCompleted(state)) {
      return { solvable: true, minSteps: steps };
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

  return { solvable: false };
}

export { isLevelSolvable };
