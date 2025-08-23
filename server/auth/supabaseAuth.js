import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('SUPABASE_JWT_SECRET environment variable is required');
}

export function authorize(required = []) {
  const requiredRoles = Array.isArray(required) ? required : [required];
  return function (req, res, next) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
      const role =
        payload?.user_metadata?.role || payload?.app_metadata?.role || payload.role || 'user';
      const tenantId =
        payload?.user_metadata?.tenant_id || payload?.app_metadata?.tenant_id || null;
      req.user = { id: payload.sub, role, tenantId };
        if (role !== 'super_admin' && requiredRoles.length && !requiredRoles.includes(role)) {
          return res.status(403).json({ error: 'Forbidden' });
        }
      next();
    } catch (err) {
      res.status(401).json({ error: 'Unauthorized' });
    }
  };
}
