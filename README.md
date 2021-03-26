# use-concurrent-state

Asynchronous, observable actions for React Hooks made easy.
Heavily inspired by [Ember Concurrency](http://ember-concurrency.com/)
and the [Folktale Task API](https://folktale.origamitower.com/api/v2.3.0/en/folktale.concurrency.task.html).

Put Side Effects in your React application where they belong (hint: not `useEffect`).

## Documentation
Work in progress. For now: [API Docs](./docs/api/index.md)

## In a nutshell

```js
import { useConcurrentState, getDependencies } from 'use-concurrent-state';

function ItemPicker({ items, fetchItemData }) {
  const [state, call, useTaskState] = useConcurrentState({}, { fetchItemData });
  const itemDataTask = useTaskState(loadItem);
  
  return (
    <SplitView>
      <ItemList items={items} onSelect={selectItem} />
      {itemDataTask.isRunning ? <Loader /> : <Item data={itemDataTask.result} />}
    </SplitView>
  );
  
  function selectItem(item) {
    // Note: there is a better way to do this.
    // This example just shows cancelation is possible ;)
    if (itemDataTask.isRunning) {
      itemDataTask.cancel();
    }
    call(loadItem, item);
  }
}

function* loadItem(item) {
  const { fetchItemData } = yield getDependencies();
  const data = yield fetchItemData(item);
  return data;
}
```

The above example transparently handles:
- Cancelling the task if the component is unmounted
- Observing the task state as it is started, restarted, resolved, cancelled, etc.
- Always making the correct version of a dependency available to the task without
  spreading `useCallback` through your code

## Features
- Tasks can spawn subtasks
- Tasks can collaboratively produce state
- State production is handled through [immer.js](http://immerjs.github.io)
- Tasks can be cancelled
- Resource cleanup with `try-finally` is possible
- Tasks are cancelled automatically on component unmount
- Task strategies allow for a declarative setup of tasks (limit concurrency, run sequentially, cancel on new, etc.)
