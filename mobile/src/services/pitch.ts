/**
 * Converts a roof pitch ratio (e.g., "4/12") to degrees.
 * @param pitchString - The ratio as a string (e.g., "4/12")
 * @returns The angle in degrees rounded to two decimal places.
 */
export const convertPitchToDegrees = (pitchString: string): number => {
  const [riseRaw, runRaw] = pitchString.split("/");
  const rise = Number(riseRaw);
  const run = Number(runRaw);

  if (!Number.isFinite(rise) || !Number.isFinite(run) || run === 0) {
    throw new Error("Invalid pitch format. Use 'Rise/Run' (e.g., 4/12)");
  }

  const radians = Math.atan(rise / run);
  const degrees = radians * (180 / Math.PI);

  return Math.round(degrees * 100) / 100;
};
