import sharp from 'sharp';
import {
  MAX_LOGO_UPLOAD_BYTES,
  validateAndProcessCompanyLogo,
} from '../src/lib/image/logo-image.service';
import { HttpError } from '../src/common/http-error';

async function pngBuffer(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 20, g: 80, b: 160, alpha: 1 } },
  })
    .png()
    .toBuffer();
}

async function jpegBuffer(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } },
  })
    .jpeg()
    .toBuffer();
}

const SIMPLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="30" fill="blue"/></svg>';
const MALICIOUS_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><script>alert(1)</script></svg>';

describe('validateAndProcessCompanyLogo', () => {
  it('accepts a valid PNG and produces UI + Print PNG derivatives plus the retained original', async () => {
    const source = await pngBuffer(200, 100);

    const result = await validateAndProcessCompanyLogo(source);

    expect(result.originalBuffer.equals(source)).toBe(true);
    expect(result.originalContentType).toBe('image/png');

    const uiMeta = await sharp(result.uiBuffer).metadata();
    expect(uiMeta.format).toBe('png');
    expect(uiMeta.width).toBeLessThanOrEqual(256);
    expect(uiMeta.height).toBeLessThanOrEqual(256);

    const printMeta = await sharp(result.printBuffer).metadata();
    expect(printMeta.format).toBe('png');
    expect(printMeta.width).toBeLessThanOrEqual(480);
    expect(printMeta.height).toBeLessThanOrEqual(480);
  });

  it('accepts a valid JPEG and still produces PNG derivatives (always rasterized to PNG, regardless of source format)', async () => {
    const source = await jpegBuffer(150, 150);

    const result = await validateAndProcessCompanyLogo(source);

    expect(result.originalContentType).toBe('image/jpeg');
    expect((await sharp(result.uiBuffer).metadata()).format).toBe('png');
    expect((await sharp(result.printBuffer).metadata()).format).toBe('png');
  });

  it('accepts a well-formed SVG and rasterizes both derivatives to PNG — never serves raw SVG back out', async () => {
    const source = Buffer.from(SIMPLE_SVG, 'utf8');

    const result = await validateAndProcessCompanyLogo(source);

    expect(result.originalContentType).toBe('image/svg+xml');
    expect(result.originalBuffer.toString('utf8')).toBe(SIMPLE_SVG);
    expect((await sharp(result.uiBuffer).metadata()).format).toBe('png');
    expect((await sharp(result.printBuffer).metadata()).format).toBe('png');
  });

  it('rejects an SVG containing a <script> tag before ever handing it to the image decoder', async () => {
    const source = Buffer.from(MALICIOUS_SVG, 'utf8');
    await expect(validateAndProcessCompanyLogo(source)).rejects.toThrow(HttpError);
    await expect(validateAndProcessCompanyLogo(source)).rejects.toThrow(/disallowed content/i);
  });

  it('rejects an empty buffer', async () => {
    await expect(validateAndProcessCompanyLogo(Buffer.alloc(0))).rejects.toThrow(HttpError);
  });

  it('rejects a buffer larger than the 2 MB maximum', async () => {
    const oversized = Buffer.alloc(MAX_LOGO_UPLOAD_BYTES + 1, 1);
    await expect(validateAndProcessCompanyLogo(oversized)).rejects.toThrow(/2 MB/);
  });

  it('rejects content that is not a recognizable image (MIME/content mismatch — bytes are the source of truth, not any claimed type)', async () => {
    const notAnImage = Buffer.from('this is just plain text, not image bytes at all');
    await expect(validateAndProcessCompanyLogo(notAnImage)).rejects.toThrow(HttpError);
  });

  it('rejects an image whose dimensions exceed the maximum accepted input size', async () => {
    const oversizedDimensions = await pngBuffer(5000, 100);
    await expect(validateAndProcessCompanyLogo(oversizedDimensions)).rejects.toThrow(/dimensions/i);
  });

  it('strips metadata from derived assets (no EXIF/ICC carried through to the UI/Print PNGs)', async () => {
    const source = await sharp({
      create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
    })
      .withMetadata({ exif: { IFD0: { Copyright: 'Should not survive' } } })
      .png()
      .toBuffer();

    const result = await validateAndProcessCompanyLogo(source);
    const uiMeta = await sharp(result.uiBuffer).metadata();
    expect(uiMeta.exif).toBeUndefined();
  });
});
