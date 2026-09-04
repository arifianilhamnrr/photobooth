import sharp from "sharp";
import { readFile } from "node:fs/promises";
import type { FilterId, PhotoTemplate, StoredShot } from "@photobooth/domain";

interface RenderStripInput {
  template: PhotoTemplate;
  shots: StoredShot[];
  filterId: FilterId;
  overlayPath: string;
  outputPath: string;
}

const filterAdjustments: Record<FilterId, Parameters<typeof sharp>[0] | null> = {
  original: null,
  mono: null,
  warm: null,
  cool: null,
  contrast: null
};

export async function renderStrip(input: RenderStripInput): Promise<void> {
  const base = sharp({
    create: {
      width: input.template.width,
      height: input.template.height,
      channels: 4,
      background: "#ece3d6"
    }
  });

  const composites: sharp.OverlayOptions[] = [];

  for (const slot of input.template.slots) {
    const shot = input.shots.find((item) => item.shotIndex === slot.photoIndex && item.filePath);
    if (!shot?.filePath) continue;
    let image = sharp(shot.filePath).rotate().resize(slot.width, slot.height, { fit: "cover", position: "centre" });

    if (input.filterId === "mono") image = image.grayscale().linear(1.08, 0);
    if (input.filterId === "warm") image = image.modulate({ saturation: 1.15, brightness: 1.02 }).tint("#f2c7a5");
    if (input.filterId === "cool") image = image.modulate({ saturation: 0.92, brightness: 1.01 }).tint("#aec8ff");
    if (input.filterId === "contrast") image = image.linear(1.16, -(128 * 1.16) + 128).modulate({ saturation: 1.1, brightness: 0.98 });

    const roundedMask = Buffer.from(
      `<svg width="${slot.width}" height="${slot.height}"><rect x="0" y="0" width="${slot.width}" height="${slot.height}" rx="${slot.cornerRadius}" ry="${slot.cornerRadius}" fill="white" /></svg>`
    );

    const rendered = await image
      .composite([{ input: roundedMask, blend: "dest-in" }])
      .png()
      .toBuffer();

    composites.push({
      input: rendered,
      left: slot.x,
      top: slot.y
    });
  }

  const overlayBuffer = await readFile(input.overlayPath);
  composites.push({ input: overlayBuffer, left: 0, top: 0 });

  await base.composite(composites).jpeg({ quality: 92 }).toFile(input.outputPath);
}
