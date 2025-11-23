import atomix from "@nasriya/atomix";
import EventsBroker from "./broker/EventsBroker";
import FilesEventsManager from "./managers/files/FilesEventsManager";
import KVsEventsManager from "./managers/kvs/KVsEventsManager";
import type { EventsManagers } from "./docs";

class Events {
    readonly #_managers: EventsManagers = {
        kvs: new KVsEventsManager(),
        files: new FilesEventsManager()
    }

    readonly #_broker = new EventsBroker(this.#_managers)

    get for() {
        return { ...this.#_managers };
    }

    get broker() { return this.#_broker }
}

export default Events;