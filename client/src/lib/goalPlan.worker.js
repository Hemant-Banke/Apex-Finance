import { buildPlan, planLevers, goalLevers } from './goalPlan';

// Solves the goal plan off the main thread: the plan first, then the levers that re-solve it.
self.onmessage = ({ data }) => {
  const { id, kind, input, settings, goalId } = data;
  if (kind === 'plan') {
    self.postMessage({ id, kind, plan: buildPlan(input, settings) });
    self.postMessage({ id, kind: 'levers', levers: planLevers(input, settings) });
  } else if (kind === 'goalLevers') {
    self.postMessage({ id, kind, goalId, levers: goalLevers(input, settings, goalId) });
  }
};
