import fs from "fs";
import path from "path";
import request from "supertest";
import app from "../index";
import { signAuthToken } from "../utils/authToken";

function getAuthHeader(): string {
  const token = signAuthToken({
    userId: "00000000-0000-0000-0000-000000000001",
    email: "upload-test@example.com",
    role: "admin",
  });
  return `Bearer ${token}`;
}

describe("POST /api/surveys/upload", () => {
  it("returns 401 without authorization", async () => {
    const res = await request(app)
      .post("/api/surveys/upload")
      .attach("image", Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
        filename: "unauthorized.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(401);
  });

  it("uploads an image and returns filePath", async () => {
    const res = await request(app)
      .post("/api/surveys/upload")
      .set("Authorization", getAuthHeader())
      .attach("image", Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
        filename: "test.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(201);
    expect(typeof res.body.filePath).toBe("string");
    expect(res.body.filePath).toMatch(/^\/uploads\/.+/);

    const uploadsDir = path.join(__dirname, "..", "..", "uploads");
    const filename = path.basename(res.body.filePath);
    const fullPath = path.join(uploadsDir, filename);

    expect(fs.existsSync(fullPath)).toBe(true);

    fs.unlinkSync(fullPath);
  });

  it("returns 400 when no file is provided", async () => {
    const res = await request(app)
      .post("/api/surveys/upload")
      .set("Authorization", getAuthHeader());

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("No image file uploaded");
  });

  it("returns 400 for non-image uploads", async () => {
    const res = await request(app)
      .post("/api/surveys/upload")
      .set("Authorization", getAuthHeader())
      .attach("image", Buffer.from("plain text"), {
        filename: "not-image.txt",
        contentType: "text/plain",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Only image files are allowed");
  });

  it("returns 413 when image exceeds 10MB", async () => {
    const oversizedImage = Buffer.alloc(10 * 1024 * 1024 + 1, 0xff);

    const res = await request(app)
      .post("/api/surveys/upload")
      .set("Authorization", getAuthHeader())
      .attach("image", oversizedImage, {
        filename: "too-large.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(413);
    expect(res.body.error).toBe("Image exceeds 10MB limit");
  });
});
