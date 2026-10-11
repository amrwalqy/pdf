/* Window size and position helpers. Pure functions so they can be unit-tested without Electron. */

const MIN_WIDTH = 200;
const MIN_HEIGHT = 140;
// A saved window must overlap a display by at least this many pixels in both directions,
// otherwise it could open off-screen after a monitor was unplugged.
const MIN_VISIBLE_PX = 120;

function isVisibleOnSomeDisplay(bounds, workAreas) {
  return workAreas.some((area) => {
    const overlapWidth = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const overlapHeight = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    return overlapWidth >= MIN_VISIBLE_PX && overlapHeight >= MIN_VISIBLE_PX;
  });
}

/** Returns sanitized bounds, or null when the saved data is missing, malformed or unusable. */
function parseWindowState(raw, workAreas) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;

  const { x, y, width, height } = data;
  if (![x, y, width, height].every((value) => Number.isFinite(value))) return null;
  if (width < MIN_WIDTH || height < MIN_HEIGHT) return null;

  const bounds = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
  if (!isVisibleOnSomeDisplay(bounds, workAreas)) return null;

  return { ...bounds, maximized: data.maximized === true };
}

module.exports = { isVisibleOnSomeDisplay, parseWindowState, MIN_WIDTH, MIN_HEIGHT };
