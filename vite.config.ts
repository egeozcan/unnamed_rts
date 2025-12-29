/// <reference types="vitest" />
import { defineConfig } from 'vite'

export default defineConfig({
    test: {
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov'],
            reportsDirectory: './coverage',
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.test.ts', 'src/**/*.d.ts']
        },
        // Use jsdom for renderer tests that need DOM APIs
        environmentMatchGlobs: [
            ['src/renderer/**/*.test.ts', 'jsdom']
        ]
    }
})
