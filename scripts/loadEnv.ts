import atomix from '@nasriya/atomix';
import fs from 'fs';
import path from 'path';

/**
 * Load environment variables from a file or from a directory's `.env` file into process.env.
 *
 * @param src - Path to a file or directory containing environment variables
 * @param options.overwrite - If true, existing environment variables will be replaced; default is false
 * @param options.mustExist - If true and the resolved source does not exist, an error is thrown; default is false
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

/**
 * Load environment variables from a file or a directory's `.env` into `process.env` synchronously.
 *
 * Reads the given path; if it is a file that file is used, otherwise `<src>/.env` is used.
 * Lines that are empty or start with `#` are ignored. Each `KEY=VALUE` line sets `process.env[KEY]`
 * unless `process.env[KEY]` is already defined and `options.overwrite` is not `true`.
 *
 * @param src - Path to a file or directory containing the environment entries
 * @param options - Optional behavior flags
 * @param options.overwrite - If `true`, existing `process.env` values will be replaced (default `false`)
 * @param options.mustExist - If `true`, throw an error when `src` does not exist (default `false`)
 * @throws Error when `src` does not exist and `options.mustExist` is `true`
 */
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