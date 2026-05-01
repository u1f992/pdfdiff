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

#include "core.h"

#include <math.h>
#include <stdlib.h>
#include <string.h>

#define COORD_INITIAL_CAPACITY 256

typedef struct {
  int32_t *data;
  int32_t count;
  int32_t capacity;
} Coords;

static int32_t coords_init(Coords *c) {
  c->capacity = COORD_INITIAL_CAPACITY;
  c->count = 0;
  c->data = (int32_t *)malloc((size_t)c->capacity * 2 * sizeof(int32_t));
  if (!c->data) {
    return CORE_ERROR_ALLOC;
  }
  return CORE_OK;
}

static int32_t coords_push(Coords *c, int32_t x, int32_t y) {
  if (c->count >= c->capacity) {
    int32_t new_cap = c->capacity * 2;
    int32_t *new_data =
        (int32_t *)realloc(c->data, (size_t)new_cap * 2 * sizeof(int32_t));
    if (!new_data) {
      return CORE_ERROR_ALLOC;
    }
    c->data = new_data;
    c->capacity = new_cap;
  }
  c->data[c->count * 2] = x;
  c->data[c->count * 2 + 1] = y;
  c->count++;
  return CORE_OK;
}

static void coords_dispose(Coords *c) {
  free(c->data);
  c->data = NULL;
}

/*
 * Mirrors the original JS `composeLayers` Porter-Duff "over" math, including
 * Math.round() (round-half-up for non-negative values), to keep output
 * byte-identical to the previous JS implementation.
 */
static void blend_over(uint8_t *dst, uint8_t sr, uint8_t sg, uint8_t sb,
                       uint8_t s_alpha, double opacity) {
  double sa = ((double)s_alpha / 255.0) * opacity;
  if (sa == 0.0) {
    return;
  }
  double da = (double)dst[3] / 255.0;
  double oa = sa + da * (1.0 - sa);
  if (oa == 0.0) {
    return;
  }
  double sw = sa / oa;
  double dw = (da * (1.0 - sa)) / oa;
  dst[0] = (uint8_t)floor((double)sr * sw + (double)dst[0] * dw + 0.5);
  dst[1] = (uint8_t)floor((double)sg * sw + (double)dst[1] * dw + 0.5);
  dst[2] = (uint8_t)floor((double)sb * sw + (double)dst[2] * dw + 0.5);
  dst[3] = (uint8_t)floor(oa * 255.0 + 0.5);
}

void core_result_free(CoreResult *r) {
  if (!r) {
    return;
  }
  free(r->overlay);
  free(r->addition_xy);
  free(r->deletion_xy);
  free(r->modification_xy);
  memset(r, 0, sizeof(*r));
}

int32_t process_page(const uint8_t *a_pixels, const uint8_t *b_pixels,
                     const uint8_t *mask_pixels, int32_t width, int32_t height,
                     const CorePallet *pallet, CoreResult *out) {
  if (!a_pixels || !b_pixels || !pallet || !out) {
    return CORE_ERROR_INVALID;
  }
  if (width <= 0 || height <= 0) {
    return CORE_ERROR_INVALID;
  }

  memset(out, 0, sizeof(*out));

  size_t pixel_count = (size_t)width * (size_t)height;
  size_t byte_count = pixel_count * 4;

  uint8_t *overlay = (uint8_t *)calloc(byte_count, 1);
  if (!overlay) {
    return CORE_ERROR_ALLOC;
  }

  Coords add = {0}, del = {0}, mod = {0};
  if (coords_init(&add) != CORE_OK || coords_init(&del) != CORE_OK ||
      coords_init(&mod) != CORE_OK) {
    coords_dispose(&add);
    coords_dispose(&del);
    coords_dispose(&mod);
    free(overlay);
    return CORE_ERROR_ALLOC;
  }

  /* Diff layer (per-pixel pallet color) is reused into `overlay` directly:
     for each pixel we compute the diff classification, then alpha-over
     a*0.2, b*0.2, and the diff-pixel*1.0 onto overlay. The diff layer
     itself is never materialized as a separate buffer. */
  for (int32_t y = 0; y < height; y++) {
    for (int32_t x = 0; x < width; x++) {
      size_t idx = (size_t)(y * width + x) * 4;

      const uint8_t *ap = a_pixels + idx;
      const uint8_t *bp = b_pixels + idx;
      uint8_t *op = overlay + idx;

      /* Compose a (opacity 0.2). */
      blend_over(op, ap[0], ap[1], ap[2], ap[3], 0.2);
      /* Compose b (opacity 0.2). */
      blend_over(op, bp[0], bp[1], bp[2], bp[3], 0.2);

      if (mask_pixels && mask_pixels[idx + 3] != 0) {
        continue;
      }

      uint8_t a_alpha = ap[3];
      uint8_t b_alpha = bp[3];
      if (a_alpha == b_alpha && ap[0] == bp[0] && ap[1] == bp[1] &&
          ap[2] == bp[2]) {
        continue;
      }
      if (a_alpha == 0 && b_alpha == 0) {
        continue;
      }

      Coords *target;
      const CoreColor *color;
      if (a_alpha == 0) {
        target = &add;
        color = &pallet->addition;
      } else if (b_alpha == 0) {
        target = &del;
        color = &pallet->deletion;
      } else {
        target = &mod;
        color = &pallet->modification;
      }
      if (coords_push(target, x, y) != CORE_OK) {
        coords_dispose(&add);
        coords_dispose(&del);
        coords_dispose(&mod);
        free(overlay);
        return CORE_ERROR_ALLOC;
      }

      /* Compose diff pixel (opacity 1.0) on top. */
      blend_over(op, color->r, color->g, color->b, color->a, 1.0);
    }
  }

  out->overlay = overlay;
  out->addition_xy = add.data;
  out->addition_count = add.count;
  out->deletion_xy = del.data;
  out->deletion_count = del.count;
  out->modification_xy = mod.data;
  out->modification_count = mod.count;
  return CORE_OK;
}
