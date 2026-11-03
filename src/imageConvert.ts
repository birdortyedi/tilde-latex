// Turns an image the browser can show (GIF, WebP, AVIF, BMP, SVG) into a PNG,
// by drawing it on a canvas. A GIF gives its first frame. An SVG is drawn at
// three times its size, so it stays sharp in print; it becomes a picture,
// not lines, which is why Tilde suggests a PDF for that.

const SVG_SCALE = 3;
const MAX_SIDE = 4000; // pixels; larger images are scaled down to this

export async function convertToPng(file: File): Promise<Uint8Array> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
    let width = (image.naturalWidth || 800) * (isSvg ? SVG_SCALE : 1);
    let height = (image.naturalHeight || 600) * (isSvg ? SVG_SCALE : 1);
    const shrink = Math.min(1, MAX_SIDE / Math.max(width, height));
    width = Math.round(width * shrink);
    height = Math.round(height * shrink);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error(`Tilde could not turn ${file.name || 'this image'} into a PNG.`);
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}
