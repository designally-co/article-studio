import { redirect } from "next/navigation";

import { Wordmark } from "../mark";
import { Button } from "@/components/ui/button";
import { getSessionUser } from "@/lib/auth";
import { signIn, hasGoogleCredentials } from "@/auth";

export const dynamic = "force-dynamic";

/**
 * The door, in the studio's own language.
 *
 * It was the team app's door ported whole — the Cut across the window, the
 * Point on it, a pill — and it was the one screen in this product drawn from
 * another product's stylesheet. It is now made of what every other screen
 * here is made of: one white plate on the ground, the flat mark, an eyebrow,
 * a heading in the display face, a deck, and the primary Button. Nothing on
 * it exists anywhere else at a different size or in a different colour.
 *
 * ONE WAY IN. Google SSO on a Designally Workspace account, in every
 * environment including local development. There is no password field, no
 * "create an account", and no development fallback — a second way in that
 * exists only sometimes is the one nobody checks, and this page is the whole
 * perimeter.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const user = await getSessionUser();
  const { from } = await searchParams;
  // A path inside this app, never an absolute URL — an open redirect on a
  // sign-in page hands somebody else's site the trust of this domain.
  const target = from && from.startsWith("/") && !from.startsWith("//") ? from : "/";

  if (user) redirect(target);

  return (
    /* A CANVAS SURFACE, like Create: the page is the ground and one white
       object sits on it, holding all the attention. Sized to the screen on a
       phone and locked in its frame (data-fits-viewport, the rule in
       globals.css); centred in whatever window a desktop offers.

       ABOVE CENTRE, NOT ON IT. A tall, narrow object centred by arithmetic
       reads low, because the eye puts the optical centre above the geometric
       one. The extra bottom padding — a tenth of the screen on a phone, an
       eighth on a desktop — lifts the plate to roughly 45% of the window,
       where it reads as centred. */
    <main
      data-fits-viewport=""
      className="flex min-h-dvh items-center justify-center bg-bg px-3 pb-[calc(1rem+10dvh)] pt-4 sm:px-6 sm:pb-[calc(2.5rem+12dvh)] sm:pt-10"
    >
      {/* THE PLATE. The dock's own vocabulary — white, a hairline, the 16px
          corner — at the width of a form. No shadow: elevation here is
          structural, and the hairline is what says "object" on this ground. */}
      <section
        aria-labelledby="signin-title"
        className="w-full max-w-[26rem] rounded-2xl border border-line bg-surface p-6 sm:p-8"
      >
        {/* THE WORDMARK GETS ITS OWN ZONE. Set in the stack, a heavy caps
            word over the hero title read as a second heading. Here it heads
            the plate on a strip bled to the plate's edges over a hairline:
            the brand is who is asking, the title and the button below are
            the task. At 112 its caps stand about half the title's. It takes
            the place of the flat mark and the "Designally" eyebrow together:
            the word says both. */}
        <div className="-mx-6 -mt-6 border-b border-line px-6 py-5 sm:-mx-8 sm:-mt-8 sm:px-8">
          <Wordmark className="w-[112px]" />
        </div>
        <h1
          id="signin-title"
          className="mt-7 font-heading text-[length:var(--text-hero)] font-medium leading-[1.1] tracking-[-0.02em] text-ink"
        >
          Article Studio
        </h1>
        {/* What the product is for, in the one place the team sees it stated.
            It writes a draft from research; the editor still edits it — which
            is the promise this can actually keep. */}
        <p className="mt-3 text-sm leading-relaxed text-ink-2 sm:text-base">
          The draft you edit, instead of the blank page.
        </p>

        {hasGoogleCredentials ? (
          <form
            className="mt-8"
            action={async () => {
              "use server";
              await signIn("google", { redirectTo: target });
            }}
          >
            {/* The primary Button, full width: the one action on the screen,
                in the accent, eight pixels, like every other commit. */}
            <Button type="submit" className="w-full">
              <GoogleGlyph />
              Continue with Google
            </Button>
          </form>
        ) : (
          /* Not a second way in — the state where there is no way in at all.
             Without it this page renders as a lockup over nothing, with the
             reason only in the server log. The same notice Create shows when
             a key is missing. */
          <div className="mt-8 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3.5 text-sm leading-relaxed text-ink-2">
            <strong>Sign-in is not configured.</strong> Set <code>AUTH_GOOGLE_ID</code> and{" "}
            <code>AUTH_GOOGLE_SECRET</code>, and add this origin&rsquo;s{" "}
            <code>/api/auth/callback/google</code> to the OAuth client&rsquo;s authorised
            redirect URIs.
          </div>
        )}

        {/* Who can come in, stated under the door rather than discovered at
            it: a personal Google account gets as far as the consent screen
            and is turned away, and that is a worse place to learn the rule. */}
        <p className="mt-5 text-xs leading-relaxed text-ink-3">
          Designally Google Workspace accounts only.
        </p>
      </section>
    </main>
  );
}

/** Google's "G", in one colour — the button's own white, so the glyph sits on
 *  the accent the way every icon on an accent button does here. Drawn inline:
 *  it is the one place the product shows another brand's mark. */
function GoogleGlyph() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-4 shrink-0" fill="currentColor">
      <path d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5c-.3 1.5-1.1 2.8-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7zM12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.7-4.9H1.4v3.1C3.4 21.4 7.4 24 12 24zM5.3 14.4c-.2-.7-.4-1.5-.4-2.4s.1-1.6.4-2.4V6.5H1.4C.5 8.2 0 10 0 12s.5 3.8 1.4 5.5l3.9-3.1zM12 4.7c1.8 0 3.3.6 4.6 1.8l3.4-3.4C18 1.2 15.2 0 12 0 7.4 0 3.4 2.6 1.4 6.5l3.9 3.1c1-2.8 3.6-4.9 6.7-4.9z" />
    </svg>
  );
}
