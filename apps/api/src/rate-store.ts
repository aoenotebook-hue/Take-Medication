import { createHash } from "node:crypto";
import { pool } from "../../../db/client";
import type { Options, Store } from "express-rate-limit";

// Shared across cold starts; store only a hash of the limiter key.
export class PostgresRateStore implements Store {
  localKeys = false;
  private windowMs = 60000;
  constructor(private bucket: string) {}
  init(options: Options) {
    this.windowMs = options.windowMs;
  }
  private hash(key: string) {
    return createHash("sha256").update(key).digest("hex");
  }
  async increment(key: string) {
    const result = await pool.query(
      "INSERT INTO api_rate_limits VALUES($1,$2,1,now()+($3*interval '1 millisecond')) ON CONFLICT(bucket,key_hash) DO UPDATE SET hits=CASE WHEN api_rate_limits.reset_at<=now() THEN 1 ELSE api_rate_limits.hits+1 END,reset_at=CASE WHEN api_rate_limits.reset_at<=now() THEN excluded.reset_at ELSE api_rate_limits.reset_at END RETURNING hits,reset_at",
      [this.bucket, this.hash(key), this.windowMs],
    );
    return {
      totalHits: result.rows[0].hits,
      resetTime: result.rows[0].reset_at,
    };
  }
  async decrement(key: string) {
    await pool.query(
      "UPDATE api_rate_limits SET hits=greatest(0,hits-1) WHERE bucket=$1 AND key_hash=$2",
      [this.bucket, this.hash(key)],
    );
  }
  async resetKey(key: string) {
    await pool.query(
      "DELETE FROM api_rate_limits WHERE bucket=$1 AND key_hash=$2",
      [this.bucket, this.hash(key)],
    );
  }
}
