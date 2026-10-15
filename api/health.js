// GET /api/health - Lightweight status & capabilities check
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    status: 'ok',
    version: '2.0.0',
    suite: 'HACHIHI PDF Tool',
    clientFirst: true,
    features: ['compress', 'pdf2word', 'pdf2excel', 'ocr', 'sign', 'form', 'redact']
  });
}
