import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const COOKIE = "cmo_session";
const SESSION_DAYS = 30;

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest();

/**
 * Single-user password login for running the interface on a server.
 *
 * A session is a signed expiry time kept in a cookie, so nothing is stored per session and logins
 * survive a restart. The signing key is random, lives in the data folder, and is bound to the
 * password: changing the password signs everyone out.
 */
export class Auth {
  private readonly key: Buffer;
  private failures = 0;
  private lockedUntil = 0;

  constructor(
    private readonly password: string,
    secretFile: string,
    private readonly secureCookie: boolean,
  ) {
    if (password.length < 12) throw new Error("CMO_PASSWORD must be at least 12 characters.");
    if (!fs.existsSync(secretFile)) {
      fs.mkdirSync(path.dirname(secretFile), { recursive: true });
      fs.writeFileSync(secretFile, crypto.randomBytes(32).toString("hex"), { mode: 0o600 });
    }
    this.key = crypto.createHmac("sha256", fs.readFileSync(secretFile, "utf8").trim()).update(password).digest();
  }

  /**
   * Checks a login attempt. After each wrong password every attempt is refused for a growing
   * wait (2 s doubling to 5 min), which makes guessing a 12+ character password impractical.
   * The wait is global: behind a reverse proxy all clients share one address.
   */
  login(password: unknown, now = Date.now()): { ok: true; cookie: string } | { ok: false; retryAfterSeconds: number } {
    if (now < this.lockedUntil) return { ok: false, retryAfterSeconds: Math.ceil((this.lockedUntil - now) / 1000) };
    const correct = typeof password === "string" && crypto.timingSafeEqual(sha256(password), sha256(this.password));
    if (!correct) {
      this.failures++;
      const wait = Math.min(2 ** this.failures, 300);
      this.lockedUntil = now + wait * 1000;
      return { ok: false, retryAfterSeconds: wait };
    }
    this.failures = 0;
    const expires = now + SESSION_DAYS * 86_400_000;
    return { ok: true, cookie: this.setCookie(`${expires}.${this.sign(expires)}`, SESSION_DAYS * 86_400) };
  }

  logoutCookie(): string {
    return this.setCookie("", 0);
  }

  isSignedIn(cookieHeader: string | undefined, now = Date.now()): boolean {
    const value = cookieHeader
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1);
    const [expires, signature] = value?.split(".") ?? [];
    if (!expires || !signature || !/^\d+$/.test(expires) || Number(expires) < now) return false;
    const expected = Buffer.from(this.sign(Number(expires)));
    const given = Buffer.from(signature);
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  }

  private sign(expires: number): string {
    return crypto.createHmac("sha256", this.key).update(`session:${expires}`).digest("hex");
  }

  private setCookie(value: string, maxAge: number): string {
    return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${this.secureCookie ? "; Secure" : ""}`;
  }
}
