// A region the user dragged out is measured in the display's own units. A
// captured image is in physical pixels, which differ whenever Windows display
// scaling is not 100%. This converts one to the other.

const MIN_REGION_SIZE = 12;

// A drag smaller than this is treated as a stray click, not a selection.
function isUsableRegion(region) {
  return Boolean(
    region &&
    Number.isFinite(region.x) && Number.isFinite(region.y) &&
    Number.isFinite(region.width) && Number.isFinite(region.height) &&
    region.width >= MIN_REGION_SIZE && region.height >= MIN_REGION_SIZE
  );
}

// Returns the crop rectangle in image pixels, clamped to the image, or null
// when the region is unusable or falls outside the display.
function toImageRegion(region, displaySize, imageSize) {
  if (!isUsableRegion(region) || !displaySize?.width || !displaySize?.height) {
    return null;
  }

  const scaleX = imageSize.width / displaySize.width;
  const scaleY = imageSize.height / displaySize.height;

  const left = Math.max(0, Math.round(region.x * scaleX));
  const top = Math.max(0, Math.round(region.y * scaleY));
  const right = Math.min(imageSize.width, Math.round((region.x + region.width) * scaleX));
  const bottom = Math.min(imageSize.height, Math.round((region.y + region.height) * scaleY));

  if (right - left < 1 || bottom - top < 1) {
    return null;
  }

  return { x: left, y: top, width: right - left, height: bottom - top };
}

module.exports = {
  MIN_REGION_SIZE,
  isUsableRegion,
  toImageRegion
};
