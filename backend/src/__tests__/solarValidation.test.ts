import request from "supertest";
import app from "../index";
import { signAuthToken } from "../utils/authToken";

function getAuthHeader(): string {
  const token = signAuthToken({
    userId: "00000000-0000-0000-0000-000000000001",
    email: "solar-validation-test@example.com",
    role: "admin",
  });
  return `Bearer ${token}`;
}

describe("POST /api/surveys/validate/solar", () => {
  it("accepts a valid payload", async () => {
    const res = await request(app)
      .post("/api/surveys/validate/solar")
      .set("Authorization", getAuthHeader())
      .send({
        customerName: "Jordan Solar",
        address: "100 Grid Avenue",
        gpsCoordinates: { latitude: 33.749, longitude: -84.388 },
        pitch: 27,
        azimuth: 185,
        roofType: "shingle",
        mainPanelAmps: 200,
        availableBreakerSlots: 4,
        photoUrls: ["https://example.com/photo-1.jpg"],
      });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.data.customerName).toBe("Jordan Solar");
  });

  it("rejects an invalid payload with issues", async () => {
    const res = await request(app)
      .post("/api/surveys/validate/solar")
      .set("Authorization", getAuthHeader())
      .send({
        customerName: "",
        address: "100 Grid Avenue",
        gpsCoordinates: { latitude: 120, longitude: -84.388 },
        pitch: 95,
        azimuth: 420,
        roofType: "slate",
        mainPanelAmps: -1,
        availableBreakerSlots: 1.5,
        photoUrls: ["not-a-url"],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid solar survey payload");
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(res.body.issues.length).toBeGreaterThan(0);
  });
});
