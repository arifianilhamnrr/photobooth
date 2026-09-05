import sharp from "sharp";
import type { FilterId, PhotoTemplate, StoredShot } from "@photobooth/domain";

const OUTPUT_WIDTH = 3600;

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
  const scale = OUTPUT_WIDTH / input.template.width;
  const outputHeight = Math.round(input.template.height * scale);
  const base = sharp({
    create: {
      width: OUTPUT_WIDTH,
      height: outputHeight,
      channels: 4,
      background: "#ece3d6"
    }
  });

  const composites: sharp.OverlayOptions[] = [];

  for (const slot of input.template.slots) {
    const shot = input.shots.find((item) => item.shotIndex === slot.photoIndex && item.filePath);
    if (!shot?.filePath) continue;
    const slotWidth = Math.round(slot.width * scale);
    const slotHeight = Math.round(slot.height * scale);
    const slotRadius = Math.round(slot.cornerRadius * scale);
    let image = sharp(shot.filePath).rotate().resize(slotWidth, slotHeight, { fit: "cover", position: "centre" });

    if (input.filterId === "mono") image = image.grayscale().linear(1.08, 0);
    if (input.filterId === "warm") image = image.modulate({ saturation: 1.15, brightness: 1.02 }).tint("#f2c7a5");
    if (input.filterId === "cool") image = image.modulate({ saturation: 0.92, brightness: 1.01 }).tint("#aec8ff");
    if (input.filterId === "contrast") image = image.linear(1.16, -(128 * 1.16) + 128).modulate({ saturation: 1.1, brightness: 0.98 });

    const roundedMask = Buffer.from(
      `<svg width="${slotWidth}" height="${slotHeight}"><rect x="0" y="0" width="${slotWidth}" height="${slotHeight}" rx="${slotRadius}" ry="${slotRadius}" fill="white" /></svg>`
    );

    const rendered = await image
      .composite([{ input: roundedMask, blend: "dest-in" }])
      .png()
      .toBuffer();

    composites.push({
      input: rendered,
      left: Math.round(slot.x * scale),
      top: Math.round(slot.y * scale)
    });
  }

  const overlayBuffer = await sharp(input.overlayPath)
    .resize(OUTPUT_WIDTH, outputHeight, { fit: "fill" })
    .png()
    .toBuffer();
  composites.push({ input: overlayBuffer, left: 0, top: 0 });

  await base
    .composite(composites)
    .jpeg({ quality: 96, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toFile(input.outputPath);
}

export async function renderGif(input: Omit<RenderStripInput, "template" | "overlayPath">): Promise<void> {
  const frameWidth = 960;
  const frameHeight = 540;
  const selectedShots = [...input.shots].sort((left, right) => left.shotIndex - right.shotIndex).filter((shot) => shot.filePath);
  if (!selectedShots.length) throw new Error("GIF requires at least one photo");

  const frameBuffers: Buffer[] = [];
  for (const shot of selectedShots) {
    let image = sharp(shot.filePath!).rotate().resize(frameWidth, frameHeight, { fit: "cover", position: "centre" });
    if (input.filterId === "mono") image = image.grayscale().linear(1.08, 0);
    if (input.filterId === "warm") image = image.modulate({ saturation: 1.15, brightness: 1.02 }).tint("#f2c7a5");
    if (input.filterId === "cool") image = image.modulate({ saturation: 0.92, brightness: 1.01 }).tint("#aec8ff");
    if (input.filterId === "contrast") image = image.linear(1.16, -(128 * 1.16) + 128).modulate({ saturation: 1.1, brightness: 0.98 });
    const rendered = await image.removeAlpha().raw().toBuffer({ resolveWithObject: true });
    if (rendered.info.channels === 1) {
      const rgb = Buffer.alloc(rendered.data.length * 3);
      for (let index = 0; index < rendered.data.length; index += 1) {
        const value = rendered.data[index];
        const offset = index * 3;
        rgb[offset] = value;
        rgb[offset + 1] = value;
        rgb[offset + 2] = value;
      }
      frameBuffers.push(rgb);
    } else {
      frameBuffers.push(rendered.data);
    }
  }

  await sharp(Buffer.concat(frameBuffers), {
    raw: {
      width: frameWidth,
      height: frameHeight * frameBuffers.length,
      channels: 3,
      pageHeight: frameHeight
    }
  })
    .gif({ loop: 0, delay: frameBuffers.map(() => 800), colours: 256, effort: 7 })
    .toFile(input.outputPath);
}
