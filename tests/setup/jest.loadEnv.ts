import path from 'path';
import { loadEnvSync } from '../../scripts/loadEnv';

const envPath = path.join(process.cwd(), 'tests', 'setup', 'test.env');
loadEnvSync(envPath);