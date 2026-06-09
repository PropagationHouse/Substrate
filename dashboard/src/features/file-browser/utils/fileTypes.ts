const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico',
]);

const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a', '.wma', '.opus',
]);

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.webm', '.mov', '.avi', '.mkv',
]);

function getExt(name: string): string {
  return name.includes('.') ? '.' + name.split('.').pop()!.toLowerCase() : '';
}

/** Check if a filename is a supported image type. */
export function isImageFile(name: string): boolean {
  return IMAGE_EXTENSIONS.has(getExt(name));
}

/** Check if a filename is a supported audio type. */
export function isAudioFile(name: string): boolean {
  return AUDIO_EXTENSIONS.has(getExt(name));
}

/** Check if a filename is a supported video type. */
export function isVideoFile(name: string): boolean {
  return VIDEO_EXTENSIONS.has(getExt(name));
}

/** Check if a binary file can be previewed (image, audio, video). */
export function isPreviewableFile(name: string): boolean {
  return isImageFile(name) || isAudioFile(name) || isVideoFile(name);
}

const KNOWN_BINARY_EXTENSIONS = new Set([
  '.db', '.sqlite', '.sqlite3', '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.dat', '.o', '.obj', '.class',
  '.pyc', '.pyd', '.wasm', '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.ppt', '.pptx', '.ttf', '.otf', '.woff', '.woff2', '.eot',
]);

/** Check if a file is a known binary format that cannot be edited as text. */
export function isBinaryFile(name: string): boolean {
  return KNOWN_BINARY_EXTENSIONS.has(getExt(name));
}
