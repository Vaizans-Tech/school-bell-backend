/** Public base URL behind reverse proxy (production HTTPS). */
function getPublicBaseUrl(req) {
  if (process.env.PUBLIC_API_URL) {
    return process.env.PUBLIC_API_URL.replace(/\/$/, '');
  }

  const forwardedProto = (req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const forwardedHost = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  let proto = forwardedProto || req.protocol || 'http';

  if (process.env.NODE_ENV === 'production') {
    proto = 'https';
  }

  return `${proto}://${forwardedHost}`;
}

function uploadsBaseUrl(req) {
  return `${getPublicBaseUrl(req)}/uploads/`;
}

module.exports = { getPublicBaseUrl, uploadsBaseUrl };
