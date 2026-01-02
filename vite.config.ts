/// <reference types="vitest" />
import { defineConfig } from 'vite'

export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov'],
            reportsDirectory: './coverage',
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.d.ts']
        },
        // Use jsdom for renderer tests that need DOM APIs
        environmentMatchGlobs: [
            ['tests/renderer/**/*.test.ts', 'jsdom']
        ]
    }
})
