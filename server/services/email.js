import fs from 'node:fs';
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

// Extract every URL the body refers to. Used by the E2E smoke spec to follow
// magic links / invite links without configuring a real SMTP inbox.
function extractLinks(text = '') {
  const matches = text.match(/https?:\/\/[^\s)>"']+/g);
  return matches ? matches : [];
}

const HTML_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPE[c]);
}

function sanitizeSubject(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ');
}

function appendE2eEmailLog(entry) {
  const path = process.env.E2E_EMAIL_LOG;
  if (!path) return;
  try {
    fs.appendFileSync(path, JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    logger.warn(`[E2E_EMAIL_LOG] append failed: ${err.message}`);
  }
}

export async function send({ to, subject, text, html }) {
  const t = getTransport();
  appendE2eEmailLog({
    timestamp: new Date().toISOString(),
    to,
    subject,
    text,
    links: extractLinks(text),
  });
  if (!t) {
    logger.info('[dev-email]', JSON.stringify({ to, subject, text }));
    return { delivered: false, dev: true };
  }
  await t.sendMail({
    from: config.smtp.from || `Basic Bugs <noreply@${new URL(config.baseUrl).hostname}>`,
    to,
    subject: sanitizeSubject(subject),
    text,
    html,
  });
  return { delivered: true };
}

export function magicLinkEmail({ url }) {
  const safeUrl = escapeHtml(url);
  return {
    subject: 'Your Basic Bugs sign-in link',
    text:
      `Click the link below to sign in to Basic Bugs.\n\n${url}\n\n` +
      `This link expires in 15 minutes and can be used only once. ` +
      `If you didn't request it, you can ignore this email.`,
    html:
      `<p>Click the link below to sign in to Basic Bugs.</p>` +
      `<p><a href="${safeUrl}">${safeUrl}</a></p>` +
      `<p>This link expires in 15 minutes and can be used only once. ` +
      `If you didn't request it, you can ignore this email.</p>`,
  };
}

export function passwordResetEmail({ url }) {
  const safeUrl = escapeHtml(url);
  return {
    subject: 'Reset your Basic Bugs password',
    text:
      `Click the link below to choose a new password.\n\n${url}\n\n` +
      `This link expires in 60 minutes and can be used only once. ` +
      `If you didn't request a reset, you can ignore this email.`,
    html:
      `<p>Click the link below to choose a new password.</p>` +
      `<p><a href="${safeUrl}">${safeUrl}</a></p>` +
      `<p>This link expires in 60 minutes and can be used only once. ` +
      `If you didn't request a reset, you can ignore this email.</p>`,
  };
}

export function inviteEmail({ url, projectName }) {
  const where = projectName ? `to the "${projectName}" project on Basic Bugs` : 'to Basic Bugs';
  const safeUrl = escapeHtml(url);
  const safeWhere = escapeHtml(where);
  return {
    subject: `You've been invited ${where}`,
    text: `You've been invited ${where}. Use the link below to set up your account:\n\n${url}\n`,
    html: `<p>You've been invited ${safeWhere}.</p><p><a href="${safeUrl}">${safeUrl}</a></p>`,
  };
}

export function notificationEmail({ subject, body, url }) {
  const safeBody = escapeHtml(body).replace(/\n/g, '<br>');
  const safeUrl = url ? escapeHtml(url) : null;
  return {
    subject,
    text: url ? `${body}\n\n${url}\n` : body,
    html: safeUrl
      ? `<p>${safeBody}</p><p><a href="${safeUrl}">${safeUrl}</a></p>`
      : `<p>${safeBody}</p>`,
  };
}

export function _resetTransportForTests() {
  transport = null;
}
