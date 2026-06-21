/**
 * Slice an ArrayBufferView into a standalone backing buffer of the same kind
 * (ArrayBuffer in, ArrayBuffer out; SharedArrayBuffer in, SharedArrayBuffer
 * out). The buffer kind is preserved through the generic parameter.
 */
export function sliceBackingBuffer<TArrayBuffer extends ArrayBufferLike>(src: {
  buffer: TArrayBuffer;
  byteOffset: number;
  byteLength: number;
}): TArrayBuffer {
  return src.buffer.slice(
    src.byteOffset,
    src.byteOffset + src.byteLength,
  ) as TArrayBuffer;
}
