import { FrameworkInfo } from "./util/frameworkTypes";
import { kairoBench } from "./kairoBench";
import { fanBench } from "./fanBench";
import { molBench } from "./molBench";
import { sbench } from "./sBench";
import { dynamicBench } from "./dynamicBench";
import { lifecycleBench } from "./lifecycleBench";

export function registerFrameworkBenchmarks(info: FrameworkInfo): void {
  const { framework } = info;
  kairoBench(framework);
  fanBench(framework);
  molBench(framework);
  sbench(framework);
  dynamicBench(info);
  lifecycleBench(framework);
}
