// @ts-check

/*
 * Copyright (C) 2025  Koutaro Mukai
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * @template T
 * @param {AsyncIterable<T>} iter
 * @param {number} [start]
 */
export async function* withIndex(iter, start = 0) {
  let index = start;
  for await (const item of iter) {
    yield /** @type {[number, T]} */ ([index, item]);
    index++;
  }
}

/**
 * @template T0, T1
 * @overload
 * @param {AsyncIterable<T0>} iter0
 * @param {AsyncIterable<T1>} iter1
 * @returns {AsyncGenerator<[T0, T1] | [T0, null] | [null, T1]>}
 *
 * @template T0, T1, T2
 * @overload
 * @param {AsyncIterable<T0>} iter0
 * @param {AsyncIterable<T1>} iter1
 * @param {AsyncIterable<T2>} iter2
 * @returns {AsyncGenerator<[T0, T1, T2] | [T0, T1, null] | [T0, null, T2] | [T0, null, null] | [null, T1, T2] | [null, T1, null] | [null, null, T2]>}
 *
 * @template T
 * @param {AsyncIterable<T>[]} iters
 * @returns {AsyncGenerator<(T | null)[]>}
 */
export async function* zipLongest(...iters) {
  const iterators = iters.map((iter) => iter[Symbol.asyncIterator]());
  while (true) {
    const results = await Promise.all(iterators.map((it) => it.next()));
    if (results.every((r) => r.done)) break;
    yield results.map((r) => (r.done ? null : r.value));
  }
}

/**
 * @template T0, T1
 * @overload
 * @param {Iterable<T0>} iter0
 * @param {Iterable<T1>} iter1
 * @returns {Generator<[T0, T1]>}
 *
 * @template T
 * @param  {Iterable<T>[]} iters
 * @returns {Generator<T[]>}
 */
export function* productSync(...iters) {
  if (iters.length === 0) {
    yield [];
    return;
  }

  /** @type {any[][]} */
  const cache = iters.map(() => []);
  const iterators = iters.map((iter) => iter[Symbol.iterator]());
  const indices = Array(iters.length).fill(0);

  for (let i = 0; i < iters.length; i++) {
    const iterator = iterators[i];
    const next = iterator.next();
    if (next.done) {
      return;
    }
    cache[i].push(next.value);
  }

  while (true) {
    yield indices.map((idx, i) => cache[i][idx]);

    for (let i = iters.length - 1; i >= 0; i--) {
      indices[i]++;
      if (indices[i] >= cache[i].length) {
        const iterator = iterators[i];
        const next = iterator.next();
        if (!next.done) {
          cache[i].push(next.value);
        }
      }
      if (indices[i] < cache[i].length) {
        break;
      }
      if (i === 0) {
        return;
      }
      indices[i] = 0;
    }
  }
}
