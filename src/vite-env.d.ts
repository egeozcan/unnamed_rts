/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_APP_TITLE: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
    readonly hot?: {
        readonly data: Record<string, unknown>;
        accept(): void;
        dispose(callback: (data: Record<string, unknown>) => void): void;
    };
}
