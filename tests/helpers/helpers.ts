import cron from "@nasriya/cron";
import overwatch from "@nasriya/overwatch";
import cachify from "../../src/cachify";

export async function cleanup() {
    await cron.destroy();
    overwatch.control.pause();
    cachify.events.dispose();
}