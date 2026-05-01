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

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <cstdint>
#include <vector>

#include "core.h"

using emscripten::val;

static CoreColor unpackColor(uint32_t packed) {
  CoreColor c;
  c.r = (uint8_t)((packed >> 24) & 0xff);
  c.g = (uint8_t)((packed >> 16) & 0xff);
  c.b = (uint8_t)((packed >> 8) & 0xff);
  c.a = (uint8_t)(packed & 0xff);
  return c;
}

val processPage(val aPixelsVal, val bPixelsVal, val maskPixelsVal,
                int32_t width, int32_t height, uint32_t additionPacked,
                uint32_t deletionPacked, uint32_t modificationPacked) {
  if (width <= 0 || height <= 0 ||
      (int64_t)width * (int64_t)height > INT32_MAX) {
    return val(CORE_ERROR_INVALID);
  }

  std::vector<uint8_t> a =
      emscripten::convertJSArrayToNumberVector<uint8_t>(aPixelsVal);
  std::vector<uint8_t> b =
      emscripten::convertJSArrayToNumberVector<uint8_t>(bPixelsVal);

  bool hasMask = !maskPixelsVal.isNull() && !maskPixelsVal.isUndefined();
  std::vector<uint8_t> mask;
  if (hasMask) {
    mask = emscripten::convertJSArrayToNumberVector<uint8_t>(maskPixelsVal);
  }

  CorePallet pallet = {unpackColor(additionPacked), unpackColor(deletionPacked),
                       unpackColor(modificationPacked)};

  CoreResult result;
  int32_t rc = process_page(a.data(), b.data(), hasMask ? mask.data() : nullptr,
                            width, height, &pallet, &result);
  if (rc != CORE_OK) {
    return val(rc);
  }

  size_t pixelByteCount = (size_t)width * (size_t)height * 4;

  val obj = val::object();

  val overlayArr = val::global("Uint8Array").new_(pixelByteCount);
  overlayArr.call<void>("set", val(emscripten::typed_memory_view(
                                   pixelByteCount, result.overlay)));
  obj.set("overlay", overlayArr);

  auto attachCoords = [&](const char *name, int32_t *xy, int32_t count) {
    int32_t len = count * 2;
    val arr = val::global("Int32Array").new_(len);
    if (len > 0) {
      arr.call<void>("set",
                     val(emscripten::typed_memory_view((size_t)len, xy)));
    }
    obj.set(name, arr);
  };
  attachCoords("addition", result.addition_xy, result.addition_count);
  attachCoords("deletion", result.deletion_xy, result.deletion_count);
  attachCoords("modification", result.modification_xy,
               result.modification_count);

  core_result_free(&result);
  return obj;
}

EMSCRIPTEN_BINDINGS(core) { emscripten::function("processPage", &processPage); }
