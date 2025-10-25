import fs from 'fs';
import path from 'path';
import configs from '../../../setup/configs'
import filesystem from '../../../../src/core/flavors/files/filesystem';
import cachify from '../../../../src/cachify';

const TEST_FILE_PATH = path.join(configs.testDir, 'cachify-benchmark.txt');
const FILE_CONTENT = 'A'.repeat(1024 * 64);

async function setup() {
    await fs.promises.rm(configs.testDir, { recursive: true, force: true });
    await fs.promises.mkdir(configs.testDir, { recursive: true });
    await filesystem.writeFile(TEST_FILE_PATH, FILE_CONTENT);

    cachify.files.configs.maxFileSize = 1024 * 1024 * 10; // 10 MB
    cachify.files.configs.maxTotalSize = 1024 * 1024 * 50; // 50 MB

    for (let i = 0; i < configs.counts.files; i++) {
        const filePath = path.join(configs.testDir, `cachify-benchmark-${i}.txt`);
        await filesystem.writeFile(filePath, FILE_CONTENT);
    }
}

export default setup;