import { CacheFlavor } from "../../docs/docs";
import FilesEventsManager from "../managers/files/FilesEventsManager";
import KVsEventsManager from "../managers/kvs/KVsEventsManager";

export type RemoveHandlerMap = {
    [K in `from${Capitalize<CacheFlavor>}`]:
    K extends 'fromKv' ? KVsEventsManager['removeHandler'] :
    K extends 'fromFile' ? FilesEventsManager['removeHandler'] :
    (...args: any[]) => any;
}

export type OnAnyMap = {
    [K in `${CacheFlavor}Event`]:
    K extends 'kvEvent' ? KVsEventsManager['onAny'] :
    K extends 'fileEvent' ? FilesEventsManager['onAny'] :
    (...args: any[]) => any;
}

export type OnMap = {
    [K in CacheFlavor]:
    K extends 'kv' ? KVsEventsManager['on'] :
    K extends 'files' ? FilesEventsManager['on'] :
    (...args: any[]) => any;
}

export type EmitMap = {
    [K in CacheFlavor]:
    K extends 'kv' ? KVsEventsManager['emit'] :
    K extends 'files' ? FilesEventsManager['emit'] :
    Record<string, any>;
};