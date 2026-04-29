import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { logger } from '../logger.js';

let transport = null;

function getTransport() {
  if (transport) return transport;
  if (!config.smtp.host) return null;
  transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user
      ? { user: config.smtp.user, pass: config.smtp.pass }
      : undefined,
  });
  return transport;
}

export async function send({ to, subject, text, html }) {
  const t = getTransport();
  if (!t) {
    logger.info('[dev-email]', JSON.stringify({ to, subject, text }));
    return { delivered: false, dev: true };
  }
  await t.sendMail({
    from: config.smtp.from || `Basic Bugs <noreply@${new URL(config.baseUrl).hostname}>`,
    to,
    subject,
    text,
    html,
  });
  return { delivered: true };
}

export function magicLinkEmail({ url }) {
  return {
    subject: 'Your Basic Bugs sign-in link',
    text:
      `Click the link below to sign in to Basic Bugs.\n\n${url}\n\n` +
      `This link expires in 15 minutes and can be used only once. ` +
      `If you didn't request it, you can ignore this email.`,
    html:
      `<p>Click the link below to sign in to Basic Bugs.</p>` +
      `<p><a href="${url}">${url}</a></p>` +
      `<p>This link expires in 15 minutes and can be used only once. ` +
      `If you didn't request it, you can ignore this email.</p>`,
  };
}

export function passwordResetEmail({ url }) {
  return {
    subject: 'Reset your Basic Bugs password',
    text:
      `Click the link below to choose a new password.\n\n${url}\n\n` +
      `This link expires in 60 minutes and can be used only once. ` +
      `If you didn't request a reset, you can ignore this email.`,
    html:
      `<p>Click the link below to choose a new password.</p>` +
      `<p><a href="${url}">${url}</a></p>` +
      `<p>This link expires in 60 minutes and can be used only once. ` +
      `If you didn't request a reset, you can ignore this email.</p>`,
  };
}

export function inviteEmail({ url, projectName }) {
  const where = projectName ? `to the "${projectName}" project on Basic Bugs` : 'to Basic Bugs';
  return {
    subject: `You've been invited ${where}`,
    text: `You've been invited ${where}. Use the link below to set up your account:\n\n${url}\n`,
    html: `<p>You've been invited ${where}.</p><p><a href="${url}">${url}</a></p>`,
  };
}

export function notificationEmail({ subject, body, url }) {
  return {
    subject,
    text: url ? `${body}\n\n${url}\n` : body,
    html: url ? `<p>${body}</p><p><a href="${url}">${url}</a></p>` : `<p>${body}</p>`,
  };
}

export function _resetTransportForTests() {
  transport = null;
}
