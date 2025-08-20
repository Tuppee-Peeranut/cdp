import express from 'express';
import cors from 'cors';
import session from 'express-session';
import passport from 'passport';
import crypto from 'crypto';
import './auth/oidcStrategy.js';
import authRoutes from './auth/routes.js';
import { schema, root } from './auth/graphql.js';
import { graphqlHTTP } from 'express-graphql';
import openaiProxy from './openaiProxy.js';
import { authorize } from './auth/roles.js';

const SESSION_TIMEOUT_MS = 15 * 60 * 1000;

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  console.error('SESSION_SECRET environment variable is required');
  process.exit(1);
}

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: SESSION_TIMEOUT_MS
  }
}));
app.use((req, res, next) => {
  if (req.session) {
    const now = Date.now();
    if (req.session.lastActivity && now - req.session.lastActivity > SESSION_TIMEOUT_MS) {
      return req.session.destroy(() => res.status(440).send('Session expired'));
    }
    req.session.lastActivity = now;
    if (!req.session.csrfToken) {
      req.session.csrfToken = crypto.randomBytes(24).toString('hex');
    }
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const token = req.headers['x-csrf-token'];
      if (token !== req.session.csrfToken) {
        return res.status(403).send('Invalid CSRF token');
      }
    }
  }
  next();
});
app.use(passport.initialize());
app.use(passport.session());
app.use(express.json());
app.use('/auth', authRoutes);
app.use('/auth/graphql', (req, res) =>
  graphqlHTTP({
    schema,
    rootValue: root,
    graphiql: true,
    context: { req, res }
  })(req, res)
);
app.post('/api/chat', authorize('admin'), openaiProxy);

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
