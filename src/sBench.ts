// Inspired by https://github.com/solidjs/solid/blob/main/packages/solid/bench/bench.cjs
import { registerBenchmark } from "./util/benchmark";
import { Computed, Signal, ReactiveFramework } from "./util/reactiveFramework";

const COUNT = 1e5;

type Reader = () => number;
export function sbench(framework: ReactiveFramework) {
  register(createDataSignals, COUNT, COUNT);
  register(createComputations0to1, COUNT, 0);
  register(createComputations1to1, COUNT, COUNT);
  register(createComputations2to1, COUNT / 2, COUNT);
  register(createComputations4to1, COUNT / 4, COUNT);
  register(createComputations1000to1, COUNT / 1000, COUNT);
  register(createComputations1to2, COUNT, COUNT / 2);
  register(createComputations1to4, COUNT, COUNT / 4);
  register(createComputations1to8, COUNT, COUNT / 8);
  register(createComputations1to1000, COUNT, COUNT / 1000);
  register(updateComputations1to1, COUNT * 4, 1);
  register(updateComputations2to1, COUNT * 2, 2);
  register(updateComputations4to1, COUNT, 4);
  register(updateComputations1000to1, COUNT / 100, 1000);
  register(updateComputations1to2, COUNT * 4, 1);
  register(updateComputations1to4, COUNT * 4, 1);
  register(updateComputations1to1000, COUNT * 4, 1);

  function register(
    fn: (n: number, sources: any[]) => void,
    count: number,
    scount: number
  ): void {
    registerBenchmark({
      framework: framework.name,
      name: fn.name,
      setup: () => {
        framework.resetBenchmark?.();
        return framework.withBuild(() => {
          const sources = createDataSignals(scount, []) as Computed<number>[];
          for (let i = 0; i < scount; i++) {
            sources[i].read();
            sources[i].read();
            sources[i].read();
          }
          return sources;
        });
      },
      benchmark: (sources) => fn(count, sources),
      gc: "inner",
    });
  }

  function createDataSignals(n: number, sources: Computed<number>[]) {
    for (let i = 0; i < n; i++) {
      sources[i] = framework.signal(i);
    }
    return sources;
  }

  function createComputations0to1(n: number, _sources: Computed<number>[]) {
    for (let i = 0; i < n; i++) {
      createComputation0(i);
    }
  }

  function createComputations1to1000(n: number, sources: Computed<number>[]) {
    for (let i = 0; i < n / 1000; i++) {
      const { read: get } = sources[i];
      for (let j = 0; j < 1000; j++) {
        createComputation1(get);
      }
    }
  }

  function createComputations1to8(n: number, sources: Computed<number>[]) {
    for (let i = 0; i < n / 8; i++) {
      const { read: get } = sources[i];
      createComputation1(get);
      createComputation1(get);
      createComputation1(get);
      createComputation1(get);
      createComputation1(get);
      createComputation1(get);
      createComputation1(get);
      createComputation1(get);
    }
  }

  function createComputations1to4(n: number, sources: Computed<number>[]) {
    for (let i = 0; i < n / 4; i++) {
      const { read: get } = sources[i];
      createComputation1(get);
      createComputation1(get);
      createComputation1(get);
      createComputation1(get);
    }
  }

  function createComputations1to2(n: number, sources: Computed<number>[]) {
    for (let i = 0; i < n / 2; i++) {
      const { read: get } = sources[i];
      createComputation1(get);
      createComputation1(get);
    }
  }

  function createComputations1to1(n: number, sources: Computed<number>[]) {
    for (let i = 0; i < n; i++) {
      const { read: get } = sources[i];
      createComputation1(get);
    }
  }

  function createComputations2to1(n: number, sources: Computed<number>[]) {
    for (let i = 0; i < n; i++) {
      createComputation2(sources[i * 2].read, sources[i * 2 + 1].read);
    }
  }

  function createComputations4to1(n: number, sources: Computed<number>[]) {
    for (let i = 0; i < n; i++) {
      createComputation4(
        sources[i * 4].read,
        sources[i * 4 + 1].read,
        sources[i * 4 + 2].read,
        sources[i * 4 + 3].read
      );
    }
  }

  // function createComputations8to1(n: number, sources: Computed<number>[]) {
  //   for (let i = 0; i < n; i++) {
  //     createComputation8(
  //       sources[i * 8].read,
  //       sources[i * 8 + 1].read,
  //       sources[i * 8 + 2].read,
  //       sources[i * 8 + 3].read,
  //       sources[i * 8 + 4].read,
  //       sources[i * 8 + 5].read,
  //       sources[i * 8 + 6].read,
  //       sources[i * 8 + 7].read
  //     );
  //   }
  // }

  // only create n / 100 computations, as otherwise takes too long
  function createComputations1000to1(n: number, sources: Computed<number>[]) {
    for (let i = 0; i < n; i++) {
      createComputation1000(sources, i * 1000);
    }
  }

  function createComputation0(i: number) {
    framework.computed(() => i);
  }

  function createComputation1(s1: Reader) {
    framework.computed(() => s1());
  }
  function createComputation2(s1: Reader, s2: Reader) {
    framework.computed(() => s1() + s2());
  }

  function createComputation4(s1: Reader, s2: Reader, s3: Reader, s4: Reader) {
    framework.computed(() => s1() + s2() + s3() + s4());
  }

  // function createComputation8(
  //   s1: Reader,
  //   s2: Reader,
  //   s3: Reader,
  //   s4: Reader,
  //   s5: Reader,
  //   s6: Reader,
  //   s7: Reader,
  //   s8: Reader
  // ) {
  //   framework.computed(
  //     () => s1() + s2() + s3() + s4() + s5() + s6() + s7() + s8()
  //   );
  // }

  function createComputation1000(ss: Computed<number>[], offset: number) {
    framework.computed(() => {
      let sum = 0;
      for (let i = 0; i < 1000; i++) {
        sum += ss[offset + i].read();
      }
      return sum;
    });
  }

  function updateComputations1to1(n: number, sources: Signal<number>[]) {
    let { read: get1, write: set1 } = sources[0];
    framework.computed(() => get1());
    for (let i = 0; i < n; i++) {
      set1(i);
    }
  }

  function updateComputations2to1(n: number, sources: Signal<number>[]) {
    let { read: get1, write: set1 } = sources[0],
      { read: get2 } = sources[1];
    framework.computed(() => get1() + get2());
    for (let i = 0; i < n; i++) {
      set1(i);
    }
  }

  function updateComputations4to1(n: number, sources: Signal<number>[]) {
    let { read: get1, write: set1 } = sources[0],
      { read: get2 } = sources[1],
      { read: get3 } = sources[2],
      { read: get4 } = sources[3];
    framework.computed(() => get1() + get2() + get3() + get4());
    for (let i = 0; i < n; i++) {
      set1(i);
    }
  }

  function updateComputations1000to1(n: number, sources: Signal<number>[]) {
    let { read: _get1, write: set1 } = sources[0];
    framework.computed(() => {
      let sum = 0;
      for (let i = 0; i < 1000; i++) {
        sum += sources[i].read();
      }
      return sum;
    });
    for (let i = 0; i < n; i++) {
      set1(i);
    }
  }

  function updateComputations1to2(n: number, sources: Signal<number>[]) {
    let { read: get1, write: set1 } = sources[0];
    framework.computed(() => get1());
    framework.computed(() => get1());
    for (let i = 0; i < n / 2; i++) {
      set1(i);
    }
  }

  function updateComputations1to4(n: number, sources: Signal<number>[]) {
    let { read: get1, write: set1 } = sources[0];
    framework.computed(() => get1());
    framework.computed(() => get1());
    framework.computed(() => get1());
    framework.computed(() => get1());
    for (let i = 0; i < n / 4; i++) {
      set1(i);
    }
  }

  function updateComputations1to1000(n: number, sources: Signal<number>[]) {
    const { read: get1, write: set1 } = sources[0];
    for (let i = 0; i < 1000; i++) {
      framework.computed(() => get1());
    }
    for (let i = 0; i < n / 1000; i++) {
      set1(i);
    }
  }
}
