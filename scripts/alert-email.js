#!/usr/bin/env node
// Best-effort operator alert emailer for the Litestream boot gate.
//
// Usage: node scripts/alert-email.js <event>
//   events: gate-fired | restore-complete
//
// Reuses the SMTP config already set for invite/notification emails
// (SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM)
// and sends to SUPER_ADMIN_EMAIL. If any of those are missing, logs a
// warning and exits 0 — this script MUST NOT block the container
// entrypoint.
//
// Wraps the send call in a 15s timeout so a broken/stalled SMTP server
// can't hang boot.

import fs from 'node:fs';
import os from 'node:os';
import nodemailer from 'nodemailer';

const TIMEOUT_MS = 15_000;

async function main() {
  const event = process.argv[2];
  if (!event || !['gate-fired', 'restore-complete'].includes(event)) {
    console.error('[alert-email] usage: alert-email.js <gate-fired|restore-complete>');
    process.exit(0); // still best-effort; don't block boot
  }

  const to = process.env.SUPER_ADMIN_EMAIL;
  const smtpHost = process.env.SMTP_HOST;
  const from = process.env.SMTP_FROM;
  if (!to || !smtpHost || !from) {
    console.warn(
      `[alert-email] SMTP_HOST/SMTP_FROM/SUPER_ADMIN_EMAIL not fully set — skipping ${event} alert.`,
    );
    return;
  }

  const app = process.env.FLY_APP_NAME || 'basicbugs';
  const machine = process.env.FLY_MACHINE_ID || os.hostname();
  const region = process.env.FLY_REGION || 'unknown';
  const now = new Date().toISOString();

  const dbPath = process.env.DB_PATH || '/data/basicbugs.sqlite';
  let dbSize = null;
  try {
    dbSize = fs.statSync(dbPath).size;
  } catch {
    /* missing is fine */
  }

  const { subject, text } = composeMessage(event, { app, machine, region, now, dbSize });

  const transport = nodemailer.createTransport({
    host: smtpHost,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        }
      : undefined,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });

  const send = transport.sendMail({ from, to, subject, text });
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`SMTP send exceeded ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
  );

  await Promise.race([send, timeout]);
  console.log(`[alert-email] ${event} → ${to} (${app}/${machine})`);
}

function composeMessage(event, ctx) {
  const { app, machine, region, now, dbSize } = ctx;
  if (event === 'gate-fired') {
    return {
      subject: `[${app}] Database missing — manual restore required`,
      text: [
        `App:       ${app}`,
        `Machine:   ${machine}`,
        `Region:    ${region}`,
        `Timestamp: ${now} (UTC)`,
        '',
        'The Litestream boot gate refused to start Node because',
        '/data/basicbugs.sqlite is missing and no /data/.allow-restore sentinel',
        'was present. The container is now running an idle sleep loop so',
        'SSH remains reachable. Node is NOT running; no writes are happening;',
        'the replica is untouched.',
        '',
        'Action required: review the incident, confirm this is the correct',
        'app/volume, then follow the manual restore procedure documented in',
        'BACKUPS.md.',
      ].join('\n'),
    };
  }
  return {
    subject: `[${app}] Database restore complete`,
    text: [
      `App:       ${app}`,
      `Machine:   ${machine}`,
      `Region:    ${region}`,
      `Timestamp: ${now} (UTC)`,
      `Restored:  ${dbSize != null ? `${dbSize} bytes` : '(size unknown)'}`,
      '',
      'Litestream restored /data/basicbugs.sqlite from the Tigris replica',
      'and Node is about to start. The /data/.allow-restore sentinel has',
      'been consumed so subsequent reboots will take the normal path.',
      '',
      'Verify: spot-check recent issues / activity for surprises; if',
      'anything looks off, see the point-in-time restore instructions in',
      'BACKUPS.md.',
    ].join('\n'),
  };
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`[alert-email] send failed: ${err.message}`);
    process.exit(0); // best-effort; never block boot
  });
