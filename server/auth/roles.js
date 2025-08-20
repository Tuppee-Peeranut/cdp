import jwt from 'jsonwebtoken';

export const ROLES = {
  USER: 'user',
  ADMIN: 'admin'
};

export const ROLE_PERMISSIONS = {
  [ROLES.USER]: [],
  [ROLES.ADMIN]: ['chat:write']
};

const ACCESS_SECRET = process.env.ACCESS_TOKEN_SECRET || 'access-secret';

export function authorize(required = []) {
  const requiredRoles = Array.isArray(required) ? required : [required];
  return function (req, res, next) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const payload = jwt.verify(token, ACCESS_SECRET);
      req.user = { id: payload.userId, role: payload.role };
      if (requiredRoles.length && !requiredRoles.includes(payload.role)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      next();
    } catch (err) {
      res.status(401).json({ error: 'Unauthorized' });
    }
  };
}

export function hasPermission(role, permission) {
  return ROLE_PERMISSIONS[role]?.includes(permission);
}
