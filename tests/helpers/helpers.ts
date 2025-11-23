import cron from "@nasriya/cron";
import overwatch from "@nasriya/overwatch";
import cachify, { Cachify, CachifyClient } from "../../src";

/**
 * Shuts down test background services and clears caches, optionally including additional Cachify clients.
 *
 * Stops scheduled cron jobs, pauses overwatch, disposes global Cachify events, and clears the default cachify cache.
 * If `clients` is provided (a single client or an array), disposes each client's events and clears its cache, skipping any client that is an instance of `Cachify`.
 *
 * @param clients - Optional `CachifyClient` or array of `CachifyClient` to include in the cleanup
 */
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