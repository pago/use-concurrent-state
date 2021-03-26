import { Operator, TaskGenerator } from './utils';

export function call<TEvent, TState, TResult>(
  task: TaskGenerator<TEvent, TState, TResult>,
  event?: TEvent
): Operator<TState, any> {
  return {
    run({ call, interpret }) {
      interpret(call(task, event));
    },
  };
}

export function getDependencies<TDependencies>(): Operator<any, TDependencies> {
  return {
    run({ next, dependencies }) {
      next(dependencies);
    },
  };
}

export function getState<TState>(): Operator<TState, any> {
  return {
    run({ next, state }) {
      next(state);
    },
  };
}
