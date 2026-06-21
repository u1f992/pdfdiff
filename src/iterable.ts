export async function* withIndex<T>(iter: AsyncIterable<T>, start = 0) {
  let index = start;
  for await (const item of iter) {
    yield [index, item] as [number, T];
    index++;
  }
}
