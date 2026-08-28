import * as fs from "node:fs";
import * as path from "node:path";
import { mapBaselinePath } from "./config.js";
import { isRev } from "./ingest-baseline.js";

interface SerializedMapBaseline {
  root: string;
  sourceRev: number;
}

export interface MapBaseline {
  sourceRev: number;
}

export function loadMapBaseline(projectRoot: string): MapBaseline | null {
  try {
    const data = JSON.parse(
      fs.readFileSync(mapBaselinePath(projectRoot), "utf-8"),
    ) as SerializedMapBaseline;
    if (data.root !== projectRoot || !isRev(data.sourceRev)) {
      return null;
    }
    return { sourceRev: data.sourceRev };
  } catch {
    return null;
  }
}

export function saveMapBaseline(projectRoot: string, sourceRev: number): boolean {
  if (!isRev(sourceRev)) return false;
  try {
    const data: SerializedMapBaseline = {
      root: projectRoot,
      sourceRev,
    };
    fs.mkdirSync(path.dirname(mapBaselinePath(projectRoot)), { recursive: true });
    fs.writeFileSync(mapBaselinePath(projectRoot), JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function hasCurrentMapBaseline(projectRoot: string, sourceRev: number): boolean {
  return loadMapBaseline(projectRoot)?.sourceRev === sourceRev;
}
