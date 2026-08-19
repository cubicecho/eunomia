import nodemailer from 'nodemailer';

// SMTP when configured; otherwise a stream transport so dev works without a
// mail server — the magic link is printed to the console instead.
function createTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

  if (SMTP_HOST) {
    return nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT ?? 587),
      secure: Number(SMTP_PORT) === 465,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });
  }

  return nodemailer.createTransport({ streamTransport: true, newline: 'unix' });
}

const transport = createTransport();
const FROM = process.env.EMAIL_FROM ?? 'eunomia <noreply@eunomia.local>';

export interface MagicLinkMessage {
  email: string;
  url: string;
  token: string;
}

export async function sendMagicLinkEmail({ email, url }: MagicLinkMessage): Promise<void> {
  const info = await transport.sendMail({
    from: FROM,
    to: email,
    subject: 'Your eunomia sign-in link',
    text: `Click this link to sign in to eunomia (expires in 15 minutes):\n\n${url}\n\nIf you did not request this, you can safely ignore this email.`,
    html: `
      <p>Click the button below to sign in to eunomia. This link expires in 15 minutes.</p>
      <p style="margin:24px 0">
        <a href="${url}" style="background:#18181b;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
          Sign in to eunomia
        </a>
      </p>
      <p style="color:#71717a;font-size:13px">Or copy this URL into your browser:<br>${url}</p>
      <p style="color:#71717a;font-size:13px">If you did not request this, you can safely ignore this email.</p>
    `,
  });

  if (!process.env.SMTP_HOST) {
    console.log('\n──────────────────────────────────────────');
    console.log('📧  Magic link for', email);
    console.log(url);
    console.log('──────────────────────────────────────────\n');
    if ('message' in info && info.message) {
      (info as { message: NodeJS.ReadableStream }).message.resume();
    }
  }
}
