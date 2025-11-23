import { Brand, Prettify } from "@nasriya/atomix";
import { CacheData, CacheFlavor, CacheScope } from "../docs/docs";
import BackupStream from "./helpers/BackupStream";
import KVCacheRecord from "../flavors/kvs/kvs.record";
import FileCacheRecord from "../flavors/files/files.record";

export interface PersistanceStorageServices {
    local: {
        configs: { path: string };
        api: {
            public: {
                backup: (fileName: string) => Promise<void>;
                restore: (fileName: string) => Promise<BodyType>;
            };
            private: {
                backup: (flavor: CacheFlavor, stream: BackupStream, ...args: Parameters<PersistanceStorageServices['local']['api']['public']['backup']>) => Promise<void>;
                restore: (flavor: CacheFlavor, ...args: Parameters<PersistanceStorageServices['local']['api']['public']['restore']>) => Promise<void>;
            }
        };
    };

    s3: {
        configs: {
            bucket: string;
            region: string;
            credentials?: {
                accessKeyId: string;
                secretAccessKey: string;
            };
        };
        api: {
            public: {
                backup: (key: string) => Promise<void>;
                restore: (key: string) => Promise<void>;
            };
            private: {
                backup: (flavor: CacheFlavor, stream: BackupStream, ...args: Parameters<PersistanceStorageServices['s3']['api']['public']['backup']>) => Promise<void>;
                restore: (flavor: CacheFlavor, ...args: Parameters<PersistanceStorageServices['s3']['api']['public']['restore']>) => Promise<void>;
            }

        };
    }

    // gcs: {
    //     configs: {
    //         bucket: string;
    //         credentials: {
    //             type: string;
    //             project_id: string;
    //             private_key_id: string;
    //             private_key: string;
    //             client_email: string;
    //             client_id: string;
    //             auth_uri: string;
    //             token_uri: string;
    //             auth_provider_x509_cert_url: string;
    //             client_x509_cert_url: string;
    //         };
    //     };
    //     api: {
    //         backup: (...args: any[]) => Promise<any>;
    //         restore: (...args: any[]) => Promise<any>;
    //     };
    //     driver: DriverAPI;
    //     instance: DriverAPI;
    // };

    // azure: {
    //     configs: { container: string } & AzureAuth;
    //     api: {
    //         backup: (...args: any[]) => Promise<any>;
    //         restore: (...args: any[]) => Promise<any>;
    //     };
    //     driver: DriverAPI;
    //     instance: DriverAPI;
    // };

    // ftp: {
    //     configs: { host: string; port: number; } & FTPAuth;
    //     api: {
    //         backup: (...args: any[]) => Promise<any>;
    //         restore: (...args: any[]) => Promise<any>;
    //     };
    //     driver: DriverAPI;
    //     instance: DriverAPI;
    // }

    // sftp: {
    //     configs: { host: string; port: number; } & SFTPAuth;
    //     api: {
    //         backup: (...args: any[]) => Promise<any>;
    //         restore: (...args: any[]) => Promise<any>;
    //     };
    //     driver: DriverAPI;
    //     instance: DriverAPI;
    // }

    // redis: {
    //     configs: {
    //         host: string;
    //         port: number;
    //         username?: string;
    //         password?: string;
    //     }
    //     api: {
    //         backup: (...args: any[]) => Promise<any>;
    //         restore: (...args: any[]) => Promise<any>;
    //     };
    //     driver: DriverAPI;
    //     instance: DriverAPI;
    // };
}

export type AzureAuth = { connectionString: string } | { accountName: string; accountKey: string };
export type FTPCredAuth = { username: string; password: string };
export type FTPAuth = Prettify<FTPCredAuth | {}>;
export type SFTPAuth = Prettify<{ privateKey: string } | FTPCredAuth>;
export type StorageServices = Prettify<keyof PersistanceStorageServices>;


export interface DriverAPI {
    backup(...args: any[]): Promise<any>;
    restore(...args: any[]): Promise<any>;
}


export type DriverName = Brand<string, 'DriverName'>;

export type KVExportedData = Exclude<Awaited<ReturnType<KVCacheRecord['export']>>, undefined>;
export type FileExportedData = Exclude<Awaited<ReturnType<FileCacheRecord['export']>>, undefined>;
export type DatabaseExportedData = any[];
export type ExportedData = KVExportedData | FileExportedData //| DatabaseExportedData;

export type BodyType = KVPersistenceData | FilePersistenceData //| DatabasePersistenceData;
export type KVPersistenceData = Record<CacheScope, KVExportedData>;
export type FilePersistenceData = Record<CacheScope, FileExportedData>;
// export type DatabasePersistenceData = Record<CacheScope, DatabaseExportedData>;

export type TransformCallbackFunc = (error?: Error | null, data?: Buffer) => void;


// Backup
export type BackupParameters<S extends StorageServices> = Parameters<PersistanceStorageServices[S]['api']['public']['backup']>;
export type BackupReturnType<S extends StorageServices> = ReturnType<PersistanceStorageServices[S]['api']['public']['backup']>;

export type BackupInternalParameters<S extends StorageServices> = Parameters<PersistanceStorageServices[S]['api']['private']['backup']>;
export type BackupInternalReturnType<S extends StorageServices> = ReturnType<PersistanceStorageServices[S]['api']['private']['backup']>;

// Restore
export type RestoreParameters<S extends StorageServices> = Parameters<PersistanceStorageServices[S]['api']['public']['restore']>;
export type RestoreReturnType<S extends StorageServices> = ReturnType<PersistanceStorageServices[S]['api']['public']['restore']>;

export type RestoreInternalParameters<S extends StorageServices> = Parameters<PersistanceStorageServices[S]['api']['private']['restore']>;
export type RestoreInternalReturnType<S extends StorageServices> = ReturnType<PersistanceStorageServices[S]['api']['private']['restore']>;

export type ProxyBackupFunction<
    K extends CacheFlavor,
    S extends StorageServices
> = (data: CacheData<K>, to: S, ...args: BackupParameters<S>) => BackupReturnType<S>;

export type ProxyRestoreFunction<
    K extends CacheFlavor,
    S extends StorageServices
> = (flavor: K, from: S, ...args: RestoreParameters<S>) => RestoreReturnType<S>;

export type ProxyBackupParameters<K extends CacheFlavor, S extends StorageServices> = Parameters<ProxyBackupFunction<K, S>>;
export type ProxyRestoreParameters<K extends CacheFlavor, S extends StorageServices> = Parameters<ProxyRestoreFunction<K, S>>;