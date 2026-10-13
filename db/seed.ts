import { pool } from "./client.js";
export const demoUser = "11111111-1111-4111-a111-111111111111";
export const demoPatient = "22222222-2222-4222-a222-222222222222";
if (process.env.NODE_ENV === "production")
  throw new Error("Synthetic seed disabled in production");
await pool.query(
  "INSERT INTO users(id,display_name) VALUES($1,$2) ON CONFLICT DO NOTHING",
  [demoUser, "Synthetic demo"],
);
await pool.query(
  "INSERT INTO patients(id,owner_id,data) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
  [
    demoPatient,
    demoUser,
    {
      displayName: "ผู้ป่วยตัวอย่าง / Demo patient",
      language: "th",
      timezone: "Asia/Bangkok",
      allergyStatus: "unknown",
      allergies: [],
    },
  ],
);
await pool.query(
  "INSERT INTO memberships VALUES($1,$2,'owner',NULL) ON CONFLICT DO NOTHING",
  [demoPatient, demoUser],
);
await pool.end();
console.log("Synthetic profile seeded; no medicine instructions invented");
