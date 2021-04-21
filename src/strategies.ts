import { TaskStrategy } from './utils';
import { Task } from './task';

// Wait for current task to finish until new tasks starts
export const chainStrategy = <T>(): TaskStrategy<T> => ({
  compose(oldTask: Task<T>, newTask: Task<T>): Task<T> {
    return oldTask.chain(() => newTask);
  },
});

// Stops running task and switches over to new task
export const switchStrategy = <T>(): TaskStrategy<T> => ({
  compose(oldTask: Task<T>, newTask: Task<T>): Task<T> {
    oldTask.cancel();
    return newTask;
  },
});

// Runs all tasks in parallel
export const defaultStrategy = <T>(): TaskStrategy<T> => ({
  compose(_: Task<T>, newTask: Task<T>): Task<T> {
    return newTask;
  },
});

export const dropStrategy = <T>(): TaskStrategy<T> => ({
  compose(oldTask: Task<T>, newTask: Task<T>): Task<T> {
    if (oldTask.isRunning) {
      newTask.cancel();
      return oldTask;
    }
    return newTask;
  },
});
