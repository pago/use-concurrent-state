import { act, renderHook } from '@testing-library/react-hooks';
import { useConcurrentState } from '../src/react';
import { switchStrategy } from '../src/strategies';

describe('useConcurrentState', () => {
  it('returns the initial state', () => {
    const { result } = renderHook(() =>
      useConcurrentState({
        solution: 42,
      })
    );
    expect(result.current[0]).toEqual({ solution: 42 });
  });

  it('executes a task and updates the state', () => {
    const { result } = renderHook(() =>
      useConcurrentState({
        solution: 42,
      })
    );
    type State = typeof result.current[0];
    let [, call] = result.current;
    act(() => {
      call(incrementByOne);
    });

    expect(result.current[0]).toEqual({ solution: 43 });

    function* incrementByOne() {
      yield (state: State) => {
        state.solution++;
      };
    }
  });

  it('executes an async task and has a task state', () => {
    const { result } = renderHook(() => {
      const [state, call, useTaskState] = useConcurrentState({
        solution: 42,
      });
      return { state, call, task: useTaskState(asyncTask) };
    });
    act(() => {
      result.current.call(asyncTask);
    });
    expect(result.current.task.result).toEqual('solved'); //?

    function* asyncTask() {
      return 'solved';
    }
  });

  it('executes an async task and waits for it to complete', done => {
    const { result } = renderHook(() => {
      const [state, call, useTaskState] = useConcurrentState({
        solution: 42,
      });
      return { state, call, task: useTaskState(asyncTask) };
    });
    const d = defer();
    act(() => {
      result.current.call(asyncTask);
    });
    expect(result.current.task.isRunning).toBeTruthy();
    d.resolve('success');
    result.current.task.listen({
      onResolved(res) {
        expect(res).toEqual('solved');
        expect(result.current.task.isRunning).toBeFalsy();
        done();
      },
    });

    function* asyncTask() {
      yield d.signal;
      return 'solved';
    }
  });

  it('executes an async task and renders it on state change', async () => {
    let rendered = 0;
    const { result, waitForNextUpdate } = renderHook(() => {
      const [state, call, useTaskState] = useConcurrentState({
        solution: 42,
      });
      rendered++;
      return { state, call, task: useTaskState(asyncTask) };
    });
    expect(rendered).toEqual(1);
    const d = defer();
    act(() => {
      result.current.call(asyncTask);
    });
    expect(result.current.task.isRunning).toBeTruthy();
    expect(rendered).toEqual(2);

    act(() => {
      d.resolve('success');
    });

    await waitForNextUpdate();
    expect(rendered).toEqual(3);
    expect(result.current.task.result).toEqual('solved');
    expect(result.current.task.isRunning).toBeFalsy();

    function* asyncTask() {
      yield d.signal;
      return 'solved';
    }
  });

  it('executes an async task and cancels it on unmount', done => {
    const { result, unmount } = renderHook(() => {
      const [state, call, useTaskState] = useConcurrentState({
        solution: 42,
      });
      return { state, call, task: useTaskState(asyncTask) };
    });
    const d = defer();
    act(() => {
      result.current.call(asyncTask);
    });
    const task = result.current.task;
    expect(task.isRunning).toBeTruthy();
    task.listen({
      onFinished() {
        expect(task.isCancelled).toBeTruthy();
        done();
      },
    });
    act(() => unmount());

    function* asyncTask() {
      yield d.signal;
      return 'solved';
    }
  });

  it('executes an async task and uses the switch strategy', done => {
    function* asyncTask() {
      yield d.signal;
      return 'solved';
    }

    asyncTask.strategy = switchStrategy<string>();

    const { result } = renderHook(() => {
      const [state, call, useTaskState] = useConcurrentState({
        solution: 42,
      });
      return { state, call, task: useTaskState(asyncTask) };
    });
    const d = defer();
    act(() => {
      result.current.call(asyncTask);
    });
    const firstTask = result.current.task;
    expect(firstTask.isRunning).toBeTruthy();
    act(() => {
      result.current.call(asyncTask);
    });
    expect(firstTask.isRunning).toBeFalsy();
    expect(firstTask.isCancelled).toBeTruthy();
    const nextTask = result.current.task;
    nextTask.listen({
      onFinished() {
        expect(firstTask.isCancelled).toBeTruthy();
        expect(nextTask.isRunning).toBeFalsy();
        done();
      },
    });
    act(() => {
      d.resolve('success');
    });
  });
});

function defer<T>() {
  let resolve: (value: T | PromiseLike<T>) => void;
  let reject: (reason?: any) => void;
  const signal = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {
    signal,
    // @ts-ignore
    resolve,
    // @ts-ignore
    reject,
  };
}
