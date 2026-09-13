// Backend adresi tek yerden. Varsayılan, kurulumun kendi portu (3001).
// Aynı makinede ikinci bir kopya (ör. geliştirme worktree'si) farklı portta
// çalışacaksa frontend/.env.development.local içinde VITE_API_ORIGIN verilir.
export const API_ORIGIN = import.meta.env.VITE_API_ORIGIN || 'http://localhost:3001';
export const API_BASE = `${API_ORIGIN}/api`;
