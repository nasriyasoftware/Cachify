import atomix from '@nasriya/atomix';
import { spawn } from 'child_process';

const platform = atomix.runtime.platform;

function runCommand(command: string) {
    return new Promise<void>((resolve, reject) => {
        const child = spawn(command, {
            shell: true, // allows passing the whole command string
            stdio: 'ignore'
        });

        child.on('error', reject);
        child.on('exit', () => resolve());
    });
}

const preventSleep = {
    start: async () => {
        if (platform.isWindows()) {
            // Add override
            await runCommand('powercfg /requestsoverride PROCESS bun EXECUTION');
        } else {
            console.warn(`[WARN] Prevent sleep is not supported on this platform`);
        }
    },

    stop: async () => {
        if (platform.isWindows()) {
            // Remove override
            await runCommand('powercfg /requestsoverride PROCESS bun');
        }
    }
};

export default preventSleep;