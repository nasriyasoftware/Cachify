import atomix from '@nasriya/atomix';
import fs from 'fs';
import path from 'path';

/**
 * Loads the environment variables from the specified file.
 * If the file is not a file, it will look for a .env file in the same directory.
 * If the .env file does not exist, it will throw an error.
 * If overwrite is true, it will overwrite existing environment variables.
 * @param src The path to the file
 * @param options The options for loading the environment variables
 * @param options.overwrite Whether to overwrite existing environment variables
 * @returns A promise that resolves when the environment variables have been loaded
 */
export async function loadEnv(src: string, options?: { overwrite?: boolean, mustExist?: boolean }) {
    const overwrite = typeof options?.overwrite === 'boolean' ? options.overwrite : false;
    const mustExist = typeof options?.mustExist === 'boolean' ? options.mustExist : false;

    if (!fs.existsSync(src)) {
        if (mustExist) { throw new Error(`The file "${src}" does not exist.`) };
        return;
    };

    await atomix.fs.promises.canAccess(src, { permissions: 'Read', throwError: true });
    const stats = await fs.promises.stat(src);

    const envPath = (() => {
        if (stats.isFile()) {
            return src;
        } else {
            return path.join(src, '.env');
        }
    })();

    const content = await fs.promises.readFile(envPath, 'utf-8');
    const lines = content.split('\n').map(i => i.trim()).filter(i => i.length > 0 && !i.startsWith('#'));

    lines.forEach(line => {
        const idx = line.indexOf('=');
        if (idx === -1) return;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (!key || !value) { return };

        if (process.env[key] !== undefined && overwrite !== true) {
            return
        };

        process.env[key] = value;
    });
}

export function loadEnvSync(src: string, options?: { overwrite?: boolean, mustExist?: boolean }) {
    const overwrite = typeof options?.overwrite === 'boolean' ? options.overwrite : false;
    const mustExist = typeof options?.mustExist === 'boolean' ? options.mustExist : false;

    if (!fs.existsSync(src)) {
        if (mustExist) { throw new Error(`The file "${src}" does not exist.`) };
        return;
    };
    
    atomix.fs.canAccessSync(src, { permissions: 'Read', throwError: true });
    const stats = fs.statSync(src);

    const envPath = (() => {
        if (stats.isFile()) {
            return src;
        } else {
            return path.join(src, '.env');
        }
    })();

    const content = fs.readFileSync(envPath, 'utf-8');
    const lines = content.split('\n').map(i => i.trim()).filter(i => i.length > 0 && !i.startsWith('#'));

    lines.forEach(line => {
        const idx = line.indexOf('=');
        if (idx === -1) return;
        const key = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim();
        if (!key || !value) { return };

        if (process.env[key] !== undefined && overwrite !== true) {
            return
        };

        process.env[key] = value;
    });
}

export default loadEnv;