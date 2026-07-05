const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const DIR = path.join(__dirname, '..', 'docs', 'prompts');

const FILES = [
  {
    md: 'CONTROLLER_APP_LIVE_WEBRTC_PROMPT.md',
    pdf: 'Prompt-1-Controller-App-Live-WebRTC.pdf',
    title: 'Prompt 1 — Controller App',
  },
  {
    md: 'PLAYER_APP_LIVE_WEBRTC_PROMPT.md',
    pdf: 'Prompt-2-Player-App-Live-WebRTC.pdf',
    title: 'Prompt 2 — Player App',
  },
  {
    md: 'LIVE_WEBRTC_SYSTEM_OVERVIEW.md',
    pdf: 'Live-WebRTC-System-Overview.pdf',
    title: 'Live WebRTC — System Overview',
  },
  {
    md: 'LIVE_WEBRTC_ICE_FIX_APP_PROMPT.md',
    pdf: 'Live-WebRTC-ICE-Fix-App-Prompt.pdf',
    title: 'Live WebRTC — ICE Fix (App Prompt)',
  },
];

function writePdf(mdPath, pdfPath, title) {
  const text = fs.readFileSync(mdPath, 'utf8');
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  const stream = fs.createWriteStream(pdfPath);
  doc.pipe(stream);

  doc.fontSize(18).text(title, { underline: true });
  doc.moveDown();
  doc.fontSize(10).text(text, { lineGap: 3, align: 'left' });

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

async function main() {
  for (const f of FILES) {
    const mdPath = path.join(DIR, f.md);
    const pdfPath = path.join(DIR, f.pdf);
    await writePdf(mdPath, pdfPath, f.title);
    console.log('Created:', pdfPath);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
