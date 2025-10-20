import atomix from '@nasriya/atomix';
import fs from 'fs';
import path from 'path';

const envPath = path.join(process.cwd(), 'tests', 'setup', 'test.env');
const content = fs.readFileSync(envPath, 'utf-8');
const lines = content.split('\n').map(i => i.trim()).filter(i => i.length > 0 && !i.startsWith('#'));
lines.forEach(line => {
    const [key, value] = line.split('=');
    if (!key || !value) { return };
    if (atomix.dataTypes.record.hasOwnProperty(process.env, key)) { return };

    process.env[key] = value;
});