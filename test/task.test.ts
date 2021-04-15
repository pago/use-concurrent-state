import { task, fromSequence } from '../src/task';
import { call, getDependencies, getState } from '../src/operators';

describe('Task', () => {
  it('tasks are lazy', () => {
    const t = task<number, any>(({ resolve }) => {
      resolve(42);
    });
    expect(t.isRunning).toBeFalsy();
    expect(t.result).toBe(undefined);
    t.run();
    expect(t.result).toBe(42);
  });

  describe('chain', () => {
    it('should chain tasks per dot operator', () => {
      const t = task<number, any>(({ resolve }) => {
        resolve(42);
      }).chain((x) =>
        task<number, any>(({ resolve }) => {
          resolve(x! + 10);
        }).chain((y) =>
          task<number, any>(({ resolve }) => {
            resolve(y! + 20);
          })
        )
      );
      t.run();
      expect(t.result).toEqual(72);
    });

    it('should chain by reference', () => {
      const t = task<number, any>(({resolve}) => {
        resolve(42)
      });

      const t2 = t.chain((x) => {
        return task<number, any>(({ resolve }) => {
          resolve(x! + 10);
        });
      });

      const t3 = t2.chain((x) => {
        return task<number, any>(({ resolve }) => {
          resolve(x + 10);
        });
      });
      t3.run();
      expect(t.result).toEqual(42);
      expect(t2.result).toEqual(52);
      expect(t3.result).toEqual(62);
    })

    it('should only execute each task once', () => {
      const tResolver = jest.fn();
      const t2Resolver = jest.fn();
      const t3Resolver = jest.fn();
      const t = task<number, any>(({resolve}) => {
        resolve(42)
      });

      const t2 = t.chain((x) => {
        return task<number, any>(({ resolve }) => {
          resolve(x! + 10);
        });
      });

      const t3 = t2.chain((x) => {
        return task<number, any>(({ resolve }) => {
          resolve(x + 10);
        });
      });

      t.run({
        onFinished: tResolver
      });
      t2.run({
        onFinished: t2Resolver
      });
      t3.run({
        onFinished: t3Resolver
      });
      expect(tResolver).toHaveBeenCalledTimes(1);
      expect(t2Resolver).toHaveBeenCalledTimes(1);
      expect(t3Resolver).toHaveBeenCalledTimes(1);
    })
  })


  describe('run', () => {
    let ctx: any;
    beforeEach(() => {
      ctx = {
        state: {},
        setState: jest.fn((fn) => {
          const newState = fn(ctx.state);
          if (newState !== undefined) {
            ctx.state = newState;
          }
        }),
        dependencies: {},
        call: jest.fn(),
      };
    });

    it('unpacks a promise', (done) => {
      const t = fromSequence(ctx, function* () {
        const value = yield Promise.resolve(42);
        expect(value).toEqual(42);
      });
      t.listen({
        onFinished: done,
      });
      t.run();
    });

    it('resolves to the returned value', () => {
      const t = fromSequence(ctx, function* () {
        return 42;
      });
      t.run();
      expect(t.result).toEqual(42);
    });

    it('calls setState when yielding a function', () => {
      const t = fromSequence(ctx, function* () {
        yield (state: any) => {
          state.foo = 'hello';
        };
        return 42;
      });
      t.run();
      expect(t.result).toEqual(42);
      expect(ctx.setState).toHaveBeenCalledTimes(1);
      expect(ctx.state).toEqual({ foo: 'hello' });
    });

    it('forwards the event', () => {
      const t = fromSequence(
        ctx,
        function* (x) {
          return x;
        },
        42
      );
      t.run();
      expect(t.result).toEqual(42);
    });

    it('rejects if an error happens immediately', () => {
      const t = fromSequence(ctx, function* () {
        throw new Error('test');
      });
      t.run();
      expect(t.isRunning).toBeFalsy();
      expect(t.error.message).toEqual('test');
    });

    it('rejects if an error happens later on', (done) => {
      const t = fromSequence(ctx, function* () {
        yield Promise.resolve(21);
        throw new Error('test');
      });
      t.listen({
        onRejected(reason) {
          expect(reason.message).toEqual('test');
          done();
        },
      });
      t.run();
    });

    it('rejects if a promise is rejected', (done) => {
      const t = fromSequence(ctx, function* () {
        yield Promise.reject(42);
        throw new Error('should never reach this');
      });
      t.listen({
        onRejected(reason) {
          expect(reason).toEqual(42);
          done();
        },
      });
      t.run();
    });

    it('catches a rejected promise', (done) => {
      const t = fromSequence(ctx, function* () {
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
      t.run();
    });

    it('catches a rejected promise and continues', (done) => {
      const t = fromSequence(ctx, function* () {
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
      t.run();
    });

    it('invokes a finally handler on promise rejection', (done) => {
      let x = 0;
      const t = fromSequence(ctx, function* () {
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
      t.run();
    });

    it('invokes a finally handler on cancellation', (done) => {
      let x = 0;
      const t = fromSequence(ctx, function* () {
        try {
          // never resolves
          yield new Promise(() => {});
        } finally {
          x = 1;
        }
      });

      t.run({
        onFinished() {
          expect(x).toEqual(1);
          done();
        },
      });
      t.cancel();
    });

    it('executes the call operator', async () => {
      ctx.call.mockReturnValue(Promise.resolve(42));
      const t = fromSequence(ctx, function* () {
        const x = yield call(double, 21);
        return x + 1;
      });
      t.run();
      expect(ctx.call).toHaveBeenCalledWith(double, 21);
      await t.toPromise();
      expect(t.result).toEqual(43);

      function* double(x: any) {
        return x * 2;
      }
    });

    it('executes the getDependencies operator', async () => {
      const t = fromSequence(ctx, function* () {
        const x = yield getDependencies();
        return x;
      });
      t.run();
      expect(t.result).toBe(ctx.dependencies);
    });

    it('executes the getDependencies operator', async () => {
      const t = fromSequence(ctx, function* () {
        const x = yield getState();
        return x;
      });
      t.run();
      expect(t.result).toBe(ctx.state);
    });

    it('continues with a subtask', () => {
      const t = fromSequence(ctx, function* () {
        const x = yield task<number>(({ resolve }) => {
          resolve(42);
        });
        return x;
      });
      t.run();
      expect(t.result).toBe(42);
    });

    it('continues with an async subtask', async () => {
      const t = fromSequence(ctx, function* () {
        const x = yield task<number>(({ resolve }) => {
          Promise.resolve(42).then(resolve);
        });
        return x;
      });
      t.run();
      await t.toPromise();
      expect(t.result).toBe(42);
    });

    it('cancels a subtask when parent task is cancelled', () => {
      const cancelHandler = jest.fn();
      const t = fromSequence(ctx, function* () {
        yield task<number>(({ onCancelled }) => {
          onCancelled(cancelHandler);
        });
      });
      t.run();
      t.cancel();
      expect(cancelHandler).toHaveBeenCalledTimes(1);
    });
  });
});
