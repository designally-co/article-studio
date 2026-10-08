/** A NextAuth session cookie for the local demo editor (see prepare-db.mjs). */
import { encode } from "next-auth/jwt";

export async function sessionCookie({ userId, origin }) {
  const name = "authjs.session-token";
  const value = await encode({
    token: { uid: userId, sub: userId, name: "Demo Editor", email: "editor@example.com" },
    secret: process.env.AUTH_SECRET,
    salt: name,
  });
  return { name, value, url: origin, httpOnly: true, sameSite: "Lax" };
}
