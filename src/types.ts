export type Mode = 3 | 6 | 12;

export interface Palette {
  version: 1;
  name: string;
  mode: Mode;
  primary: string;   // hex, e.g. "#dd7596"
  slots: string[];   // length === mode; each is hex
}

export const MODES: Mode[] = [3, 6, 12];

// Canonical 12-slot table. Smaller modes are fixed subsets — names line up.
export const SLOT_NAMES_12 = [
  "red", "orange", "yellow", "lime", "green", "teal",
  "turquoise", "azure", "blue", "purple", "magenta", "pink",
] as const;

export const SLOT_RGB_HUES_12 = [
  0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330,
] as const;

// Indices into the 12-slot table that the smaller modes use.
export const MODE_INDICES: Record<Mode, number[]> = {
  3:  [0, 4, 8],
  6:  [0, 2, 4, 6, 8, 10],
  12: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
