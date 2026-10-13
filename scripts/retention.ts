import { pool } from "../db/client";
import { runRetention } from "../apps/worker/src/retention";
console.log(await runRetention(100, 300000));
await pool.end();
