import {
  isGeneratorFunction,
  isPromise,
  TaskGenerator,
  isOperator,
} from './utils';

export interface TaskEventNotifications<TResult, TReason> {
  onCancelled?: () => void;
  onResolved?: (result: TResult) => void;
  onRejected?: (error: TReason) => void;
  onFinished?: () => void;
}

export interface Task<TResult, TReason = any> {
  isRunning: boolean;
  isIdle: boolean;
  isCancelled: boolean;
  error?: TReason;
  result?: TResult;

  cancel(): void;
  listen(events: TaskEventNotifications<TResult, TReason>): void;
  toPromise(): Promise<TResult>;
}

export interface TaskResolver<TResult, TReason> {
  resolve(result: TResult): void;
  reject(reason: TReason): void;
  onCancelled(handler: () => void): void;
}

interface TaskRunner<TResult, TReason> {
  (resolver: TaskResolver<TResult, TReason>): void;
}

export function isTask(candidate: any): candidate is Task<any> {
  return (
    typeof candidate === 'object' &&
    typeof candidate.listen === 'function' &&
    typeof candidate.cancel === 'function' &&
    typeof candidate.isRunning === 'boolean' &&
    // todo test if that works
    // typeof candidate.isIdle === 'boolean' &&
    typeof candidate.isCancelled === 'boolean'
  );
}

export const IdleTask: Task<any> = {
  isRunning: false,
  isCancelled: false,
  isIdle: true,
  cancel() {},
  listen() {},
  toPromise() {
    return Promise.resolve();
  },
};

export function task<TResult, TReason = any>(
  runner: TaskRunner<TResult, TReason>
): Task<TResult, TReason> {
  const subscribers = new Set<TaskEventNotifications<TResult, TReason>>();
  const task: Task<TResult, TReason> = {
    isRunning: true,
    isCancelled: false,
    result: undefined,
    error: undefined,
    get isIdle() {
      return !task.isRunning;
    },
    cancel() {
      if (!task.isRunning) {
        // todo: decide whether to swallow or throw
        return;
      }
      task.isCancelled = true;
      task.isRunning = false;
      subscribers.forEach(function notifyCancellation(events) {
        events.onCancelled?.();
        events.onFinished?.();
      });
    },
    listen(events: TaskEventNotifications<TResult, TReason>) {
      subscribers.add(events);
    },
    toPromise() {
      return new Promise((resolve, reject) => {
        task.listen({
          onResolved: resolve,
          onRejected: reject,
          onCancelled() {
            // todo should this resolve or reject?
            reject();
          },
        });
      });
    },
  };
  runner({
    resolve(result: TResult) {
      if (!task.isRunning) {
        // todo: decide whether to swallow or throw
        return;
      }
      task.isRunning = false;
      task.result = result;
      subscribers.forEach(function notifyResolved(events) {
        events.onResolved?.(result);
        events.onFinished?.();
      });
    },
    reject(reason: TReason) {
      if (!task.isRunning) {
        // todo: decide whether to swallow or throw
        return;
      }
      task.isRunning = false;
      task.error = reason;
      subscribers.forEach(function notifyResolved(events) {
        events.onRejected?.(reason);
        events.onFinished?.();
      });
    },
    onCancelled(handler: () => void) {
      task.listen({ onCancelled: handler });
    },
  });
  return task;
}

interface ExecutionContext<TState, TDependencies, TEvent> {
  state: TState;
  setState(state: TState): void | undefined | TState;
  dependencies: TDependencies;
  call<TResult>(
    sequence: TaskGenerator<TEvent, TState, TResult>,
    event?: TEvent
  ): Task<TResult>;
}

export function run<TState, TDependencies, TEvent = any, TResult = any>(
  context: ExecutionContext<TState, TDependencies, TEvent>,
  sequence: TaskGenerator<TEvent, TState, TResult>,
  event?: TEvent
): Task<TResult> {
  let t: Task<TResult>;
  t = task<TResult, unknown>(function runSequence({
    resolve,
    reject,
    onCancelled,
  }) {
    let iterator: ReturnType<typeof sequence>;

    onCancelled(function cancelIterator() {
      const cancelError = new Error('use-concurrent-state/task-cancelled');
      try {
        iterator.throw(cancelError);
      } catch (e) {
        if (e !== cancelError) {
          throw e;
        }
      }
    });

    iterator = sequence(event);
    consumeNextValue();

    function consumeNextValue(data?: any) {
      if (t && t.isCancelled) {
        return;
      }
      // @ts-ignore
      let yielded: ReturnType<typeof iterator['next']>;
      try {
        yielded = iterator.next(data);
      } catch (e) {
        reject(e);
        return;
      }
      if (yielded.done) {
        resolve(yielded.value);
      } else {
        interpretValue(yielded.value);
      }
    }

    function resumeAfterFailure(reason: unknown) {
      if (t && t.isCancelled) {
        return;
      }
      let yielded: ReturnType<typeof iterator['next']>;
      try {
        yielded = iterator.throw(reason);
      } catch (e) {
        reject(e);
        return;
      }
      if (yielded.done) {
        resolve(yielded.value);
      } else {
        interpretValue(yielded.value);
      }
    }

    function interpretValue(result: any) {
      if (isPromise(result)) {
        result.then(consumeNextValue, resumeAfterFailure);
      } else if (isGeneratorFunction(result)) {
        // @ts-ignore
        const subTask = context.call(result);
        // todo notify about task state
        interpretValue(subTask);
      } else if (typeof result === 'function') {
        consumeNextValue(context.setState(result));
      } else if (isOperator(result)) {
        // todo figure out why result is of type never
        // @ts-ignore
        result.run({
          ...context,
          // @ts-ignore
          call: context.call,
          task: t,
          interpret: interpretValue,
          next: consumeNextValue,
        });
      } else if (isTask(result)) {
        // todo figure out why result is of type `never`
        const subtask = result as Task<any>;
        if (!subtask.isRunning) {
          if (subtask.error) {
            resumeAfterFailure(subtask.error);
          } else {
            consumeNextValue(subtask.result);
          }
        } else {
          subtask.listen({
            onResolved: consumeNextValue,
            onRejected: resumeAfterFailure,
            // todo do we need to handle cancellation?
          });
          onCancelled(subtask.cancel);
        }
      } else {
        // todo handle error
        throw new Error('use-concurrent-state/invalid-yieldable');
      }
    }
  });
  return t;
}
