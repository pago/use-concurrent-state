import isGeneratorFunction from 'is-generator-function';
import { isPromise, TaskGenerator, isOperator } from './utils';

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
  isFinished: boolean;
  error?: TReason;
  result?: TResult;
  run(events?: TaskEventNotifications<TResult, TReason>): void;
  chain(lift: (value?: TResult) => Task<TResult>): Task<any>;
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
    typeof candidate.isFinished === 'boolean' &&
    // todo test if that works
    // typeof candidate.isIdle === 'boolean' &&
    typeof candidate.isCancelled === 'boolean'
  );
}

export function idleTask(): Task<any> {
  return task(() => {});
}

export function task<TResult, TReason = any>(
  runner: TaskRunner<TResult, TReason>
): Task<TResult, TReason> {
  const eventSubscribers: Array<TaskEventNotifications<TResult, TReason>> = [];
  const cancelCallbacks: Array<() => void> = [];
  const t: Task<TResult, TReason> = {
    isRunning: false,
    isFinished: false,
    isCancelled: false,
    result: undefined,
    error: undefined,
    get isIdle() {
      return !t.isRunning;
    },
    chain(lift) {
      const chainedTask = task(({ resolve, onCancelled, reject }) => {
        const cancelableTasks: Task<unknown>[] = [t];
        onCancelled(() => cancelableTasks.forEach((t) => t.cancel()));
        t.run({
          onResolved(result) {
            const nextTask = lift(result);
            cancelableTasks.push(nextTask);
            nextTask.run({
              onResolved: resolve,
              onRejected: reject,
            });
          },
          onCancelled() {
            lift().cancel();
          },
          onRejected(error) {
            reject(error);
          }
        });
      });
      return chainedTask;
    },
    cancel() {
      if (t.isFinished) {
        // todo: decide whether to swallow or throw
        return;
      }
      t.isCancelled = true;
      t.isFinished = true;
      t.isRunning = false;
      cancelCallbacks.forEach(function executeCallback(handler) {
        handler();
      });
      eventSubscribers.forEach(notify);
    },
    listen(events: TaskEventNotifications<TResult, TReason>) {
      if (t.isFinished) {
        // notify straight away
        notify(events);
      } else {
        eventSubscribers.push(events);
      }
    },
    toPromise() {
      return new Promise((resolve, reject) => {
        t.listen({
          onResolved: resolve,
          onRejected: reject,
          onCancelled() {
            // todo should this resolve or reject?
            reject();
          },
        });
      });
    },
    run(events: TaskEventNotifications<TResult, TReason>) {
      if (events) {
        t.listen(events);
      }
      if (t.isFinished || t.isRunning) {
        return;
      }
      t.isRunning = true;
      runner({
        resolve(result: TResult) {
          if (!t.isRunning || t.isFinished) {
            // todo: decide whether to swallow or throw
            return;
          }
          t.isFinished = true;
          t.isRunning = false;
          t.result = result;
          eventSubscribers.forEach(notify);
        },
        reject(reason: TReason) {
          if (!t.isRunning || t.isFinished) {
            // todo: decide whether to swallow or throw
            return;
          }
          t.isRunning = false;
          t.isFinished = true;
          t.error = reason;
          eventSubscribers.forEach(notify);
        },
        onCancelled(handler: () => void) {
          cancelCallbacks.push(handler);
        },
      });
    },
  };
  function notify(event: TaskEventNotifications<TResult, TReason>) {
    if (t.isCancelled) event.onCancelled?.();
    if (t.error) event.onRejected?.(t.error);
    if (t.isFinished && !t.isCancelled && !t.error)
      event.onResolved?.(t.result!);
    event.onFinished?.();
  }
  return t;
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

export function fromSequence<
  TState,
  TDependencies,
  TEvent = any,
  TResult = any
>(
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
      } else if (isTask(result)) {
        // todo figure out why result is of type `never`
        const subtask = result as Task<any>;
        onCancelled(subtask.cancel);
        subtask.run({
          onResolved: consumeNextValue,
          onRejected: resumeAfterFailure,
        });
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
      } else {
        // todo handle error
        throw new Error('use-concurrent-state/invalid-yieldable');
      }
    }
  });
  return t;
}
