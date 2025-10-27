import { CacheFlavor } from "../../docs/docs";
import FilesEventsManager from "../managers/files/FilesEventsManager";
import KVsEventsManager from "../managers/kvs/KVsEventsManager";

export type RemoveHandlerMap = {
    [K in `from${Capitalize<CacheFlavor>}`]:
    K extends 'fromKvs' ? KVsEventsManager['removeHandler'] :
    K extends 'fromFiles' ? FilesEventsManager['removeHandler'] :
    (...args: any[]) => any;
}

export type OnAnyMap = {
    [K in `${CacheFlavor}Event`]:
    K extends 'kvsEvent' ? KVsEventsManager['onAny'] :
    K extends 'filesEvent' ? FilesEventsManager['onAny'] :
    (...args: any[]) => any;
}

export type OnMap = {
    [K in CacheFlavor]:
    K extends 'kvs' ? KVsEventsManager['on'] :
    K extends 'files' ? FilesEventsManager['on'] :
    (...args: any[]) => any;
}

export type EmitMap = {
    [K in CacheFlavor]:
    K extends 'kvs' ? KVsEventsManager['emit'] :
    K extends 'files' ? FilesEventsManager['emit'] :
    Record<string, any>;
};