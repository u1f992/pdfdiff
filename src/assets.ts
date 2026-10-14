import { assetVersions } from "./asset-versions.ts";

export function assetQuery(file: string): string {
  const version = assetVersions[file];
  return version === undefined ? "" : `?v=${encodeURIComponent(version)}`;
}

export function locateVersioned(file: string, directory: string): string {
  return `${directory}${file}${assetQuery(file)}`;
}
