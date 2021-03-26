import { task, run } from '../src/task';
import { call, getDependencies, getState } from '../src/operators';

describe('Task', () => {
  it('executes the runner immediately', () => {
    const t = task<number, any>(({ resolve }) => {
      resolve(42);
    });
    expect(t.isRunning).toBeFalsy();
    expect(t.result).toBe(42);
  });

  describe('run', () => {
    let ctx: any;
    beforeEach(() => {
      ctx = {
        state: {},
        setState: jest.fn(fn => {
          const newState = fn(ctx.state);
          if (newState !== undefined) {
            ctx.state = newState;
          }
        }),
        dependencies: {},
        call: jest.fn(),
      };
    });

    it('unpacks a promise', done => {
      const t = run(ctx, function*() {
        const value = yield Promise.resolve(42);
        expect(value).toEqual(42);
      });
      t.listen({
        onFinished: done,
      });
    });

    it('resolves to the returned value', () => {
      const t = run(ctx, function*() {
        return 42;
      });
      expect(t.result).toEqual(42);
    });

    it('calls setState when yielding a function', () => {
      const t = run(ctx, function*() {
        yield (state: any) => {
          state.foo = 'hello';
        };
        return 42;
      });
      expect(t.result).toEqual(42);
      expect(ctx.setState).toHaveBeenCalledTimes(1);
      expect(ctx.state).toEqual({ foo: 'hello' });
    });

    it('forwards the event', () => {
      const t = run(
        ctx,
        function*(x) {
          return x;
        },
        42
      );
      expect(t.result).toEqual(42);
    });

    it('rejects if an error happens immediately', () => {
      const t = run(ctx, function*() {
        throw new Error('test');
      });
      expect(t.isRunning).toBeFalsy();
      expect(t.error.message).toEqual('test');
    });

    it('rejects if an error happens later on', done => {
      const t = run(ctx, function*() {
        yield Promise.resolve(21);
        throw new Error('test');
      });
      t.listen({
        onRejected(reason) {
          expect(reason.message).toEqual('test');
          done();
        },
      });
    });

    it('rejects if a promise is rejected', done => {
      const t = run(ctx, function*() {
        yield Promise.reject(42);
        throw new Error('should never reach this');
      });
      t.listen({
        onRejected(reason) {
          expect(reason).toEqual(42);
          done();
        },
      });
    });

    it('catches a rejected promise', done => {
      const t = run(ctx, function*() {
        try {
          yield Promise.reject(42);
        } catch (n) {
          return n / 2;
        }
        return 1;
      });
      t.listen({
        onResolved(value) {
          expect(value).toEqual(21);
          done();
        },
      });
    });

    it('catches a rejected promise and continues', done => {
      const t = run(ctx, function*() {
        let value: number;
        try {
          value = yield Promise.reject(42);
        } catch (n) {
          value = n / 2;
        }
        value += yield Promise.resolve(1);
        return value;
      });
      t.listen({
        onResolved(value) {
          expect(value).toEqual(22);
          done();
        },
      });
    });

    it('invokes a finally handler on promise rejection', done => {
      let x = 0;
      const t = run(ctx, function*() {
        try {
          yield Promise.reject(42);
        } finally {
          x = 1;
        }
      });
      t.listen({
        onFinished() {
          expect(t.error).toEqual(42);
          expect(x).toEqual(1);
          done();
        },
      });
    });

    it('invokes a finally handler on cancellation', done => {
      let x = 0;
      const t = run(ctx, function*() {
        try {
          // never resolves
          yield new Promise(() => {});
        } finally {
          x = 1;
        }
      });
      t.listen({
        onFinished() {
          expect(x).toEqual(1);
          done();
        },
      });
      t.cancel();
    });

    it('executes the call operator', async () => {
      ctx.call.mockReturnValue(Promise.resolve(42));
      const t = run(ctx, function*() {
        const x = yield call(double, 21);
        return x + 1;
      });
      expect(ctx.call).toHaveBeenCalledWith(double, 21);

      await t.toPromise();
      expect(t.result).toEqual(43);

      function* double(x: any) {
        return x * 2;
      }
    });

    it('executes the getDependencies operator', async () => {
      const t = run(ctx, function*() {
        const x = yield getDependencies();
        return x;
      });
      expect(t.result).toBe(ctx.dependencies);
    });

    it('executes the getDependencies operator', async () => {
      const t = run(ctx, function*() {
        const x = yield getState();
        return x;
      });
      expect(t.result).toBe(ctx.state);
    });

    it('continues with a subtask', () => {
      const t = run(ctx, function*() {
        const x = yield task<number>(({ resolve }) => {
          resolve(42);
        });
        return x;
      });
      expect(t.result).toBe(42);
    });

    it('continues with an async subtask', async () => {
      const t = run(ctx, function*() {
        const x = yield task<number>(({ resolve }) => {
          Promise.resolve(42).then(resolve);
        });
        return x;
      });
      await t.toPromise();
      expect(t.result).toBe(42);
    });

    it('cancels a subtask when parent task is cancelled', () => {
      const cancelHandler = jest.fn();
      const t = run(ctx, function*() {
        yield task<number>(({ onCancelled }) => {
          onCancelled(cancelHandler);
        });
      });
      t.cancel();
      expect(cancelHandler).toHaveBeenCalledTimes(1);
    });
  });
});
