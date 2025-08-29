import benchmark from "./TS/main";
import preventSleep from "./helpers/preventSleep";

try {
    await preventSleep.start();
    await benchmark();
} finally {
    await preventSleep.stop();
}