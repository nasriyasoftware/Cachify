interface QueryOptions {
    /**
     * Whether the key comparison should be case-sensitive.
     * Defaults to `true`.
     * @default true
     */
    caseSensitive?: boolean;
}

class RecordStore<K extends string, V> extends Map<K, V> {
    constructor(entries?: Iterable<readonly [K, V]>) {
        super(entries);
    }

    /**
     * Retrieves the value associated with the given key.
     * If the key is not found in the map, `undefined` is returned.
     * If `caseSensitive` is `true`, the key comparison is case-sensitive.
     * If `caseSensitive` is `false` or not provided, the key comparison is case-insensitive.
     * @param key The key to search for in the map.
     * @param options Optional configurations for the search.
     * @returns The value associated with the given key, or `undefined` if not found.
     */
    get(key: K, options: QueryOptions = {}): V | undefined {
        const cs = typeof options?.caseSensitive === 'boolean' ? options?.caseSensitive : true;
        if (cs) {
            return super.get(key);
        } else {
            for (const [k, v] of this) {
                if (k.toLowerCase() === key.toLowerCase()) {
                    return v;
                }
            }
            return undefined;
        }
    }


    /**
     * Checks if a key exists within the map.
     * If `caseSensitive` is `true`, the key comparison is case-sensitive.
     * If `caseSensitive` is `false` or not provided, the key comparison is case-insensitive.
     * @param key The key to search for in the map.
     * @param options Optional configurations for the search.
     * @returns `true` if the key exists in the map, `false` otherwise.
     */
    has(key: K, options: QueryOptions = {}): boolean {
        const cs = typeof options?.caseSensitive === 'boolean' ? options?.caseSensitive : true;
        if (cs) {
            return super.has(key);
        } else {
            for (const [k] of this) {
                if (k.toLowerCase() === key.toLowerCase()) {
                    return true;
                }
            }
            return false;
        }
    }
}

export default RecordStore;