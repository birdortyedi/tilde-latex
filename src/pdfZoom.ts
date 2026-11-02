// How big to draw PDF pages: as wide as the pane, a whole page at a time, or
// a fixed size where 100% is the printed size (1 inch = 96 screen pixels).

export type Zoom = 'width' | 'page' | number; // a number is a scale: 1 = 100%

export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const POINTS_TO_PIXELS = 96 / 72; // PDF sizes are in points, 72 per inch

export interface Size {
  width: number;
  height: number;
}

// The PDF.js scale for one page. `page` is its size in points, `area` the
// room for it on screen in CSS pixels.
export function pageScale(zoom: Zoom, page: Size, area: Size): number {
  if (zoom === 'width') return area.width / page.width;
  if (zoom === 'page') return Math.min(area.width / page.width, area.height / page.height);
  return zoom * POINTS_TO_PIXELS;
}

// The zoom as a percentage of the printed size, for showing "125%".
export function zoomPercent(zoom: Zoom, page: Size, area: Size): number {
  return Math.round((pageScale(zoom, page, area) / POINTS_TO_PIXELS) * 100);
}

// One step bigger (+1) or smaller (−1) than the current size, from any mode.
export function stepZoom(zoom: Zoom, direction: 1 | -1, page: Size, area: Size): number {
  const current = pageScale(zoom, page, area) / POINTS_TO_PIXELS;
  // At least 5% bigger or smaller, so every click visibly changes the size.
  const next = direction > 0
    ? ZOOM_STEPS.find((step) => step > current * 1.05)
    : [...ZOOM_STEPS].reverse().find((step) => step < current / 1.05);
  return next ?? (direction > 0 ? ZOOM_STEPS[ZOOM_STEPS.length - 1] : ZOOM_STEPS[0]);
}
