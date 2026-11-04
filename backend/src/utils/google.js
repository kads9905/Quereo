// Verifies a Google access token from the browser's Google sign-in popup.
// tokeninfo confirms the token was issued to *our* client id (so a token
// minted for another app can't be replayed here); userinfo gives the profile.
const TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export const googleClientId = () => process.env.GOOGLE_CLIENT_ID?.trim() || null;

export const verifyGoogleAccessToken = async (accessToken) => {
  const clientId = googleClientId();

  const info = await fetch(`${TOKENINFO_URL}?access_token=${encodeURIComponent(accessToken)}`);
  if (!info.ok) return null;
  const token = await info.json();
  if (token.aud !== clientId && token.azp !== clientId) return null;

  const profile = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!profile.ok) return null;
  const me = await profile.json();
  if (!me.sub || !me.email || me.email_verified === false) return null;

  return { googleId: me.sub, email: me.email.toLowerCase(), fullName: me.name || me.email.split("@")[0], avatarUrl: me.picture };
};
