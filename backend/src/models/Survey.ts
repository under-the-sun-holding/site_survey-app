import { z } from "zod";

export interface SolarSurvey {
  customerName: string;
  address: string;
  gpsCoordinates: {
    latitude: number;
    longitude: number;
  };
  pitch: number;
  azimuth: number;
  roofType: "shingle" | "tile" | "metal";
  mainPanelAmps: number;
  availableBreakerSlots: number;
  photoUrls: string[];
}

export const solarSurveySchema: z.ZodType<SolarSurvey> = z.object({
  customerName: z.string().min(1),
  address: z.string().min(1),
  gpsCoordinates: z.object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  }),
  pitch: z.number().finite().min(0).max(90),
  azimuth: z.number().finite().min(0).max(360),
  roofType: z.enum(["shingle", "tile", "metal"]),
  mainPanelAmps: z.number().finite().nonnegative(),
  availableBreakerSlots: z.number().int().nonnegative(),
  photoUrls: z.array(z.string().url()),
});

export type SolarSurveyInput = z.infer<typeof solarSurveySchema>;
