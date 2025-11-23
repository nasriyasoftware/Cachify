import { StorageServices } from "../docs";
import atomix from "@nasriya/atomix";

const hasOwnProp = atomix.dataTypes.record.hasOwnProperty;

const validate: Record<StorageServices, (configs: any) => void> = {
    s3: (configs: any) => {
        if (!atomix.valueIs.record(configs)) { throw new TypeError(`The "configs" argument must be a record, but instead got ${typeof configs}`) }

        for (const prop of ['bucket', 'region']) {
            if (hasOwnProp(configs, prop)) {
                assertNonEmptyString(configs[prop], prop);
            } else {
                throw new SyntaxError(`The "${prop}" property of the "configs" object is required and missing.`);
            }
        }

        if (hasOwnProp(configs, 'credentials')) {
            const credentials = configs.credentials;
            if (!atomix.valueIs.record(credentials)) { throw new TypeError(`The "credentials" property of the "configs" object (when provided) must be a record, but instead got ${typeof credentials}`) }
            for (const prop of ['accessKeyId', 'secretAccessKey']) {
                if (hasOwnProp(credentials, prop)) {
                    assertNonEmptyString(credentials[prop], `credentials.${prop}`);
                }
            }
        }
    },

    // gcs: (configs: any) => {
    //     if (!atomix.valueIs.record(configs)) { throw new TypeError(`The "configs" argument must be a record, but instead got ${typeof configs}`) }

    //     if (hasOwnProp(configs, 'bucket')) {
    //         assertNonEmptyString(configs.bucket, 'bucket');
    //     } else {
    //         throw new SyntaxError(`The "bucket" property of the "configs" object is required and missing.`);
    //     }

    //     if (hasOwnProp(configs, 'credentials')) {
    //         const props: (keyof PersistanceStorageServices['gcs']['configs']['credentials'])[] = ['type', 'project_id', 'private_key_id', 'private_key', 'client_email', 'client_id', 'auth_uri', 'token_uri', 'auth_provider_x509_cert_url', 'client_x509_cert_url'];
    //         for (const prop of props) {
    //             if (hasOwnProp(configs.credentials, prop)) {
    //                 assertNonEmptyString(configs.credentials[prop], `credentials.${prop}`);
    //             } else {
    //                 throw new SyntaxError(`The "${prop}" property of the "credentials" object is required and missing.`);
    //             }
    //         }
    //     } else {
    //         throw new SyntaxError(`The "credentials" property of the "configs" object is required and missing.`);
    //     }
    // },

    // azure: (configs: any) => {
    //     if (!atomix.valueIs.record(configs)) { throw new TypeError(`The "configs" argument must be a record, but instead got ${typeof configs}`) }

    //     if (hasOwnProp(configs, 'container')) {
    //         assertNonEmptyString(configs.container, 'container');
    //     } else {
    //         throw new SyntaxError(`The "container" property of the "configs" object is required and missing.`);
    //     }

    //     const hasConnectionString = hasOwnProp(configs, 'connectionString');
    //     const hasAccountName = hasOwnProp(configs, 'accountName');
    //     const hasAccountKey = hasOwnProp(configs, 'accountKey');

    //     if (!(hasConnectionString || (hasAccountName && hasAccountKey))) {
    //         throw new SyntaxError(`The configs object is missing the authentication information. Either "connectionString" or ("accountName" and "accountKey") must be provided.`);
    //     }

    //     if (hasConnectionString) {
    //         assertNonEmptyString(configs.connectionString, 'connectionString');
    //     } else {
    //         assertNonEmptyString(configs.accountName, 'accountName');
    //         assertNonEmptyString(configs.accountKey, 'accountKey');
    //     }
    // },

    // ftp: (configs: any) => {
    //     if (!atomix.valueIs.record(configs)) { throw new TypeError(`The "configs" argument must be a record, but instead got ${typeof configs}`) }

    //     if (hasOwnProp(configs, 'host')) {
    //         assertNonEmptyString(configs.host, 'host');
    //     } else {
    //         throw new SyntaxError(`The "host" property of the "configs" object is required and missing.`);
    //     }

    //     if (hasOwnProp(configs, 'port')) {
    //         assertPort(configs.port, 'port');
    //     } else {
    //         throw new SyntaxError(`The "port" property of the "configs" object is required and missing.`);
    //     }

    //     const hasAuth = hasOwnProp(configs, 'username') || hasOwnProp(configs, 'password');

    //     if (hasAuth) {
    //         assertNonEmptyString(configs.username, 'username');
    //         assertNonEmptyString(configs.password, 'password');
    //     }
    // },

    // sftp: (configs: any) => {
    //     if (!atomix.valueIs.record(configs)) { throw new TypeError(`The "configs" argument must be a record, but instead got ${typeof configs}`) }

    //     if (hasOwnProp(configs, 'host')) {
    //         assertNonEmptyString(configs.host, 'host');
    //     } else {
    //         throw new SyntaxError(`The "host" property of the "configs" object is required and missing.`);
    //     }

    //     if (hasOwnProp(configs, 'port')) {
    //         assertPort(configs.port, 'port');
    //     } else {
    //         throw new SyntaxError(`The "port" property of the "configs" object is required and missing.`);
    //     }

    //     const hasCredAuth = hasOwnProp(configs, 'username') || hasOwnProp(configs, 'password');
    //     const hasKeyAuth = hasOwnProp(configs, 'privateKey');

    //     if (!hasCredAuth && !hasKeyAuth) {
    //         throw new SyntaxError(`SFTP requires authentication. Provide either "username" and "password", or "username" and "privateKey".`);
    //     }

    //     if (hasKeyAuth) {
    //         assertNonEmptyString(configs.privateKey, 'privateKey');
    //     } else if (hasCredAuth) {
    //         assertNonEmptyString(configs.username, 'username');
    //         assertNonEmptyString(configs.password, 'password');
    //     }
    // },

    // redis: (configs: any) => {
    //     if (!atomix.valueIs.record(configs)) { throw new TypeError(`The "configs" argument must be a record, but instead got ${typeof configs}`) }

    //     if (hasOwnProp(configs, 'host')) {
    //         assertNonEmptyString(configs.host, 'host');
    //     } else {
    //         throw new SyntaxError(`The "host" property of the "configs" object is required and missing.`);
    //     }

    //     if (hasOwnProp(configs, 'port')) {
    //         assertPort(configs.port, 'port');
    //     } else {
    //         throw new SyntaxError(`The "port" property of the "configs" object is required and missing.`);
    //     }

    //     const props: (keyof PersistanceStorageServices['redis']['configs'])[] = ['username', 'password'];
    //     for (const prop of props) {
    //         if (hasOwnProp(configs, prop)) {
    //             assertNonEmptyString(configs[prop], prop);
    //         }
    //     }
    // },

    local: (configs: any) => {
        if (!atomix.valueIs.record(configs)) { throw new TypeError(`The "configs" argument must be a record, but instead got ${typeof configs}`) }

        if (hasOwnProp(configs, 'path')) {
            assertNonEmptyString(configs.path, 'path');
            const canWrite = atomix.fs.canAccessSync(configs.path, { permissions: 'Write' });
            if (!canWrite) { throw new Error(`The path "${configs.path}" does not allow write access.`) }
            const canRead = atomix.fs.canAccessSync(configs.path, { permissions: 'Read' });
            if (!canRead) { throw new Error(`The path "${configs.path}" does not allow read access.`) }
        } else {
            throw new SyntaxError(`The "path" property of the "configs" object is required and missing.`);
        }
    }
}

function assertPort(port: unknown, path: string) {
    if (!atomix.valueIs.number(port)) { throw new TypeError(`"${path}" must be a number`) }
    if (!atomix.valueIs.integer(port)) { throw new TypeError(`"${path}" must be an integer`) }
    if (port <= 0 || port > 65535) { throw new RangeError(`"${path}" must be a port number between 1 and 65535`) }
}

function assertNonEmptyString(value: unknown, path: string) {
    if (!atomix.valueIs.string(value)) throw new TypeError(`"${path}" must be a string`);
    if (value.length === 0) throw new RangeError(`"${path}" must be a non-empty string`);
}

export default validate;