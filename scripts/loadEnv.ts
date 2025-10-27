import atomix from '@nasriya/atomix';
import fs from 'fs';
import path from 'path';

interface EnvReadOptions {
    overwrite?: boolean;
    mustExist?: boolean;
}

const helpers = {
    parseOptions(options?: EnvReadOptions): Required<EnvReadOptions> {
        return {
            overwrite: typeof options?.overwrite === 'boolean' ? options.overwrite : false,
            mustExist: typeof options?.mustExist === 'boolean' ? options.mustExist : false
        }
    },
    content: {
        parse(content: string) {
            const records: Record<string, string> = {};

            const lines = content.split('\n').map(i => i.trim()).filter(i => i.length > 0 && !i.startsWith('#'));
            for (const line of lines) {
                const idx = line.indexOf('=');
                if (idx === -1) { continue };

                const key = line.slice(0, idx).trim();
                const rawValue = line.slice(idx + 1).trim();
                if (!key || !rawValue) { continue };

                const value = (() => {
                    const delimiters = ['"', '`', '\''];
                    for (const delimiter of delimiters) {
                        if (rawValue.startsWith(delimiter)) { return rawValue.slice(1, -1) };
                    };

                    return rawValue;
                })();

                records[key] = value;
            }

            return records;
        },
        write(records: Record<string, string>, overwrite: boolean) {
            for (const [key, value] of Object.entries(records)) {
                if (process.env[key] !== undefined && overwrite !== true) {
                    continue;
                };

                process.env[key] = value;
            }
        }
    }
}

/**
 * Loads environment variables from the provided path.
 *
 * @param {string} src - The path to the environment file or directory.
 * @param {EnvReadOptions} [options] - Optional configuration object.
 * @param {boolean} [options.overwrite] - Whether to overwrite existing environment variables.
 * @param {boolean} [options.mustExist] - Whether to throw an error if the environment file does not exist.
 *
 * @throws {Error} If the environment file does not exist and mustExist is true.
 * @throws {Error} If the current user does not have read access to the environment file.
 */
export async function loadEnv(src: string, options?: EnvReadOptions) {
    const configs = helpers.parseOptions(options);

    // Check if the procided path exist
    if (!fs.existsSync(src)) {
        if (configs.mustExist) { throw new Error(`The path of the environment file "${src}" does not exist.`) };
        return;
    };

    // Check if the current user has read access to the provided path
    await atomix.fs.promises.canAccess(src, { permissions: 'Read', throwError: true });

    // Get the path stats
    const stats = await fs.promises.stat(src);

    // Get the environment file path
    const envPath = stats.isFile() ? src : path.join(src, '.env');
    if (stats.isDirectory()) {
        // Check if the directory has a .env file
        if (!fs.existsSync(envPath)) {
            if (configs.mustExist) { throw new Error(`The path of the environment file "${envPath}" does not exist.`) };
            return;
        };

        // Check if the current user has read access to the .env file
        await atomix.fs.promises.canAccess(envPath, { permissions: 'Read', throwError: true });
    }

    // Read the environment file content
    const content = await fs.promises.readFile(envPath, 'utf-8');
    const envs = helpers.content.parse(content);
    helpers.content.write(envs, configs.overwrite);
}

/**
 * Synchronously loads environment variables from the provided path.
 *
 * @param {string} src - The path to the environment file or directory.
 * @param {object} [options] - Optional configuration object.
 * @param {boolean} [options.overwrite] - Whether to overwrite existing environment variables.
 * @param {boolean} [options.mustExist] - Whether to throw an error if the environment file does not exist.
 *
 * @throws {Error} If the environment file does not exist and mustExist is true.
 * @throws {Error} If the current user does not have read access to the environment file.
 */
export function loadEnvSync(src: string, options?: { overwrite?: boolean, mustExist?: boolean }) {
    const configs = helpers.parseOptions(options);

    // Check if the procided path exist
    if (!fs.existsSync(src)) {
        if (configs.mustExist) { throw new Error(`The path of the environment file "${src}" does not exist.`) };
        return;
    };

    // Check if the current user has read access to the provided path
    atomix.fs.canAccessSync(src, { permissions: 'Read', throwError: true });

    // Get the path stats
    const stats = fs.statSync(src);

    // Get the environment file path
    const envPath = stats.isFile() ? src : path.join(src, '.env');
    if (stats.isDirectory()) {
        // Check if the directory has a .env file
        if (!fs.existsSync(envPath)) {
            if (configs.mustExist) { throw new Error(`The path of the environment file "${envPath}" does not exist.`) };
            return;
        };

        // Check if the current user has read access to the .env file
        atomix.fs.canAccessSync(envPath, { permissions: 'Read', throwError: true });
    }

    // Read the environment file content
    const content = fs.readFileSync(envPath, 'utf-8');
    const envs = helpers.content.parse(content);
    helpers.content.write(envs, configs.overwrite);
}

export default loadEnv;