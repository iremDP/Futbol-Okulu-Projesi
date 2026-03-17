/**
 * Mail, PDF font vb. servisler
 */
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

let mailTransporter = null;

function getMailTransporter() {
  if (mailTransporter) return mailTransporter;
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpHost || !smtpUser || !smtpPass) return null;
  mailTransporter = nodemailer.createTransport({
    host: smtpHost,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_PORT === '465',
    auth: { user: smtpUser, pass: smtpPass }
  });
  return mailTransporter;
}

function getPdfFontPath() {
  const candidates = [
    path.join(__dirname, '..', 'fonts', 'DejaVuSans.ttf'),
    path.join(__dirname, '..', 'fonts', 'NotoSans-Regular.ttf')
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  const windowsFont = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'arial.ttf');
  if (fs.existsSync(windowsFont)) return windowsFont;
  return null;
}

module.exports = {
  getMailTransporter,
  getPdfFontPath
};
