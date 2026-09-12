const p1 = (await import('./p1.js')).default;
const p2 = (await import('./p2.js')).default;
await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(p1 + p2));
