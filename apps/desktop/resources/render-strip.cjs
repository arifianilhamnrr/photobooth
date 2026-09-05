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

const OUTPUT_WIDTH = 1800;

async function renderStrip({ template, shots, filterId, overlayPath, outputPath }) {
  const scale = OUTPUT_WIDTH / template.width;
  const outputHeight = Math.round(template.height * scale);
  const base = sharp({
    create: {
      width: OUTPUT_WIDTH,
      height: outputHeight,
      channels: 4,
      background: '#ece3d6'
    }
  });

  const composites = [];

  for (const slot of template.slots) {
    const shot = shots.find((item) => item.shotIndex === slot.photoIndex && item.filePath);
    if (!shot || !shot.filePath) continue;

    const slotWidth = Math.round(slot.width * scale);
    const slotHeight = Math.round(slot.height * scale);
    const slotRadius = Math.round(slot.cornerRadius * scale);

    let image = sharp(shot.filePath).rotate().resize(slotWidth, slotHeight, {
      fit: 'cover',
      position: 'centre'
    });

    if (filterId === 'mono') image = image.grayscale().linear(1.08, 0);
    if (filterId === 'warm') image = image.modulate({ saturation: 1.15, brightness: 1.02 }).tint('#f2c7a5');
    if (filterId === 'cool') image = image.modulate({ saturation: 0.92, brightness: 1.01 }).tint('#aec8ff');
    if (filterId === 'contrast') image = image.linear(1.16, -(128 * 1.16) + 128).modulate({ saturation: 1.1, brightness: 0.98 });

    const roundedMask = Buffer.from(
      `<svg width="${slotWidth}" height="${slotHeight}"><rect x="0" y="0" width="${slotWidth}" height="${slotHeight}" rx="${slotRadius}" ry="${slotRadius}" fill="white" /></svg>`
    );

    const rendered = await image.composite([{ input: roundedMask, blend: 'dest-in' }]).png().toBuffer();
    composites.push({ input: rendered, left: Math.round(slot.x * scale), top: Math.round(slot.y * scale) });
  }

  const overlayBuffer = await sharp(overlayPath)
    .resize(OUTPUT_WIDTH, outputHeight, { fit: 'fill' })
    .png()
    .toBuffer();
  composites.push({ input: overlayBuffer, left: 0, top: 0 });

  await base
    .composite(composites)
    .jpeg({ quality: 96, chromaSubsampling: '4:4:4', mozjpeg: true })
    .toFile(outputPath);
}

module.exports = { renderStrip };
