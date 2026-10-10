const nodemailer = require('nodemailer');

const smtp = process.env.SMTP_HOST ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: +(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true',
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
}) : null;

const configured = !!smtp;
const from = process.env.SMTP_USER ? `Argus Field <${process.env.SMTP_USER}>` : 'Argus Field <no-reply@argus.local>';

function template({ org, name, empId, designation, link, hours, email, isAdmin }) {
  return `<!doctype html><html><body style="margin:0;background:#f4f5fb;font-family:Segoe UI,Arial,sans-serif;color:#1b1d2e">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">
<table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 8px 30px rgba(60,50,160,.10)">
<tr><td style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:28px 32px;color:#fff;font-size:20px;font-weight:700">${org}</td></tr>
<tr><td style="padding:32px">
<h2 style="margin:0 0 8px;font-size:22px">Hi ${name}, you're invited 👋</h2>
<p style="color:#5b5f78;line-height:1.6;margin:0 0 20px">${isAdmin ? `You've been added as an <b>admin</b> (${designation}) on ${org}. Open the link below and continue with <b>this Google account</b> (${email}) to get access to the admin console. Next time, just sign in with Google.` : `You've been added as <b>${designation}</b> (ID <b>${empId}</b>) on ${org}. Open the link below and continue with <b>this Google account</b> (${email}), then register your face to start logging customer site visits. Next time, just sign in with Google.`}</p>
<a href="${link}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;font-weight:600;padding:14px 26px;border-radius:12px">Complete registration</a>
<p style="color:#8a8ea6;font-size:13px;line-height:1.6;margin:24px 0 0">This secure link expires in ${hours} hours and can be used once. If the button doesn't work, paste this into your browser:<br><span style="word-break:break-all;color:#4f46e5">${link}</span></p>
</td></tr></table></td></tr></table></body></html>`;
}

async function sendInvite(user, link, settings) {
  const html = template({ org: settings.orgName, name: user.name, empId: user.empId, designation: user.designation, link, hours: settings.inviteHours, email: user.email, isAdmin: user.role === 'admin' });
  if (!smtp) {
    console.log(`\n[mail:dev] SMTP not configured. Invitation link for ${user.email}:\n  ${link}\n`);
    return { sent: false };
  }
  await smtp.sendMail({ from, to: user.email, subject: `You're invited to ${settings.orgName}`, html, text: `Hi ${user.name}, complete your registration: ${link}` });
  return { sent: true };
}

module.exports = { sendInvite, configured };
