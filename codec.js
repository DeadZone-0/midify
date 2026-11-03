
export function stripFolderSlashes(name) {
  const s = String(name ?? 'payload.bin').replace(/[/\\]+$/, '');
  return s.replace(/^.*[/\\]/, '') || 'payload.bin';
}

export async function computeSha256(data) {
  const digestBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digestBuffer), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
}

export async function packFile(name, uint8Array) {
  const data = uint8Array instanceof Uint8Array ? uint8Array : new Uint8Array(uint8Array);
  const hash = await computeSha256(data);

  const cleanName = stripFolderSlashes(name);
  const filenameBytes = new TextEncoder().encode(cleanName);
  if (filenameBytes.length > 255) {
    throw new RangeError(`Filename exceeds 255 bytes: ${filenameBytes.length}`);
  }

  const packed = new Uint8Array(10 + filenameBytes.length + data.length);
  const view = new DataView(packed.buffer, packed.byteOffset, 10);

  view.setUint32(0, 0x57535452, false);
  view.setUint8(4, 0);
  view.setUint8(5, filenameBytes.length);
  view.setUint32(6, data.length, false);

  packed.set(filenameBytes, 10);
  packed.set(data, 10 + filenameBytes.length);

  packed.hash = hash;
  return packed;
}

export async function unpackBlob(uint8Array) {
  const bytes = uint8Array instanceof Uint8Array ? uint8Array : new Uint8Array(uint8Array);

  if (bytes.length < 10) {
    throw new Error(`Buffer too small for header: ${bytes.length} bytes`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, false) !== 0x57535452) {
    throw new Error('Invalid magic header: expected "WSTR"');
  }

  const filenameLen = view.getUint8(5);
  const payloadLen = view.getUint32(6, false);
  const payloadStart = 10 + filenameLen;
  const payloadEnd = payloadStart + payloadLen;

  if (bytes.length < payloadEnd) {
    throw new Error(
      `Truncated payload: expected ${payloadEnd} bytes, received ${bytes.length}`
    );
  }

  const filenameBytes = bytes.subarray(10, payloadStart);
  const rawFilename = new TextDecoder().decode(filenameBytes);
  const filename = stripFolderSlashes(rawFilename);

  const data = bytes.slice(payloadStart, payloadEnd);
  const hash = await computeSha256(data);

  return { filename, data, hash };
}

export async function testCodec() {
  const originalData = new Uint8Array(1024);
  crypto.getRandomValues(originalData);

  const filename = 'sample/path/test-payload.bin';
  const packed = await packFile(filename, originalData);

  // Trailing padding simulation
  const padded = new Uint8Array(packed.length + 256);
  padded.set(packed, 0);

  const unpacked = await unpackBlob(padded);

  console.log(`Original hash:  ${packed.hash}`);
  console.log(`Recovered hash: ${unpacked.hash}`);
  console.log(`Hashes match:   ${packed.hash === unpacked.hash}`);

  if (packed.hash !== unpacked.hash) {
    throw new Error('Hash mismatch between packed and unpacked data');
  }

  return { packed, unpacked };
}

if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('codec.js')) {
  testCodec().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
