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

#ifndef CORE_H
#define CORE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

enum {
  CORE_OK = 0,
  CORE_ERROR_ALLOC = -1,
  CORE_ERROR_INVALID = -2,
};

typedef struct {
  uint8_t r;
  uint8_t g;
  uint8_t b;
  uint8_t a;
} CoreColor;

typedef struct {
  CoreColor addition;
  CoreColor deletion;
  CoreColor modification;
} CorePallet;

/*
 * Output buffers are owned by the caller; release with core_result_free.
 * On error, the struct is left zero-initialized and nothing needs freeing.
 *
 * `overlay`     : width * height * 4 bytes RGBA. Final overlay computed as
 *                 alpha-over of (a * 0.2), (b * 0.2), and (diff layer * 1.0).
 * `*_xy`        : packed [x0, y0, x1, y1, ...] int32 coordinates.
 * `*_count`     : number of pixels (each pixel uses 2 int32 entries).
 */
typedef struct {
  uint8_t *overlay;
  int32_t *addition_xy;
  int32_t addition_count;
  int32_t *deletion_xy;
  int32_t deletion_count;
  int32_t *modification_xy;
  int32_t modification_count;
} CoreResult;

/*
 * Diff scan + diff-layer paint + final overlay compose, in a single pass.
 *
 * a_pixels, b_pixels: width * height * 4 bytes RGBA, identical dimensions.
 * mask_pixels       : NULL, or width * height * 4 bytes RGBA. Pixels where
 *                     mask alpha != 0 are excluded from the diff scan.
 * pallet            : colors used to paint the diff layer per category.
 * out               : populated with overlay + per-category coordinates.
 *
 * Returns CORE_OK on success, negative on error.
 */
int32_t process_page(const uint8_t *a_pixels, const uint8_t *b_pixels,
                     const uint8_t *mask_pixels, int32_t width, int32_t height,
                     const CorePallet *pallet, CoreResult *out);

void core_result_free(CoreResult *r);

#ifdef __cplusplus
}
#endif

#endif
