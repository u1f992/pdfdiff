export type RGBAColor = [number, number, number, number];

export const parseHex = (hex: string) => {
  if (/^#([0-9a-fA-F]{3})$/.test(hex)) {
    return [
      parseInt(hex[1]! + hex[1]!, 16),
      parseInt(hex[2]! + hex[2]!, 16),
      parseInt(hex[3]! + hex[3]!, 16),
      255,
    ] as RGBAColor;
  }
  if (/^#([0-9a-fA-F]{4})$/.test(hex)) {
    return [
      parseInt(hex[1]! + hex[1]!, 16),
      parseInt(hex[2]! + hex[2]!, 16),
      parseInt(hex[3]! + hex[3]!, 16),
      parseInt(hex[4]! + hex[4]!, 16),
    ] as RGBAColor;
  }
  if (/^#([0-9a-fA-F]{6})$/.test(hex)) {
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
      255,
    ] as RGBAColor;
  }
  if (/^#([0-9a-fA-F]{8})$/.test(hex)) {
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
      parseInt(hex.slice(7, 9), 16),
    ] as RGBAColor;
  }
  return null;
};

export const formatHex = ([r, g, b, a]: RGBAColor) =>
  "#" +
  [r, g, b, a]
    .map((v) => {
      const hex = v.toString(16);
      return hex.length === 1 ? "0" + hex : hex;
    })
    .join("");
