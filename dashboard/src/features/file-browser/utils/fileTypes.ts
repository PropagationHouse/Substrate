const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico',
]);

/** Check if a filename is a supported image type. */
export function isImageFile(name: string): boolean {
  const ext = name.includes('.') ? '.' + name.split('.').pop()!.toLowerCase() : '';
  return IMAGE_EXTENSIONS.has(ext);
}
