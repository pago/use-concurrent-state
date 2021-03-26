import { Task } from './task';

export interface OperatorApi<TState, TDependencies> {
  call<TEvent, TResult>(
    sequence: TaskGenerator<TEvent, TState, TResult>,
    event?: TEvent
  ): Task<TResult>;
  interpret<T>(value: TaskYieldable<T, TState>): void;
  next(value: any): void;
  dependencies: TDependencies;
  task: Task<any>;
  state: TState;
  setState(state: TState): void | undefined | TState;
}
export interface Operator<TState, TDependencies> {
  run(api: OperatorApi<TState, TDependencies>): void;
}

export function isOperator(candidate: any): candidate is Operator<any, any> {
  return typeof candidate === 'object' && typeof candidate.run === 'function';
}

export type TaskYieldable<T, TState, TDependencies = any> =
  | Promise<T>
  | Task<T>
  | Generator<unknown, T>
  | Operator<TState, TDependencies>
  | ((state: TState) => void | undefined | TState);
// type UnpackedYieldable<T> = T extends Promise<infer R>
//   ? R
//   : T extends Task<infer R>
//   ? R
//   : T extends Generator<unknown, infer R, unknown>
//   ? R
//   : T extends (state: infer R) => void | undefined | infer R
//   ? R
//   : any;

export type TaskGenerator<TEvent, TState, TResult, R = any> = (
  event?: TEvent
) => Generator<TaskYieldable<R, TState>, TResult, any>;

// export interface TaskGenerator<TEvent, TState, TResult> {
//   <R>(event?: TEvent): Generator<
//     TaskYieldable<R, TState>,
//     TResult,
//     UnpackedYieldable<R>
//   >;
//   strategy?: TaskStrategy<TResult>;
// }

export interface TaskStrategy<TResult> {
  compose(oldTask: Task<TResult>, newTask: Task<TResult>): Task<TResult>;
}

export function hasTaskStrategy(
  candidate: any
): candidate is TaskGenerator<any, any, any> & { strategy: TaskStrategy<any> } {
  return (
    typeof candidate?.strategy === 'object' &&
    typeof candidate.strategy.compose === 'function'
  );
}

export function isPromise(candidate: any): candidate is Promise<any> {
  return candidate && typeof candidate.then === 'function';
}

export function apply<T, V>(value: T) {
  return (fn: (value: T) => V) => fn(value);
}
