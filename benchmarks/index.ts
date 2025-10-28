import preventSleep from "./setup/preventSleep";
import configs from "./setup/configs";
import benchmark from './benchmark';

const preBenchmark = async () => {
    await preventSleep.start();
    await configs.update();
}

const postBenchmark = async () => {
    await preventSleep.stop();
}

try {
    await preBenchmark();
    await benchmark!.run();
} finally {
    await postBenchmark();
}