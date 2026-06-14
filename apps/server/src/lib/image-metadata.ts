export type ImageDimensions = {
  width: number;
  height: number;
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function parsePng(buffer: Buffer): ImageDimensions | undefined {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return undefined;
  }
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') {
    return undefined;
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : undefined;
}

function parseGif(buffer: Buffer): ImageDimensions | undefined {
  if (buffer.length < 10) {
    return undefined;
  }
  const signature = buffer.toString('ascii', 0, 6);
  if (signature !== 'GIF87a' && signature !== 'GIF89a') {
    return undefined;
  }
  const width = buffer.readUInt16LE(6);
  const height = buffer.readUInt16LE(8);
  return width > 0 && height > 0 ? { width, height } : undefined;
}

function parseBmp(buffer: Buffer): ImageDimensions | undefined {
  if (buffer.length < 26 || buffer.toString('ascii', 0, 2) !== 'BM') {
    return undefined;
  }
  const dibHeaderSize = buffer.readUInt32LE(14);
  // DIB ヘッダ全体が存在しない（truncated／虚偽の dibHeaderSize）なら不正とみなす。
  if (dibHeaderSize < 12 || buffer.length < 14 + dibHeaderSize) {
    return undefined;
  }
  if (dibHeaderSize === 12) {
    const width = buffer.readUInt16LE(18);
    const height = buffer.readUInt16LE(20);
    return width > 0 && height > 0 ? { width, height } : undefined;
  }
  const width = buffer.readInt32LE(18);
  const height = Math.abs(buffer.readInt32LE(22));
  return width > 0 && height > 0 ? { width, height } : undefined;
}

function parseJpeg(buffer: Buffer): ImageDimensions | undefined {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return undefined;
  }

  let offset = 2;
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      return undefined;
    }
    while (buffer[offset] === 0xff) {
      offset += 1;
    }
    const marker = buffer[offset];
    offset += 1;

    if (marker === undefined || marker === 0xd9 || marker === 0xda) {
      return undefined;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 2 > buffer.length) {
      return undefined;
    }
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      return undefined;
    }
    if (SOF_MARKERS.has(marker)) {
      if (segmentLength < 7) {
        return undefined;
      }
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      return width > 0 && height > 0 ? { width, height } : undefined;
    }
    offset += segmentLength;
  }

  return undefined;
}

export function readImageDimensions(buffer: Buffer): ImageDimensions | undefined {
  return parsePng(buffer) ?? parseJpeg(buffer) ?? parseGif(buffer) ?? parseBmp(buffer);
}

export function exceedsImageLimits(
  dimensions: ImageDimensions,
  limits: { maxImageWidth: number; maxImageHeight: number; maxImagePixels: number },
): boolean {
  if (dimensions.width > limits.maxImageWidth || dimensions.height > limits.maxImageHeight) {
    return true;
  }
  return BigInt(dimensions.width) * BigInt(dimensions.height) > BigInt(limits.maxImagePixels);
}
