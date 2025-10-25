import path from "path";
import fs from 'fs';
import globalConfigs from "./configs";
import type { Brand, Prettify } from "@nasriya/atomix";

const userformatting = {
    reset: `<:reset>`,
    colors: {
        reset: `<:color:reset>`,
        red: `<:color:red>`,
        green: `<:color:green>`,
        yellow: `<:color:yellow>`,
        blue: `<:color:blue>`,
        magenta: `<:color:magenta>`,
        cyan: `<:color:cyan>`,
        white: `<:color:white>`
    },
    style: {
        bold: `<:style:bold>`,
        italic: `<:style:italic>`,
        underline: `<:style:underline>`,
        inverse: `<:style:inverse>`
    }
} as const;

const systemformatting = {
    reset: `\x1b[0m`,
    colors: {
        reset: `\x1b[0m`,
        red: `\x1b[31m`,
        green: `\x1b[32m`,
        yellow: `\x1b[33m`,
        blue: `\x1b[34m`,
        magenta: `\x1b[35m`,
        cyan: `\x1b[36m`,
        white: `\x1b[37m`,
    },
    style: {
        bold: `\x1b[1m`,
        italic: `\x1b[3m`,
        underline: `\x1b[4m`,
        inverse: `\x1b[7m`
    }
} as const;

export type ConsoleSystemFormatting = typeof systemformatting;
export type ConsoleFormatting = typeof userformatting;
type ConsoleTimeID = Brand<string, 'ConsoleTimeID'>;
interface ConsoleTimeMeta {
    id: ConsoleTimeID;
    title: string;
    tag: string;
    start: number;
    end: number;
    logOptions: BaseOptions;
}

interface ConsoleTimeOptions {
    id: string;
    title: string;
    tag?: string;
    logOptions?: BaseOptions;
}

interface BaseOptions {
    logToFile?: boolean;
    logToConsole?: boolean;
}

interface FormatOptions {
    colorCode?: keyof ConsoleFormatting['colors'];
    style?: keyof ConsoleFormatting['style'] | Prettify<keyof ConsoleFormatting['style']>[];
}

export class ConsoleX {
    static readonly #_formatting = systemformatting;
    readonly formatting = userformatting;

    readonly #_data = {
        content: '',
        out: {
            dir: process.cwd(),
            storeJSON: false,
            storeOutput: false
        }
    }

    readonly timers: Map<ConsoleTimeID, ConsoleTimeMeta> = new Map();
    readonly #_helpers = {
        parseFormatting: (str: string): string => {
            return str.replace(/<:reset>/g, ConsoleX.#_formatting.reset)
                .replace(/<:color:(\w+)>/g, (match, c) => {
                    const color = c as keyof ConsoleFormatting['colors'];
                    return ConsoleX.#_formatting.colors[color]
                })
                .replace(/<:style:(\w+)>/g, (match, s) => {
                    const style = s as keyof ConsoleFormatting['style'];
                    return ConsoleX.#_formatting.style[style]
                });
        },
        addContent: (str: string) => {
            str = str.replace(/\x1b\[[0-9;]*m/g, '');
            this.#_data.content += `${str.startsWith('\n') ? '' : '\n'}${str}`;
        },
        formatTable: (data: object[] | Record<string, any>): string => {
            const rows = Array.isArray(data) ? data : Object.entries(data).map(([key, value]) => ({ key, ...value }));
            const headers = Object.keys(rows[0] ?? {});

            const reset = ConsoleX.#_formatting.reset;
            const { colors, style } = ConsoleX.#_formatting;

            const columnWidths = headers.map(header =>
                Math.max(header.length, ...rows.map(row => String(row[header] ?? '').length))
            );

            const formatRow = (row: any, isHeader = false) =>
                headers
                    .map((header, i) => {
                        const raw = String(row[header] ?? '');
                        const padded = raw.padEnd(columnWidths[i]);
                        if (isHeader) return `${style.bold}${i === 0 ? colors.cyan : colors.yellow}${padded}${reset}`;
                        return `${colors.white}${padded}${reset}`;
                    })
                    .join(` ${reset}| `);

            const headerLine = formatRow(Object.fromEntries(headers.map(h => [h, h])), true);
            const separatorLine = columnWidths.map(w => '-'.repeat(w)).join('-|-');
            const rowLines = rows.map(row => formatRow(row));

            return [headerLine, separatorLine, ...rowLines].join('\n');
        }
    }

    constructor(outOptions?: { storeJSON: boolean, storeOutput: boolean, outDir?: string }) {
        if (outOptions) {
            this.#_data.out.storeJSON = outOptions.storeJSON || false;
            this.#_data.out.storeOutput = outOptions.storeOutput || false;
            this.#_data.out.dir = outOptions.outDir || process.cwd();
            if (!fs.existsSync(this.#_data.out.dir)) { fs.mkdirSync(this.#_data.out.dir, { recursive: true }); }
        }
    }

    readonly predefined = {
        title: (title: string, options?: BaseOptions) => {
            const configs: BaseOptions = {
                logToFile: options?.logToFile ?? true,
                logToConsole: options?.logToConsole ?? true
            };

            const lineLength = Math.max(globalConfigs.consts.lineHeight, title.length + 4);
            const totalPadding = lineLength - title.length - 2; // 2 spaces around the msg
            const leftPadding = Math.floor(totalPadding / 2);
            const rightPadding = totalPadding - leftPadding;
            const reset = ConsoleX.#_formatting.reset;

            const lines = [
                `${reset}${ConsoleX.#_formatting.colors.white}${'#'.repeat(lineLength)}`,
                `${ConsoleX.#_formatting.colors.white}${'#'.repeat(leftPadding)} ${ConsoleX.#_formatting.colors.yellow}${title} ${ConsoleX.#_formatting.colors.white}${'#'.repeat(rightPadding)}`,
                `${'#'.repeat(lineLength)}${reset}`,
                ``
            ];

            const content = lines.join('\n');
            if (configs.logToFile) { this.#_helpers.addContent(content) }
            if (configs.logToConsole) { console.log(content) }
        },
        diver: (str: string, options?: Prettify<BaseOptions & FormatOptions>) => {
            const reset = ConsoleX.#_formatting.reset;
            const configs = {
                logToFile: options?.logToFile ?? true,
                logToConsole: options?.logToConsole ?? true,
                colorCode: options?.colorCode || 'white',
                style: undefined
            }

            const systemColor = ConsoleX.#_formatting.colors[configs.colorCode];
            const content = `${reset}${systemColor}${str.repeat(globalConfigs.consts.lineHeight)}${reset}`;
            if (configs.logToFile) { this.#_helpers.addContent(content) }
            if (configs.logToConsole) { console.log(content) }
        },
        systemInfo: (options?: BaseOptions) => {
            const configs: BaseOptions = {
                logToFile: options?.logToFile ?? true,
                logToConsole: options?.logToConsole ?? true
            }

            const reset = ConsoleX.#_formatting.reset;
            const { colors, style } = ConsoleX.#_formatting;

            const dataLines: string[] = [
                `${colors.cyan}${style.bold}Hardware:${colors.reset} [${colors.yellow}${style.underline}CPU:${colors.reset} ${globalConfigs.systemInfo.cpu.model.trim()} (${globalConfigs.systemInfo.cpu.cores} cores)] | [${colors.yellow}${style.underline}RAM:${colors.reset} ${globalConfigs.systemInfo.memory.total}]`,
                `${colors.cyan}${style.bold}Software:${colors.reset} [${colors.yellow}${style.underline}CPU:${colors.reset} ${globalConfigs.systemInfo.platform} (${globalConfigs.systemInfo.arch})] | [${colors.yellow}${style.underline}OS:${colors.reset} ${globalConfigs.systemInfo.release}]`
            ];

            const visibleLengths = dataLines.map(line => line.replace(/\x1b\[[0-9;]*m/g, '').length);
            const LONGEST_LINE_LENGTH = Math.max(...visibleLengths);
            const MARGIN_LENGTH = 10;
            const MAX_LINE_LENGTH = Math.max(globalConfigs.consts.lineHeight, (LONGEST_LINE_LENGTH + MARGIN_LENGTH));


            const totalPadding = MAX_LINE_LENGTH - LONGEST_LINE_LENGTH - 2; // 2 spaces around the msg
            const leftPadding = Math.floor(totalPadding / 2);
            const rightPadding = totalPadding - leftPadding;

            const lines = [
                `${reset}${colors.white}${'#'.repeat(MAX_LINE_LENGTH)}`,
                ...dataLines.map(line => {
                    const strippedLength = leftPadding + line.replace(/\x1b\[[0-9;]*m/g, '').length + rightPadding;
                    const toAdd = Math.max(0, MAX_LINE_LENGTH - strippedLength - 2);
                    const visibleLine = `${colors.white}${'#'.repeat(leftPadding)} ${line}${' '.repeat(toAdd)} ${colors.white}${'#'.repeat(rightPadding)}`;
                    return visibleLine;
                }),
                `${'#'.repeat(MAX_LINE_LENGTH)}${reset}`,
            ];

            const content = lines.join('\n');
            if (configs.logToFile) { this.#_helpers.addContent(content) }
            if (configs.logToConsole) { console.log(content) }
        }
    }

    table(data: object[] | Record<string, any>, options?: BaseOptions & { paddingStart?: number, paddingEnd?: number }) {
        const configs = {
            logToFile: options?.logToFile ?? true,
            logToConsole: options?.logToConsole ?? true,
            paddingStart: options?.paddingStart ?? 0,
            paddingEnd: options?.paddingEnd ?? 0
        }

        const table = this.#_helpers.formatTable(data);
        const content = `${''.repeat(configs.paddingStart)}${table}${''.repeat(configs.paddingEnd)}`;
        if (configs.logToFile) { this.#_helpers.addContent(content) }
        if (configs.logToConsole) { console.log(content) }
    }

    time(timeOptions: ConsoleTimeOptions,) {
        const reset = ConsoleX.#_formatting.reset;
        const configs: BaseOptions = {
            logToFile: timeOptions?.logOptions?.logToFile ?? true,
            logToConsole: timeOptions?.logOptions?.logToConsole ?? true
        }

        const title = this.#_helpers.parseFormatting(timeOptions.title);
        const meta: ConsoleTimeMeta = {
            id: timeOptions.id as ConsoleTimeID,
            title,
            tag: typeof timeOptions.tag === 'string' ? this.#_helpers.parseFormatting(timeOptions.tag) : title,
            start: performance.now(),
            end: 0,
            logOptions: configs
        }

        this.timers.set(meta.id, meta);
        const titleLog = `${ConsoleX.#_formatting.colors.cyan}${meta.title}${reset}`;
        const startLog = `[${meta.tag}] ${ConsoleX.#_formatting.colors.yellow}STARTED${reset}`;

        if (configs.logToFile) { this.#_helpers.addContent(titleLog); this.#_helpers.addContent(startLog) }
        if (configs.logToConsole) { console.log(titleLog); console.log(startLog); }
    }

    timeEnd(id: string) {
        const endTime = performance.now();
        const meta = this.timers.get(id as ConsoleTimeID);
        if (!meta) { return }

        meta.end = endTime;
        const delta = meta.end - meta.start;
        const duration = delta > 1000 ? `${(delta / 1000).toFixed(2)}s` : `${delta.toFixed(2)}ms`;

        const reset = ConsoleX.#_formatting.reset;
        const endLog = `${reset}[${meta.tag}] ${ConsoleX.#_formatting.colors.green}ENDED${ConsoleX.#_formatting.reset} in ${ConsoleX.#_formatting.colors.yellow}${duration}${reset}`;

        if (meta.logOptions.logToFile) { this.#_helpers.addContent(endLog) }
        if (meta.logOptions.logToConsole) { console.log(endLog) }
    }

    newLine(options?: Prettify<BaseOptions & { numberOfLines?: number }>) {
        const configs = {
            logToFile: options?.logToFile ?? true,
            logToConsole: options?.logToConsole ?? true,
            numberOfLines: options?.numberOfLines || 1
        }

        if (configs.logToFile) { this.#_helpers.addContent(`${'\n'.repeat(configs.numberOfLines)}`) }
        if (configs.logToConsole) { console.log(`${'\n'.repeat(configs.numberOfLines)}`) }
    }

    log(msg: string, options?: BaseOptions) {
        const reset = ConsoleX.#_formatting.reset;
        msg = this.#_helpers.parseFormatting(msg);
        if (!msg.startsWith(reset)) { msg = `${reset}${msg}` }
        if (!msg.endsWith(reset)) { msg = `${msg}${reset}` }

        const configs: BaseOptions = {
            logToFile: options?.logToFile ?? true,
            logToConsole: options?.logToConsole ?? true,
        }

        if (configs.logToFile) { this.#_helpers.addContent(msg) }
        if (configs.logToConsole) { console.log(msg) }
    }

    dir(obj: any, options?: BaseOptions) {
        const configs: BaseOptions = {
            logToFile: options?.logToFile ?? true,
            logToConsole: options?.logToConsole ?? true,
        }

        if (configs.logToFile) { this.#_helpers.addContent(JSON.stringify(obj, null, 4)) }
        if (configs.logToConsole) { console.dir(obj, { colors: true, depth: Infinity }) }
    }

    async flush() {
        const filePath = path.join(this.#_data.out.dir, 'benchmark.log');
        const output = this.#_data.content;
        this.#_data.content = ''; // reset output

        await fs.promises.writeFile(filePath, output.trim());
    }
}

const consoleX = new ConsoleX({
    storeJSON: true,
    storeOutput: true,
    outDir: globalConfigs.outDir
});

export default consoleX;