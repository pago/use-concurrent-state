import { useImmer } from 'use-immer';
import { useLatestRef, useReference } from '@pago/use-reference';
import { IdleTask, run, Task } from './task';
import { apply, hasTaskStrategy, TaskGenerator } from './utils';
import { useEffect, useRef, useState } from 'react';

export function useConcurrentState<TState, TDependencies extends object = any>(
  initialState: TState,
  dependencies?: TDependencies
) {
  const [state, setState] = useImmer(initialState);
  const deps = useReference(dependencies || {});
  const stateRef = useLatestRef(state);
  const taskMap = useTaskMap();
  const taskList = useTaskList();

  const { call, useTaskState } = useStableApi({
    call<TEvent, TResult>(
      sequence: TaskGenerator<TEvent, TState, TResult>,
      event?: TEvent
    ) {
      const t: Task<TResult> = run(
        {
          // @ts-ignore
          call,
          get state() {
            return stateRef.current;
          },
          dependencies: deps,
          setState(oldState) {
            return setState(oldState);
          },
        },
        sequence,
        event
      );
      taskList.register(t);
      taskMap.start(sequence, t);
      return t;
    },
    useTaskState<TEvent, TResult>(
      sequence: TaskGenerator<TEvent, TState, TResult>
    ) {
      const [task, setTask] = useState(IdleTask);
      taskMap.addListener(sequence, setTask);
      return task;
    },
  });
  return [
    state,
    call as <TEvent, TResult>(
      sequence: TaskGenerator<TEvent, TState, TResult>,
      event?: TEvent
    ) => Task<TResult>,
    useTaskState as <TEvent, TResult>(
      sequence: TaskGenerator<TEvent, TState, TResult>
    ) => Task<TResult>,
  ] as const;
}

function useTaskList() {
  const tasksRef = useRef<Array<Task<any>>>([]);
  useEffect(function cancelRunningTasks() {
    return function cancelAnyRunningTask() {
      tasksRef.current.forEach(function cancelTask(task) {
        task.cancel();
      });
    };
  }, []);

  return useReference({
    register(task: Task<any>) {
      task.listen({
        onFinished() {
          tasksRef.current = tasksRef.current.filter(
            candidate => candidate !== task
          );
        },
      });
      tasksRef.current.push(task);
    },
  });
}

function useTaskMap() {
  type TaskGen = TaskGenerator<any, any, any>;
  type Handler = (task: Task<any>) => void;
  const eventMap = useRef(new Map<TaskGen, Set<Handler>>());
  const taskMap = useRef(new Map<TaskGen, Task<any> | undefined>());

  return useReference({
    start(sequence: TaskGen, t: Task<any>) {
      if (hasTaskStrategy(sequence)) {
        const oldTask = taskMap.current.get(sequence);
        if (oldTask) {
          t = sequence.strategy.compose(oldTask, t);
        }
        taskMap.current.set(sequence, t);
        t.listen({
          onFinished() {
            if (taskMap.current.get(sequence) === t) {
              taskMap.current.set(sequence, undefined);
            }
          },
        });
      }
      const notifiers = eventMap.current.get(sequence);
      if (notifiers) {
        notifiers.forEach(apply(t));
      }
    },
    addListener(sequence: TaskGen, handler: Handler) {
      if (!eventMap.current.has(sequence)) {
        eventMap.current.set(sequence, new Set());
      }
      eventMap.current.get(sequence)!.add(handler);
    },
  });
}

function useStableApi<T extends { [key: string]: (...args: any[]) => any }>(
  api: T
): T {
  const ref = useReference(api);
  return useStableCallbacks(ref);
}

function useStableCallbacks<
  T extends { [key: string]: (...args: any[]) => any }
>(api: T): T {
  const r = useRef<T>();
  if (!r.current) {
    r.current = Object.keys(api).reduce((obj, name) => {
      // @ts-ignore
      obj[name] = (...args: any[]) => api[name](...args);
      return obj;
    }, {} as T);
  }
  return r.current;
}
