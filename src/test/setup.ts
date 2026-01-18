import '@testing-library/jest-dom';

// Mock localStorage with proper Object.keys support
class LocalStorageMock {
    private store: Record<string, string> = {};

    getItem(key: string): string | null {
        return this.store[key] || null;
    }

    setItem(key: string, value: string): void {
        this.store[key] = value;
    }

    removeItem(key: string): void {
        delete this.store[key];
    }

    clear(): void {
        this.store = {};
    }

    get length(): number {
        return Object.keys(this.store).length;
    }

    key(index: number): string | null {
        return Object.keys(this.store)[index] || null;
    }

    // Make it iterable with Object.keys
    [Symbol.iterator]() {
        return Object.keys(this.store)[Symbol.iterator]();
    }
}

// Create instance
const localStorageMock = new LocalStorageMock();

// Also mock Object.keys(localStorage) to work
const originalKeys = Object.keys;
Object.keys = function (obj: object) {
    if (obj === localStorageMock) {
        // Return internal keys for localStorage mock
        const keys: string[] = [];
        for (let i = 0; i < localStorageMock.length; i++) {
            const key = localStorageMock.key(i);
            if (key) keys.push(key);
        }
        return keys;
    }
    return originalKeys(obj);
} as typeof Object.keys;

Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
});
