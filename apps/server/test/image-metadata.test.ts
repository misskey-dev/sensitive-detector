import { describe, expect, it } from 'vitest';
import { encodeRgbPng } from '../../../packages/core/test/helpers/png.js';
import { exceedsImageLimits, readImageDimensions } from '../src/lib/image-metadata.js';

// readImageDimensions はピクセル展開せずヘッダだけから寸法を読む（デコード爆弾対策の前段ゲート）。
// 攻撃者制御バイトを解釈する箇所なので、各形式の実バイト・truncated・malformed を直接検証する。

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** crc を 0 埋めした最小 PNG ヘッダ（parser は crc を検証しない）。寸法 0 等の異常系を組み立てるために使う。 */
function pngHeader(width: number, height: number): Buffer {
  const sig = Buffer.from(PNG_SIGNATURE);
  const lenAndType = Buffer.alloc(8);
  lenAndType.writeUInt32BE(13, 0); // IHDR チャンク長
  lenAndType.write('IHDR', 4, 'ascii');
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  const crc = Buffer.alloc(4);
  return Buffer.concat([sig, lenAndType, ihdr, crc]); // 8 + 8 + 13 + 4 = 33 bytes
}

/** SOI → (任意で APP0) → SOFn を持つ最小 JPEG。SOFn は 3 コンポーネント（segment length 17）。 */
function jpeg(opts: { width: number; height: number; marker?: number; withApp0?: boolean }): Buffer {
  const { width, height, marker = 0xc0, withApp0 = false } = opts;
  const bytes: number[] = [0xff, 0xd8]; // SOI
  if (withApp0) {
    // APP0(JFIF): FF E0, length 16, "JFIF\0", version, density 単位/値 — SOF まで読み飛ばされることの確認用。
    bytes.push(
      0xff,
      0xe0,
      0x00,
      0x10,
      0x4a,
      0x46,
      0x49,
      0x46,
      0x00,
      0x01,
      0x01,
      0x00,
      0x00,
      0x01,
      0x00,
      0x01,
      0x00,
      0x00,
    );
  }
  // SOFn: FF <marker>, length 0x0011, precision 8, height(2 BE), width(2 BE), nComp 3, 各コンポーネント 3 bytes。
  bytes.push(
    0xff,
    marker,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
  );
  return Buffer.from(bytes);
}

function gif(opts: { width: number; height: number; version?: '87a' | '89a' }): Buffer {
  const { width, height, version = '89a' } = opts;
  const header = Buffer.from(`GIF${version}`, 'ascii'); // 6 bytes
  const lsd = Buffer.alloc(7); // logical screen descriptor
  lsd.writeUInt16LE(width, 0);
  lsd.writeUInt16LE(height, 2);
  return Buffer.concat([header, lsd]); // 13 bytes
}

/** 40-byte DIB（BITMAPINFOHEADER）。height は負値で top-down DIB を表現できる。 */
function bmpInfo(opts: { width: number; height: number }): Buffer {
  const buf = Buffer.alloc(54);
  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(54, 2); // file size
  buf.writeUInt32LE(54, 10); // pixel data offset
  buf.writeUInt32LE(40, 14); // dibHeaderSize
  buf.writeInt32LE(opts.width, 18);
  buf.writeInt32LE(opts.height, 22);
  return buf;
}

/** 12-byte DIB（OS/2 BITMAPCOREHEADER）。width/height は UInt16。 */
function bmpCore(opts: { width: number; height: number }): Buffer {
  const buf = Buffer.alloc(26);
  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(26, 2);
  buf.writeUInt32LE(26, 10);
  buf.writeUInt32LE(12, 14); // dibHeaderSize = 12
  buf.writeUInt16LE(opts.width, 18);
  buf.writeUInt16LE(opts.height, 20);
  return buf;
}

describe('readImageDimensions', () => {
  describe('PNG', () => {
    it('reads dimensions from a real encoded PNG', () => {
      expect(readImageDimensions(encodeRgbPng(40, 24, [119, 119, 119]))).toEqual({ width: 40, height: 24 });
    });

    it('reads dimensions from a hand-built IHDR header', () => {
      expect(readImageDimensions(pngHeader(1280, 720))).toEqual({ width: 1280, height: 720 });
    });

    it('rejects a truncated PNG (shorter than the IHDR block)', () => {
      expect(readImageDimensions(pngHeader(10, 10).subarray(0, 32))).toBeUndefined();
    });

    it('rejects a wrong signature', () => {
      const buf = pngHeader(10, 10);
      buf[1] = 0x00; // corrupt signature byte
      expect(readImageDimensions(buf)).toBeUndefined();
    });

    it('rejects when the IHDR tag is missing', () => {
      const buf = pngHeader(10, 10);
      buf.write('IDAT', 12, 'ascii'); // not IHDR at the expected offset
      expect(readImageDimensions(buf)).toBeUndefined();
    });

    it('rejects zero dimensions', () => {
      expect(readImageDimensions(pngHeader(0, 10))).toBeUndefined();
      expect(readImageDimensions(pngHeader(10, 0))).toBeUndefined();
    });
  });

  describe('JPEG', () => {
    it('reads dimensions from a baseline SOF0 jpeg', () => {
      expect(readImageDimensions(jpeg({ width: 250, height: 200 }))).toEqual({ width: 250, height: 200 });
    });

    it('walks past an APP0 segment to reach the SOF marker', () => {
      expect(readImageDimensions(jpeg({ width: 64, height: 48, withApp0: true }))).toEqual({ width: 64, height: 48 });
    });

    it('reads dimensions from a progressive SOF2 jpeg', () => {
      expect(readImageDimensions(jpeg({ width: 32, height: 16, marker: 0xc2 }))).toEqual({ width: 32, height: 16 });
    });

    it('rejects bytes without an SOI marker', () => {
      expect(readImageDimensions(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toBeUndefined();
    });

    it('rejects when a segment length runs past the buffer end', () => {
      // SOI + SOF0 marker + length 0x0011 but no payload bytes follow.
      expect(readImageDimensions(Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11]))).toBeUndefined();
    });

    it('rejects an SOF segment whose declared length is too small for dimensions', () => {
      // length 0x0005 (< 7) cannot contain precision + height + width.
      const buf = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x05, 0x08, 0x00, 0x10, 0x00, 0x10]);
      expect(readImageDimensions(buf)).toBeUndefined();
    });

    it('rejects zero dimensions', () => {
      expect(readImageDimensions(jpeg({ width: 0, height: 16 }))).toBeUndefined();
    });
  });

  describe('GIF', () => {
    it('reads dimensions from GIF89a', () => {
      expect(readImageDimensions(gif({ width: 300, height: 200 }))).toEqual({ width: 300, height: 200 });
    });

    it('reads dimensions from GIF87a', () => {
      expect(readImageDimensions(gif({ width: 12, height: 34, version: '87a' }))).toEqual({ width: 12, height: 34 });
    });

    it('rejects a too-short buffer', () => {
      expect(readImageDimensions(Buffer.from('GIF89'))).toBeUndefined();
    });

    it('rejects an unknown signature', () => {
      expect(readImageDimensions(gif({ width: 10, height: 10 }).fill(0x00, 0, 6))).toBeUndefined();
    });

    it('rejects zero dimensions', () => {
      expect(readImageDimensions(gif({ width: 0, height: 10 }))).toBeUndefined();
    });
  });

  describe('BMP', () => {
    it('reads dimensions from a BITMAPINFOHEADER (40-byte DIB)', () => {
      expect(readImageDimensions(bmpInfo({ width: 640, height: 480 }))).toEqual({ width: 640, height: 480 });
    });

    it('treats a negative height (top-down DIB) as its absolute value', () => {
      expect(readImageDimensions(bmpInfo({ width: 100, height: -50 }))).toEqual({ width: 100, height: 50 });
    });

    it('reads dimensions from a BITMAPCOREHEADER (12-byte DIB)', () => {
      expect(readImageDimensions(bmpCore({ width: 8, height: 8 }))).toEqual({ width: 8, height: 8 });
    });

    it('rejects a too-short buffer', () => {
      expect(readImageDimensions(Buffer.from('BM'))).toBeUndefined();
    });

    it('rejects an invalid DIB header size', () => {
      const buf = bmpInfo({ width: 10, height: 10 });
      buf.writeUInt32LE(8, 14); // dibHeaderSize < 12
      expect(readImageDimensions(buf)).toBeUndefined();
    });

    it('rejects zero dimensions', () => {
      expect(readImageDimensions(bmpInfo({ width: 0, height: 10 }))).toBeUndefined();
    });
  });

  describe('unknown / non-image input', () => {
    it('returns undefined for an empty buffer', () => {
      expect(readImageDimensions(Buffer.alloc(0))).toBeUndefined();
    });

    it('returns undefined for a WebP container (unsupported by the sniffer)', () => {
      const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
      expect(readImageDimensions(webp)).toBeUndefined();
    });
  });
});

describe('exceedsImageLimits', () => {
  const limits = { maxImageWidth: 299, maxImageHeight: 299, maxImagePixels: 299 * 299 };

  it('allows dimensions within all limits', () => {
    expect(exceedsImageLimits({ width: 200, height: 150 }, limits)).toBe(false);
  });

  it('allows dimensions exactly at the limit', () => {
    expect(exceedsImageLimits({ width: 299, height: 299 }, limits)).toBe(false);
  });

  it('rejects when width exceeds the limit', () => {
    expect(exceedsImageLimits({ width: 300, height: 10 }, limits)).toBe(true);
  });

  it('rejects when height exceeds the limit', () => {
    expect(exceedsImageLimits({ width: 10, height: 300 }, limits)).toBe(true);
  });

  it('rejects when the pixel count exceeds the limit even if each side is within bounds', () => {
    // 各辺は上限内だが総ピクセルが上限を超えるケース（BigInt 乗算でオーバーフローしないことも兼ねる）。
    const wide = { maxImageWidth: 100_000, maxImageHeight: 100_000, maxImagePixels: 10_000 };
    expect(exceedsImageLimits({ width: 200, height: 200 }, wide)).toBe(true);
  });
});
