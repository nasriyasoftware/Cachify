import cron from "@nasriya/cron";
import overwatch from "@nasriya/overwatch";
import cachify, { Cachify, CachifyClient } from "../../src";

export async function cleanup(clients?: CachifyClient | CachifyClient[]) {
    await cron.destroy();
    overwatch.control.pause();
    cachify.events.dispose();

    const clearPromises = [cachify.clear()]

    if (clients) {
        if (clients instanceof CachifyClient) { clients = [clients]; }
        for (const client of clients) {
            if (client instanceof Cachify) { continue; }
            client.events.dispose();
            clearPromises.push(client.clear());
        }
    }

    await Promise.all(clearPromises);
}