// Verifies a Google Identity Services ID token. Exposed as an object so tests can stub `verify`.
const google = {
  async verify(credential) {
    const cid = process.env.GOOGLE_CLIENT_ID;
    if (!cid) { const e = new Error('Google sign-in is not configured on this server'); e.status = 503; throw e; }
    if (typeof credential !== 'string' || !credential || credential.length > 4096) { const e = new Error('Missing Google credential'); e.status = 400; throw e; }
    let info;
    try {
      const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
      info = r.ok ? await r.json() : null;
    } catch { const e = new Error('Could not reach Google to verify your sign-in'); e.status = 502; throw e; }
    if (!info || info.aud !== cid || !['accounts.google.com', 'https://accounts.google.com'].includes(info.iss)
      || String(info.email_verified) !== 'true' || +info.exp * 1000 < Date.now()) { const e = new Error('Google sign-in could not be verified'); e.status = 401; throw e; }
    return { email: String(info.email).toLowerCase(), name: info.name || '' };
  },
};
module.exports = google;
