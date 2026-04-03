/**
 * Format elapsed time as MM:SS.T (minutes, seconds, tenths)
 */
export function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60).toString().padStart(2, '0');
  const sec = (totalSec % 60).toString().padStart(2, '0');
  const tenth = Math.floor((ms % 1000) / 100);
  return `${min}:${sec}.${tenth}s`;
}
