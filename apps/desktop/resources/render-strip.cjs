const path = require('node:path');

function loadSharp() {
  try {
    return require('sharp');
  } catch (error) {
    // extraResources places this helper beside the unpacked app directory.
    return require(path.join(__dirname, 'app', 'node_modules', 'sharp'));
  }
}

const sharp = loadSharp();
const { readFile } = require('node:fs/promises');

async function renderStrip({ template, shots, filterId, overlayPath, outputPath }) {
  const base = sharp({
    create: {
      width: template.width,
      height: template.height,
      channels: 4,
      background: '#ece3d6'
    }
  });

  const composites = [];

  for (const slot of template.slots) {
    const shot = shots.find((item) => item.shotIndex === slot.photoIndex && item.filePath);
    if (!shot || !shot.filePath) continue;

    let image = sharp(shot.filePath).rotate().resize(slot.width, slot.height, {
      fit: 'cover',
      position: 'centre'
    });

    if (filterId === 'mono') image = image.grayscale().linear(1.08, 0);
    if (filterId === 'warm') image = image.modulate({ saturation: 1.15, brightness: 1.02 }).tint('#f2c7a5');
    if (filterId === 'cool') image = image.modulate({ saturation: 0.92, brightness: 1.01 }).tint('#aec8ff');
    if (filterId === 'contrast') image = image.linear(1.16, -(128 * 1.16) + 128).modulate({ saturation: 1.1, brightness: 0.98 });

    const roundedMask = Buffer.from(
      `<svg width="${slot.width}" height="${slot.height}"><rect x="0" y="0" width="${slot.width}" height="${slot.height}" rx="${slot.cornerRadius}" ry="${slot.cornerRadius}" fill="white" /></svg>`
    );

    const rendered = await image.composite([{ input: roundedMask, blend: 'dest-in' }]).png().toBuffer();
    composites.push({ input: rendered, left: slot.x, top: slot.y });
  }

  const overlayBuffer = await readFile(overlayPath);
  composites.push({ input: overlayBuffer, left: 0, top: 0 });

  await base.composite(composites).jpeg({ quality: 92 }).toFile(outputPath);
}

module.exports = { renderStrip };
