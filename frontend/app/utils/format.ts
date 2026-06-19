/**
 * Formats a number to a compact string representation (k, M, G).
 * @param num - The number to format
 * @returns The formatted string
 */
export function formatCompactNumber(num: number | string | undefined | null): string {
    const val = Number(num);
    if (!val || isNaN(val)) return "0";
    
    if (val >= 1000000000) {
        return (val / 1000000000).toFixed(1).replace('.0', '') + 'G';
    }
    if (val >= 1000000) {
        return (val / 1000000).toFixed(1).replace('.0', '') + 'M';
    }
    if (val >= 1000) {
        return (val / 1000).toFixed(1).replace('.0', '') + 'k';
    }
    return val.toString();
}

/**
 * Formate un timestamp en durée relative courte en français (« Il y a X min / Xh / Xj »). #39
 */
export function formatTimeAgo(dateString: string | number | Date): string {
    const diffInMinutes = Math.floor((Date.now() - new Date(dateString).getTime()) / 60000);
    if (diffInMinutes < 60) return `Il y a ${diffInMinutes} min`;
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `Il y a ${diffInHours}h`;
    return `Il y a ${Math.floor(diffInHours / 24)}j`;
}

/**
 * Formate une durée en secondes vers `H:MM:SS` (ou `M:SS` si moins d'une heure). #39
 */
export function formatDurationHMS(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
}
