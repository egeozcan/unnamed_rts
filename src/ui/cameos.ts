// Vite bundles the portraits with hashed URLs, including deployments under a base path.
const portraits = import.meta.glob<string>('../assets/cameos/*.png', {
    eager: true,
    query: '?url',
    import: 'default'
});

export function getCameo(key: string): string | null {
    return portraits[`../assets/cameos/${key}.png`] ?? null;
}
